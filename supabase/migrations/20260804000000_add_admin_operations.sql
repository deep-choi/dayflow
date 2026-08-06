create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.billing_subscriptions
  add column if not exists retry_count integer not null default 0,
  add column if not exists grace_period_end timestamptz,
  add column if not exists last_billing_error text;

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs (target_type, target_id, created_at desc);

create table if not exists public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete set null,
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists admin_notes_user_created_idx
  on public.admin_notes (user_id, created_at desc);

create table if not exists public.billing_attempts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_at timestamptz not null,
  attempt_number integer not null default 1 check (attempt_number between 1 and 10),
  idempotency_key text not null unique,
  toss_order_id text not null unique,
  amount integer not null check (amount >= 0),
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  payment_key text,
  failure_code text,
  failure_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, scheduled_at, attempt_number)
);

create index if not exists billing_attempts_status_created_idx
  on public.billing_attempts (status, created_at desc);
create index if not exists billing_attempts_user_created_idx
  on public.billing_attempts (user_id, created_at desc);

create table if not exists public.billing_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.billing_payments(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete set null,
  amount integer not null check (amount > 0),
  reason text not null check (char_length(reason) between 2 and 500),
  status text not null default 'DONE',
  toss_transaction_key text,
  created_at timestamptz not null default now()
);

create index if not exists billing_refunds_payment_created_idx
  on public.billing_refunds (payment_id, created_at desc);
create index if not exists billing_refunds_created_idx
  on public.billing_refunds (created_at desc);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  toss_order_id text,
  payment_key text,
  billing_key text,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists billing_events_received_idx
  on public.billing_events (received_at desc);
create index if not exists billing_events_status_idx
  on public.billing_events (processing_status, received_at desc);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null unique,
  plan_id text not null,
  provider text not null default 'google',
  model text not null,
  status text not null check (status in ('succeeded', 'failed')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('service', 'account', 'billing', 'ai', 'other')),
  subject text not null check (char_length(subject) between 2 and 120),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists support_tickets_status_updated_idx
  on public.support_tickets (status, updated_at desc);
create index if not exists support_tickets_user_created_idx
  on public.support_tickets (user_id, created_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('user', 'admin')),
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists support_messages_ticket_created_idx
  on public.support_messages (ticket_id, created_at asc);

create index if not exists ai_usage_events_created_idx
  on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);
create index if not exists ai_usage_events_model_created_idx
  on public.ai_usage_events (model, created_at desc);

alter table public.admin_audit_logs enable row level security;
alter table public.admin_notes enable row level security;
alter table public.billing_attempts enable row level security;
alter table public.billing_refunds enable row level security;
alter table public.billing_events enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

revoke all on public.admin_audit_logs from anon, authenticated;
revoke all on public.admin_notes from anon, authenticated;
revoke all on public.billing_attempts from anon, authenticated;
revoke all on public.billing_refunds from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.ai_usage_events from anon, authenticated;
revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;

grant all on public.admin_audit_logs to service_role;
grant all on public.admin_notes to service_role;
grant all on public.billing_attempts to service_role;
grant all on public.billing_refunds to service_role;
grant all on public.billing_events to service_role;
grant all on public.ai_usage_events to service_role;
grant all on public.support_tickets to service_role;
grant all on public.support_messages to service_role;
