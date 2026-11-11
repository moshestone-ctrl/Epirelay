-- =====================================================================
--  One-time step: lets people delete their own account from inside the app,
--  and adds the optional privacy clean-up job.
--
--  These are the only parts of schema.sql that remove data, so the server
--  asks a person to approve them. To add them:
--    Supabase dashboard → project "epirelay" → SQL Editor → New query →
--    paste this whole file → Run.
--  Safe to run more than once.
-- =====================================================================

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;

create or replace function public.purge_old_locations() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.alert_recipients r set lat = null, lng = null
    from public.alerts a
   where a.id = r.alert_id and a.status <> 'active'
     and a.closed_at < now() - interval '30 days' and r.lat is not null;
  update public.alerts set lat = round(lat::numeric, 2), lng = round(lng::numeric, 2)
   where status <> 'active' and closed_at < now() - interval '30 days'
     and (lat <> round(lat::numeric, 2) or lng <> round(lng::numeric, 2));
  delete from public.responder_locations where updated_at < now() - interval '7 days';
end $$;

revoke execute on function public.purge_old_locations() from public, anon, authenticated;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
