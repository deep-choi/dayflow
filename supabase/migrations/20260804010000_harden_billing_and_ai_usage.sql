-- Bound AI generation fan-out per user turn and make money-moving operations retry-safe.

create table if not exists public.ai_generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_id uuid not null,
  payload_hash text not null check (char_length(payload_hash) = 64),
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, turn_id, payload_hash)
);

create index if not exists ai_generation_requests_user_created_idx
  on public.ai_generation_requests (user_id, created_at desc);
create index if not exists ai_generation_requests_turn_idx
  on public.ai_generation_requests (user_id, turn_id, created_at asc);

alter table public.ai_generation_requests enable row level security;
revoke all on public.ai_generation_requests from anon, authenticated;
grant all on public.ai_generation_requests to service_role;

create or replace function public.claim_ai_generation_request(
  p_user_id uuid,
  p_turn_id uuid,
  p_payload_hash text,
  p_max_per_turn integer default 20,
  p_max_per_minute integer default 30
)
returns table (
  allowed boolean,
  reason text,
  generation_request_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_turn_count integer;
  v_minute_count integer;
begin
  if p_payload_hash is null or char_length(p_payload_hash) <> 64 then
    return query select false, 'INVALID_PAYLOAD_HASH'::text, null::uuid;
    return;
  end if;

  -- Serialize all generation claims for a user so parallel turns cannot bypass the minute limit.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select request.id
    into v_request_id
  from public.ai_generation_requests as request
  where request.user_id = p_user_id
    and request.turn_id = p_turn_id
    and request.payload_hash = p_payload_hash;

  if v_request_id is not null then
    return query select false, 'DUPLICATE_GENERATION'::text, v_request_id;
    return;
  end if;

  select count(*)::integer
    into v_turn_count
  from public.ai_generation_requests as request
  where request.user_id = p_user_id
    and request.turn_id = p_turn_id;

  if v_turn_count >= greatest(1, least(coalesce(p_max_per_turn, 1), 50)) then
    return query select false, 'TURN_GENERATION_LIMIT'::text, null::uuid;
    return;
  end if;

  select count(*)::integer
    into v_minute_count
  from public.ai_generation_requests as request
  where request.user_id = p_user_id
    and request.created_at >= now() - interval '1 minute';

  if v_minute_count >= greatest(1, least(coalesce(p_max_per_minute, 1), 100)) then
    return query select false, 'AI_RATE_LIMITED'::text, null::uuid;
    return;
  end if;

  insert into public.ai_generation_requests (user_id, turn_id, payload_hash)
  values (p_user_id, p_turn_id, p_payload_hash)
  returning id into v_request_id;

  return query select true, 'CLAIMED'::text, v_request_id;
end;
$$;

revoke all on function public.claim_ai_generation_request(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_generation_request(uuid, uuid, text, integer, integer) to service_role;

create table if not exists public.billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  customer_key text not null,
  auth_key_hash text not null unique check (char_length(auth_key_hash) = 64),
  toss_order_id text not null unique,
  issue_idempotency_key uuid not null default gen_random_uuid() unique,
  payment_idempotency_key uuid not null default gen_random_uuid() unique,
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  failure_code text,
  failure_message text,
  locked_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_checkout_attempts_user_processing_uq
  on public.billing_checkout_attempts (user_id)
  where status = 'processing';
create index if not exists billing_checkout_attempts_created_idx
  on public.billing_checkout_attempts (created_at desc);

alter table public.billing_checkout_attempts enable row level security;
revoke all on public.billing_checkout_attempts from anon, authenticated;
grant all on public.billing_checkout_attempts to service_role;

create or replace function public.claim_billing_checkout(
  p_user_id uuid,
  p_plan_id text,
  p_customer_key text,
  p_auth_key_hash text,
  p_toss_order_id text
)
returns table (
  attempt_id uuid,
  claim_status text,
  toss_order_id text,
  issue_idempotency_key uuid,
  payment_idempotency_key uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.billing_checkout_attempts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_attempt
  from public.billing_checkout_attempts
  where auth_key_hash = p_auth_key_hash
  for update;

  if found then
    if v_attempt.user_id <> p_user_id or v_attempt.customer_key <> p_customer_key or v_attempt.plan_id <> p_plan_id then
      return query select v_attempt.id, 'MISMATCH'::text, v_attempt.toss_order_id,
        v_attempt.issue_idempotency_key, v_attempt.payment_idempotency_key;
      return;
    end if;
    if v_attempt.status = 'succeeded' then
      return query select v_attempt.id, 'COMPLETED'::text, v_attempt.toss_order_id,
        v_attempt.issue_idempotency_key, v_attempt.payment_idempotency_key;
      return;
    end if;
    if v_attempt.status = 'failed' then
      return query select v_attempt.id, 'FAILED'::text, v_attempt.toss_order_id,
        v_attempt.issue_idempotency_key, v_attempt.payment_idempotency_key;
      return;
    end if;
    if v_attempt.locked_at >= now() - interval '2 minutes' then
      return query select v_attempt.id, 'IN_PROGRESS'::text, v_attempt.toss_order_id,
        v_attempt.issue_idempotency_key, v_attempt.payment_idempotency_key;
      return;
    end if;

    update public.billing_checkout_attempts
      set locked_at = now(), updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;

    return query select v_attempt.id, 'CLAIMED'::text, v_attempt.toss_order_id,
      v_attempt.issue_idempotency_key, v_attempt.payment_idempotency_key;
    return;
  end if;

  if exists (
    select 1 from public.billing_subscriptions
    where user_id = p_user_id
      and status in ('active', 'canceled')
      and current_period_end > now()
  ) then
    return query select null::uuid, 'SUBSCRIPTION_ACTIVE'::text, null::text, null::uuid, null::uuid;
    return;
  end if;

  update public.billing_checkout_attempts
  set status = 'failed', failure_code = 'STALE_CHECKOUT',
      failure_message = '새 결제 요청으로 대체되었습니다.', completed_at = now(), updated_at = now()
  where user_id = p_user_id
    and status = 'processing'
    and locked_at < now() - interval '2 minutes';

  begin
    insert into public.billing_checkout_attempts (
      user_id, plan_id, customer_key, auth_key_hash, toss_order_id
    ) values (
      p_user_id, p_plan_id, p_customer_key, p_auth_key_hash, p_toss_order_id
    ) returning * into v_attempt;
  exception when unique_violation then
    return query select null::uuid, 'IN_PROGRESS'::text, null::text, null::uuid, null::uuid;
    return;
  end;

  return query select v_attempt.id, 'CLAIMED'::text, v_attempt.toss_order_id,
    v_attempt.issue_idempotency_key, v_attempt.payment_idempotency_key;
end;
$$;

revoke all on function public.claim_billing_checkout(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_billing_checkout(uuid, text, text, text, text) to service_role;

create or replace function public.complete_billing_checkout(
  p_attempt_id uuid,
  p_billing_key text,
  p_payment_key text,
  p_payment_status text,
  p_approved_at timestamptz,
  p_card_company text,
  p_card_number_masked text
)
returns table (
  subscription_id uuid,
  plan_id text,
  current_period_start timestamptz,
  current_period_end timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.billing_checkout_attempts%rowtype;
  v_subscription_id uuid;
  v_period_start timestamptz := coalesce(p_approved_at, now());
  v_period_end timestamptz := coalesce(p_approved_at, now()) + interval '1 month';
  v_amount integer;
begin
  select * into v_attempt
  from public.billing_checkout_attempts
  where id = p_attempt_id
  for update;

  if not found then raise exception 'CHECKOUT_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status = 'failed' then raise exception 'CHECKOUT_ATTEMPT_FAILED'; end if;

  v_amount := case v_attempt.plan_id
    when 'dayflow_plus_monthly' then 4900
    when 'dayflow_pro_monthly' then 9900
    else null
  end;
  if v_amount is null then raise exception 'UNKNOWN_PLAN'; end if;

  insert into public.billing_subscriptions (
    user_id, plan_id, status, billing_key, card_company, card_number_masked,
    current_period_start, current_period_end, next_billing_at, canceled_at,
    last_payment_key, retry_count, grace_period_end, last_billing_error, updated_at
  ) values (
    v_attempt.user_id, v_attempt.plan_id, 'active', p_billing_key, p_card_company, p_card_number_masked,
    v_period_start, v_period_end, v_period_end, null,
    p_payment_key, 0, null, null, now()
  )
  on conflict (user_id) do update set
    plan_id = excluded.plan_id,
    status = excluded.status,
    billing_key = excluded.billing_key,
    card_company = excluded.card_company,
    card_number_masked = excluded.card_number_masked,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    next_billing_at = excluded.next_billing_at,
    canceled_at = null,
    last_payment_key = excluded.last_payment_key,
    retry_count = 0,
    grace_period_end = null,
    last_billing_error = null,
    updated_at = now()
  returning id into v_subscription_id;

  insert into public.billing_payments (
    user_id, subscription_id, toss_order_id, payment_key, plan_id, amount, status, approved_at
  ) values (
    v_attempt.user_id, v_subscription_id, v_attempt.toss_order_id, p_payment_key,
    v_attempt.plan_id, v_amount, p_payment_status, v_period_start
  )
  on conflict (toss_order_id) do update set
    subscription_id = excluded.subscription_id,
    payment_key = excluded.payment_key,
    status = excluded.status,
    approved_at = excluded.approved_at;

  update public.billing_checkout_attempts
  set status = 'succeeded', completed_at = now(), updated_at = now(), failure_code = null, failure_message = null
  where id = v_attempt.id;

  insert into public.admin_audit_logs (
    admin_user_id, action, target_type, target_id, reason, metadata
  ) values (
    null, 'subscription.started', 'subscription', v_subscription_id::text, '첫 정기결제 승인',
    jsonb_build_object('userId', v_attempt.user_id, 'amount', v_amount, 'orderId', v_attempt.toss_order_id)
  );

  return query select v_subscription_id, v_attempt.plan_id, v_period_start, v_period_end;
end;
$$;

revoke all on function public.complete_billing_checkout(uuid, text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.complete_billing_checkout(uuid, text, text, text, timestamptz, text, text) to service_role;

alter table public.billing_attempts
  add column if not exists locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.billing_attempts
set locked_at = coalesce(locked_at, created_at)
where locked_at is null;

alter table public.billing_attempts
  alter column locked_at set default now(),
  alter column locked_at set not null;

create or replace function public.complete_billing_renewal(
  p_attempt_id uuid,
  p_payment_key text,
  p_payment_status text,
  p_approved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.billing_attempts%rowtype;
  v_subscription public.billing_subscriptions%rowtype;
  v_period_start timestamptz := coalesce(p_approved_at, now());
  v_period_end timestamptz := coalesce(p_approved_at, now()) + interval '1 month';
begin
  select * into v_attempt from public.billing_attempts where id = p_attempt_id for update;
  if not found then raise exception 'BILLING_ATTEMPT_NOT_FOUND'; end if;
  select * into v_subscription from public.billing_subscriptions where id = v_attempt.subscription_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;

  insert into public.billing_payments (
    user_id, subscription_id, toss_order_id, payment_key, plan_id, amount, status, approved_at
  ) values (
    v_attempt.user_id, v_attempt.subscription_id, v_attempt.toss_order_id, p_payment_key,
    v_subscription.plan_id, v_attempt.amount, p_payment_status, v_period_start
  )
  on conflict (toss_order_id) do update set
    payment_key = excluded.payment_key,
    status = excluded.status,
    approved_at = excluded.approved_at;

  update public.billing_subscriptions set
    status = 'active', current_period_start = v_period_start, current_period_end = v_period_end,
    next_billing_at = v_period_end, last_payment_key = p_payment_key,
    retry_count = 0, grace_period_end = null, last_billing_error = null, updated_at = now()
  where id = v_subscription.id;

  update public.billing_attempts set
    status = 'succeeded', payment_key = p_payment_key, processed_at = now(), updated_at = now(),
    failure_code = null, failure_message = null
  where id = v_attempt.id;

  insert into public.admin_audit_logs (
    admin_user_id, action, target_type, target_id, reason, metadata
  ) values (
    null, 'subscription.renewed', 'subscription', v_subscription.id::text, '자동 정기결제',
    jsonb_build_object('userId', v_attempt.user_id, 'amount', v_attempt.amount, 'orderId', v_attempt.toss_order_id)
  );
end;
$$;

revoke all on function public.complete_billing_renewal(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_billing_renewal(uuid, text, text, timestamptz) to service_role;

create or replace function public.fail_billing_renewal(
  p_attempt_id uuid,
  p_failure_code text,
  p_failure_message text,
  p_next_retry_at timestamptz,
  p_grace_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.billing_attempts%rowtype;
  v_subscription public.billing_subscriptions%rowtype;
begin
  select * into v_attempt from public.billing_attempts where id = p_attempt_id for update;
  if not found then raise exception 'BILLING_ATTEMPT_NOT_FOUND'; end if;
  select * into v_subscription from public.billing_subscriptions where id = v_attempt.subscription_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;

  insert into public.billing_payments (
    user_id, subscription_id, toss_order_id, plan_id, amount, status, failure_code, failure_message
  ) values (
    v_attempt.user_id, v_attempt.subscription_id, v_attempt.toss_order_id,
    v_subscription.plan_id, v_attempt.amount, 'FAILED', p_failure_code, p_failure_message
  )
  on conflict (toss_order_id) do update set
    status = 'FAILED', failure_code = excluded.failure_code, failure_message = excluded.failure_message;

  update public.billing_subscriptions set
    status = 'past_due', retry_count = v_attempt.attempt_number,
    next_billing_at = p_next_retry_at, grace_period_end = p_grace_period_end,
    last_billing_error = concat_ws(': ', p_failure_code, p_failure_message), updated_at = now()
  where id = v_subscription.id;

  update public.billing_attempts set
    status = 'failed', failure_code = p_failure_code, failure_message = p_failure_message,
    processed_at = now(), updated_at = now()
  where id = v_attempt.id;
end;
$$;

revoke all on function public.fail_billing_renewal(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fail_billing_renewal(uuid, text, text, timestamptz, timestamptz) to service_role;

alter table public.billing_refunds
  add column if not exists operation_key uuid,
  add column if not exists idempotency_key uuid,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists billing_refunds_operation_key_uq
  on public.billing_refunds (operation_key) where operation_key is not null;
create unique index if not exists billing_refunds_idempotency_key_uq
  on public.billing_refunds (idempotency_key) where idempotency_key is not null;
create unique index if not exists billing_refunds_transaction_key_uq
  on public.billing_refunds (toss_transaction_key) where toss_transaction_key is not null;

create or replace function public.claim_billing_refund(
  p_payment_id uuid,
  p_admin_user_id uuid,
  p_operation_key uuid,
  p_amount integer,
  p_reason text
)
returns table (
  refund_id uuid,
  claim_status text,
  idempotency_key uuid,
  payment_key text,
  payment_amount integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.billing_payments%rowtype;
  v_refund public.billing_refunds%rowtype;
  v_reserved integer;
begin
  select * into v_payment from public.billing_payments where id = p_payment_id for update;
  if not found or v_payment.payment_key is null then
    return query select null::uuid, 'PAYMENT_NOT_FOUND'::text, null::uuid, null::text, null::integer;
    return;
  end if;

  select * into v_refund from public.billing_refunds where operation_key = p_operation_key for update;
  if found then
    if v_refund.status = 'DONE' then
      return query select v_refund.id, 'COMPLETED'::text,
        v_refund.idempotency_key, v_payment.payment_key, v_payment.amount;
      return;
    end if;
    if v_refund.status = 'FAILED' then
      return query select v_refund.id, 'FAILED'::text,
        v_refund.idempotency_key, v_payment.payment_key, v_payment.amount;
      return;
    end if;
    if v_refund.locked_at >= now() - interval '2 minutes' then
      return query select v_refund.id, 'IN_PROGRESS'::text,
        v_refund.idempotency_key, v_payment.payment_key, v_payment.amount;
      return;
    end if;
    update public.billing_refunds set locked_at = now(), updated_at = now()
    where id = v_refund.id returning * into v_refund;
    return query select v_refund.id, 'CLAIMED'::text,
      v_refund.idempotency_key, v_payment.payment_key, v_payment.amount;
    return;
  end if;

  select coalesce(sum(refund.amount), 0)::integer into v_reserved
  from public.billing_refunds as refund
  where refund.payment_id = p_payment_id
    and refund.status in ('processing', 'DONE');

  if p_amount <= 0 or p_amount > v_payment.amount - v_reserved then
    return query select null::uuid, 'INVALID_AMOUNT'::text, null::uuid, v_payment.payment_key, v_payment.amount;
    return;
  end if;

  insert into public.billing_refunds (
    payment_id, user_id, admin_user_id, amount, reason, status,
    operation_key, idempotency_key, locked_at
  ) values (
    v_payment.id, v_payment.user_id, p_admin_user_id, p_amount, p_reason, 'processing',
    p_operation_key, gen_random_uuid(), now()
  ) returning * into v_refund;

  return query select v_refund.id, 'CLAIMED'::text, v_refund.idempotency_key, v_payment.payment_key, v_payment.amount;
end;
$$;

revoke all on function public.claim_billing_refund(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.claim_billing_refund(uuid, uuid, uuid, integer, text) to service_role;

create or replace function public.complete_billing_refund(
  p_refund_id uuid,
  p_toss_transaction_key text
)
returns table (payment_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.billing_refunds%rowtype;
  v_payment public.billing_payments%rowtype;
  v_refunded integer;
  v_status text;
begin
  select * into v_refund from public.billing_refunds where id = p_refund_id for update;
  if not found then raise exception 'REFUND_NOT_FOUND'; end if;
  select * into v_payment from public.billing_payments where id = v_refund.payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  update public.billing_refunds set
    status = 'DONE', toss_transaction_key = coalesce(p_toss_transaction_key, toss_transaction_key),
    failure_code = null, failure_message = null, updated_at = now()
  where id = v_refund.id;

  select coalesce(sum(amount), 0)::integer into v_refunded
  from public.billing_refunds
  where payment_id = v_payment.id and status = 'DONE';

  v_status := case when v_refunded >= v_payment.amount then 'CANCELED' else 'PARTIAL_CANCELED' end;
  update public.billing_payments set status = v_status where id = v_payment.id;

  insert into public.admin_audit_logs (
    admin_user_id, action, target_type, target_id, reason, metadata
  ) values (
    v_refund.admin_user_id, 'payment.refunded', 'payment', v_payment.id::text, v_refund.reason,
    jsonb_build_object('userId', v_refund.user_id, 'amount', v_refund.amount, 'status', v_status)
  );

  return query select v_status;
end;
$$;

revoke all on function public.complete_billing_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_billing_refund(uuid, text) to service_role;

-- Match the existing partial unique index when deduplicating queued AI triggers.
create or replace function public.enqueue_ai_trigger(
  p_user_id uuid,
  p_trigger text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_scheduled_for timestamp with time zone default timezone('utc'::text, now())
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_dedupe_key is null then
    insert into public.ai_trigger_queue (user_id, trigger, payload, scheduled_for)
    values (p_user_id, p_trigger, coalesce(p_payload, '{}'::jsonb), coalesce(p_scheduled_for, timezone('utc'::text, now())));
  else
    insert into public.ai_trigger_queue (user_id, trigger, payload, dedupe_key, scheduled_for)
    values (p_user_id, p_trigger, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_scheduled_for, timezone('utc'::text, now())))
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;
end;
$$;
