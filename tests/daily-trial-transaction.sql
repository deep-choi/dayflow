-- Run via supabase db query --linked --file tests/daily-trial-transaction.sql.
-- Synthetic account/device only. No existing user's identity or session is used.
begin;
set local timezone = 'Asia/Seoul';
do $test$
declare
  actor uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  old_device uuid := gen_random_uuid();
  ip text := 'daily-trial-test-' || gen_random_uuid()::text;
  rid uuid := gen_random_uuid();
  today date := (clock_timestamp() at time zone 'utc')::date;
  claim record;
  ids uuid[];
  before_count integer;
  before_old_count integer;
  after_count integer;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values(actor,'trial-test-' || actor::text || '@example.invalid','{}','{}');
  update public.dayflow_operations_settings set trial_paused=false,guest_ip_daily_limit=100000,guest_global_daily_limit=100000 where id=true;
  insert into public.ai_guest_trial_daily(bucket,usage_date,used_count) values('global',today,0)
    on conflict(bucket,usage_date) do update set used_count=0;

  -- Ten turns, retry of an existing turn, then the eleventh turn is denied.
  for i in 1..10 loop
    rid := gen_random_uuid();
    select * into claim from public.claim_ai_trial_turn(actor,rid);
    if not claim.allowed or not claim.claimed_new or claim.used_count<>i or claim.usage_date<>today then raise exception 'ACCOUNT_COUNT_FAILED'; end if;
  end loop;
  select * into claim from public.claim_ai_trial_turn(actor,rid);
  if not claim.allowed or claim.claimed_new or claim.used_count<>10 then raise exception 'ACCOUNT_RETRY_FAILED'; end if;
  select * into claim from public.claim_ai_trial_turn(actor,gen_random_uuid());
  if claim.allowed or claim.remaining_count<>0 then raise exception 'ACCOUNT_LIMIT_FAILED'; end if;
  -- Same request ID on a new day belongs to that day's allowance.
  update public.ai_trial_usage set usage_date=today-1 where user_id=actor;
  select * into claim from public.claim_ai_trial_turn(actor,rid);
  if not claim.allowed or not claim.claimed_new or claim.used_count<>1 or claim.remaining_count<>9 then raise exception 'ACCOUNT_RESET_FAILED'; end if;
  perform public.release_ai_trial_turn(actor,rid,today-1);
  select request_ids into ids from public.ai_trial_usage where user_id=actor;
  if cardinality(ids)<>1 then raise exception 'STALE_ACCOUNT_RELEASE_REMOVED_TODAY'; end if;
  perform public.release_ai_trial_turn(actor,rid,today);
  perform public.release_ai_trial_turn(actor,rid,today);
  select request_ids into ids from public.ai_trial_usage where user_id=actor;
  if cardinality(ids)<>0 then raise exception 'ACCOUNT_RELEASE_FAILED'; end if;

  for i in 1..10 loop
    rid := gen_random_uuid();
    select * into claim from public.claim_ai_guest_trial_turn(device,ip,rid);
    if not claim.allowed or not claim.claimed_new or claim.remaining_count<>10-i or claim.usage_date<>today then raise exception 'GUEST_COUNT_FAILED'; end if;
  end loop;
  select * into claim from public.claim_ai_guest_trial_turn(device,ip,rid);
  if not claim.allowed or claim.claimed_new or claim.remaining_count<>0 then raise exception 'GUEST_RETRY_FAILED'; end if;
  select used_count into before_count from public.ai_guest_trial_daily where bucket='ip:' || ip and usage_date=today;
  if before_count<>10 then raise exception 'DUPLICATE_COUNTED_IN_IP_BUCKET'; end if;
  select * into claim from public.claim_ai_guest_trial_turn(device,ip,gen_random_uuid());
  if claim.allowed or claim.reason<>'DEVICE_LIMIT' then raise exception 'GUEST_LIMIT_FAILED'; end if;
  update public.ai_guest_trial_usage set usage_date=today-1 where device_id=device;
  select * into claim from public.claim_ai_guest_trial_turn(device,ip,rid);
  if not claim.allowed or not claim.claimed_new or claim.remaining_count<>9 then raise exception 'GUEST_RESET_FAILED'; end if;
  perform public.release_ai_guest_trial_turn(device,ip,rid,today-1);
  select request_ids into ids from public.ai_guest_trial_usage where device_id=device;
  if cardinality(ids)<>1 then raise exception 'STALE_GUEST_RELEASE_REMOVED_TODAY'; end if;
  perform public.release_ai_guest_trial_turn(device,ip,rid,today);
  perform public.release_ai_guest_trial_turn(device,ip,rid,today);
  select used_count into after_count from public.ai_guest_trial_daily where bucket='ip:' || ip and usage_date=today;
  if after_count<>before_count then raise exception 'GUEST_RELEASE_NOT_IDEMPOTENT'; end if;

  -- A late failure before any new-day request refunds yesterday's buckets only.
  insert into public.ai_guest_trial_usage(device_id,request_ids,usage_date) values(old_device,array[rid],today-1);
  insert into public.ai_guest_trial_daily(bucket,usage_date,used_count)
    values('ip:' || ip,today-1,1),('global',today-1,1)
    on conflict(bucket,usage_date) do update set used_count=public.ai_guest_trial_daily.used_count+1;
  select used_count into before_old_count from public.ai_guest_trial_daily where bucket='global' and usage_date=today-1;
  perform public.release_ai_guest_trial_turn(old_device,ip,rid,today-1);
  select used_count into after_count from public.ai_guest_trial_daily where bucket='global' and usage_date=today-1;
  if after_count<>before_old_count-1 then raise exception 'YESTERDAY_RELEASE_FAILED'; end if;
  select used_count into after_count from public.ai_guest_trial_daily where bucket='ip:' || ip and usage_date=today;
  if after_count<>before_count then raise exception 'YESTERDAY_RELEASE_CHANGED_TODAY'; end if;

  update public.dayflow_operations_settings set guest_ip_daily_limit=1 where id=true;
  select * into claim from public.claim_ai_guest_trial_turn(gen_random_uuid(),ip,gen_random_uuid());
  if claim.allowed or claim.reason<>'IP_LIMIT' then raise exception 'IP_CAP_FAILED'; end if;
  update public.dayflow_operations_settings set guest_ip_daily_limit=100000,guest_global_daily_limit=1 where id=true;
  select * into claim from public.claim_ai_guest_trial_turn(gen_random_uuid(),gen_random_uuid()::text,gen_random_uuid());
  if claim.allowed or claim.reason<>'GLOBAL_LIMIT' then raise exception 'GLOBAL_CAP_FAILED'; end if;
  update public.dayflow_operations_settings set trial_paused=true where id=true;
  select * into claim from public.claim_ai_guest_trial_turn(gen_random_uuid(),ip,gen_random_uuid());
  if claim.allowed or claim.reason<>'PAUSED' then raise exception 'PAUSE_FAILED'; end if;

  if (timestamptz '2026-10-28 08:59:59+09' at time zone 'utc')::date <> date '2026-10-27'
    or (timestamptz '2026-10-28 09:00:00+09' at time zone 'utc')::date <> date '2026-10-28'
    then raise exception 'RESET_BOUNDARY_FAILED'; end if;
  if has_function_privilege('anon','public.claim_ai_guest_trial_turn(uuid,text,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_ai_trial_turn(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.release_ai_guest_trial_turn(uuid,text,uuid,date)','EXECUTE')
    or has_function_privilege('authenticated','public.release_ai_trial_turn(uuid,uuid,date)','EXECUTE')
    or has_table_privilege('authenticated','public.ai_trial_usage','SELECT')
    then raise exception 'PRIVATE_QUOTA_ACCESS_EXPOSED'; end if;
  if not has_function_privilege('service_role','public.claim_ai_guest_trial_turn(uuid,text,uuid)','EXECUTE') then raise exception 'SERVICE_PERMISSION_MISSING'; end if;
end;
$test$;
rollback;
select 'daily quota, retries, reset, late failure, caps, permissions: PASS (rolled back)' as result;
