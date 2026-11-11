-- Safety escalations: scheduled job that texts a responder's emergency contact (see schema.sql CRON block).
select vault.create_secret('https://nwmncmdqdooetjwzkueq.supabase.co', 'project_url') where not exists (select 1 from vault.secrets where name = 'project_url');
-- Every minute, if a responder missed a safety check-in or tapped "I feel unsafe", call the
-- safety-escalation Edge Function, which texts their emergency contact. Needs two Vault secrets:
-- 'project_url' (https://<project>.supabase.co) and 'safety_cron_secret' (random, created below).
create extension if not exists pg_cron;
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'safety_cron_secret')
 where not exists (select 1 from vault.secrets where name = 'safety_cron_secret');

create or replace function public._safety_cron_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'safety_cron_secret'
$$;
revoke all on function public._safety_cron_secret() from public, anon, authenticated;
grant execute on function public._safety_cron_secret() to service_role;

select cron.schedule('safety-escalations', '* * * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/safety-escalation',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'safety_cron_secret')))
  where exists (
    select 1 from public.alert_recipients r
     where r.escalated_at is null and r.safe_confirmed_at is null
       and r.responded_at > now() - interval '12 hours'
       and (r.felt_unsafe_at is not null
            or (r.status in ('en_route', 'arrived')
                and coalesce(r.last_checkin_at, r.responded_at)
                    < now() - make_interval(mins => (public._cfg('checkin_minutes')
                                                     + public._cfg('checkin_grace_minutes'))::int))))
$cron$);
