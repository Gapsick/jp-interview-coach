/**
 * 음성 인식(STT) 서비스 - 일본어 음성을 텍스트로 변환
 *
 * 이 파일이 하는 일:
 * - OpenAI Whisper API를 사용하여 오디오 파일 → 일본어 텍스트 변환
 * - 단어별 타임스탬프(word timestamps)를 추출하여 발음 분석에 활용
 * - 세그먼트별 신뢰도(avg_logprob)를 추출하여 불명확한 발음 구간 감지
 * - API 키가 없거나 Mock 모드이면 가짜(mock) 데이터를 반환 (개발용)
 */
import fs from 'fs';
import OpenAI from 'openai';
import { config } from '../config.js';
import type { WordTimestamp } from '../models/Session.js';

// OpenAI 클라이언트 초기화 (API 키가 있고 Mock 모드가 아닐 때만 생성)
let openai: OpenAI | null = null;
if (config.openaiApiKey && !config.useMockStt) {
  openai = new OpenAI({ apiKey: config.openaiApiKey });
}

/**
 * Whisper API가 반환하는 세그먼트 정보 (신뢰도 분석용)
 *
 * [avg_logprob이란?]
 * - 해당 세그먼트의 토큰들의 평균 로그 확률 (log probability)
 * - 값 범위: 대략 0 ~ -2 (0에 가까울수록 Whisper가 확신함)
 * - -0.5 이상: 높은 신뢰도 → 발음이 명확
 * - -0.5 ~ -1.0: 보통 신뢰도 → 일부 불명확
 * - -1.0 미만: 낮은 신뢰도 → 발음이 불명확하거나 노이즈
 *
 * [no_speech_prob이란?]
 * - 해당 세그먼트에 음성이 없을 확률 (0~1)
 * - 0.5 이상이면 실제 음성이 아닌 소음/침묵일 가능성이 높음
 */
export type WhisperSegment = {
  text: string;
  start: number;
  end: number;
  avg_logprob: number;
  no_speech_prob: number;
};

/** transcribe 함수의 반환 타입: 텍스트 + 단어 타임스탬프 + 세그먼트 신뢰도 */
export type TranscriptionResult = {
  text: string;                    // 전체 인식 텍스트
  words: WordTimestamp[];          // 단어별 타임스탬프 배열
  segments: WhisperSegment[];      // 세그먼트별 신뢰도 정보
  duration: number;                // 전체 오디오 길이 (초)
};

/**
 * 오디오 파일을 텍스트로 변환 (STT) + 단어별 타임스탬프 추출
 *
 * @param audioFilePath - 변환할 오디오 파일 경로
 * @returns TranscriptionResult - 인식 텍스트 + 단어 타임스탬프 + 세그먼트 신뢰도
 *
 * Mock 모드이거나 API 키가 없으면 → 가짜 데이터 반환
 * 실제 모드이면 → OpenAI Whisper API 호출 (word-level timestamps 포함)
 */
export async function transcribe(audioFilePath: string): Promise<TranscriptionResult> {
  // Mock 모드: 실제 API 호출 없이 샘플 데이터 반환 (개발/테스트용)
  if (config.useMockStt || !openai) {
    return mockTranscribe();
  }

  // 오디오 파일을 읽기 스트림으로 열어서 Whisper API에 전송
  const file = fs.createReadStream(audioFilePath);
  const response = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',              // Whisper 모델 사용
    language: 'ja',                  // 인식 언어: 일본어
    response_format: 'verbose_json', // 상세 JSON 형태로 응답 받기
    // timestamp_granularities: 단어 단위 타임스탬프 요청
    // → response.words 배열에 각 단어의 시작/끝 시간이 포함됨
    timestamp_granularities: ['word'],
    // 맥락 힌트: 짧거나 불분명한 음성에서 환각(hallucination)을 줄이기 위한 프롬프트
    prompt: '面接の自己紹介です。日本語で話しています。',
  });

  // Whisper 응답에서 단어별 타임스탬프 추출
  // response 타입이 any일 수 있으므로 안전하게 접근
  const raw = response as any;
  const words: WordTimestamp[] = (raw.words || []).map((w: any) => ({
    word: w.word || '',
    start: w.start ?? 0,
    end: w.end ?? 0,
  }));

  // 세그먼트별 신뢰도 정보 추출
  const segments: WhisperSegment[] = (raw.segments || []).map((s: any) => ({
    text: s.text || '',
    start: s.start ?? 0,
    end: s.end ?? 0,
    avg_logprob: s.avg_logprob ?? 0,
    no_speech_prob: s.no_speech_prob ?? 0,
  }));

  // 전체 오디오 길이 (초)
  const duration = raw.duration ?? 0;

  return {
    text: response.text || '',
    words,
    segments,
    duration,
  };
}

/**
 * Mock 음성 인식 함수 (개발/테스트용)
 *
 * 실제 API를 호출하지 않고 미리 정해진 데이터를 반환
 * - 발음 분석 기능도 테스트할 수 있도록 단어별 타임스탬프 + 세그먼트 신뢰도 포함
 * - 일부러 불명확한 구간(낮은 신뢰도)을 포함하여 UI 테스트 가능
 */
function mockTranscribe(): Promise<TranscriptionResult> {
  return Promise.resolve({
    text: 'こんにちは。私の名前は田中です。御社のエンジニア職に応募しました。よろしくお願いいたします。',
    words: [
      { word: 'こんにちは', start: 0.0, end: 0.8 },
      { word: '私', start: 1.2, end: 1.5 },
      { word: 'の', start: 1.5, end: 1.6 },
      { word: '名前', start: 1.6, end: 2.0 },
      { word: 'は', start: 2.0, end: 2.1 },
      { word: '田中', start: 2.1, end: 2.6 },
      { word: 'です', start: 2.6, end: 3.0 },
      // ↓ 1.5초 쉼 (hesitation 감지 테스트용)
      { word: '御社', start: 4.5, end: 5.1 },
      { word: 'の', start: 5.1, end: 5.2 },
      { word: 'エンジニア', start: 5.2, end: 5.9 },
      { word: '職', start: 5.9, end: 6.2 },
      { word: 'に', start: 6.2, end: 6.3 },
      { word: '応募', start: 6.3, end: 6.8 },
      { word: 'しました', start: 6.8, end: 7.3 },
      { word: 'よろしく', start: 7.8, end: 8.3 },
      { word: 'お願い', start: 8.3, end: 8.8 },
      { word: 'いたします', start: 8.8, end: 9.5 },
    ],
    segments: [
      {
        text: 'こんにちは。私の名前は田中です。',
        start: 0.0,
        end: 3.0,
        avg_logprob: -0.3,      // 높은 신뢰도 → 발음 명확
        no_speech_prob: 0.01,
      },
      {
        text: '御社のエンジニア職に応募しました。',
        start: 4.5,
        end: 7.3,
        avg_logprob: -0.85,     // 보통 신뢰도 → 일부 불명확 (테스트용)
        no_speech_prob: 0.05,
      },
      {
        text: 'よろしくお願いいたします。',
        start: 7.8,
        end: 9.5,
        avg_logprob: -0.25,     // 높은 신뢰도
        no_speech_prob: 0.02,
      },
    ],
    duration: 9.5,
  });
}
