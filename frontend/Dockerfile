# ============================================================
# Frontend Dockerfile - Vue + Vite 프론트엔드 컨테이너
#
# 2단계 빌드 (Multi-stage build):
# 1단계 (build): Node.js에서 Vite로 정적 파일 빌드
# 2단계 (production): nginx로 빌드된 파일 서빙 + /api 프록시
#
# 왜 nginx를 사용하는가?
# - 개발 시에는 Vite dev 서버가 프록시를 해주지만
# - 프로덕션에서는 빌드된 정적 파일만 있으므로 웹 서버(nginx)가 필요
# - nginx가 /api 요청을 백엔드 컨테이너로 프록시해줌
# ============================================================

# ---------- 1단계: 빌드 ----------
FROM node:20-slim AS build

WORKDIR /app

# 의존성 파일만 먼저 복사 (캐시 활용)
COPY package.json package-lock.json* ./
RUN npm install

# 소스 복사 후 빌드
COPY . .
RUN npm run build

# ---------- 2단계: nginx로 서빙 ----------
FROM nginx:alpine

# Vite 빌드 결과물(dist/)을 nginx 기본 경로로 복사
COPY --from=build /app/dist /usr/share/nginx/html

# nginx 설정 파일 복사 (/api 프록시 설정 포함)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# nginx 기본 포트
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
