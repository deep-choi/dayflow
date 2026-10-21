begin;

create table if not exists public.dayflow_operations_settings (
  id boolean primary key default true check (id),
  revision bigint not null default 0 check (revision >= 0),
  trial_paused boolean not null default false,
  guest_ip_daily_limit integer not null default 30 check (guest_ip_daily_limit between 1 and 100000),
  guest_global_daily_limit integer not null default 1000 check (guest_global_daily_limit between 1 and 100000),
  updated_at timestamptz not null default now()
);
insert into public.dayflow_operations_settings(id) values(true) on conflict do nothing;
alter table public.dayflow_operations_settings enable row level security;
revoke all on public.dayflow_operations_settings from public, anon, authenticated;
grant all on public.dayflow_operations_settings to service_role;

create or replace function public.save_dayflow_operations(
  p_actor uuid, p_revision bigint, p_paused boolean, p_ip_limit integer, p_global_limit integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before public.dayflow_operations_settings; v_after public.dayflow_operations_settings;
begin
  if not exists(select 1 from auth.users where id=p_actor and (raw_app_meta_data->>'role'='admin' or raw_app_meta_data->'is_admin'='true'::jsonb)) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_paused is null or p_revision is null or p_ip_limit is null or p_global_limit is null or
    p_ip_limit not between 1 and 100000 or p_global_limit not between 1 and 100000 then raise exception 'INVALID_SETTINGS'; end if;
  select * into v_before from public.dayflow_operations_settings where id=true for update;
  if v_before.revision <> p_revision then raise exception 'SETTINGS_CONFLICT'; end if;
  update public.dayflow_operations_settings set revision=revision+1, trial_paused=p_paused,
    guest_ip_daily_limit=p_ip_limit, guest_global_daily_limit=p_global_limit, updated_at=now()
    where id=true returning * into v_after;
  insert into public.admin_audit_logs(admin_user_id,action,target_type,target_id,metadata)
    values(p_actor,'operations.settings.updated','operations','trial',jsonb_build_object('before',to_jsonb(v_before),'after',to_jsonb(v_after)));
  return to_jsonb(v_after)-'id'-'updated_at';
end;
$$;
revoke all on function public.save_dayflow_operations(uuid,bigint,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.save_dayflow_operations(uuid,bigint,boolean,integer,integer) to service_role;

create or replace function public.update_dayflow_ticket(p_actor uuid,p_ticket uuid,p_updated_at timestamptz,p_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before public.support_tickets;
begin
  if not exists(select 1 from auth.users where id=p_actor and (raw_app_meta_data->>'role'='admin' or raw_app_meta_data->'is_admin'='true'::jsonb)) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status is null or p_status not in ('open','in_progress','resolved','closed') or char_length(trim(coalesce(p_reason,''))) not between 2 and 500 then raise exception 'INVALID_TICKET'; end if;
  select * into v_before from public.support_tickets where id=p_ticket for update;
  if not found then raise exception 'TICKET_NOT_FOUND'; end if;
  if p_updated_at is null or v_before.updated_at<>p_updated_at then raise exception 'TICKET_CONFLICT'; end if;
  update public.support_tickets set status=p_status,assigned_admin_id=p_actor,updated_at=now(),
    resolved_at=case when p_status in ('resolved','closed') then now() else null end where id=p_ticket;
  insert into public.admin_audit_logs(admin_user_id,action,target_type,target_id,reason,metadata)
    values(p_actor,'support.status_changed','support_ticket',p_ticket::text,trim(p_reason),jsonb_build_object('before',v_before.status,'after',p_status));
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.update_dayflow_ticket(uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.update_dayflow_ticket(uuid,uuid,timestamptz,text,text) to service_role;

create table if not exists public.dayflow_guest_ai_events (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
  model text not null, status text not null check(status in ('succeeded','failed')),
  input_tokens integer not null default 0, output_tokens integer not null default 0,
  total_tokens integer not null default 0, duration_ms integer not null default 0,
  error_code text, created_at timestamptz not null default now()
);
create index if not exists dayflow_guest_ai_events_created_idx on public.dayflow_guest_ai_events(created_at desc);
alter table public.dayflow_guest_ai_events enable row level security;
revoke all on public.dayflow_guest_ai_events from public,anon,authenticated;
grant all on public.dayflow_guest_ai_events to service_role;

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
  c_ip_daily_limit integer;
  c_global_daily_limit integer;
  v_paused boolean;
  v_today date := (now() at time zone 'utc')::date;
  v_ip_bucket text := 'ip:' || p_ip_hash;
  v_request_ids uuid[];
  v_ip_count integer;
  v_global_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('dayflow-guest:' || p_device_id::text, 0));
  select guest_ip_daily_limit,guest_global_daily_limit,trial_paused
  into c_ip_daily_limit,c_global_daily_limit,v_paused
  from public.dayflow_operations_settings where id=true;
  if not found then raise exception 'OPERATIONS_UNAVAILABLE'; end if;
  if v_paused then return query select false,0,false,'PAUSED'::text; return; end if;
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


commit;
