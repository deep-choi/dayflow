create table if not exists public.ai_subscription_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  plan_id text not null,
  request_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start)
);

alter table public.ai_subscription_usage enable row level security;

revoke all on table public.ai_subscription_usage from anon, authenticated;
grant all on table public.ai_subscription_usage to service_role;

create or replace function public.claim_ai_subscription_turn(
  p_user_id uuid,
  p_request_id uuid,
  p_plan_id text,
  p_period_start timestamptz,
  p_limit integer
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
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 1000));
begin
  insert into public.ai_subscription_usage (user_id, period_start, plan_id, request_ids)
  values (p_user_id, p_period_start, p_plan_id, array[p_request_id]::uuid[])
  on conflict (user_id, period_start) do nothing
  returning true into v_inserted;

  if v_inserted then
    return query select true, 1, v_limit - 1, true;
    return;
  end if;

  select usage.request_ids
    into v_request_ids
  from public.ai_subscription_usage as usage
  where usage.user_id = p_user_id
    and usage.period_start = p_period_start
  for update;

  if p_request_id = any(v_request_ids) then
    return query select true, cardinality(v_request_ids), greatest(0, v_limit - cardinality(v_request_ids)), false;
    return;
  end if;

  if cardinality(v_request_ids) >= v_limit then
    return query select false, cardinality(v_request_ids), 0, false;
    return;
  end if;

  v_request_ids := array_append(v_request_ids, p_request_id);

  update public.ai_subscription_usage
  set request_ids = v_request_ids,
      plan_id = p_plan_id,
      updated_at = now()
  where user_id = p_user_id
    and period_start = p_period_start;

  return query select true, cardinality(v_request_ids), v_limit - cardinality(v_request_ids), true;
end;
$$;

revoke all on function public.claim_ai_subscription_turn(uuid, uuid, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_subscription_turn(uuid, uuid, text, timestamptz, integer) to service_role;

create or replace function public.release_ai_subscription_turn(
  p_user_id uuid,
  p_request_id uuid,
  p_period_start timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_subscription_usage
  set request_ids = array_remove(request_ids, p_request_id),
      updated_at = now()
  where user_id = p_user_id
    and period_start = p_period_start
    and p_request_id = any(request_ids);
$$;

revoke all on function public.release_ai_subscription_turn(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.release_ai_subscription_turn(uuid, uuid, timestamptz) to service_role;
