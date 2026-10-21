# Dayflow 관리자 운영

## 접속

- 운영 주소: `https://dayflow.web.app/admin`.
- 기존 Supabase 로그인을 사용한다. 운영자 여부는 클라이언트가 수정할 수 있는 프로필이 아니라 검증된 사용자의 `app_metadata.role = admin` 또는 `app_metadata.is_admin = true`로 서버에서 판단한다.
- 프로젝트 `mlpikaguvatuggzxqzve`의 기존 운영자 계정은 별도 신규 권한 부여 없이 사용한다. Firebase 관리자 권한과 Supabase 관리자 권한은 서로 다르다.
- 일반 계정과 비로그인 사용자는 운영 데이터를 받을 수 없다. 회원 메뉴의 ‘관리자 페이지’ 링크는 운영자에게만 표시된다.
- Google 로그인은 기존 루트 콜백을 유지하고, 관리자 화면에서 시작한 로그인은 성공 후 `/admin`으로 돌아온다. 복귀 표시는 10분 후 만료되며 권한을 부여하지 않는다.
- 관리 주소는 PWA의 오프라인 앱 화면 대체 대상에서 제외한다. 관리자 API 응답은 `Cache-Control: no-store`다.

## 화면과 범위

| 메뉴 | 제공 기능 |
| --- | --- |
| 운영 현황 | 등록 사용자, 미처리 문의, 최근 30일 서버 AI 요청/실패, 조회한 결제 내역의 이번 달 승인·환불액, 구독 권한 수 |
| 사용자 | 조회한 사용자 검색, 체험/구독 AI 사용량, 로그인 이용 제한/해제, 관리자 내부 메모 |
| AI 운영 | 서버 제공 체험 일시 중지, 비로그인 IP별/전체 일일 요청 수 변경, 최근 서버 AI 요청 메타데이터 |
| 문의·신고 | 기존 `app-support`/지원 접수 목록, 사용자가 제출한 메시지, 처리 상태·사유 변경 |
| 결제·환불 | 기존 Toss 연동 상태와 실제 결제/환불 기록 조회. 신규 결제·환불 실행 버튼 없음 |
| 변경 이력 | 운영자, 시각, 작업 대상, 사유 |

일정·할 일·메모·대화 원문, 개인 API 키, 결제키는 관리자 화면의 일반 목록에서 조회하지 않는다. 지원 내용에는 사용자가 신고·문의에 직접 제출한 내용만 표시한다.

문의 상태 변경은 사용자에게 메시지를 발송하지 않는다. 계정 삭제 요청을 ‘해결’로 바꾸는 것만으로 계정이 삭제되지 않는다. 계정 삭제, 결제/환불 실행은 이번 콘솔에서 제공하지 않는다.

사용자 자신과 다른 관리자 계정의 로그인 제한은 서버에서도 차단한다. 로그인 제한은 Supabase 계정에 적용한다. 이미 다운로드한 로컬 기록 삭제나 개인 API 키 폐기를 의미하지 않는다.

## AI 제한과 측정

- 서버 `trial-chat`만 관리한다. 사용자가 직접 연결한 Gemini/OpenAI/Anthropic/xAI/Ollama/개인 서버 요청의 키·과금·모델은 운영 콘솔에서 통제할 수 없다.
- 로그인 전 기기당 체험 10회, 로그인 후 계정당 무료 체험 10회는 기존 정책을 유지한다.
- 비로그인 IP별/전체 일일 상한은 기존 기본값 30/1,000이며 설정 저장 시 다음 예약부터 반영된다. 전체 상한은 비로그인 체험에만 적용한다.
- 일일 초기화는 UTC 자정(한국 시간 오전 9시). 재시작과 다중 인스턴스에서도 SQL transaction으로 공유하며, 같은 기기의 동시 예약도 직렬화한다.
- 일시 중지는 로그인 여부와 무관하게 서버 체험 호출 전에 검사한다. 이미 진행 중인 공급자 요청은 취소하지 않는다.
- 요청 수는 금액 상한이 아니다. 공급자 단가와 입력/출력/생각 토큰 등은 별도로 확인한다.
- 로그인 체험은 기존 `ai_usage_events`, 비로그인 체험은 새 `dayflow_guest_ai_events`에 공급자 호출 결과를 기록한다. 비로그인 이벤트에는 IP, 기기 ID, 대화, 인증 정보를 저장하지 않는다.
- 제공자 오류·내용 없음·네트워크 실패는 오류 코드만 기록한다. 로그 저장이 실패해도 AI 응답 자체는 유지하고 `trial_metrics_write_failed`를 남긴다. 공급자가 돌려주지 않은 토큰은 집계할 수 없다.
- AI 조회는 최근 30일 최대 2,000건 기준이며 수집 이전 요청은 복원하지 않는다. 사용자 목록 최대 1,000명, 문의 최대 1,000건, 지원 메시지 최대 3,000건, 결제·환불·감사 로그 각각 최대 200건을 조회하는 기존 API 범위를 유지한다. 조회 범위를 넘으면 화면 집계가 전체 통계와 다를 수 있다.

## DB 및 서버

- 새 마이그레이션: `supabase/migrations/20261021140000_dayflow_admin_console.sql`.
- 새 설정 테이블은 RLS 활성화, 일반/비로그인 권한 모두 회수, service role만 접근한다. 저장 RPC는 서버의 검증된 운영자 UID를 전달받아 실제 `auth.users` 권한을 다시 확인한다.
- 설정 변경과 감사 로그, 문의 상태 변경과 감사 로그는 각각 같은 DB transaction에서 저장한다. 설정 revision과 문의 updated_at으로 동시 편집을 감지한다.
- 기존 운영 서버의 `admin-dashboard`, `admin-operations` 소스를 회수해 저장소에 포함했다. 서비스 키는 서버 환경에만 있다. 기존 금융 실행 경로는 새 UI에서 호출하지 않는다.

기존 DB 이력과 관계없는 마이그레이션을 일괄 재실행하지 않는다. 이번 파일만 적용한 뒤 이력을 반영한다.

```powershell
npx supabase db query --linked --project-ref mlpikaguvatuggzxqzve --file supabase/migrations/20261021140000_dayflow_admin_console.sql
npx supabase migration repair 20261021140000 --status applied --linked
npx supabase functions deploy dayflow-admin admin-dashboard admin-operations trial-chat --project-ref mlpikaguvatuggzxqzve
npm run deploy -- --project life-a01e2 --non-interactive
```

## 확인

`npm run typecheck`, `npm run test:admin`, `npm run build`, Deno의 Edge Function 검사를 수행한다. DB에서는 기본값 유지, 설정 저장/감사 로그의 원자성, 오래된 revision 충돌, 일반 역할의 테이블/RPC 접근 거부를 확인한다. DB 쓰기 검증은 transaction 후 rollback하여 실제 운영 값을 바꾸지 않는다.

배포 후 실제 운영자 계정에서 모든 메뉴의 조회를 확인한다. 일반 계정·비로그인의 관리자 API 접근 거부를 별도 확인한다. 실제 사용자 제한, 실결제, 환불, 외부 답변 발송은 검증을 위해 실행하지 않는다.
