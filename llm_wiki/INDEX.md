# 🧠 Dayflow LLM Wiki Index

Dayflow 웹서비스의 시스템 아키텍처, 데이터 모델, AI 서비스 파이프라인, 동기화 엔진을 체계적으로 파악할 수 있는 모듈형 지식 문서(Knowledge Base)입니다.

---

## 📚 Wiki 문서 목차

1. [🏛️ 아키텍처 및 시스템 구조 (ARCHITECTURE.md)](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/llm_wiki/ARCHITECTURE.md)
   - 프로젝트 개요 및 핵심 가치
   - 프론트엔드/백엔드/AI 통합 아키텍처
   - 프로젝트 디렉토리 맵 & 핵심 파일 가이드

2. [📱 화면 및 UX 모듈 분석 (VIEWS_AND_UX.md)](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/llm_wiki/VIEWS_AND_UX.md)
   - 7대 주요 View 컴포넌트 분석 (`Journal`, `Todo`, `Calendar`, `Chat`, `CommunityBoard`, `PersonaSettings`, `ApiSettings`)
   - Notion 스타일 UI & 무한 캔버스 패닝 UX

3. [🤖 AI 서비스 & 페르소나 엔진 (AI_AND_PERSONA.md)](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/llm_wiki/AI_AND_PERSONA.md)
   - Multi-LLM 연동 체계 (Gemini, OpenAI, Anthropic, xAI, Ollama)
   - Intent & Action Parsing (채팅 기반 일정/할일/일기 자동 등록)
   - Persona Memory System (Fact, Preference, Goal 추론 및 저장)

4. [💾 데이터 모델 & 동기화 엔진 (DATA_AND_SYNC.md)](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/llm_wiki/DATA_AND_SYNC.md)
   - `types.ts` 인터페이스 모델 상세
   - Supabase PostgreSQL 스키마 & RLS 보안 정책
   - Dual Persistence (LocalStorage ↔ Supabase Cloud Debounced Sync)

5. [🚀 개발 및 운영 가이드 (OPERATIONS.md)](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/llm_wiki/OPERATIONS.md)
   - 환경변수 및 로컬 개발 환경 구축
   - Firebase Hosting 배포 및 Supabase Edge Function 배포

---

## 🛠️ 기술 스택 한눈에 보기

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, `@dnd-kit/core`, `lucide-react`
- **Backend & DB**: Supabase (PostgreSQL, Auth, RLS, Edge Functions)
- **AI Integration**: `@google/genai` (Gemini 2.5/3.0), OpenAI, Anthropic Claude, xAI, Ollama
- **Hosting**: Firebase Hosting (`https://dayflow.web.app`)
