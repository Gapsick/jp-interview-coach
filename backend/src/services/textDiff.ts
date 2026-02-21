/**
 * 알고리즘 기반 원문-STT 텍스트 비교
 *
 * 왜 LLM 대신 알고리즘을 쓰는가?
 * - LLM diff는 비결정적: 매번 결과가 다르고 긴 텍스트에서 오분류 발생
 * - 알고리즘(diff-match-patch)은 정확하고 일관된 결과를 보장
 *
 * 핵심 설계: "비교는 정규화로, 표시는 원문으로"
 * - 정규화(カタカナ→ひらがな, 숫자→한자, 구두점 제거)로 diff 정확도 향상
 * - posMap(위치 매핑)으로 diff 결과를 원문 텍스트로 복원 → カタカナ로 표시
 *
 * kuroshiro 통합:
 * - 한자가 포함된 replace 토큰은 요미가나(読み仮名)를 비교
 * - 예: 花織(かおり) ↔ 香里(かおり) → yomi 동일 → orthography/low (표기 차이)
 * - 예: 銀(ぎん) ↔ 金(きん) → yomi 다름 → meaning_change/high
 *
 * 처리 순서:
 * 1. buildNormalized(): 정규화 + posMap 생성
 * 2. diff-match-patch로 정규화 텍스트 비교
 * 3. posMap으로 결과를 원문으로 복원
 * 4. 각 토큰에 severity/reason 부여 (kuroshiro yomi 비교 포함)
 */
import DiffMatchPatch from 'diff-match-patch';

// ===== 타입 정의 =====

/**
 * 원문-STT 비교 결과 토큰
 * ref/hyp는 원문 텍스트 그대로 (カタカナ 보존)
 */
export type WordDiff = {
  kind: 'equal' | 'replace' | 'delete' | 'insert';
  ref: string;       // 원문 텍스트 (カタカナ 그대로 표시)
  hyp: string;       // STT 인식 텍스트
  severity: 'high' | 'medium' | 'low' | 'none';
  reason?: 'meaning_change' | 'orthography' | 'proper_noun' | 'punctuation' | 'unknown';
};

// ===== kuroshiro 싱글톤 =====

/** kuroshiro 인스턴스 (모듈 로드 시 백그라운드 초기화) */
let _kuroshiro: any = null;
let _kuroshiroReady: Promise<boolean> | null = null;

/**
 * kuroshiro를 초기화하고 준비 상태를 반환
 * - dynamic import로 ESM 모듈 로드
 * - 모듈 로드 실패해도 앱은 계속 동작 (graceful degradation)
 */
async function initKuroshiro(): Promise<boolean> {
  try {
    const [kuroMod, kuromojiMod] = await Promise.all([
      import('kuroshiro'),
      import('kuroshiro-analyzer-kuromoji'),
    ]);
    // CJS 모듈을 ESM dynamic import로 가져올 때 default.default 이중 래핑 발생 가능
    const Kuroshiro = kuroMod.default?.default ?? kuroMod.default ?? kuroMod;
    const KuromojiAnalyzer = kuromojiMod.default?.default ?? kuromojiMod.default ?? kuromojiMod;
    _kuroshiro = new Kuroshiro();
    await _kuroshiro.init(new KuromojiAnalyzer());
    return true;
  } catch (e) {
    // kuroshiro를 사용할 수 없어도 앱은 계속 동작
    console.warn('[textDiff] kuroshiro 초기화 실패 (yomi 비교 비활성화):', e);
    return false;
  }
}

// 모듈 로드 시 백그라운드에서 kuroshiro 초기화 시작
_kuroshiroReady = initKuroshiro();

/**
 * 텍스트를 히라가나 요미가나로 변환
 * - kuroshiro가 준비되지 않았으면 원문 그대로 반환 (비교에서 제외됨)
 */
async function toYomi(text: string): Promise<string> {
  const ready = await _kuroshiroReady;
  if (!ready || !_kuroshiro) return text; // fallback: 변환 불가
  try {
    return await _kuroshiro.convert(text, { to: 'hiragana' });
  } catch {
    return text;
  }
}

// ===== 정규화 =====

/**
 * 카타카나 → 히라가나 (ア~ン, 1:1 변환)
 * 예: コ→こ, ル→る, テ→て
 */
function katakanaToHiragana(ch: string): string {
  return ch.replace(/[\u30A1-\u30F3]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

/**
 * 숫자 → 한자 변환 테이블 (비교용)
 * 예: '2'→'二' → "2位" ↔ "二位"를 동일하게 처리
 */
const NUM_TO_KANJI: Record<string, string> = {
  '0': '〇', '1': '一', '2': '二', '3': '三', '4': '四',
  '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
};

/** 비교 시 제거할 구두점 집합 */
const REMOVE_CHARS = new Set([...'。、「」『』【】〔〕・…']);

/** origSpan 결과에서 앞뒤 구두점/공백 제거용 */
const PUNCT_TRIM_RE = /^[。、「」『』【】〔〕・…\s]+|[。、「」『』【】〔〕・…\s]+$/g;

/**
 * 텍스트를 정규화하면서 원문 위치 매핑도 함께 반환
 *
 * posMap[i] = 정규화된 i번째 문자가 원문(trimmed)에서 몇 번째 위치인지
 * → diff 결과 span을 원문으로 복원할 때 사용
 *
 * 예:
 *   원문:       "コルティナ、オリンピック"
 *   정규화:     "こるてぃなおりんぴっく"  (구두점 제거, カタカナ→ひらがな)
 *   posMap:     [0,1,2,3,4, 6,7,8,9,10,11]  (5번째 '、'는 제거됨)
 */
function buildNormalized(text: string): { normalized: string; posMap: number[]; trimmed: string } {
  const trimmed = text.trim();
  const posMap: number[] = [];
  let normalized = '';

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (REMOVE_CHARS.has(ch)) continue; // 구두점: 정규화에서 제외

    let conv = katakanaToHiragana(ch);   // カタカナ → ひらがな
    if (NUM_TO_KANJI[conv]) conv = NUM_TO_KANJI[conv]; // 숫자 → 한자

    normalized += conv;
    posMap.push(i); // 정규화 인덱스 → 원문 인덱스 매핑
  }

  return { normalized, posMap, trimmed };
}

/**
 * posMap을 사용해 정규화 범위 [normStart, normStart+normLen)를 원문 텍스트로 복원
 * 앞뒤 구두점은 자동 제거 (。 버그 방지)
 */
function origSpan(trimmed: string, posMap: number[], normStart: number, normLen: number): string {
  if (normLen === 0 || normStart >= posMap.length) return '';
  const origStart = posMap[normStart];
  const origEnd = posMap[Math.min(normStart + normLen - 1, posMap.length - 1)] + 1;
  // 앞뒤 구두점/공백 제거: diff_cleanupSemantic이 구두점을 토큰에 포함시킬 수 있음
  return trimmed.slice(origStart, origEnd).replace(PUNCT_TRIM_RE, '');
}

// ===== 심각도 판단 =====

/** 순수 CJK 한자로만 구성된 문자열인지 확인 (히라가나/카타카나 없음) */
function isPureKanji(s: string): boolean {
  return s.length > 0 && [...s].every(ch => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(ch));
}

/** 한자가 하나라도 포함된 문자열인지 확인 */
function hasKanji(s: string): boolean {
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s);
}

/**
 * replace 토큰의 심각도와 이유를 판단 (비동기: kuroshiro yomi 비교 포함)
 *
 * 판단 순서:
 * 1. 정규화 후 동일 → orthography low (표기 차이, 발음 같음)
 *    예: コルティナ ↔ こるてぃな, 2 ↔ 二 (숫자↔한자)
 * 2. 한자가 포함된 경우 → kuroshiro로 yomi 비교
 *    예: 花織 ↔ 香里 → yomi 모두 "かおり" → orthography low
 *    예: 銀 ↔ 金 → yomi "ぎん" ↔ "きん" → meaning_change high
 * 3. 길이 차이 크면 → meaning_change high
 * 4. 나머지 → unknown medium
 */
async function classifyReplace(
  origRef: string, origHyp: string,
  normRef: string, normHyp: string,
): Promise<Pick<WordDiff, 'severity' | 'reason'>> {
  // 정규화 후 동일 → 표기 차이 (발음은 같음)
  if (normRef === normHyp) {
    return { severity: 'low', reason: 'orthography' };
  }

  // 한자가 포함된 경우 → kuroshiro로 요미가나 비교
  // 예: 花織(かおり) ↔ 香里(かおり) → 발음 동일 → orthography low
  // 예: あと(hiragana) ↔ 後(kanji) → toYomi(後) vs あと 비교
  if (hasKanji(origRef) || hasKanji(origHyp)) {
    try {
      const [yomiRef, yomiHyp] = await Promise.all([toYomi(origRef), toYomi(origHyp)]);
      if (yomiRef === yomiHyp) {
        return { severity: 'low', reason: 'orthography' };
      }
      // 한쪽이 이미 히라가나(STT 인식 결과)인 경우: 반대쪽 요미와 직접 비교
      // 예: origHyp='あと'(hiragana), toYomi(origRef='後')='のち'이어도
      //     origHyp가 origRef의 요미 중 하나일 수 있으므로 교차 비교
      if (origHyp === yomiRef || origRef === yomiHyp) {
        return { severity: 'low', reason: 'orthography' };
      }
    } catch {
      // kuroshiro 오류 시 다음 단계로 진행
    }
  }

  // 순수 한자↔한자 교체 → 의미 변경 (발음+의미 모두 달라짐)
  // 예: 銀↔金, 女子↔長寿
  if (isPureKanji(origRef) && isPureKanji(origHyp)) {
    return { severity: 'high', reason: 'meaning_change' };
  }

  // 길이 차이가 크면 → 의미가 완전히 달라진 것
  const longer = Math.max(normRef.length, normHyp.length);
  const shorter = Math.min(normRef.length, normHyp.length);
  if (longer > 0 && shorter < longer * 0.5) {
    return { severity: 'high', reason: 'meaning_change' };
  }

  return { severity: 'medium', reason: 'unknown' };
}

// ===== 메인 함수 =====

/**
 * 원문(refText)과 STT 결과(hypText)를 알고리즘으로 비교하여 WordDiff[] 반환
 *
 * 핵심: diff는 정규화 텍스트로, 결과는 posMap으로 원문 복원
 * → カタカナは カタカナで 表示, 숫자↔한자 자동 처리, 한자 동음 자동 감지
 *
 * @param refText - 원문 (사용자가 읽어야 했던 문장)
 * @param hypText - STT 결과 (Whisper 인식 텍스트)
 * @returns WordDiff[] - 비교 결과 (ref/hyp는 원문 텍스트 그대로)
 */
export async function diffTexts(refText: string, hypText: string): Promise<WordDiff[]> {
  const dmp = new DiffMatchPatch();

  // 정규화 + 위치 매핑 생성
  const { normalized: normRef, posMap: refPosMap, trimmed: refTrimmed } = buildNormalized(refText);
  const { normalized: normHyp, posMap: hypPosMap, trimmed: hypTrimmed } = buildNormalized(hypText);

  // diff 실행 후 의미 단위로 병합
  const rawDiffs = dmp.diff_main(normRef, normHyp);
  dmp.diff_cleanupSemantic(rawDiffs);

  const result: WordDiff[] = [];
  let refNormPos = 0; // normRef에서 현재 위치
  let hypNormPos = 0; // normHyp에서 현재 위치

  let i = 0;
  while (i < rawDiffs.length) {
    const [op, normText] = rawDiffs[i];
    const len = normText.length;

    if (op === DiffMatchPatch.DIFF_EQUAL) {
      // 일치: posMap으로 원문 복원
      const origRef = origSpan(refTrimmed, refPosMap, refNormPos, len);
      result.push({ kind: 'equal', ref: origRef, hyp: origRef, severity: 'none' });
      refNormPos += len;
      hypNormPos += len;
      i++;

    } else if (
      op === DiffMatchPatch.DIFF_DELETE &&
      i + 1 < rawDiffs.length &&
      rawDiffs[i + 1][0] === DiffMatchPatch.DIFF_INSERT
    ) {
      // DELETE + INSERT 연속 = replace (다른 발음)
      const refLen = len;
      const hypLen = rawDiffs[i + 1][1].length;
      const origRef = origSpan(refTrimmed, refPosMap, refNormPos, refLen);
      const origHyp = origSpan(hypTrimmed, hypPosMap, hypNormPos, hypLen);
      const normRefPart = normText;
      const normHypPart = rawDiffs[i + 1][1];
      const classification = await classifyReplace(origRef, origHyp, normRefPart, normHypPart);
      result.push({ kind: 'replace', ref: origRef, hyp: origHyp, ...classification });
      refNormPos += refLen;
      hypNormPos += hypLen;
      i += 2;

    } else if (op === DiffMatchPatch.DIFF_DELETE) {
      // 원문에 있는데 STT에 없음 (발음을 빠뜨림)
      const origRef = origSpan(refTrimmed, refPosMap, refNormPos, len);
      result.push({ kind: 'delete', ref: origRef, hyp: '', severity: 'high', reason: 'meaning_change' });
      refNormPos += len;
      i++;

    } else if (op === DiffMatchPatch.DIFF_INSERT) {
      // STT에만 있음 (없는 말을 추가로 발음)
      const origHyp = origSpan(hypTrimmed, hypPosMap, hypNormPos, len);
      result.push({ kind: 'insert', ref: '', hyp: origHyp, severity: 'low', reason: 'unknown' });
      hypNormPos += len;
      i++;

    } else {
      i++;
    }
  }

  // 구두점만 남은 토큰 필터링 (ref/hyp 모두 비어있으면 제외)
  return result.filter(token =>
    token.ref.length > 0 || token.hyp.length > 0
  );
}
