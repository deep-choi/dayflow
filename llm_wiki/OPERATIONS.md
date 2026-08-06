# 🚀 Dayflow Operations & Deployment Guide

Dayflow 프로젝트의 로컬 환경 설정, 환경변수, 빌드 및 Firebase Hosting 배포 가이드입니다.

---

## 1. 사전 준비 사항 (Prerequisites)

- Node.js (v18+)
- npm 또는 yarn
- Supabase CLI (`npx supabase`)
- Firebase CLI (`npx firebase-tools`)

---

## 2. 로컬 실행 (Run Locally)

```bash
# 1. 패키지 라이브러리 설치
npm install

# 2. 로컬 개발 환경 변수 (.env.local) 설정
# VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
# VITE_SUPABASE_ANON_KEY=<your-anon-key>

# 3. 로컬 개발 서버 실행
npm run dev
```

---

## 3. 빌드 및 배포 (Build & Firebase Hosting Deployment)

Firebase Hosting은 프로젝트의 공식 운영 호스팅 타겟입니다.

- **Firebase Project**: `life-a01e2`
- **Hosting Target**: `dayflow.web.app`

```bash
# 1. 인코딩 및 타입체크 후 Production 빌드
npm run build

# 2. Firebase Hosting으로 원클릭 배포
npm run deploy
```

---

## 4. 자주 겪는 트러블슈팅 (Troubleshooting)

- **AI 응답 미작동**: `ApiSettingsView.tsx`에서 Gemini API 키 또는 선택된 AI 프로바이더의 연결 상태를 활성화(`isActive`)했는지 확인합니다.
- **Supabase 동기화 오류**: `.env.local`의 `VITE_SUPABASE_URL` 및 `VITE_SUPABASE_ANON_KEY`가 올바른지 체크합니다.
