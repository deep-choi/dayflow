create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan_id text not null,
  status text not null check (status in ('active', 'canceled', 'past_due')),
  billing_key text not null,
  card_company text,
  card_number_masked text,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  next_billing_at timestamptz,
  canceled_at timestamptz,
  last_payment_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  toss_order_id text not null unique,
  payment_key text unique,
  plan_id text not null,
  amount integer not null check (amount >= 0),
  currency text not null default 'KRW',
  status text not null,
  failure_code text,
  failure_message text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists billing_payments_user_created_idx
  on public.billing_payments (user_id, created_at desc);

alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;

-- 결제키와 전체 결제 응답은 브라우저에서 직접 읽지 않고 Edge Function만 접근합니다.
revoke all on public.billing_customers from anon, authenticated;
revoke all on public.billing_subscriptions from anon, authenticated;
revoke all on public.billing_payments from anon, authenticated;

grant all on public.billing_customers to service_role;
grant all on public.billing_subscriptions to service_role;
grant all on public.billing_payments to service_role;
