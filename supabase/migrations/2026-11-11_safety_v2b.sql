-- Hide responders' positions from the requester once the SOS has ended.
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
                 -- A responder's position is shown only while the SOS is active and once they're close
                 -- (or have arrived), so the person who sent it never learns where they set off from
                 -- or where they go afterwards.
                 'lat', case when a.status = 'active' and rr.status in ('en_route', 'arrived')
                              and (rr.status = 'arrived' or d.m <= v_zone) then rr.lat end,
                 'lng', case when a.status = 'active' and rr.status in ('en_route', 'arrived')
                              and (rr.status = 'arrived' or d.m <= v_zone) then rr.lng end,
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
