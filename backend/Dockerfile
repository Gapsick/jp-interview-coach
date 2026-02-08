# ============================================================
# Backend Dockerfile - Express + TypeScript 백엔드 컨테이너
#
# 빌드 흐름:
# 1. Node.js 20 이미지 기반
# 2. ffmpeg 설치 (오디오 추출용)
# 3. npm install로 의존성 설치
# 4. TypeScript → JavaScript 컴파일 (tsc)
# 5. 컴파일된 dist/index.js 실행
# ============================================================

FROM node:20-slim

# ffmpeg 설치 (오디오/비디오에서 음성 추출에 필요)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# 작업 디렉토리 설정
WORKDIR /app

# 의존성 파일만 먼저 복사 (Docker 캐시 활용 → 코드 변경 시 npm install 스킵)
COPY package.json package-lock.json* ./

# 의존성 설치 (devDependencies 포함 - TypeScript 컴파일에 필요)
RUN npm install

# 소스 코드 전체 복사
COPY . .

# TypeScript → JavaScript 컴파일
RUN npm run build

# data, uploads 폴더 생성 (JSON 파일 저장용)
RUN mkdir -p data uploads

# 서버 포트 노출
EXPOSE 3000

# 컴파일된 JavaScript로 서버 시작
CMD ["node", "dist/index.js"]
