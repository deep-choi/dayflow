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

- 전체 회원 수와 최근 회원 최대 100명 조회
- 유료 이용 중 회원 수 조회
- 이번 달 결제금액과 최근 결제 조회
- 무료·유료 AI 요청 누적량 조회
- 조회 전용 운영 화면

환불, 구독 강제 변경, 회원 정지 같은 작업은 실수와 권한 오남용 위험이 있어 현재 버전에는 포함하지 않습니다. 추가할 때는 작업별 재확인, 사유 기록, 감사 로그를 함께 구현해야 합니다.
