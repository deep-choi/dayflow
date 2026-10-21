begin;
do $check$
declare s public.dayflow_operations_settings; actor uuid; saved jsonb; before_count bigint; device uuid := gen_random_uuid(); rid uuid := gen_random_uuid(); ip text := gen_random_uuid()::text; claim record; ticket public.support_tickets;
begin
  select id into actor from auth.users where raw_app_meta_data->>'role'='admin' or raw_app_meta_data->'is_admin'='true'::jsonb order by created_at limit 1;
  if actor is null then raise exception 'ADMIN_ACCOUNT_REQUIRED'; end if;
  select * into s from public.dayflow_operations_settings where id=true;
  select count(*) into before_count from public.admin_audit_logs where action='operations.settings.updated';
  saved := public.save_dayflow_operations(actor,s.revision,true,1,100000);
  if (saved->>'revision')::bigint<>s.revision+1 then raise exception 'REVISION_NOT_INCREMENTED'; end if;
  if (select count(*) from public.admin_audit_logs where action='operations.settings.updated')<>before_count+1 then raise exception 'AUDIT_MISSING'; end if;
  begin
    perform public.save_dayflow_operations(actor,s.revision,false,1,100000);
    raise exception 'STALE_REVISION_ACCEPTED';
  exception when others then if sqlerrm <> 'SETTINGS_CONFLICT' then raise; end if; end;
  select * into claim from public.claim_ai_guest_trial_turn(device,ip,rid);
  if claim.allowed or claim.reason<>'PAUSED' then raise exception 'PAUSE_NOT_ENFORCED'; end if;
  perform public.save_dayflow_operations(actor,s.revision+1,false,1,100000);
  select * into claim from public.claim_ai_guest_trial_turn(device,ip,rid);
  if not claim.allowed or not claim.claimed_new then raise exception 'FIRST_RESERVATION_FAILED'; end if;
  select * into claim from public.claim_ai_guest_trial_turn(device,ip,rid);
  if not claim.allowed or claim.claimed_new then raise exception 'DUPLICATE_RESERVATION_CHANGED_USAGE'; end if;
  select * into claim from public.claim_ai_guest_trial_turn(gen_random_uuid(),ip,gen_random_uuid());
  if claim.allowed or claim.reason<>'IP_LIMIT' then raise exception 'IP_LIMIT_NOT_ENFORCED'; end if;
  insert into public.support_tickets(user_id,category,subject,updated_at) values(actor,'other','Administrator rollback verification',now()-interval '1 day') returning * into ticket;
  perform public.update_dayflow_ticket(actor,ticket.id,ticket.updated_at,'in_progress','Verification only');
  begin
    perform public.update_dayflow_ticket(actor,ticket.id,ticket.updated_at,'resolved','Stale edit');
    raise exception 'STALE_TICKET_ACCEPTED';
  exception when others then if sqlerrm <> 'TICKET_CONFLICT' then raise; end if; end;
  if has_table_privilege('authenticated','public.dayflow_operations_settings','SELECT') or has_table_privilege('anon','public.dayflow_guest_ai_events','SELECT') then raise exception 'PRIVATE_TABLE_ACCESSIBLE'; end if;
  if has_function_privilege('authenticated','public.save_dayflow_operations(uuid,bigint,boolean,integer,integer)','EXECUTE') or has_function_privilege('anon','public.update_dayflow_ticket(uuid,uuid,timestamptz,text,text)','EXECUTE') then raise exception 'ADMIN_RPC_EXPOSED'; end if;
end;
$check$;
rollback;
select revision,trial_paused,guest_ip_daily_limit,guest_global_daily_limit from public.dayflow_operations_settings where id=true;
