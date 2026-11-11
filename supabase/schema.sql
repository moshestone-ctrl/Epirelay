-- =====================================================================
--  EpiRelay backend (Supabase / Postgres)
--
--  HOW TO USE: Supabase dashboard → SQL Editor → New query → paste this
--  whole file → Run. Run it once on a fresh project.
--
--  What this sets up:
--    • profiles              – one row per user (name, carrier info, medical info)
--    • responder_locations   – last known location of carriers (never readable by other users)
--    • alerts                – SOS requests
--    • alert_recipients      – who was notified about an alert and whether they're coming
--    • messages              – chat between the person in need and responders
--    • feedback              – post-event ratings
--  Plus the functions the app calls (create_alert, respond_to_alert, ...).
--
--  Privacy design:
--    • Nobody can see where carriers are. The app only gets a COUNT nearby.
--    • A responder sees only the DISTANCE to an alert until they tap
--      "I'm on my way"; then they get the exact location.
--    • The person in need sees responders' live location only once they're coming.
-- =====================================================================

create extension if not exists pg_net with schema extensions;  -- used to send push notifications


-- ---------------------------------------------------------------------
--  Tuning knobs (change the numbers here, then re-run this one function)
-- ---------------------------------------------------------------------
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
  end)::numeric
$$;


-- ---------------------------------------------------------------------
--  Helpers
-- ---------------------------------------------------------------------

-- Great-circle distance in metres (haversine). Accurate enough for "who's nearby".
create or replace function public._distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- Human-friendly distance for push notifications (US units for the US launch).
create or replace function public._fmt_distance(m float8)
returns text language sql immutable set search_path = '' as $$
  select case
    when m < 160 then (greatest(50, round(m * 3.28084 / 50) * 50))::int::text || ' ft'
    else to_char(m / 1609.344, 'FM990.0') || ' mi'
  end
$$;


-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------

create table public.profiles (
  id                            uuid primary key references auth.users(id) on delete cascade,
  display_name                  text not null default '' check (char_length(display_name) <= 60),
  phone                         text check (char_length(phone) <= 30),
  -- Carrier info
  carries_epinephrine           boolean not null default false,
  device_type                   text check (device_type in ('auto_injector', 'nasal_spray', 'other')),
  device_expires_on             date,
  available_to_respond          boolean not null default false,
  -- Medical profile (shared only with responders who are on their way, and only if allowed)
  allergies                     text check (char_length(allergies) <= 500),
  emergency_contact_name        text check (char_length(emergency_contact_name) <= 60),
  emergency_contact_phone       text check (char_length(emergency_contact_phone) <= 30),
  share_medical_with_responders boolean not null default true,
  -- App plumbing
  expo_push_token               text,
  accepted_terms_version        int,
  accepted_terms_at             timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create table public.responder_locations (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  lat        float8 not null check (lat between -90 and 90),
  lng        float8 not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);
create index responder_locations_lat_idx on public.responder_locations (lat);

create table public.alerts (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references public.profiles(id) on delete cascade,
  status         text not null default 'active' check (status in ('active', 'resolved', 'cancelled')),
  lat            float8 not null check (lat between -90 and 90),
  lng            float8 not null check (lng between -180 and 180),
  note           text check (char_length(note) <= 280),
  is_test        boolean not null default false,
  radius_m       int not null,
  notified_count int not null default 0,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      uuid references public.profiles(id) on delete set null
);
create index alerts_requester_idx on public.alerts (requester_id, created_at desc);
create index alerts_active_idx on public.alerts (created_at) where status = 'active';

create table public.alert_recipients (
  alert_id     uuid not null references public.alerts(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  distance_m   int not null,                       -- distance when notified
  status       text not null default 'notified'
               check (status in ('notified', 'declined', 'en_route', 'arrived', 'withdrawn')),
  lat          float8,                             -- live position while en route
  lng          float8,
  location_at  timestamptz,
  notified_at  timestamptz not null default now(),
  responded_at timestamptz,
  primary key (alert_id, user_id)
);
create index alert_recipients_user_idx on public.alert_recipients (user_id, notified_at desc);

create table public.messages (
  id         bigint generated always as identity primary key,
  alert_id   uuid not null references public.alerts(id) on delete cascade,
  sender_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_alert_idx on public.messages (alert_id, created_at);

create table public.feedback (
  id         bigint generated always as identity primary key,
  alert_id   uuid not null references public.alerts(id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  rating     int not null check (rating between 1 and 5),
  comment    text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (alert_id, author_id)
);

-- Safety tools ---------------------------------------------------------

-- People blocked from sending SOS alerts or responding (e.g. after fake alerts).
-- Managed by the team from the Supabase dashboard; the app can't read or change it.
create table public.suspended_users (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

-- Responders flag an SOS they believe was fake or abusive.
create table public.alert_reports (
  alert_id    uuid not null references public.alerts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (reason in ('fake', 'no_one_there', 'abusive', 'other')),
  note        text check (char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  primary key (alert_id, reporter_id)
);

-- Crash and error reports sent by the app.
create table public.app_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid() references public.profiles(id) on delete set null,
  message     text not null check (char_length(message) <= 2000),
  stack       text check (char_length(stack) <= 8000),
  context     text check (char_length(context) <= 200),
  platform    text check (char_length(platform) <= 40),
  app_version text check (char_length(app_version) <= 40),
  created_at  timestamptz not null default now()
);
create index app_errors_created_idx on public.app_errors (created_at desc);


-- ---------------------------------------------------------------------
--  Triggers
-- ---------------------------------------------------------------------

-- Create a profile automatically when someone signs up.
create or replace function public._handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public._handle_new_user();

create or replace function public._touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public._touch_updated_at();


-- ---------------------------------------------------------------------
--  Row-level security (who can read/write what directly)
-- ---------------------------------------------------------------------

create or replace function public._is_requester(p_alert uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.alerts a
                  where a.id = p_alert and a.requester_id = (select auth.uid()))
$$;

-- Responder who is currently coming or has arrived.
create or replace function public._is_active_responder(p_alert uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.alert_recipients r
                  where r.alert_id = p_alert and r.user_id = (select auth.uid())
                    and r.status in ('en_route', 'arrived'))
$$;

-- Anyone who took part (requester, or a responder who was ever on the way).
create or replace function public._is_party(p_alert uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._is_requester(p_alert) or exists (
    select 1 from public.alert_recipients r
     where r.alert_id = p_alert and r.user_id = (select auth.uid())
       and r.status in ('en_route', 'arrived', 'withdrawn'))
$$;

-- Is the signed-in user suspended?
create or replace function public._am_i_suspended() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.suspended_users s where s.user_id = (select auth.uid()))
$$;

alter table public.profiles            enable row level security;
alter table public.responder_locations enable row level security;  -- no policies: RPC access only
alter table public.alerts              enable row level security;
alter table public.alert_recipients    enable row level security;
alter table public.messages            enable row level security;
alter table public.feedback            enable row level security;
alter table public.suspended_users     enable row level security;  -- no policies: dashboard only
alter table public.alert_reports       enable row level security;  -- no policies: RPC only
alter table public.app_errors          enable row level security;

create policy "read own profile"   on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "parties read alert" on public.alerts for select to authenticated
  using (requester_id = (select auth.uid()) or public._is_active_responder(id));

create policy "read own invitations, requester reads responders" on public.alert_recipients
  for select to authenticated
  using (user_id = (select auth.uid())
         or (status in ('en_route', 'arrived', 'withdrawn') and public._is_requester(alert_id)));

create policy "parties read messages" on public.messages for select to authenticated
  using (public._is_party(alert_id));
create policy "active parties send messages" on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (public._is_requester(alert_id) or public._is_active_responder(alert_id))
    and exists (select 1 from public.alerts a where a.id = alert_id and a.status = 'active')
    and not public._am_i_suspended()
  );

create policy "send own error reports" on public.app_errors for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "parties leave feedback" on public.feedback for insert to authenticated
  with check (author_id = (select auth.uid()) and public._is_party(alert_id));
create policy "read own feedback" on public.feedback for select to authenticated
  using (author_id = (select auth.uid()));

-- Least privilege: logged-out visitors get nothing; signed-in users get only what the app
-- needs (row-level security above then limits *which* rows). Everything else goes through
-- the functions below.
revoke all on public.profiles, public.responder_locations, public.alerts,
              public.alert_recipients, public.messages, public.feedback,
              public.suspended_users, public.alert_reports, public.app_errors from anon, authenticated;
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.alerts, public.alert_recipients to authenticated;
grant select, insert on public.messages, public.feedback to authenticated;
grant insert on public.app_errors to authenticated;


-- ---------------------------------------------------------------------
--  Internal functions (not callable from the app)
-- ---------------------------------------------------------------------

-- Sends notifications through Expo's push service. Never blocks or fails the caller.
create or replace function public._send_push(p_messages jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_messages is null or jsonb_array_length(p_messages) = 0 then
    return;
  end if;
  perform net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    body    := p_messages,
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
  );
exception when others then
  raise warning 'push send failed: %', sqlerrm;
end $$;

-- Carriers who could respond to an emergency at (lat, lng).
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
     and d.m <= p_radius_m
$$;

-- Auto-close alerts nobody closed.
create or replace function public._expire_stale_alerts() returns void
language sql security definer set search_path = '' as $$
  update public.alerts
     set status = 'cancelled', closed_at = now()
   where status = 'active'
     and created_at < now() - make_interval(mins => public._cfg('alert_ttl_minutes')::int)
$$;

-- Notify carriers inside the alert's radius who haven't been notified yet.
-- Returns how many were newly notified.
create or replace function public._notify_responders(p_alert_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  a          public.alerts;
  v_new      int;
  v_messages jsonb;
begin
  select * into a from public.alerts where id = p_alert_id;

  with chosen as (
    select e.user_id, e.expo_push_token, e.distance_m
      from public._eligible_responders(a.lat, a.lng, a.radius_m, a.requester_id) e
     where not exists (select 1 from public.alert_recipients r
                        where r.alert_id = a.id and r.user_id = e.user_id)
     order by e.distance_m
     limit public._cfg('max_notified_per_round')::int
  ), ins as (
    insert into public.alert_recipients (alert_id, user_id, distance_m)
    select a.id, c.user_id, round(c.distance_m)::int from chosen c
    returning user_id, distance_m
  )
  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'to',        c.expo_push_token,
           'title',     case when a.is_test then '[TEST] ' else '' end || 'Epinephrine needed nearby',
           'body',      'Someone about ' || public._fmt_distance(i.distance_m)
                          || ' away needs epinephrine. Tap to respond.',
           'data',      jsonb_build_object('type', 'sos', 'alertId', a.id),
           'sound',     'default',
           'priority',  'high',
           'channelId', 'sos'
         )) filter (where c.expo_push_token is not null), '[]'::jsonb)
    into v_new, v_messages
    from ins i join chosen c on c.user_id = i.user_id;

  update public.alerts set notified_count = notified_count + v_new where id = a.id;
  perform public._send_push(v_messages);
  return v_new;
end $$;


-- ---------------------------------------------------------------------
--  Functions the app calls
-- ---------------------------------------------------------------------

-- Carriers keep their last-known location fresh while the app is open.
create or replace function public.update_my_location(p_lat float8, p_lng float8) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.responder_locations (user_id, lat, lng, updated_at)
  values (auth.uid(), p_lat, p_lng, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
end $$;

-- How many available carriers are near a point (a count only — never who or where).
create or replace function public.nearby_responder_count(p_lat float8, p_lng float8) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from public._eligible_responders(p_lat, p_lng, public._cfg('search_radius_m')::int, auth.uid())
$$;

-- SOS. Creates the alert and notifies nearby carriers. If the caller already has an
-- active alert, returns that one instead of creating a duplicate.
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

-- Requester: alert carriers further away (and any who became available since).
create or replace function public.widen_alert(p_alert_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a     public.alerts;
  v_new int;
begin
  select * into a from public.alerts where id = p_alert_id for update;
  if not found or a.requester_id is distinct from auth.uid() then
    raise exception 'Alert not found';
  end if;
  if a.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  update public.alerts
     set radius_m = greatest(radius_m, public._cfg('widen_radius_m')::int)
   where id = a.id;
  v_new := public._notify_responders(a.id);
  return jsonb_build_object('ok', true, 'notified_new', v_new,
    'notified_total', (select notified_count from public.alerts where id = a.id));
end $$;

-- Responder: "I'm on my way" (p_accept = true) or "I can't help" (false).
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

  update public.alert_recipients set status = 'en_route', responded_at = now()
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

-- Responder: share live position while on the way.
create or replace function public.update_responder_position(
  p_alert_id uuid, p_lat float8, p_lng float8) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.alert_recipients
     set lat = p_lat, lng = p_lng, location_at = now()
   where alert_id = p_alert_id and user_id = auth.uid() and status in ('en_route', 'arrived');
  perform public.update_my_location(p_lat, p_lng);
end $$;

-- Responder: 'arrived' or 'withdrawn' ("I can't make it").
create or replace function public.set_responder_status(p_alert_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_name  text;
begin
  if p_status not in ('arrived', 'withdrawn') then raise exception 'Invalid status'; end if;

  update public.alert_recipients set status = p_status
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

-- Close an alert. The requester can resolve or cancel; a responder who has
-- arrived can mark it resolved (e.g. if the requester can't use their phone).
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
  return jsonb_build_object('ok', true);
end $$;

-- Everything one screen needs about an alert, shaped for the caller's role.
create or replace function public.get_alert(p_alert_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  a     public.alerts;
  r     public.alert_recipients;
  req   public.profiles;
  v_active boolean;
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
      'responders', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', rr.user_id,
                 'name', coalesce(nullif(btrim(p.display_name), ''), 'Responder'),
                 'device_type', p.device_type,
                 'status', rr.status,
                 'distance_m', case when rr.lat is null then rr.distance_m
                                    else round(public._distance_m(a.lat, a.lng, rr.lat, rr.lng))::int end,
                 'lat', rr.lat, 'lng', rr.lng, 'location_at', rr.location_at)
               order by rr.responded_at)
          from public.alert_recipients rr join public.profiles p on p.id = rr.user_id
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
      'allergies', case when v_active and req.share_medical_with_responders then req.allergies end),
    'en_route_count', (select count(*) from public.alert_recipients
                        where alert_id = a.id and status in ('en_route', 'arrived')),
    'max_en_route', public._cfg('max_en_route')::int);
end $$;

-- Home screen: my active SOS (if any) + alerts I've been asked to help with.
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
         and r.status in ('notified', 'en_route', 'arrived')), '[]'::jsonb));
end $$;

-- Responder: flag an SOS as fake / nobody there / abusive. Only people who were alerted can report.
create or replace function public.report_alert(p_alert_id uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_reason not in ('fake', 'no_one_there', 'abusive', 'other') then raise exception 'Invalid reason'; end if;
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

-- Health check used by the daily keep-awake job (stops the free server from pausing).
create or replace function public.ping() returns timestamptz
language sql stable set search_path = '' as $$
  select now()
$$;

-- In-app account deletion (required by the App Store).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;


-- ---------------------------------------------------------------------
--  Privacy housekeeping: strip precise locations from old, closed alerts.
--  To run it nightly: Database → Extensions → enable pg_cron, then run
--    select cron.schedule('purge-locations', '15 3 * * *', 'select public.purge_old_locations()');
-- ---------------------------------------------------------------------
create or replace function public.purge_old_locations() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.alert_recipients r set lat = null, lng = null
    from public.alerts a
   where a.id = r.alert_id and a.status <> 'active'
     and a.closed_at < now() - interval '30 days' and r.lat is not null;
  -- keep only a ~1 km-precision point for statistics
  update public.alerts set lat = round(lat::numeric, 2), lng = round(lng::numeric, 2)
   where status <> 'active' and closed_at < now() - interval '30 days'
     and (lat <> round(lat::numeric, 2) or lng <> round(lng::numeric, 2));
  delete from public.responder_locations where updated_at < now() - interval '7 days';
end $$;


-- ---------------------------------------------------------------------
--  Permissions: only signed-in users can call the app functions;
--  internal helpers can't be called from the app at all.
-- ---------------------------------------------------------------------
revoke execute on function
  public._cfg(text), public._distance_m(float8, float8, float8, float8), public._fmt_distance(float8),
  public._handle_new_user(), public._touch_updated_at(), public._send_push(jsonb),
  public._eligible_responders(float8, float8, int, uuid), public._expire_stale_alerts(),
  public._notify_responders(uuid), public.purge_old_locations()
from public, anon, authenticated;

revoke execute on function
  public._is_requester(uuid), public._is_active_responder(uuid), public._is_party(uuid),
  public._am_i_suspended(),
  public.update_my_location(float8, float8), public.nearby_responder_count(float8, float8),
  public.create_alert(float8, float8, text, boolean), public.widen_alert(uuid),
  public.respond_to_alert(uuid, boolean), public.update_responder_position(uuid, float8, float8),
  public.set_responder_status(uuid, text), public.close_alert(uuid, text),
  public.get_alert(uuid), public.my_alerts(), public.report_alert(uuid, text, text),
  public.delete_my_account()
from public, anon;

grant execute on function
  public._is_requester(uuid), public._is_active_responder(uuid), public._is_party(uuid),
  public._am_i_suspended(),
  public.update_my_location(float8, float8), public.nearby_responder_count(float8, float8),
  public.create_alert(float8, float8, text, boolean), public.widen_alert(uuid),
  public.respond_to_alert(uuid, boolean), public.update_responder_position(uuid, float8, float8),
  public.set_responder_status(uuid, text), public.close_alert(uuid, text),
  public.get_alert(uuid), public.my_alerts(), public.report_alert(uuid, text, text),
  public.delete_my_account()
to authenticated;

-- The keep-awake health check is the one thing logged-out callers may run.
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;


-- ---------------------------------------------------------------------
--  Live updates: let the app subscribe to changes on these tables.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alerts, public.alert_recipients, public.messages;
  end if;
end $$;
