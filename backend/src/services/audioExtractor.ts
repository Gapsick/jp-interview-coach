/**
 * 오디오 추출/변환 서비스
 *
 * 이 파일이 하는 일:
 * 1. 비디오 파일에서 오디오만 추출 (extractAudioFromVideo)
 * 2. 오디오 파일의 재생 시간(초) 조회 (getAudioDuration)
 * 3. 다양한 오디오 포맷을 STT에 적합한 WAV로 변환 (toSttReadyAudio)
 *
 * 내부적으로 ffmpeg를 사용함 (시스템에 ffmpeg가 설치되어 있어야 함)
 */
import ffmpeg from 'fluent-ffmpeg';  // ffmpeg를 Node.js에서 쉽게 사용하기 위한 래퍼 라이브러리
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 시스템 PATH에 ffmpeg가 없으면, .env의 FFMPEG_PATH에서 지정한 경로 사용
if (config.ffmpegPath) {
  const base = path.resolve(config.ffmpegPath);
  ffmpeg.setFfmpegPath(path.join(base, 'ffmpeg.exe'));   // ffmpeg 실행 파일 경로
  ffmpeg.setFfprobePath(path.join(base, 'ffprobe.exe')); // ffprobe 실행 파일 경로 (미디어 정보 조회용)
}

/**
 * 비디오 파일에서 오디오만 추출하여 WAV 파일로 저장
 *
 * @param inputPath - 입력 비디오 파일 경로 (예: "uploads/xxx.mp4")
 * @param outputDir - 출력할 폴더 경로
 * @returns 추출된 WAV 파일의 경로
 *
 * 변환 설정:
 * - noVideo(): 비디오 트랙 제거 (오디오만 추출)
 * - pcm_s16le: 비압축 PCM 코덱 (WAV 표준)
 * - 16000Hz: Whisper STT에 최적화된 샘플레이트
 * - 모노(1채널): STT에는 모노가 충분
 */
export function extractAudioFromVideo(
  inputPath: string,
  outputDir = path.join(__dirname, '..', '..', 'uploads'),
): Promise<string> {
  const basename = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${basename}_audio.wav`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()                    // 영상 트랙 제외
      .audioCodec('pcm_s16le')      // WAV 코덱
      .audioFrequency(16000)        // 16kHz 샘플레이트
      .audioChannels(1)             // 모노
      .output(outputPath)
      .on('end', () => resolve(outputPath))    // 변환 완료 → 출력 경로 반환
      .on('error', (err: Error) => reject(err)) // 에러 발생 시 reject
      .run();
  });
}

/**
 * 오디오 파일의 재생 시간(초)을 조회
 *
 * @param filePath - 오디오 파일 경로
 * @returns 재생 시간(초). 에러 시 0 반환
 *
 * ffprobe를 사용하여 미디어 파일의 메타데이터에서 duration을 읽어옴
 */
export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err: Error | undefined, data: any) => {
      if (err) return resolve(0);  // ffprobe 에러 시 0 반환 (서버 크래시 방지)
      const sec = data?.format?.duration;
      resolve(typeof sec === 'number' ? sec : 0);
    });
  });
}

/**
 * 다양한 오디오 포맷을 STT에 적합한 WAV로 변환
 *
 * @param inputPath - 입력 오디오 파일 경로
 * @param mimeType - 파일의 MIME 타입 (예: "audio/webm")
 * @param outputDir - 출력 폴더 경로
 * @returns 변환된 WAV 파일 경로 (이미 WAV이면 원본 경로 그대로 반환)
 *
 * 처리 로직:
 * - 비디오 파일이면 → extractAudioFromVideo()로 위임
 * - 이미 .wav이면 → 변환 없이 원본 반환
 * - 그 외(webm, ogg 등) → WAV로 변환
 */
export async function toSttReadyAudio(
  inputPath: string,
  mimeType: string,
  outputDir = path.join(__dirname, '..', '..', 'uploads'),
): Promise<string> {
  // 비디오 파일이면 오디오 추출 함수로 위임
  const isVideo = (mimeType || '').startsWith('video/');
  if (isVideo) return extractAudioFromVideo(inputPath, outputDir);

  // 이미 WAV 파일이면 변환 불필요
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.wav') return inputPath;

  // webm, ogg 등 → WAV 변환 (16kHz, 모노, PCM)
  const basename = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${basename}_stt.wav`);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err: Error) => reject(err))
      .run();
  });
}
