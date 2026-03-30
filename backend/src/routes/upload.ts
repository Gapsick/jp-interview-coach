/**
 * 파일 업로드 & 분석 라우터
 *
 * 핵심 엔드포인트: POST /api/analyze
 * - 프론트엔드에서 오디오/비디오 파일을 multipart로 전송하면
 * - 아래 6단계 파이프라인을 거쳐 발음 분석 결과를 JSON으로 응답
 *
 * 파이프라인 흐름:
 * 파일 업로드 → 오디오 추출/변환 → STT(음성→텍스트) → 규칙 분석 → LLM 코칭 → 응답
 */
import express, { type Request, type Response } from 'express';
import multer from 'multer';    // 파일 업로드 처리 미들웨어
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from '../config.js';
import { extractAudioFromVideo, getAudioDuration, toSttReadyAudio } from '../services/audioExtractor.js';
import { transcribe } from '../services/transcription.js';
import { analyzeTranscript, analyzePronunciation } from '../services/transcriptAnalyzer.js';
import { generateCoachingFeedback } from '../services/coachingLLM.js';
import { diffTexts } from '../services/textDiff.js';
import { getOrCreateSession, addResult, getSession, type AnalysisResult } from '../services/sessionStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 업로드 폴더 경로 설정 (backend/uploads/)
const uploadDir = path.join(__dirname, '..', '..', config.uploadDir);

// 업로드 폴더가 없으면 자동 생성
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// multer 저장소 설정: 업로드된 파일을 디스크에 저장
const storage = multer.diskStorage({
  // 저장 위치: uploadDir (backend/uploads/)
  destination: (_, __, cb) => cb(null, uploadDir),
  // 파일명: "타임스탬프-랜덤문자열.확장자" 형태로 충돌 방지
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

// multer 인스턴스 생성 (파일 크기 제한, 허용 파일 타입 설정)
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 최대 100MB
  fileFilter: (_, file, cb) => {
    // 허용되는 MIME 타입 목록 (비디오: mp4/mov, 오디오: mp3/wav/webm 등)
    const allowed = [
      'video/mp4', 'video/quicktime',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a',
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type. Use MP4 video or audio (mp3, wav, webm, etc.).'));
  },
});

export const uploadRouter = express.Router();

// Multer가 파일을 req.file에 넣어주기 위한 타입 확장
type MulterRequest = Request & { file?: Express.Multer.File };

/**
 * POST /api/analyze - 메인 분석 엔드포인트
 *
 * 요청: multipart/form-data
 *   - file: 오디오 또는 비디오 파일 (필수)
 *   - sessionId: 기존 세션 ID (선택, 없으면 새로 생성)
 *   - referenceText: 원문 텍스트 (선택, 있으면 단어별 비교 모드)
 *
 * 응답: JSON
 *   - status: 'success' | 'no_speech' | 'error'
 *   - transcript: 인식된 텍스트
 *   - topIssues: 주요 개선점 목록
 *   - pronunciationTips: 발음 팁 목록
 *   - trainingRoutine: 3분 훈련 루틴 목록
 */
uploadRouter.post('/analyze', upload.single('file'), async (req: MulterRequest, res: Response) => {
  // req.user는 authMiddleware가 설정한 인증된 사용자 정보 (SafeUser 타입)
  // userId를 세션에 연결하여 "이 세션이 누구의 것인지" 기록
  const userId = req.user?.id;

  // 세션 ID가 있으면 기존 세션 사용, 없으면 새 세션 생성 (userId도 같이 전달)
  const sessionId = await getOrCreateSession((req.body as any)?.sessionId, userId);
  const filePath = req.file?.path;       // 업로드된 파일의 디스크 경로
  const mimeType = req.file?.mimetype || ''; // 파일의 MIME 타입 (예: "audio/webm")
  // 원문 텍스트 (있으면 reference 모드 → 단어별 비교, 없으면 free 모드)
  const referenceText = ((req.body as any)?.referenceText || '').trim() || undefined;

  // 파일이 없으면 400 에러 응답
  if (!filePath || !req.file) {
    return res.status(400).json({
      sessionId,
      status: 'error',
      error: 'No file uploaded. Send multipart field \"file\".',
    });
  }

  try {
    // ========== 1단계: 오디오 경로 확보 ==========
    // 비디오 파일이면 → ffmpeg로 오디오만 추출
    // webm/ogg 파일이면 → WAV로 변환 (Whisper STT 호환성을 위해)
    const isVideo = mimeType.startsWith('video/');
    let audioPath = filePath;
    if (isVideo) {
      audioPath = await extractAudioFromVideo(filePath, uploadDir);
    } else if (mimeType.startsWith('audio/webm') || mimeType.startsWith('audio/ogg')) {
      try {
        audioPath = await toSttReadyAudio(filePath, mimeType, uploadDir);
      } catch {
        // ffmpeg가 없으면 원본 파일 그대로 사용 (일부 포맷은 Whisper가 직접 처리 가능)
      }
    }

    // ========== 2단계: STT (음성 → 텍스트 변환) ==========
    // OpenAI Whisper API를 사용하여 일본어 음성을 텍스트로 변환
    // words: 단어별 타임스탬프, segments: 세그먼트별 신뢰도, duration: 전체 길이
    const { text: transcript, words, segments, duration } = await transcribe(audioPath);

    // 인식된 텍스트가 너무 짧으면(2자 미만) → 음성이 없는 것으로 판단
    const trimmedTranscript = (transcript || '').trim();
    if (trimmedTranscript.length < 2) {
      return res.json({
        sessionId,
        status: 'no_speech',
        error: '음성이 인식되지 않았습니다. 마이크를 확인하고, 3초 이상 분명히 말해 주세요.',
        transcript: '',
      });
    }

    // ========== 2.5단계: 짧은 녹음 경고 ==========
    // 녹음이 2.5초 미만이면 인식 정확도가 떨어질 수 있다고 경고
    const durationSec = await getAudioDuration(audioPath);
    const SHORT_AUDIO_SEC = 2.5;
    const transcriptWarning =
      durationSec > 0 && durationSec < SHORT_AUDIO_SEC
        ? '녹음이 너무 짧아 인식이 부정확할 수 있습니다. 3초 이상 말씀해 주세요.'
        : undefined;

    // ========== 3단계: 규칙 기반 분석 ==========
    // 필러(えーと 등), 짧은 답변, 반복 표현 등을 정규식으로 검출
    const { issues } = analyzeTranscript(trimmedTranscript);

    // ========== 3.5단계: 발음 분석 (Whisper 단어 타임스탬프 기반) ==========
    // 말하기 속도(WPM), 쉼 패턴, 불명확 발음 구간을 분석하여 종합 점수 산출
    const pronunciation = analyzePronunciation(words, segments, duration);

    // ========== 3.7단계: 기존 히스토리 조회 (LLM 누적 코칭용) ==========
    // 현재 세션의 과거 분석 이력을 가져와서 LLM에 전달
    // → LLM이 "이전보다 필러가 줄었네요" 같은 누적 피드백을 생성할 수 있음
    const currentSession = await getSession(sessionId);
    const previousHistory = currentSession?.history ?? [];

    // ========== 4단계: 알고리즘 diff (reference 모드에서만) ==========
    // LLM 대신 diff-match-patch 알고리즘으로 원문 vs STT 비교
    // → 결정적이고 정확한 결과, 구두점/동음이자 자동 처리
    const wordDiff = referenceText
      ? await diffTexts(referenceText, trimmedTranscript)
      : [];

    // ========== 5단계: LLM 코칭 피드백 생성 ==========
    // referenceText가 있으면 diff 결과를 넘겨서 코칭만 생성
    // 없으면 발음 수치 기반 free 모드
    const coaching = await generateCoachingFeedback(
      trimmedTranscript,
      issues,
      pronunciation,
      previousHistory,
      referenceText,
      wordDiff.length > 0 ? wordDiff : undefined,
    );
    const {
      topIssues, pronunciationTips, trainingRoutine,
      overallScore, pronunciationAnalysis: pronunciationAnalysisLLM,
      historyNote,
    } = coaching;

    // ========== 6단계: 세션에 결과 저장 ==========
    // 분석 결과를 세션 히스토리에 추가 (MongoDB에 영구 저장)
    const result: AnalysisResult = {
      transcript: trimmedTranscript,
      issues,
      topIssues,
      pronunciationTips,
      trainingRoutine,
      pronunciation, // Whisper 기반 발음 분석 결과
      rawAnalysis: { transcriptLength: trimmedTranscript.length },
    };
    // await 추가: MongoDB에 분석 결과를 저장하는 비동기 작업
    await addResult(sessionId, result);

    // ========== 7단계: 클라이언트에 응답 ==========
    return res.json({
      sessionId,
      status: 'success',
      transcript: trimmedTranscript,                // 인식된 텍스트
      transcriptWarning,                            // 짧은 녹음 경고 (있을 때만)
      topIssues,                                    // 주요 개선점 목록
      pronunciationTips,                            // 발음 팁 목록
      trainingRoutine,                              // 3분 훈련 루틴
      pronunciation,                                // Whisper 발음 분석 결과
      // LLM 코칭 데이터
      overallScore,
      pronunciationAnalysisLLM,
      wordDiff,                                     // 원문 비교 결과 (reference 모드에서만 채워짐)
      historyNote,
    });
  } catch (err) {
    // 에러 처리: ffmpeg 관련 에러는 503, 그 외는 500 응답
    console.error('Analyze error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    const isFfmpegMissing = msg.includes('Cannot find ffmpeg') || msg.includes('ffmpeg');
    const message = isFfmpegMissing
      ? '영상 처리에 ffmpeg가 필요합니다. ffmpeg를 설치하거나, 브라우저 녹음/음성 파일만 업로드해 주세요.'
      : msg || 'Analysis failed.';
    return res.status(isFfmpegMissing ? 503 : 500).json({
      sessionId,
      status: 'error',
      error: message,
    });
  } finally {
    // 업로드된 원본 파일을 5초 후 삭제 (디스크 정리)
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // 삭제 실패해도 무시
      }
    }, 5000);
  }
});
