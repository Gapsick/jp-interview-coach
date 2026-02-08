/**
 * 음성 인식(STT) 서비스 - 일본어 음성을 텍스트로 변환
 *
 * 이 파일이 하는 일:
 * - OpenAI Whisper API를 사용하여 오디오 파일 → 일본어 텍스트 변환
 * - API 키가 없거나 Mock 모드이면 가짜(mock) 텍스트를 반환 (개발용)
 */
import fs from 'fs';
import OpenAI from 'openai';
import { config } from '../config.js';

// OpenAI 클라이언트 초기화 (API 키가 있고 Mock 모드가 아닐 때만 생성)
let openai: OpenAI | null = null;
if (config.openaiApiKey && !config.useMockStt) {
  openai = new OpenAI({ apiKey: config.openaiApiKey });
}

/**
 * 오디오 파일을 텍스트로 변환 (STT)
 *
 * @param audioFilePath - 변환할 오디오 파일 경로
 * @returns { text: string } - 인식된 텍스트
 *
 * Mock 모드이거나 API 키가 없으면 → 가짜 일본어 텍스트 반환
 * 실제 모드이면 → OpenAI Whisper API 호출
 */
export async function transcribe(audioFilePath: string): Promise<{ text: string }> {
  // Mock 모드: 실제 API 호출 없이 샘플 텍스트 반환 (개발/테스트용)
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
    // 맥락 힌트: 짧거나 불분명한 음성에서 환각(hallucination)을 줄이기 위한 프롬프트
    prompt: '面接の自己紹介です。日本語で話しています。',
  });

  return { text: response.text || '' };
}

/**
 * Mock 음성 인식 함수 (개발/테스트용)
 *
 * 실제 API를 호출하지 않고 미리 정해진 일본어 샘플 텍스트를 반환
 * → API 키 없이도 프론트엔드 개발이나 흐름 테스트가 가능
 */
function mockTranscribe(): Promise<{ text: string }> {
  return Promise.resolve({
    text: 'こんにちは。私の名前は田中です。御社のエンジニア職に応募しました。よろしくお願いいたします。',
  });
}
