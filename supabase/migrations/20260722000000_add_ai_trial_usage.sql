-- Track up to ten complimentary chat turns per authenticated user.
-- Request IDs make repeated model calls within one chat turn idempotent.
create table if not exists public.ai_trial_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_trial_usage_max_ten_requests
    check (cardinality(request_ids) <= 10)
);

alter table public.ai_trial_usage enable row level security;

revoke all on table public.ai_trial_usage from anon, authenticated;
grant all on table public.ai_trial_usage to service_role;

create or replace function public.claim_ai_trial_turn(
  p_user_id uuid,
  p_request_id uuid
)
returns table (
  allowed boolean,
  used_count integer,
  remaining_count integer,
  claimed_new boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_ids uuid[];
  v_inserted boolean := false;
begin
  insert into public.ai_trial_usage (user_id, request_ids)
  values (p_user_id, array[p_request_id]::uuid[])
  on conflict (user_id) do nothing
  returning true into v_inserted;

  if v_inserted then
    return query select true, 1, 9, true;
    return;
  end if;

  select usage.request_ids
    into v_request_ids
  from public.ai_trial_usage as usage
  where usage.user_id = p_user_id
  for update;

  if p_request_id = any(v_request_ids) then
    return query select true, cardinality(v_request_ids), 10 - cardinality(v_request_ids), false;
    return;
  end if;

  if cardinality(v_request_ids) >= 10 then
    return query select false, cardinality(v_request_ids), 0, false;
    return;
  end if;

  v_request_ids := array_append(v_request_ids, p_request_id);

  update public.ai_trial_usage
  set request_ids = v_request_ids,
      updated_at = now()
  where user_id = p_user_id;

  return query select true, cardinality(v_request_ids), 10 - cardinality(v_request_ids), true;
end;
$$;

revoke all on function public.claim_ai_trial_turn(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_trial_turn(uuid, uuid) to service_role;

create or replace function public.release_ai_trial_turn(
  p_user_id uuid,
  p_request_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_trial_usage
  set request_ids = array_remove(request_ids, p_request_id),
      updated_at = now()
  where user_id = p_user_id
    and p_request_id = any(request_ids);
$$;

revoke all on function public.release_ai_trial_turn(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_ai_trial_turn(uuid, uuid) to service_role;
