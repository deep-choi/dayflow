-- Merge partial user_data updates without overwriting unrelated settings keys.
-- This is especially important for frequently changing settings.apiUsage updates.

create or replace function public.merge_user_data_patch(
  p_user_id uuid,
  p_settings_patch jsonb default null,
  p_activity_log jsonb default null,
  p_calendar_tags jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized to update this user_data row';
  end if;

  insert into public.user_data (
    user_id,
    settings,
    activity_log,
    calendar_tags,
    updated_at
  )
  values (
    p_user_id,
    coalesce(p_settings_patch, '{}'::jsonb),
    coalesce(p_activity_log, '[]'::jsonb),
    coalesce(p_calendar_tags, '[]'::jsonb),
    timezone('utc'::text, now())
  )
  on conflict (user_id) do update
  set settings = case
      when p_settings_patch is null then public.user_data.settings
      else coalesce(public.user_data.settings, '{}'::jsonb) || p_settings_patch
    end,
    activity_log = coalesce(p_activity_log, public.user_data.activity_log),
    calendar_tags = coalesce(p_calendar_tags, public.user_data.calendar_tags),
    updated_at = timezone('utc'::text, now());
end;
$$;

grant execute on function public.merge_user_data_patch(uuid, jsonb, jsonb, jsonb) to authenticated;
