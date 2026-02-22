/**
 * 알고리즘 기반 원문-STT 텍스트 비교
 *
 * 핵심 설계: "비교는 요미가나로, 표시는 원문으로"
 *
 * 처리 순서:
 * 1. buildNormalized(): 문장 전체를 kuromoji로 형태소 분석 → hiragana 변환 + posMap 생성
 *    - 문장 단위라 문맥을 반영: "獲得した後" → "かくとくしたあと" (単独 後 → のち 문제 해결)
 *    - posMap[i] = { origStart, origEnd } : 히라가나 i번째 문자가 원문의 어느 형태소 span인지
 * 2. diff-match-patch로 hiragana끼리 비교 (결정적)
 *    - 같은 발음 = equal op → 에러 없음 (花織/浩里 둘 다 かおり면 equal)
 * 3. posMap으로 diff 결과를 원문으로 복원 → カタカナ/한자 그대로 표시
 * 4. classifyReplace(): 남은 replace 토큰에 severity 부여
 *    - replace = 발음이 실제로 다름 (같은 발음이면 이미 equal)
 */
import DiffMatchPatch from 'diff-match-patch';

// ===== 타입 =====

export type WordDiff = {
  kind: 'equal' | 'replace' | 'delete' | 'insert';
  ref: string;      // 원문 텍스트 (カタカナ/한자 그대로 표시)
  hyp: string;      // STT 인식 텍스트
  severity: 'high' | 'medium' | 'low' | 'none';
  reason?: 'meaning_change' | 'orthography' | 'proper_noun' | 'punctuation' | 'unknown';
};

/**
 * posMap 엔트리: 히라가나 1문자가 원문의 어느 위치 범위에서 왔는지
 * 한자 1글자가 여러 히라가나로 변환되므로 단순 index가 아닌 span 필요
 * 예: 花織(2chars) → かおり(3chars) → 3개 엔트리 모두 {origStart:0, origEnd:2}
 */
type PosEntry = { origStart: number; origEnd: number };

// ===== kuroshiro 싱글톤 =====

let _kuroshiro: any = null;
let _kuroshiroReady: Promise<boolean> | null = null;

async function initKuroshiro(): Promise<boolean> {
  try {
    const [kuroMod, kuromojiMod] = await Promise.all([
      import('kuroshiro'),
      import('kuroshiro-analyzer-kuromoji'),
    ]);
    // CJS 모듈 ESM dynamic import 시 default.default 이중 래핑
    const Kuroshiro = kuroMod.default?.default ?? kuroMod.default ?? kuroMod;
    const KuromojiAnalyzer = kuromojiMod.default?.default ?? kuromojiMod.default ?? kuromojiMod;
    _kuroshiro = new Kuroshiro();
    await _kuroshiro.init(new KuromojiAnalyzer());
    console.log('[textDiff] kuroshiro 초기화 완료');
    return true;
  } catch (e) {
    console.warn('[textDiff] kuroshiro 초기화 실패 (카타카나→히라가나 fallback 사용):', e);
    return false;
  }
}

_kuroshiroReady = initKuroshiro();

// ===== 정규화 유틸 =====

/** カタカナ → ひらがな (1:1, ア~ン 범위) */
function katakanaToHiragana(s: string): string {
  return s.replace(/[\u30A1-\u30F3]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

/** 비교 시 제거할 구두점 */
const REMOVE_CHARS = new Set([...'。、「」『』【】〔〕・…']);

/** origSpan 결과 앞뒤 구두점/공백 제거 */
const PUNCT_TRIM_RE = /^[。、「」『』【】〔〕・…\s]+|[。、「」『』【】〔〕・…\s]+$/g;

/**
 * ASCII 숫자 → 히라가나 변환 (kuromoji 경로)
 * 2 → に, 二 → くromoji reading ニ → に → 동일하게 처리
 */
const DIGIT_HIRA: Record<string, string> = {
  '0': 'ぜろ', '1': 'いち', '2': 'に', '3': 'さん', '4': 'し',
  '5': 'ご', '6': 'ろく', '7': 'なな', '8': 'はち', '9': 'きゅう',
};

/**
 * ASCII 숫자 → 한자 변환 (fallback 경로)
 * 2 → 二, 二 → 二 → 동일하게 처리
 */
const NUM_TO_KANJI: Record<string, string> = {
  '0': '〇', '1': '一', '2': '二', '3': '三', '4': '四',
  '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
};

/** 문자열에 한자(CJK)가 포함되어 있는지 확인 */
function hasKanjiInStr(s: string): boolean {
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s);
}

/**
 * [메인] 텍스트 정규화 + posMap 생성
 *
 * kuroshiro 사용 가능 시: kuromoji 형태소 분석으로 한자 → 히라가나 변환
 *   → 문맥 반영으로 정확도 향상 (獲得した後 → かくとくしたあと)
 * 불가 시: 카타카나→히라가나만 (fallback)
 */
async function buildNormalized(text: string): Promise<{
  normalized: string;
  posMap: PosEntry[];
  trimmed: string;
}> {
  const trimmed = text.trim();
  const ready = await _kuroshiroReady;

  if (ready && _kuroshiro) {
    try {
      return await buildNormalizedKuro(trimmed);
    } catch (e) {
      console.warn('[textDiff] kuromoji 분석 실패, fallback 사용:', e);
    }
  }

  return buildNormalizedFallback(trimmed);
}

/**
 * kuromoji 형태소 분석을 이용한 정규화
 * _kuroshiro._analyzer.parse() → 형태소 토큰 배열
 * 각 토큰: { surface_form: 원문, reading: 카타카나 읽기 }
 *
 * posMap 전략:
 * - surface에 한자 없음(카타카나/히라가나/ASCII): 문자별 posMap (세밀한 diff)
 *   예: ミラノ→みらの, 각 문자가 독립적 posMap 항목 → ミ↔イ 처럼 세밀하게 비교 가능
 * - surface에 한자 있음: reading 사용 + 형태소 단위 posMap
 *   예: 花織→かおり (2자→3자 확장), posMap 3항목 모두 {0,2}(花織) 가리킴
 */
async function buildNormalizedKuro(trimmed: string): Promise<{
  normalized: string;
  posMap: PosEntry[];
  trimmed: string;
}> {
  const tokens: any[] = await _kuroshiro._analyzer.parse(trimmed);

  let normalized = '';
  const posMap: PosEntry[] = [];
  let origPos = 0;

  for (const token of tokens) {
    const surface: string = token.surface_form;
    const surfaceStart = origPos;
    const surfaceEnd = origPos + surface.length;
    origPos = surfaceEnd;

    const rawReading: string | undefined = token.reading;
    const hasReading = !!(rawReading && rawReading !== surface);

    if (hasReading && hasKanjiInStr(surface)) {
      // 한자 포함 형태소: reading 사용 + 형태소 단위 posMap
      // 예: 花織(2자) → かおり(3자) → 3항목 모두 {surfaceStart, surfaceEnd}
      const readingHira = katakanaToHiragana(rawReading!);
      for (const ch of readingHira) {
        if (REMOVE_CHARS.has(ch)) continue;
        normalized += ch;
        posMap.push({ origStart: surfaceStart, origEnd: surfaceEnd });
      }
    } else {
      // 한자 없음 (카타카나/히라가나/ASCII 등): 문자별 posMap (세밀도 유지)
      // 예: ミラノ → み(0,1)ら(1,2)の(2,3) → ミ↔イ 처럼 세밀하게 비교
      for (let j = 0; j < surface.length; j++) {
        const ch = surface[j];
        if (REMOVE_CHARS.has(ch)) continue;

        const digitHira = DIGIT_HIRA[ch];
        if (digitHira) {
          // ASCII 숫자: DIGIT_HIRA로 변환 (2→に, 二→kuromoji→に 로 동일하게 처리)
          for (const hch of digitHira) {
            normalized += hch;
            posMap.push({ origStart: surfaceStart + j, origEnd: surfaceStart + j + 1 });
          }
        } else {
          normalized += katakanaToHiragana(ch);
          posMap.push({ origStart: surfaceStart + j, origEnd: surfaceStart + j + 1 });
        }
      }
    }
  }

  return { normalized, posMap, trimmed };
}

/**
 * fallback: 카타카나→히라가나만 (kuroshiro 없을 때)
 * 한자는 그대로 남아 diff에서 글자 단위 비교
 */
function buildNormalizedFallback(trimmed: string): {
  normalized: string;
  posMap: PosEntry[];
  trimmed: string;
} {
  const posMap: PosEntry[] = [];
  let normalized = '';

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (REMOVE_CHARS.has(ch)) continue;
    let conv = katakanaToHiragana(ch);
    conv = NUM_TO_KANJI[conv] ?? conv; // 숫자→한자: 2↔二 동일 처리
    normalized += conv;
    posMap.push({ origStart: i, origEnd: i + 1 });
  }

  return { normalized, posMap, trimmed };
}

/**
 * posMap을 사용해 정규화 범위를 원문 텍스트로 복원
 * 앞뒤 구두점 자동 제거 (。 버그 방지)
 *
 * 예: normStart=0, normLen=3 (かおり) → posMap[0]={0,2} → trimmed.slice(0,2) → "花織"
 */
function origSpan(
  trimmed: string,
  posMap: PosEntry[],
  normStart: number,
  normLen: number,
): string {
  if (normLen === 0 || normStart >= posMap.length) return '';
  const first = posMap[normStart];
  const last = posMap[Math.min(normStart + normLen - 1, posMap.length - 1)];
  return trimmed.slice(first.origStart, last.origEnd).replace(PUNCT_TRIM_RE, '');
}

// ===== 심각도 판단 =====

/** 순수 CJK 한자로만 구성된 문자열인지 (히라가나/카타카나 없음) */
function isPureKanji(s: string): boolean {
  return s.length > 0 && [...s].every(ch => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(ch));
}

/**
 * replace 토큰의 심각도 판단 (동기 - kuroshiro 호출 불필요)
 *
 * kuroshiro가 buildNormalized 단계에서 이미 같은 발음을 equal로 처리했으므로
 * 여기까지 온 replace = 실제로 발음이 다른 경우
 *
 * normRef === normHyp: fallback 모드에서 발생 가능 (한자 그대로 비교)
 */
function classifyReplace(
  origRef: string,
  origHyp: string,
  normRef: string,
  normHyp: string,
): Pick<WordDiff, 'severity' | 'reason'> {
  // fallback 모드에서 정규화 후 동일한 경우 (카타카나↔히라가나 등)
  if (normRef === normHyp) {
    return { severity: 'low', reason: 'orthography' };
  }

  // 순수 한자↔한자: 의미 변경 (kuromoji 정규화 후에도 다르면 발음이 진짜 다름)
  if (isPureKanji(origRef) && isPureKanji(origHyp)) {
    return { severity: 'high', reason: 'meaning_change' };
  }

  // 길이 차이 크면 의미 변경
  const longer = Math.max(normRef.length, normHyp.length);
  const shorter = Math.min(normRef.length, normHyp.length);
  if (longer > 0 && shorter < longer * 0.5) {
    return { severity: 'high', reason: 'meaning_change' };
  }

  return { severity: 'medium', reason: 'unknown' };
}

// ===== 메인 함수 =====

/**
 * 원문(refText)과 STT 결과(hypText)를 비교하여 WordDiff[] 반환
 *
 * @param refText - 원문 (사용자가 읽어야 했던 문장)
 * @param hypText - STT 결과 (Whisper 인식 텍스트)
 */
export async function diffTexts(refText: string, hypText: string): Promise<WordDiff[]> {
  const dmp = new DiffMatchPatch();

  // 문장 전체를 히라가나로 정규화 (병렬)
  const [refNorm, hypNorm] = await Promise.all([
    buildNormalized(refText),
    buildNormalized(hypText),
  ]);

  // 히라가나끼리 diff
  const rawDiffs = dmp.diff_main(refNorm.normalized, hypNorm.normalized);
  dmp.diff_cleanupSemantic(rawDiffs);

  const result: WordDiff[] = [];
  let refNormPos = 0;
  let hypNormPos = 0;

  let i = 0;
  while (i < rawDiffs.length) {
    const [op, normText] = rawDiffs[i];
    const len = normText.length;

    if (op === DiffMatchPatch.DIFF_EQUAL) {
      const origRef = origSpan(refNorm.trimmed, refNorm.posMap, refNormPos, len);
      result.push({ kind: 'equal', ref: origRef, hyp: origRef, severity: 'none' });
      refNormPos += len;
      hypNormPos += len;
      i++;

    } else if (
      op === DiffMatchPatch.DIFF_DELETE &&
      i + 1 < rawDiffs.length &&
      rawDiffs[i + 1][0] === DiffMatchPatch.DIFF_INSERT
    ) {
      // DELETE + INSERT = replace
      const refLen = len;
      const hypLen = rawDiffs[i + 1][1].length;
      const origRef = origSpan(refNorm.trimmed, refNorm.posMap, refNormPos, refLen);
      const origHyp = origSpan(hypNorm.trimmed, hypNorm.posMap, hypNormPos, hypLen);
      const classification = classifyReplace(origRef, origHyp, normText, rawDiffs[i + 1][1]);
      result.push({ kind: 'replace', ref: origRef, hyp: origHyp, ...classification });
      refNormPos += refLen;
      hypNormPos += hypLen;
      i += 2;

    } else if (op === DiffMatchPatch.DIFF_DELETE) {
      const origRef = origSpan(refNorm.trimmed, refNorm.posMap, refNormPos, len);
      result.push({ kind: 'delete', ref: origRef, hyp: '', severity: 'high', reason: 'meaning_change' });
      refNormPos += len;
      i++;

    } else if (op === DiffMatchPatch.DIFF_INSERT) {
      const origHyp = origSpan(hypNorm.trimmed, hypNorm.posMap, hypNormPos, len);
      result.push({ kind: 'insert', ref: '', hyp: origHyp, severity: 'low', reason: 'unknown' });
      hypNormPos += len;
      i++;

    } else {
      i++;
    }
  }

  return result.filter(t => t.ref.length > 0 || t.hyp.length > 0);
}
