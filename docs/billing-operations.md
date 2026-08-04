# Dayflow 정기결제 운영 설정

Dayflow의 정기결제 코드는 빌링키를 저장하는 것만으로 자동 실행되지 않습니다. 토스페이먼츠는 결제 주기 스케줄러를 제공하지 않으므로 Dayflow가 `toss-renewal` 함수를 정기적으로 호출해야 합니다.

## 배포 전 비밀값

다음 값은 브라우저나 Git에 넣지 않고 Supabase Edge Function Secret으로만 설정합니다.

```powershell
npx supabase secrets set BILLING_CRON_SECRET="충분히 긴 무작위 값"
npx supabase secrets set TOSS_WEBHOOK_TOKEN="별도의 충분히 긴 무작위 값"
```

`TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`도 자동결제 계약이 연결된 MID의 키여야 합니다. 테스트 키와 라이브 키를 섞으면 안 됩니다.

## 함수 배포

```powershell
npx supabase functions deploy admin-dashboard
npx supabase functions deploy admin-operations
npx supabase functions deploy trial-chat
npx supabase functions deploy toss-billing
npx supabase functions deploy support-ticket
npx supabase functions deploy toss-renewal --no-verify-jwt
npx supabase functions deploy toss-webhook --no-verify-jwt
```

`toss-renewal`은 JWT 대신 `x-dayflow-cron-secret` 헤더를 검증합니다. `toss-webhook`은 URL의 `token` 쿼리를 검증하고, 일반 결제 상태 웹훅은 토스 결제 조회 API를 다시 호출해 상태를 확인합니다.

## 정기 실행

Supabase Cron 또는 별도의 신뢰 가능한 스케줄러에서 다음 요청을 매시간 실행합니다.

```http
POST https://<project-ref>.supabase.co/functions/v1/toss-renewal
x-dayflow-cron-secret: <BILLING_CRON_SECRET>
```

함수는 `next_billing_at`이 지난 `active` 또는 `past_due` 구독만 처리합니다. 동일 결제는 고정 멱등성 키와 데이터베이스 고유 제약으로 중복 실행을 막습니다.

- 성공: 다음 한 달 이용기간을 만들고 결제와 감사 기록을 저장합니다.
- 실패: 하루 뒤 다시 시도합니다.
- 최대 재시도: 3회
- 유예기간: 최초 실패 후 3일

처음에는 테스트 MID에서 수동 호출로 한 건을 검증한 뒤 Cron을 켜야 합니다. 라이브 키로 바꾼 상태에서 검증 없이 Cron을 활성화하면 실제 카드 청구가 발생합니다.

## 토스 웹훅

토스페이먼츠 개발자센터에 다음 URL을 등록합니다.

```text
https://<project-ref>.supabase.co/functions/v1/toss-webhook?token=<TOSS_WEBHOOK_TOKEN>
```

등록 이벤트:

- `PAYMENT_STATUS_CHANGED`
- `BILLING_DELETED`

웹훅 원문과 처리 상태는 `billing_events`에 저장됩니다. 중복 이벤트는 `event_key` 고유 제약으로 무시합니다.

## 운영 확인 순서

1. 테스트 결제로 첫 구독 생성
2. 해당 구독의 `next_billing_at`을 테스트 가능한 시각으로 조정
3. `toss-renewal` 수동 호출
4. `billing_attempts`, `billing_payments`, `billing_subscriptions` 확인
5. 어드민의 구독·결제 및 감사 기록 확인
6. 실패 카드 시나리오와 3회 재시도 확인
7. 테스트 결과가 모두 맞은 뒤 Cron 활성화
