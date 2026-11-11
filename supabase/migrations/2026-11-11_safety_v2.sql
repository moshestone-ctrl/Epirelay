-- Safety v2 (applied to the live project on 2026-11-11). Fresh installs: use schema.sql.


create or replace function public._cfg(key text) returns numeric
language sql immutable set search_path = '' as $$
  select (case key
    when 'search_radius_m'        then 3000   -- first ring of carriers alerted (~1.9 mi)
    when 'widen_radius_m'         then 8000   -- "Widen search" button (~5 mi)
    when 'max_notified_per_round' then 30     -- cap on alerts sent per round
    when 'max_en_route'           then 3      -- how many responders can head over at once
    when 'location_fresh_minutes' then 30     -- ignore carriers whose location is older than this (they're likely unreachable)
    when 'alert_ttl_minutes'      then 120    -- active alerts auto-close after this
    when 'max_alerts_per_hour'      then 6    -- real SOS alerts one person can send per hour
    when 'max_test_alerts_per_hour' then 10   -- practice alerts one person can send per hour
    when 'privacy_zone_m'           then 400  -- the person in need sees a responder on the map only within this distance
    when 'require_verified_phone'   then 0    -- 1 = a verified phone number is needed to send an SOS or respond
    when 'new_account_hours'        then 24   -- brand-new accounts can only send practice alerts for this long
    when 'checkin_minutes'          then 20   -- responders are asked "Are you OK?" this often
    when 'checkin_grace_minutes'    then 10   -- ...and their emergency contact is texted if they don't answer in time
    when 'auto_hold_reporters'      then 2    -- reports from this many different responders put the sender on hold
  end)::numeric
$$;



alter table public.alert_recipients
  add column if not exists last_checkin_at   timestamptz,
  add column if not exists safe_confirmed_at timestamptz,
  add column if not exists felt_unsafe_at    timestamptz,
  add column if not exists escalated_at      timestamptz,
  add column if not exists escalation_result text;

create or replace function public._phone_verified(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where u.id = p_uid and u.phone_confirmed_at is not null)
$$;


create or replace function public._is_new_account(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_uid
                  and p.created_at > now() - make_interval(hours => public._cfg('new_account_hours')::int))
$$;


create or replace function public._eligible_responders(
  p_lat float8, p_lng float8, p_radius_m int, p_exclude uuid)
returns table (user_id uuid, expo_push_token text, distance_m float8)
language sql stable security definer set search_path = '' as $$
  select p.id, p.expo_push_token, d.m
    from public.responder_locations l
    join public.profiles p on p.id = l.user_id
    cross join lateral (select public._distance_m(p_lat, p_lng, l.lat, l.lng) as m) d
   where l.lat between p_lat - p_radius_m / 111320.0 and p_lat + p_radius_m / 111320.0
     and l.lng between p_lng - p_radius_m / (111320.0 * greatest(cos(radians(p_lat)), 0.01))
                   and p_lng + p_radius_m / (111320.0 * greatest(cos(radians(p_lat)), 0.01))
     and l.updated_at > now() - make_interval(mins => public._cfg('location_fresh_minutes')::int)
     and p.carries_epinephrine
     and p.available_to_respond
     and (p.device_expires_on is null or p.device_expires_on >= current_date)
     and p.id is distinct from p_exclude
     and not exists (select 1 from public.suspended_users s where s.user_id = p.id)
     and (public._cfg('require_verified_phone') = 0 or public._phone_verified(p.id))
     and d.m <= p_radius_m
$$;


create or replace function public.create_alert(
  p_lat float8, p_lng float8, p_note text default null, p_is_test boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_existing public.alerts;
  v_id       uuid;
  v_count    int;
  v_recent   int;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if public._am_i_suspended() then
    raise exception 'This account is suspended and can''t send alerts.';
  end if;
  if public._cfg('require_verified_phone') = 1 and not public._phone_verified(v_uid) then
    raise exception 'Verify your phone number to send an SOS to people nearby.';
  end if;
  if not coalesce(p_is_test, false) and public._is_new_account(v_uid) then
    raise exception 'New accounts can send practice alerts only, for the first % hours.',
      public._cfg('new_account_hours')::int;
  end if;
  perform public._expire_stale_alerts();

  select * into v_existing from public.alerts
   where requester_id = v_uid and status = 'active'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('alert_id', v_existing.id,
                              'notified', v_existing.notified_count, 'existing', true);
  end if;

  -- Rate limit to stop alert spam (generous, so a real emergency is never blocked by retries).
  select count(*) into v_recent from public.alerts
   where requester_id = v_uid and is_test = coalesce(p_is_test, false)
     and created_at > now() - interval '1 hour';
  if v_recent >= public._cfg(case when coalesce(p_is_test, false)
                                  then 'max_test_alerts_per_hour' else 'max_alerts_per_hour' end) then
    raise exception 'Too many alerts in the last hour.';
  end if;

  insert into public.alerts (requester_id, lat, lng, note, is_test, radius_m)
  values (v_uid, p_lat, p_lng, nullif(btrim(left(p_note, 280)), ''),
          coalesce(p_is_test, false), public._cfg('search_radius_m')::int)
  returning id into v_id;

  v_count := public._notify_responders(v_id);
  return jsonb_build_object('alert_id', v_id, 'notified', v_count, 'existing', false);
end $$;


create or replace function public.respond_to_alert(p_alert_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  a          public.alerts;
  r          public.alert_recipients;
  v_coming   int;
  v_name     text;
  v_token    text;
begin
  -- Lock the alert so two responders can't both take the last slot.
  select * into a from public.alerts where id = p_alert_id for update;
  select * into r from public.alert_recipients where alert_id = p_alert_id and user_id = v_uid;
  if a.id is null or r.alert_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_invited');
  end if;
  if a.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if p_accept and public._am_i_suspended() then
    return jsonb_build_object('ok', false, 'reason', 'suspended');
  end if;
  if p_accept and public._cfg('require_verified_phone') = 1 and not public._phone_verified(v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'verify_phone');
  end if;

  if not p_accept then
    update public.alert_recipients set status = 'declined', responded_at = now()
     where alert_id = p_alert_id and user_id = v_uid and status = 'notified';
    return jsonb_build_object('ok', true);
  end if;

  if r.status in ('en_route', 'arrived') then
    return jsonb_build_object('ok', true);
  end if;

  select count(*) into v_coming from public.alert_recipients
   where alert_id = p_alert_id and status in ('en_route', 'arrived');
  if v_coming >= public._cfg('max_en_route') then
    return jsonb_build_object('ok', false, 'reason', 'enough_help');
  end if;

  update public.alert_recipients
     set status = 'en_route', responded_at = now(), last_checkin_at = now(), safe_confirmed_at = null
   where alert_id = p_alert_id and user_id = v_uid;

  select nullif(btrim(display_name), '') into v_name from public.profiles where id = v_uid;
  select expo_push_token into v_token from public.profiles where id = a.requester_id;
  if v_token is not null then
    perform public._send_push(jsonb_build_array(jsonb_build_object(
      'to', v_token,
      'title', 'Help is on the way',
      'body', coalesce(v_name, 'A responder') || ' is bringing epinephrine (about '
                || public._fmt_distance(r.distance_m) || ' away). Keep 911 on the line.',
      'data', jsonb_build_object('type', 'sos_update', 'alertId', p_alert_id),
      'sound', 'default', 'priority', 'high', 'channelId', 'sos')));
  end if;
  return jsonb_build_object('ok', true);
end $$;


create or replace function public.set_responder_status(p_alert_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_name  text;
begin
  if p_status not in ('arrived', 'withdrawn') then raise exception 'Invalid status'; end if;

  update public.alert_recipients
     set status = p_status,
         safe_confirmed_at = case when p_status = 'withdrawn' and felt_unsafe_at is null
                                  then coalesce(safe_confirmed_at, now()) else safe_confirmed_at end
   where alert_id = p_alert_id and user_id = auth.uid() and status in ('en_route', 'arrived');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_responding');
  end if;

  if p_status = 'withdrawn' then
    select p.expo_push_token into v_token
      from public.alerts a join public.profiles p on p.id = a.requester_id
     where a.id = p_alert_id and a.status = 'active';
    select nullif(btrim(display_name), '') into v_name from public.profiles where id = auth.uid();
    if v_token is not null then
      perform public._send_push(jsonb_build_array(jsonb_build_object(
        'to', v_token, 'title', 'A responder can''t make it',
        'body', coalesce(v_name, 'A responder') || ' is no longer coming. Open the app to widen the search.',
        'data', jsonb_build_object('type', 'sos_update', 'alertId', p_alert_id),
        'sound', 'default', 'priority', 'high', 'channelId', 'sos')));
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;


create or replace function public.close_alert(p_alert_id uuid, p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.alerts;
begin
  if p_outcome not in ('resolved', 'cancelled') then raise exception 'Invalid outcome'; end if;
  select * into a from public.alerts where id = p_alert_id for update;
  if not found then raise exception 'Alert not found'; end if;

  if not (a.requester_id = auth.uid()
          or (p_outcome = 'resolved' and exists (
                select 1 from public.alert_recipients r
                 where r.alert_id = a.id and r.user_id = auth.uid() and r.status = 'arrived'))) then
    raise exception 'Not allowed';
  end if;

  if a.status = 'active' then
    update public.alerts set status = p_outcome, closed_at = now(), closed_by = auth.uid()
     where id = a.id;
  end if;
  -- A responder closing it themselves is also their "I'm safe".
  update public.alert_recipients set safe_confirmed_at = coalesce(safe_confirmed_at, now())
   where alert_id = a.id and user_id = auth.uid() and felt_unsafe_at is null;
  return jsonb_build_object('ok', true);
end $$;


create or replace function public.get_alert(p_alert_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  a     public.alerts;
  r     public.alert_recipients;
  req   public.profiles;
  v_active boolean;
  v_zone   int := public._cfg('privacy_zone_m')::int;
begin
  select * into a from public.alerts where id = p_alert_id;
  if not found then return null; end if;

  -- Requester view
  if a.requester_id = v_uid then
    return jsonb_build_object(
      'role', 'requester',
      'alert', jsonb_build_object(
        'id', a.id, 'status', a.status, 'lat', a.lat, 'lng', a.lng, 'note', a.note,
        'is_test', a.is_test, 'radius_m', a.radius_m, 'notified_count', a.notified_count,
        'created_at', a.created_at, 'closed_at', a.closed_at),
      'privacy_zone_m', v_zone,
      'responders', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', rr.user_id,
                 -- first name only
                 'name', coalesce(nullif(split_part(btrim(p.display_name), ' ', 1), ''), 'Responder'),
                 'device_type', p.device_type,
                 'status', rr.status,
                 'distance_m', d.m,
                 -- A responder's position is shown only once they're close (or have arrived),
                 -- so the person who sent the SOS never learns where they set off from.
                 'lat', case when rr.status in ('en_route', 'arrived') and (rr.status = 'arrived' or d.m <= v_zone) then rr.lat end,
                 'lng', case when rr.status in ('en_route', 'arrived') and (rr.status = 'arrived' or d.m <= v_zone) then rr.lng end,
                 'location_at', rr.location_at)
               order by rr.responded_at)
          from public.alert_recipients rr
          join public.profiles p on p.id = rr.user_id
          cross join lateral (select case when rr.lat is null then rr.distance_m
                                          else round(public._distance_m(a.lat, a.lng, rr.lat, rr.lng))::int end as m) d
         where rr.alert_id = a.id and rr.status in ('en_route', 'arrived', 'withdrawn')), '[]'::jsonb));
  end if;

  -- Responder view
  select * into r from public.alert_recipients where alert_id = a.id and user_id = v_uid;
  if not found then return null; end if;
  v_active := r.status in ('en_route', 'arrived');
  select * into req from public.profiles where id = a.requester_id;

  return jsonb_build_object(
    'role', 'responder',
    'my_status', r.status,
    'alert', jsonb_build_object(
      'id', a.id, 'status', a.status, 'note', a.note, 'is_test', a.is_test,
      'created_at', a.created_at, 'closed_at', a.closed_at, 'distance_m', r.distance_m,
      -- exact location only once they've committed to coming
      'lat', case when v_active then a.lat end,
      'lng', case when v_active then a.lng end),
    'requester', jsonb_build_object(
      'name', coalesce(nullif(split_part(btrim(req.display_name), ' ', 1), ''), 'Someone'),
      'allergies', case when v_active and req.share_medical_with_responders then req.allergies end,
      -- Trust signals shown before a responder decides to go
      'phone_verified', public._phone_verified(a.requester_id),
      'member_since', req.created_at,
      'past_resolved', (select count(*) from public.alerts x
                         where x.requester_id = a.requester_id and x.id <> a.id
                           and not x.is_test and x.status = 'resolved')),
    'safety', jsonb_build_object(
      'checkin_due_at', case when r.safe_confirmed_at is null and r.felt_unsafe_at is null
                               and r.status in ('en_route', 'arrived')
                             then coalesce(r.last_checkin_at, r.responded_at)
                                  + make_interval(mins => public._cfg('checkin_minutes')::int) end,
      'safe_confirmed_at', r.safe_confirmed_at,
      'felt_unsafe_at', r.felt_unsafe_at,
      'escalated_at', r.escalated_at,
      'needs_confirmation', r.status in ('en_route', 'arrived') and r.safe_confirmed_at is null
                            and r.felt_unsafe_at is null),
    'en_route_count', (select count(*) from public.alert_recipients
                        where alert_id = a.id and status in ('en_route', 'arrived')),
    'max_en_route', public._cfg('max_en_route')::int);
end $$;

create or replace function public.my_alerts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public._expire_stale_alerts();
  return jsonb_build_object(
    'my_active_alert_id', (select id from public.alerts
                            where requester_id = v_uid and status = 'active'
                            order by created_at desc limit 1),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'alert_id', a.id, 'distance_m', r.distance_m, 'my_status', r.status,
               'is_test', a.is_test, 'created_at', a.created_at)
             order by a.created_at desc)
        from public.alert_recipients r join public.alerts a on a.id = r.alert_id
       where r.user_id = v_uid and a.status = 'active'
         and r.status in ('notified', 'en_route', 'arrived')), '[]'::jsonb),
    -- Responses where I haven't confirmed I'm safe yet (even if the SOS has ended).
    'safety_pending', coalesce((
      select jsonb_agg(r.alert_id order by r.responded_at desc)
        from public.alert_recipients r
       where r.user_id = v_uid and r.status in ('en_route', 'arrived')
         and r.safe_confirmed_at is null and r.felt_unsafe_at is null
         and r.responded_at > now() - interval '24 hours'), '[]'::jsonb),
    'me', jsonb_build_object(
      'phone_verified', public._phone_verified(v_uid),
      'phone_required', public._cfg('require_verified_phone') = 1,
      'new_account_until', (select p.created_at + make_interval(hours => public._cfg('new_account_hours')::int)
                              from public.profiles p where p.id = v_uid),
      'suspended', public._am_i_suspended()));
end $$;

create or replace function public.report_alert(p_alert_id uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_reason not in ('fake', 'no_one_there', 'abusive', 'unsafe', 'other') then raise exception 'Invalid reason'; end if;
  if not exists (select 1 from public.alert_recipients r
                  where r.alert_id = p_alert_id and r.user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_invited');
  end if;
  insert into public.alert_reports (alert_id, reporter_id, reason, note)
  values (p_alert_id, auth.uid(), p_reason, nullif(btrim(left(p_note, 500)), ''))
  on conflict (alert_id, reporter_id) do update
    set reason = excluded.reason, note = excluded.note, created_at = now();
  return jsonb_build_object('ok', true);
end $$;


create or replace function public.confirm_responder_safe(p_alert_id uuid, p_still_there boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.alert_recipients
     set last_checkin_at   = now(),
         safe_confirmed_at = case when p_still_there then safe_confirmed_at else coalesce(safe_confirmed_at, now()) end
   where alert_id = p_alert_id and user_id = auth.uid()
     and status in ('en_route', 'arrived', 'withdrawn');
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_responding'); end if;
  return jsonb_build_object('ok', true);
end $$;


create or replace function public.responder_unsafe(p_alert_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.alert_recipients
     set status = case when status in ('en_route', 'arrived') then 'withdrawn' else status end,
         felt_unsafe_at = coalesce(felt_unsafe_at, now())
   where alert_id = p_alert_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_invited'); end if;
  insert into public.alert_reports (alert_id, reporter_id, reason, note)
  values (p_alert_id, auth.uid(), 'unsafe', 'Responder tapped "I feel unsafe"')
  on conflict (alert_id, reporter_id) do update set reason = 'unsafe', created_at = now();
  return jsonb_build_object('ok', true);
end $$;


create or replace function public._auto_hold_on_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_sender uuid;
  v_reporters int;
begin
  select requester_id into v_sender from public.alerts where id = new.alert_id;
  select count(distinct rp.reporter_id) into v_reporters
    from public.alert_reports rp join public.alerts a on a.id = rp.alert_id
   where a.requester_id = v_sender and rp.created_at > now() - interval '30 days';
  if new.reason in ('unsafe', 'abusive') or v_reporters >= public._cfg('auto_hold_reporters') then
    insert into public.suspended_users (user_id, reason)
    values (v_sender, 'Automatic hold: ' || case when new.reason in ('unsafe', 'abusive')
                                                 then 'a responder reported "' || new.reason || '"'
                                                 else v_reporters || ' responders reported alerts' end
                      || '. Review in the admin notebook, then remove the hold if it was a mistake.')
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;


create or replace function public._claim_due_safety_escalations() returns table (
  alert_id uuid, user_id uuid, responder_name text, contact_name text, contact_phone text,
  reason text, last_lat float8, last_lng float8, dest_lat float8, dest_lng float8)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select r.alert_id, r.user_id,
           case when r.felt_unsafe_at is not null then 'unsafe' else 'no_checkin' end as reason
      from public.alert_recipients r
     where r.escalated_at is null
       and r.safe_confirmed_at is null
       and r.responded_at > now() - interval '12 hours'
       and (r.felt_unsafe_at is not null
            or (r.status in ('en_route', 'arrived')
                and coalesce(r.last_checkin_at, r.responded_at)
                    < now() - make_interval(mins => (public._cfg('checkin_minutes')
                                                     + public._cfg('checkin_grace_minutes'))::int)))
     for update of r skip locked
  ), marked as (
    update public.alert_recipients r set escalated_at = now(), escalation_result = 'claimed'
      from due where r.alert_id = due.alert_id and r.user_id = due.user_id
    returning r.alert_id, r.user_id, r.lat, r.lng
  )
  select m.alert_id, m.user_id,
         coalesce(nullif(btrim(p.display_name), ''), 'An EpiRelay responder'),
         p.emergency_contact_name, p.emergency_contact_phone, d.reason,
         coalesce(m.lat, l.lat), coalesce(m.lng, l.lng), a.lat, a.lng
    from marked m
    join due d on d.alert_id = m.alert_id and d.user_id = m.user_id
    join public.profiles p on p.id = m.user_id
    join public.alerts a on a.id = m.alert_id
    left join public.responder_locations l on l.user_id = m.user_id;
end $$;


create or replace function public._record_escalation_result(p_alert_id uuid, p_user_id uuid, p_result text)
returns void language sql security definer set search_path = '' as $$
  update public.alert_recipients set escalation_result = left(p_result, 200)
   where alert_id = p_alert_id and user_id = p_user_id
$$;


create trigger alert_reports_auto_hold
  after insert or update on public.alert_reports
  for each row execute function public._auto_hold_on_report();

revoke execute on function
  public._phone_verified(uuid), public._is_new_account(uuid), public._auto_hold_on_report(),
  public._claim_due_safety_escalations(), public._record_escalation_result(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public._claim_due_safety_escalations(), public._record_escalation_result(uuid, uuid, text) to service_role;

revoke execute on function public.confirm_responder_safe(uuid, boolean), public.responder_unsafe(uuid) from public, anon;
grant execute on function public.confirm_responder_safe(uuid, boolean), public.responder_unsafe(uuid) to authenticated;
