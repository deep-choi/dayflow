# Dayflow 관리자 페이지 설정

관리자 페이지는 프런트엔드 메뉴 숨김만으로 보호하지 않습니다. `admin-dashboard` Edge Function이 로그인 사용자의 JWT를 다시 확인하고 `app_metadata.role`이 `admin`인 경우에만 서비스 역할로 운영 데이터를 조회합니다.

## 최초 관리자 지정

Supabase Dashboard의 SQL Editor에서 실제 관리자 이메일로 아래 쿼리를 한 번 실행합니다.

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = '관리자 이메일';
```

권한을 JWT에 반영하려면 해당 계정에서 로그아웃한 뒤 다시 로그인해야 합니다. 이후 계정 메뉴에 `관리자` 항목이 표시됩니다.

관리자 권한을 회수할 때는 다음 쿼리를 사용합니다.

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'role'
where email = '관리자 이메일';
```

## 필요한 배포

웹 배포와 별도로 관리자 Edge Function을 배포해야 합니다.

```powershell
npx supabase functions deploy admin-dashboard
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 관리하는 함수 환경 변수를 사용합니다. 서비스 역할 키를 `VITE_` 환경 변수나 브라우저 코드에 넣으면 안 됩니다.

## 현재 범위

- 관리자 전용 사이드바와 운영 현황
- 회원, 구독, 결제, AI 사용량, 고객지원, 시스템, 감사 기록 조회
- 회원 운영 메모와 계정 이용 제한·복구
- 자동갱신 해지와 전체·부분 환불
- 모델별 AI 토큰·오류·응답 시간 조회
- 서비스 내 고객 문의 접수·답변·상태 관리
- 토스 웹훅 처리 및 정기결제 시도 상태 확인
- 모든 관리자 조치 사유와 변경 이력 저장

환불, 자동갱신 해지, 회원 이용 제한은 전용 서버 함수에서만 실행됩니다. 화면에서 작업 사유를 입력하고 재확인해야 하며 결과는 `admin_audit_logs`에 저장됩니다. 빌링키·결제키·서비스 역할 키는 브라우저 응답에 포함하지 않습니다.

정기결제 스케줄과 토스 웹훅 설정은 [billing-operations.md](./billing-operations.md)를 따릅니다.
