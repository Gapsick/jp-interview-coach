/**
 * Coach API 클라이언트 - 백엔드와 통신하는 함수 모음
 *
 * 이 파일이 하는 일:
 * - 프론트엔드에서 파일(오디오/비디오)을 백엔드 /api/analyze 로 전송
 * - 백엔드의 분석 결과(인식 텍스트, 코칭 피드백 등)를 받아서 반환
 * - JWT 토큰을 Authorization 헤더에 담아서 인증된 요청을 보냄
 */

import { getToken } from './auth.js'; // JWT 토큰 가져오기

// API 기본 경로 (Vite 프록시 설정에 의해 백엔드로 자동 포워딩됨)
const API_BASE = '/api';

/**
 * 파일(오디오/비디오)을 업로드하고 분석 결과를 받아오는 함수
 *
 * @param { File | Blob } file - 업로드할 파일 (파일 선택기의 File 또는 녹음 결과의 Blob)
 * @param { string } [sessionId] - 기존 세션 ID (있으면 이전 분석 이력에 이어서 저장)
 * @returns { Promise<Object> } 분석 결과 객체:
 *   - sessionId: 세션 ID
 *   - status: 'success' | 'no_speech' | 'error'
 *   - transcript: 인식된 텍스트
 *   - topIssues: 주요 개선점 배열
 *   - pronunciationTips: 발음 팁 배열
 *   - practiceSentences: 연습 문장 배열
 *   - error: 에러 메시지 (에러 시)
 */
export async function analyzeFile(file, sessionId) {
  // FormData로 multipart 요청 구성 (파일 업로드용)
  const form = new FormData();

  // file이 Blob이면 그대로, 아니면 Blob으로 감싸기
  const blob = file instanceof Blob ? file : new Blob([file]);
  // File 객체면 원본 파일명 사용, Blob이면 기본 이름 'recording.webm' 사용
  const name = file instanceof File ? file.name : 'recording.webm';

  form.append('file', blob, name);                       // 파일 첨부
  if (sessionId) form.append('sessionId', sessionId);    // 세션 ID 첨부 (있을 때만)

  // 요청 헤더 구성: JWT 토큰이 있으면 Authorization 헤더 추가
  const headers = {};
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 백엔드 POST /api/analyze 호출 (인증 토큰 포함)
  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers,
    body: form, // Content-Type은 FormData가 자동으로 multipart/form-data 설정
  });

  // 응답을 JSON으로 파싱 (실패하면 빈 객체)
  const data = await res.json().catch(() => ({}));

  // HTTP 에러 응답이면 에러를 throw
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
