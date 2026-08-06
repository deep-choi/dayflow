# 📱 Dayflow Views & UX Modules

Dayflow의 프론트엔드를 구성하는 7개 핵심 뷰(`views/`) 컴포넌트에 대한 역할, UI/UX 컨셉 및 최근 시스템 디자인 규칙에 대한 분석입니다.

---

## 1. 🎨 UI/UX Design System Rules (디자인 시스템 규칙)

최신 사용자 UX 개선 작업에 맞춰 정의된 글로벌 디자인 가이드라인입니다:

- **Primary Text Color**: `#37352f` (Notion 스타일 따뜻한 숯검정 톤). 기존의 자극적인 강한 검정(`#171717`) 금지.
- **Font Weight Restrictions**: 오직 **`400` (`font-normal`)**과 **`500` (`font-medium`)** 두 종류만 허용. `600` (`font-semibold`) 및 `700` (`font-bold`) 금지.
- **Font Size Restrictions**: 최소 폰트 크기는 **14px (`text-sm`)**. 12px (`text-xs`) 이하 크기는 시각적 편의를 위해 전면 배제.
- **Border & Focus Color Rules**: 테두리는 은은하고 일관된 연한 회색만 허용 (`border-[#e9e9e8]`, `border-[#dcdcd9]`, `focus:border-[#d4d4d4]`). 테두리에 파란색(`border-blue-*` 및 `focus:border-[var(--color-primary)]`) 사용 금지.
- **Brand Action Color**: 주요 실행 버튼 및 활성화 버튼에는 브랜드 파란색(`bg-blue-600`, `hover:bg-blue-700`)을 일관되게 사용.
- **Subtle Active State**: 탭 및 메뉴 선택 시 파란색 배경 대신 부드러운 중성 회색(`bg-[#e8e8e6] text-[#37352f]`)을 사용.

---

## 2. 개별 View 상세 분석

### 2.1. [`JournalView.tsx`](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/views/JournalView.tsx) - 일기장 / 메모장
- **UX 컨셉**: Notion 스타일의 차분한 미니멀 메모장
- **핵심 기능**:
  - `isListOpen` 토글을 통한 목록 보기 보기 개수 조정(5줄/10줄/20줄 확장).
  - 글쓰기 모드(`isWriting`) 시 에디터 영역이 포커스되어 제목, 내용, 기분 카테고리(`mood`) 선택 가능.
  - **✨ AI Social Interaction**: 일기를 작성하여 저장하면, 설정된 AI 페르소나들이 각 일기 하단에 **댓글(Comments)**을 자동 생성하여 감정적 공감과 라이프 팁을 전달.

### 2.2. [`TodoView.tsx`](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/views/TodoView.tsx) - 할 일 관리 보드
- **UX 컨셉**: Trello + 무한 캔버스 칸반 보드
- **핵심 기능**:
  - 마우스 드래그를 통한 캔버스 패닝(`isPanning`) 지원.
  - `@dnd-kit/core` 및 `@dnd-kit/sortable` 기반의 완벽한 **Drag & Drop** 지원 (리스트 간 할일 이동, 리스트 순서 변경).
  - SubTask(하위 단계) 분할 작성 및 체크박스 상태 업데이트.
  - 클릭 한 번으로 항목 수정 가능한 **In-place Inline Editing**.

### 2.3. [`CalendarView.tsx`](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/views/CalendarView.tsx) - 일정 관리 캘린더
- **UX 컨셉**: 미니멀 Grid 기반 월간 캘린더
- **핵심 기능**:
  - **Double Click Quick Add**: 특정 날짜 더블 클릭 시 해당 일자의 일정 작성 모달 팝업.
  - **Wheel Interaction**: 마우스 휠 스크롤을 감지해 가볍게 이전/다음 달로 화면 전환 (`handleWheel`).
  - 태그 색상 지정, 종일(All Day) 일정 처리 및 시간 지정 타임피커 지원.

### 2.4. [`ChatView.tsx`](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/views/ChatView.tsx) - AI 대화 & Intent Agent
- **UX 컨셉**: 메시지 말풍선 기반의 페르소나 대화 공간
- **핵심 기능**:
  - **온보딩 프로세스 (`onboardingStep`)**: 최초 접속 시 사용자 이름과 환경을 묻는 웰컴 챗.
  - **다중 페르소나 채팅**: 1개 이상의 페르소나를 선택하여 단체 대화 또는 1:1 대화 가능.
  - **Intent Parsing & Action Card**: 자연어 메시지를 분석해 `add_event`, `add_todo`, `add_journal_entry` 등 UI 액션 카드를 챗 화면 내에 렌더링하고, 클릭 시 즉시 데이터베이스에 반영.
  - **모달 UX 개편**: 페르소나 편집 모달을 슬림한 `512px`(`sm:max-w-lg`) 폭으로 정돈하고, 답답한 외각 중첩 박스를 제거한 개방형 라이트 레이아웃 구성.

### 2.5. [`CommunityBoardView.tsx`](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/views/CommunityBoardView.tsx) - AI 피드 보드
- **UX 컨셉**: AI 페르소나들의 독백 & 생태계 피드
- **핵심 기능**:
  - AI 페르소나들이 스스로 작성하거나 생성한 일상 생각 포스트가 무한 피드로 렌더링.
  - 사용자가 역으로 AI의 포스트에 댓글(`onAddComment`) 및 이모지 반응을 남길 수 있는 소셜 반전 창구.

### 2.6. [`PersonaSettingsView.tsx`](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/views/PersonaSettingsView.tsx) - 페르소나 & 기억 관리
- **UX 컨셉**: AI 에이전트 커스텀 랩 & 메모리 데이터베이스
- **핵심 기능**:
  - AI 에이전트의 이름, 역할, 성격, 어조, 컬러, 응답 길이 및 커스텀 API 설정.
  - 대화 중 자동 수집된 사용자 **장기 기억(Persona Memory)**을 조회, 수정, 고정(Pin)하거나 삭제 관리.
  - **하단 액션 바**: 페르소나 관리 버튼(`[ ⟳ 기본값으로 복원 ]`, `[ + 새 페르소나 추가 ]`)을 목록 맨 우측 하단(`justify-end`)으로 재배치하여 상단 헤더와의 충돌 방지.

### 2.7. [`SettingsView.tsx`](file:///C:/Users/%EC%B5%9C%EB%8F%99%EC%A4%80/Desktop/project/dayflow/views/SettingsView.tsx) - API & 시스템 설정
- **UX 컨셉**: LLM 연결 허브 & 대시보드
- **핵심 기능**:
  - **프로필 설정**: 변경사항 저장 버튼을 우측 정렬(`justify-end`) 및 항상 선명한 파란색(`bg-blue-600`) 상태로 표시.
  - **API & AI 모델 카드**: 답답한 회색 중첩 박스 대신 심플한 화이트 카드(`border-[#e9e9e8] bg-white rounded-2xl`) 및 인라인 API Key 입력창 제공.
  - **테마 설정**: 테마 모드 선택 아이콘 크기를 **`24px`** (`h-11 w-11` 박스)로 확대하여 시각적 직관성 강화.
