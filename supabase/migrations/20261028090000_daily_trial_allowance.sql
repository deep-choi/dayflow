begin;

-- One counter per account/device. Rotate under the same lock used to reserve a
-- turn, at UTC midnight (09:00 Asia/Seoul). Existing usage keeps its last day.
alter table public.ai_trial_usage add column usage_date date;
update public.ai_trial_usage set usage_date = (updated_at at time zone 'utc')::date;
alter table public.ai_trial_usage alter column usage_date set default ((now() at time zone 'utc')::date);
alter table public.ai_trial_usage alter column usage_date set not null;
alter table public.ai_guest_trial_usage add column usage_date date;
update public.ai_guest_trial_usage set usage_date = (updated_at at time zone 'utc')::date;
alter table public.ai_guest_trial_usage alter column usage_date set default ((now() at time zone 'utc')::date);
alter table public.ai_guest_trial_usage alter column usage_date set not null;

-- The returned reservation date lets an upstream failure release only the
-- counter it originally reserved, even when the response crosses midnight.
drop function public.claim_ai_trial_turn(uuid, uuid);
create function public.claim_ai_trial_turn(p_user_id uuid, p_request_id uuid)
returns table(allowed boolean, used_count integer, remaining_count integer, claimed_new boolean, usage_date date)
language plpgsql security definer set search_path = public
as $$
declare
  v_today date;
  v_date date;
  v_ids uuid[];
begin
  insert into public.ai_trial_usage(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select u.request_ids, u.usage_date into v_ids, v_date
    from public.ai_trial_usage u where u.user_id = p_user_id for update;
  v_today := (clock_timestamp() at time zone 'utc')::date;
  if v_date <> v_today then v_ids := '{}'::uuid[]; end if;
  if p_request_id = any(v_ids) then
    return query select true, cardinality(v_ids), 10-cardinality(v_ids), false, v_today;
    return;
  end if;
  if cardinality(v_ids) >= 10 then
    return query select false, 10, 0, false, v_today;
    return;
  end if;
  v_ids := array_append(v_ids, p_request_id);
  update public.ai_trial_usage u set request_ids=v_ids, usage_date=v_today, updated_at=now()
    where u.user_id=p_user_id;
  return query select true, cardinality(v_ids), 10-cardinality(v_ids), true, v_today;
end;
$$;

drop function public.release_ai_trial_turn(uuid, uuid);
create function public.release_ai_trial_turn(p_user_id uuid, p_request_id uuid, p_usage_date date default null)
returns void language sql security definer set search_path = public
as $$
  update public.ai_trial_usage u set request_ids=array_remove(u.request_ids,p_request_id), updated_at=now()
  where u.user_id=p_user_id and p_request_id=any(u.request_ids)
    and (p_usage_date is null or u.usage_date=p_usage_date);
$$;

drop function public.claim_ai_guest_trial_turn(uuid, text, uuid);
create function public.claim_ai_guest_trial_turn(p_device_id uuid, p_ip_hash text, p_request_id uuid)
returns table(allowed boolean, remaining_count integer, claimed_new boolean, reason text, usage_date date)
language plpgsql security definer set search_path = public
as $$
declare
  v_today date;
  v_date date;
  v_ip_bucket text := 'ip:' || p_ip_hash;
  v_ids uuid[];
  v_ip_count integer;
  v_global_count integer;
  v_ip_limit integer;
  v_global_limit integer;
  v_paused boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('dayflow-guest:' || p_device_id::text,0));
  v_today := (clock_timestamp() at time zone 'utc')::date;
  select s.guest_ip_daily_limit,s.guest_global_daily_limit,s.trial_paused
    into v_ip_limit,v_global_limit,v_paused from public.dayflow_operations_settings s where s.id=true;
  if not found then raise exception 'OPERATIONS_UNAVAILABLE'; end if;
  if v_paused then return query select false,0,false,'PAUSED'::text,v_today; return; end if;
  select u.request_ids,u.usage_date into v_ids,v_date
    from public.ai_guest_trial_usage u where u.device_id=p_device_id for update;
  v_ids := case when v_date=v_today then coalesce(v_ids,'{}'::uuid[]) else '{}'::uuid[] end;
  if p_request_id=any(v_ids) then
    return query select true,10-cardinality(v_ids),false,null::text,v_today; return;
  end if;
  if cardinality(v_ids)>=10 then
    return query select false,0,false,'DEVICE_LIMIT'::text,v_today; return;
  end if;

  delete from public.ai_guest_trial_daily d where d.usage_date < v_today-7;
  insert into public.ai_guest_trial_daily(bucket,usage_date,used_count)
    values('global',v_today,0),(v_ip_bucket,v_today,0) on conflict on constraint ai_guest_trial_daily_pkey do nothing;
  -- Both claim and release lock the global bucket before the IP bucket.
  perform 1 from public.ai_guest_trial_daily d
    where d.usage_date=v_today and d.bucket in ('global',v_ip_bucket) order by d.bucket for update;
  select d.used_count into v_ip_count from public.ai_guest_trial_daily d where d.bucket=v_ip_bucket and d.usage_date=v_today;
  select d.used_count into v_global_count from public.ai_guest_trial_daily d where d.bucket='global' and d.usage_date=v_today;
  if v_ip_count>=v_ip_limit then
    return query select false,10-cardinality(v_ids),false,'IP_LIMIT'::text,v_today; return;
  end if;
  if v_global_count>=v_global_limit then
    return query select false,10-cardinality(v_ids),false,'GLOBAL_LIMIT'::text,v_today; return;
  end if;
  update public.ai_guest_trial_daily d set used_count=d.used_count+1
    where d.usage_date=v_today and d.bucket in ('global',v_ip_bucket);
  v_ids := array_append(v_ids,p_request_id);
  insert into public.ai_guest_trial_usage(device_id,request_ids,usage_date) values(p_device_id,v_ids,v_today)
    on conflict(device_id) do update set request_ids=excluded.request_ids,usage_date=excluded.usage_date,updated_at=now();
  return query select true,10-cardinality(v_ids),true,null::text,v_today;
end;
$$;

drop function public.release_ai_guest_trial_turn(uuid, text, uuid);
create function public.release_ai_guest_trial_turn(p_device_id uuid,p_ip_hash text,p_request_id uuid,p_usage_date date default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_date date;
begin
  perform pg_advisory_xact_lock(hashtextextended('dayflow-guest:' || p_device_id::text,0));
  update public.ai_guest_trial_usage u set request_ids=array_remove(u.request_ids,p_request_id),updated_at=now()
    where u.device_id=p_device_id and p_request_id=any(u.request_ids)
      and (p_usage_date is null or u.usage_date=p_usage_date)
    returning u.usage_date into v_date;
  if v_date is not null then
    perform 1 from public.ai_guest_trial_daily d
      where d.usage_date=v_date and d.bucket in ('global','ip:' || p_ip_hash) order by d.bucket for update;
    update public.ai_guest_trial_daily d set used_count=greatest(d.used_count-1,0)
      where d.usage_date=v_date and d.bucket in ('global','ip:' || p_ip_hash);
  end if;
end;
$$;

revoke all on function public.claim_ai_trial_turn(uuid,uuid) from public,anon,authenticated;
revoke all on function public.release_ai_trial_turn(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.claim_ai_guest_trial_turn(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.release_ai_guest_trial_turn(uuid,text,uuid,date) from public,anon,authenticated;
grant execute on function public.claim_ai_trial_turn(uuid,uuid) to service_role;
grant execute on function public.release_ai_trial_turn(uuid,uuid,date) to service_role;
grant execute on function public.claim_ai_guest_trial_turn(uuid,text,uuid) to service_role;
grant execute on function public.release_ai_guest_trial_turn(uuid,text,uuid,date) to service_role;

notify pgrst, 'reload schema';
commit;
