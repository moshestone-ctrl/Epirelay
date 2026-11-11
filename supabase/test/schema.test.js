// Runs supabase/schema.sql against embedded Postgres with Supabase-like stubs
// (auth.users, auth.uid(), anon/authenticated roles, net.http_post) and checks behaviour.
const fs = require('fs');
const { PGlite } = require('@electric-sql/pglite');

const schemaPath = process.argv[2] || require('path').join(__dirname, '..', 'schema.sql');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

const U = {
  A: '00000000-0000-0000-0000-00000000000a', // requester
  B: '00000000-0000-0000-0000-00000000000b', // carrier ~500 m, has push token
  C: '00000000-0000-0000-0000-00000000000c', // carrier ~2 km
  I: '00000000-0000-0000-0000-000000000009', // carrier ~2.5 km
  D: '00000000-0000-0000-0000-00000000000d', // carrier ~5 km (outside first ring, inside widen)
  E: '00000000-0000-0000-0000-00000000000e', // carrier ~600 m, EXPIRED device
  F: '00000000-0000-0000-0000-00000000000f', // carrier ~600 m, NOT available
  G: '00000000-0000-0000-0000-000000000007', // carrier ~600 m, STALE location
};
const base = { lat: 40.8568, lng: -74.1285 }; // somewhere in NJ
const north = (m) => ({ lat: base.lat + m / 111320, lng: base.lng });

(async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema extensions; create schema net;
    create role anon nologin; create role authenticated nologin;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table net.calls (id serial, url text, body jsonb);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
      headers jsonb default '{}', timeout_milliseconds int default 2000) returns bigint
      language sql as $$ insert into net.calls (url, body) values (url, body) returning id::bigint $$;
    grant usage on schema auth, public, net to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);

  const sql = fs.readFileSync(schemaPath, 'utf8')
    .replace(/create extension if not exists pg_net[^;]*;/, '');
  await db.exec(sql);
  console.log('schema loaded');

  const as = async (who, q, params = []) => {
    await db.exec(`reset role; set request.jwt.claim.sub = '${who ? U[who] : ''}'; set role ${who ? 'authenticated' : 'anon'};`);
    try { return await db.query(q, params); } finally { await db.exec('reset role;'); }
  };
  const fails = async (who, q, params = []) => { try { await as(who, q, params); return null; } catch (e) { return e.message; } };
  const rpc = async (who, q, params) => (await as(who, q, params)).rows[0];

  // Users sign up
  for (const [k, id] of Object.entries(U))
    await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [id, { display_name: k === 'B' ? 'Bea Lopez' : 'User ' + k }]);
  ok((await db.query('select count(*)::int c from public.profiles')).rows[0].c === 8, 'profile auto-created for each sign-up');

  // Carriers set up their profiles + location
  const carrier = async (who, dist, extra = '') => {
    await as(who, `update public.profiles set carries_epinephrine = true, available_to_respond = true,
                   device_type = 'auto_injector', device_expires_on = current_date + 200 where id = auth.uid()`);
    if (extra) await as(who, `update public.profiles set ${extra} where id = auth.uid()`);
    const p = north(dist);
    await as(who, 'select public.update_my_location($1, $2)', [p.lat, p.lng]);
  };
  await carrier('B', 500, `expo_push_token = 'ExponentPushToken[bbb]'`);
  await carrier('C', 2000);
  await carrier('I', 2500);
  await carrier('D', 5000);
  await carrier('E', 600, 'device_expires_on = current_date - 1');
  await carrier('F', 600, 'available_to_respond = false');
  await carrier('G', 600);
  await db.exec(`update public.responder_locations set updated_at = now() - interval '4 hours' where user_id = '${U.G}'`);
  await as('A', `update public.profiles set allergies = 'Peanuts, tree nuts', expo_push_token = 'ExponentPushToken[aaa]' where id = auth.uid()`);

  console.log('\nMatching');
  const cnt = await rpc('A', 'select public.nearby_responder_count($1,$2) n', [base.lat, base.lng]);
  ok(cnt.n === 3, `nearby count = 3 (B, C, I); excludes far, expired, unavailable, stale → got ${cnt.n}`);

  const created = (await rpc('A', 'select public.create_alert($1,$2,$3) r', [base.lat, base.lng, 'Kitchen, 2nd floor'])).r;
  ok(created.notified === 3 && !created.existing, `create_alert notified 3 → ${JSON.stringify(created)}`);
  const alertId = created.alert_id;
  const calls = (await db.query('select body from net.calls')).rows;
  ok(calls.length === 1 && calls[0].body.length === 1 && calls[0].body[0].to === 'ExponentPushToken[bbb]', 'one push request, only to the carrier with a token');
  console.log('    push:', calls[0].body[0].title, '—', calls[0].body[0].body);
  const again = (await rpc('A', 'select public.create_alert($1,$2) r', [base.lat, base.lng])).r;
  ok(again.existing && again.alert_id === alertId, 'second SOS returns the existing alert (no duplicates)');

  console.log('\nPrivacy before accepting');
  const bView = (await rpc('B', 'select public.get_alert($1) r', [alertId])).r;
  ok(bView.role === 'responder' && bView.alert.lat === null && bView.alert.distance_m > 400, 'invited responder sees distance but not exact location');
  ok(bView.requester.allergies === null, 'allergies hidden until responder commits');
  ok((await as('B', 'select * from public.alerts')).rows.length === 0, 'invited responder cannot read alerts table directly');
  ok((await as('B', 'select * from public.alert_recipients')).rows.length === 1, 'responder sees only their own invitation row');
  ok((await as('B', 'select * from public.profiles')).rows.length === 1, 'users can read only their own profile');
  const locErr = await fails('B', 'select * from public.responder_locations');
  ok(!!locErr || (await as('B', 'select * from public.responder_locations')).rows.length === 0, 'nobody can read carrier locations');
  ok((await rpc('D', 'select public.get_alert($1) r', [alertId])).r === null, 'non-invited user gets nothing');
  ok((await as('A', 'select * from public.alert_recipients')).rows.length === 0, 'requester cannot see who was merely notified');

  console.log('\nResponding');
  ok((await rpc('B', 'select public.respond_to_alert($1, true) r', [alertId])).r.ok, 'B accepts');
  const bView2 = (await rpc('B', 'select public.get_alert($1) r', [alertId])).r;
  ok(bView2.alert.lat !== null && bView2.requester.allergies === 'Peanuts, tree nuts' && bView2.requester.name === 'User', 'after accepting, B gets exact location + allergies');
  const pushes = (await db.query('select body from net.calls order by id')).rows;
  ok(pushes.length === 2 && pushes[1].body[0].to === 'ExponentPushToken[aaa]', 'requester gets "help is on the way" push');
  console.log('    push:', pushes[1].body[0].body);
  const aView = (await rpc('A', 'select public.get_alert($1) r', [alertId])).r;
  ok(aView.role === 'requester' && aView.responders.length === 1 && aView.responders[0].name === 'Bea Lopez', 'requester sees B coming');
  ok((await as('A', 'select * from public.alert_recipients')).rows.length === 1, 'requester can read the en-route responder row (for live updates)');
  ok((await as('B', 'select * from public.alerts')).rows.length === 1, 'en-route responder can read the alert (for live updates)');

  ok((await rpc('C', 'select public.respond_to_alert($1, false) r', [alertId])).r.ok, 'C declines');
  const widened = (await rpc('A', 'select public.widen_alert($1) r', [alertId])).r;
  ok(widened.notified_new === 1 && widened.notified_total === 4, `widen notifies D → ${JSON.stringify(widened)}`);
  ok((await rpc('C', 'select public.respond_to_alert($1, true) r', [alertId])).r.ok, 'C changes mind, accepts');
  ok((await rpc('I', 'select public.respond_to_alert($1, true) r', [alertId])).r.ok, 'I accepts (3 coming)');
  const dTry = (await rpc('D', 'select public.respond_to_alert($1, true) r', [alertId])).r;
  ok(!dTry.ok && dTry.reason === 'enough_help', 'D is told enough help is coming');
  ok((await rpc('E', 'select public.respond_to_alert($1, true) r', [alertId])).r.reason === 'not_invited', 'uninvited user cannot join');

  console.log('\nChat, live position, closing');
  ok(!(await fails('B', `insert into public.messages (alert_id, body) values ($1, 'Two minutes away')`, [alertId])), 'responder can message');
  ok(!(await fails('A', `insert into public.messages (alert_id, body) values ($1, 'Front door is open')`, [alertId])), 'requester can message');
  ok(!!(await fails('D', `insert into public.messages (alert_id, body) values ($1, 'hi')`, [alertId])), 'non-responder cannot message');
  ok(!!(await fails('B', `insert into public.messages (alert_id, sender_id, body) values ($1, $2, 'spoof')`, [alertId, U.A])), 'cannot send as someone else');
  ok((await as('A', 'select * from public.messages')).rows.length === 2, 'requester reads both messages');
  ok((await as('D', 'select * from public.messages')).rows.length === 0, 'outsider reads none');

  const p = north(100);
  await as('B', 'select public.update_responder_position($1,$2,$3)', [alertId, p.lat, p.lng]);
  const aView2 = (await rpc('A', 'select public.get_alert($1) r', [alertId])).r;
  const bRow = aView2.responders.find(r => r.user_id === U.B);
  ok(bRow.distance_m >= 95 && bRow.distance_m <= 105, `requester sees B's live distance (${bRow.distance_m} m)`);

  ok((await rpc('I', `select public.set_responder_status($1, 'withdrawn') r`, [alertId])).r.ok, 'I withdraws');
  ok(!!(await fails('C', `select public.close_alert($1, 'resolved')`, [alertId])), 'responder who has not arrived cannot close');
  ok((await rpc('B', `select public.set_responder_status($1, 'arrived') r`, [alertId])).r.ok, 'B arrives');
  ok((await rpc('B', `select public.close_alert($1, 'resolved') r`, [alertId])).r.ok, 'arrived responder can mark resolved');
  ok((await db.query('select status from public.alerts where id = $1', [alertId])).rows[0].status === 'resolved', 'alert is resolved');
  ok(!!(await fails('B', `insert into public.messages (alert_id, body) values ($1, 'late')`, [alertId])), 'no messages after close');

  ok(!(await fails('A', `insert into public.feedback (alert_id, rating, comment) values ($1, 5, 'Thank you')`, [alertId])), 'requester leaves feedback');
  ok(!(await fails('B', `insert into public.feedback (alert_id, rating) values ($1, 5)`, [alertId])), 'responder leaves feedback');
  ok(!!(await fails('D', `insert into public.feedback (alert_id, rating) values ($1, 1)`, [alertId])), 'outsider cannot leave feedback');

  console.log('\nHome screen + expiry');
  const a2 = (await rpc('A', 'select public.create_alert($1,$2,null,true) r', [base.lat, base.lng])).r;
  ok(!a2.existing, 'new (test) alert after the previous one was resolved');
  const testPush = (await db.query('select body from net.calls order by id desc limit 1')).rows[0].body[0];
  ok(testPush.title.startsWith('[TEST]'), 'test alerts are labelled [TEST]');
  const cHome = (await rpc('C', 'select public.my_alerts() r')).r;
  ok(cHome.invitations.length === 1 && cHome.invitations[0].is_test, 'carrier sees the new invitation on home screen');
  await db.exec(`update public.alerts set created_at = now() - interval '3 hours' where id = '${a2.alert_id}'`);
  const aHome = (await rpc('A', 'select public.my_alerts() r')).r;
  ok(aHome.my_active_alert_id === null, 'alerts older than 2 h auto-close');

  console.log('\nPermissions');
  ok(!!(await fails(null, 'select public.create_alert(1,1)')), 'logged-out callers cannot create alerts');
  ok(!!(await fails(null, 'select * from public.profiles')), 'logged-out callers cannot read profiles');
  ok(!!(await fails('A', `select public._notify_responders('${alertId}')`)), 'internal functions are not callable from the app');
  ok(!!(await fails('A', `select public._send_push('[]')`)), 'app cannot send arbitrary pushes');
  ok(!!(await fails('A', `update public.profiles set display_name = 'x' where id = '${U.B}' returning id`)) ||
     (await as('A', `update public.profiles set display_name = 'x' where id = '${U.B}' returning id`)).rows.length === 0,
     'cannot edit someone else\'s profile');

  await as('F', 'select public.delete_my_account()');
  ok((await db.query('select count(*)::int c from public.profiles where id = $1', [U.F])).rows[0].c === 0, 'delete_my_account removes the user and their data');

  await db.exec(`update public.alerts set closed_at = now() - interval '31 days' where id = '${alertId}'`);
  await db.query('select public.purge_old_locations()');
  const purged = (await db.query('select lat from public.alerts where id = $1', [alertId])).rows[0];
  ok(Math.abs(purged.lat - Math.round(base.lat * 100) / 100) < 1e-9, 'old alert locations are coarsened');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
