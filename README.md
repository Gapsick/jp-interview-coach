# Interview Pronunciation Coach Agent

일본어 면접 발음 연습을 위한 AI 에이전트. 녹음/영상 업로드 후 **한 번에 분석**하고, 상위 2개 발음 이슈와 다음 연습 문장 2개를 제안합니다.

## 목표

- **명확한 목표**: 일본어 면접 발음·클리어리티 개선
- **사용자 상태 저장**: 세션별 분석 이력 저장 (다음 액션 결정용)
- **액션 결정**: 단순 1회 분석이 아니라, 이력 기반 다음 연습 제안

## MVP 범위

- **프론트엔드 (Vue)**: 영상(MP4) 업로드 또는 브라우저 녹음 → 처리 상태 표시 → 분석 결과(상위 2 이슈, 연습 문장 2개)
- **백엔드 (Express)**: 업로드 API, 영상 시 ffmpeg로 음원 추출, STT(일본어), 규칙 기반 분석, LLM 코칭 피드백, 세션 저장

## 폴더 구조

```
interview-agent/
├── backend/                 # Express API
│   ├── src/
│   │   ├── index.js         # 진입점, CORS, 라우트
│   │   ├── config.js        # 환경 변수
│   │   ├── routes/
│   │   │   └── upload.js    # POST /api/analyze (multipart)
│   │   └── services/
│   │       ├── audioExtractor.js   # ffmpeg 영상→음원
│   │       ├── transcription.js   # STT (Whisper)
│   │       ├── transcriptAnalyzer.js  # 규칙 기반 분석
│   │       ├── coachingLLM.js      # LLM 피드백
│   │       └── sessionStore.js     # 세션/이력 저장
│   ├── uploads/             # 임시 업로드 (gitignore)
│   ├── data/                # sessions.json (선택)
│   ├── package.json
│   └── .env.example
├── frontend/                # Vue 3 + Vite
│   ├── src/
│   │   ├── main.js
│   │   ├── App.vue
│   │   ├── views/
│   │   │   └── CoachPage.vue
│   │   ├── components/
│   │   │   ├── FileUpload.vue
│   │   │   ├── AudioRecorder.vue
│   │   │   ├── ProcessingStatus.vue
│   │   │   └── AnalysisResult.vue
│   │   └── api/
│   │       └── coach.js
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── README.md
└── .gitignore
```

## 실행 방법

### 요구 사항

- Node.js 18+
- **ffmpeg** (영상 업로드 시 음원 추출용, PATH에 설치)
- OpenAI API 키 (Whisper STT + 코칭 LLM). 없으면 mock 응답 사용 가능

### 백엔드

```bash
cd backend
cp .env.example .env
# .env에 OPENAI_API_KEY=sk-... 설정 (선택)
npm install
npm run dev
```

- API: `http://localhost:3000`
- 분석: `POST /api/analyze` (multipart: `file`, 선택 `sessionId`)

### 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

- 앱: `http://localhost:5173` (Vite가 `/api`를 백엔드 3000으로 프록시)

### 동작 흐름

1. 사용자가 **영상(MP4)** 또는 **브라우저 녹음(webm)** 업로드
2. 백엔드: 영상이면 ffmpeg로 음원 추출 → 동일 파이프라인으로 STT → 규칙 기반 분석 → LLM 피드백 → 세션에 결과 저장
3. 프론트: 처리 상태 표시 후, **상위 2개 발음 이슈**와 **다음 연습 문장 2개** 표시

## 환경 변수 (backend/.env)

| 변수 | 설명 |
|------|------|
| `PORT` | 서버 포트 (기본 3000) |
| `OPENAI_API_KEY` | Whisper + GPT 코칭용. 없으면 mock |
| `USE_MOCK_STT` | true 시 STT mock |
| `USE_MOCK_LLM` | true 시 LLM mock |

## 제약

- **실시간 스트리밍 아님**: 녹음/업로드 완료 후 한 번에 분석
- 영상·음성 모두 **동일 분석 파이프라인** 사용
