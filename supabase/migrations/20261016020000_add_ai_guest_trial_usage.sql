-- Complimentary chat turns for visitors who have not signed in yet.
-- Each device gets up to ten turns. Per-IP and global daily caps bound the cost
-- of someone rotating device ids against the shared trial API key.
create table if not exists public.ai_guest_trial_usage (
  device_id uuid primary key,
  request_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_guest_trial_usage_max_ten_requests
    check (cardinality(request_ids) <= 10)
);

create table if not exists public.ai_guest_trial_daily (
  bucket text not null,
  usage_date date not null,
  used_count integer not null default 0,
  primary key (bucket, usage_date)
);

alter table public.ai_guest_trial_usage enable row level security;
alter table public.ai_guest_trial_daily enable row level security;

revoke all on table public.ai_guest_trial_usage from anon, authenticated;
revoke all on table public.ai_guest_trial_daily from anon, authenticated;
grant all on table public.ai_guest_trial_usage to service_role;
grant all on table public.ai_guest_trial_daily to service_role;

create or replace function public.claim_ai_guest_trial_turn(
  p_device_id uuid,
  p_ip_hash text,
  p_request_id uuid
)
returns table (
  allowed boolean,
  remaining_count integer,
  claimed_new boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_device_limit constant integer := 10;
  c_ip_daily_limit constant integer := 30;
  c_global_daily_limit constant integer := 1000;
  v_today date := (now() at time zone 'utc')::date;
  v_ip_bucket text := 'ip:' || p_ip_hash;
  v_request_ids uuid[];
  v_ip_count integer;
  v_global_count integer;
begin
  select usage.request_ids
    into v_request_ids
  from public.ai_guest_trial_usage as usage
  where usage.device_id = p_device_id
  for update;

  v_request_ids := coalesce(v_request_ids, '{}'::uuid[]);

  -- Retries of a turn that was already claimed are free.
  if p_request_id = any(v_request_ids) then
    return query select true, c_device_limit - cardinality(v_request_ids), false, null::text;
    return;
  end if;

  if cardinality(v_request_ids) >= c_device_limit then
    return query select false, 0, false, 'DEVICE_LIMIT'::text;
    return;
  end if;

  delete from public.ai_guest_trial_daily where usage_date < v_today - 7;

  insert into public.ai_guest_trial_daily (bucket, usage_date, used_count)
  values (v_ip_bucket, v_today, 0), ('global', v_today, 0)
  on conflict (bucket, usage_date) do nothing;

  -- Always lock the ip bucket before the global bucket to avoid deadlocks.
  select daily.used_count into v_ip_count
  from public.ai_guest_trial_daily as daily
  where daily.bucket = v_ip_bucket and daily.usage_date = v_today
  for update;

  select daily.used_count into v_global_count
  from public.ai_guest_trial_daily as daily
  where daily.bucket = 'global' and daily.usage_date = v_today
  for update;

  if v_ip_count >= c_ip_daily_limit then
    return query select false, c_device_limit - cardinality(v_request_ids), false, 'IP_LIMIT'::text;
    return;
  end if;

  if v_global_count >= c_global_daily_limit then
    return query select false, c_device_limit - cardinality(v_request_ids), false, 'GLOBAL_LIMIT'::text;
    return;
  end if;

  update public.ai_guest_trial_daily
  set used_count = used_count + 1
  where usage_date = v_today
    and bucket in (v_ip_bucket, 'global');

  v_request_ids := array_append(v_request_ids, p_request_id);

  insert into public.ai_guest_trial_usage (device_id, request_ids)
  values (p_device_id, v_request_ids)
  on conflict (device_id) do update
    set request_ids = excluded.request_ids,
        updated_at = now();

  return query select true, c_device_limit - cardinality(v_request_ids), true, null::text;
end;
$$;

revoke all on function public.claim_ai_guest_trial_turn(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_guest_trial_turn(uuid, text, uuid) to service_role;

create or replace function public.release_ai_guest_trial_turn(
  p_device_id uuid,
  p_ip_hash text,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_removed boolean := false;
begin
  update public.ai_guest_trial_usage
  set request_ids = array_remove(request_ids, p_request_id),
      updated_at = now()
  where device_id = p_device_id
    and p_request_id = any(request_ids)
  returning true into v_removed;

  if coalesce(v_removed, false) then
    update public.ai_guest_trial_daily
    set used_count = greatest(used_count - 1, 0)
    where usage_date = v_today
      and bucket in ('ip:' || p_ip_hash, 'global');
  end if;
end;
$$;

revoke all on function public.release_ai_guest_trial_turn(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.release_ai_guest_trial_turn(uuid, text, uuid) to service_role;
