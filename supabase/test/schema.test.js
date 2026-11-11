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
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}',
                             phone text, phone_confirmed_at timestamptz);
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
    .replace(/create extension if not exists pg_net[^;]*;/, '')
    .replace(/-- CRON-BEGIN[\s\S]*-- CRON-END/, '');   // pg_cron + Vault aren't available here
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
  // These test accounts are "established" (older than the 24-hour new-account window).
  await db.exec(`update public.profiles set created_at = now() - interval '3 days'`);

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
  ok(aView.role === 'requester' && aView.responders.length === 1 && aView.responders[0].name === 'Bea', 'requester sees B coming, first name only');
  ok(aView.responders[0].lat === null, 'requester does NOT see where B is while B is far away (privacy zone)');
  ok(bView2.requester.phone_verified === false && bView2.requester.member_since && bView2.requester.past_resolved === 0,
     'responder sees trust info about the sender (phone verified, member since, past SOS)');
  ok(bView2.safety.needs_confirmation === true && bView2.safety.checkin_due_at, 'accepting starts safety check-ins');
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
  ok(bRow.lat !== null, 'once B is within the privacy zone, the requester sees B on the map');

  ok((await rpc('I', `select public.set_responder_status($1, 'withdrawn') r`, [alertId])).r.ok, 'I withdraws');
  ok(!!(await fails('C', `select public.close_alert($1, 'resolved')`, [alertId])), 'responder who has not arrived cannot close');
  ok((await rpc('B', `select public.set_responder_status($1, 'arrived') r`, [alertId])).r.ok, 'B arrives');
  ok((await rpc('B', `select public.close_alert($1, 'resolved') r`, [alertId])).r.ok, 'arrived responder can mark resolved');
  ok((await db.query('select status from public.alerts where id = $1', [alertId])).rows[0].status === 'resolved', 'alert is resolved');
  const aView3 = (await rpc('A', 'select public.get_alert($1) r', [alertId])).r;
  ok(aView3.responders.every(r => r.lat === null && r.lng === null), 'after the SOS ends, the requester no longer sees any responder on the map');
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

  console.log('\nSafety tools');
  // C was alerted for a2, so C may report it; D (never alerted for a2) may not.
  ok((await rpc('C', `select public.report_alert($1, 'fake', 'nobody answered') r`, [a2.alert_id])).r.ok, 'alerted responder can report an SOS as fake');
  ok((await rpc('C', `select public.report_alert($1, 'no_one_there') r`, [a2.alert_id])).r.ok, 'reporting again updates the report');
  ok((await db.query('select count(*)::int c from public.alert_reports')).rows[0].c === 1, 'one report stored per responder per alert');
  ok((await rpc('D', `select public.report_alert($1, 'fake') r`, [a2.alert_id])).r.reason === 'not_invited', 'people who were not alerted cannot report');
  ok(!!(await fails('C', 'select * from public.alert_reports')), 'reports are not readable from the app');
  ok(!!(await fails('A', 'select * from public.suspended_users')), 'suspension list is not readable from the app');
  ok(!!(await fails('A', `insert into public.suspended_users (user_id) values ('${U.A}')`)), 'app cannot write the suspension list');

  // Rate limit: a2 was back-dated 3 h above, so A has 0 practice alerts this hour. 10 allowed, 11th refused.
  for (let i = 0; i < 10; i++) {
    const r = (await rpc('A', 'select public.create_alert($1,$2,null,true) r', [base.lat, base.lng])).r;
    await as('A', `select public.close_alert($1, 'cancelled')`, [r.alert_id]);
  }
  const tooMany = await fails('A', 'select public.create_alert($1,$2,null,true)', [base.lat, base.lng]);
  ok(tooMany && tooMany.includes('Too many alerts'), 'practice alerts are rate-limited (10 per hour)');
  const realStillOk = (await rpc('A', 'select public.create_alert($1,$2) r', [base.lat, base.lng])).r;
  ok(!realStillOk.existing && realStillOk.alert_id, 'a real SOS still goes through when practice alerts hit the limit');
  await as('A', `select public.close_alert($1, 'cancelled')`, [realStillOk.alert_id]);

  // Suspension: suspended carrier is not matched and cannot respond; suspended requester cannot send SOS.
  await db.query('insert into public.suspended_users (user_id, reason) values ($1, $2)', [U.C, 'test']);
  const g = (await rpc('G', 'select public.nearby_responder_count($1,$2) n', [base.lat, base.lng])).n;
  ok(g === 2, `suspended carrier is no longer matched (count ${g}: B and I)`);
  await db.query('insert into public.suspended_users (user_id, reason) values ($1, $2)', [U.G, 'test']);
  const sus = await fails('G', 'select public.create_alert($1,$2)', [base.lat, base.lng]);
  ok(sus && sus.includes('suspended'), 'suspended user cannot send an SOS');
  // A suspended responder who was already alerted cannot accept.
  const a3 = (await rpc('E', 'select public.create_alert($1,$2,null,true) r', [base.lat, base.lng])).r;
  await db.query(`insert into public.alert_recipients (alert_id, user_id, distance_m) values ($1, $2, 100)`, [a3.alert_id, U.C]);
  ok((await rpc('C', 'select public.respond_to_alert($1, true) r', [a3.alert_id])).r.reason === 'suspended', 'suspended responder cannot accept an SOS');
  await as('E', `select public.close_alert($1, 'cancelled')`, [a3.alert_id]);

  // Error reports
  ok(!(await fails('A', `insert into public.app_errors (message, context) values ('boom', 'test')`)), 'signed-in user can send an error report');
  ok(!!(await fails('A', `insert into public.app_errors (user_id, message) values ('${U.B}', 'spoof')`)), 'cannot send an error report as someone else');
  ok(!!(await fails('A', 'select * from public.app_errors')), 'error reports are not readable from the app');
  ok(!!(await fails(null, `insert into public.app_errors (message) values ('x')`)), 'logged-out callers cannot send error reports');

  // Keep-awake health check
  ok((await as(null, 'select public.ping() t')).rows.length === 1, 'logged-out health check (ping) works');

  console.log('\nResponder safety');
  // Fresh cast so earlier suspensions don't interfere.
  const S = { R: '00000000-0000-0000-0000-0000000000a1', X: '00000000-0000-0000-0000-0000000000a2',
              Y: '00000000-0000-0000-0000-0000000000a3', N: '00000000-0000-0000-0000-0000000000a4',
              Z: '00000000-0000-0000-0000-0000000000a5' };
  Object.assign(U, S);
  for (const [k, id] of Object.entries(S))
    await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [id, { display_name: 'User ' + k }]);
  await db.query(`update public.profiles set created_at = now() - interval '3 days' where id = any($1::uuid[])`,
                 [[S.R, S.X, S.Y, S.Z]]);   // N stays a brand-new account
  // Far from everyone else (somewhere in PA)
  const far = { lat: 40.2, lng: -76.9 };
  const near = (m) => ({ lat: far.lat + m / 111320, lng: far.lng });
  for (const [who, d] of [['X', 300], ['Y', 700]]) {
    await as(who, `update public.profiles set carries_epinephrine = true, available_to_respond = true, device_type = 'auto_injector',
                   device_expires_on = current_date + 200, emergency_contact_name = 'Mom', emergency_contact_phone = '555 123 4567' where id = auth.uid()`);
    const p = near(d); await as(who, 'select public.update_my_location($1,$2)', [p.lat, p.lng]);
  }

  // New account: practice only
  const newReal = await fails('N', 'select public.create_alert($1,$2)', [far.lat, far.lng]);
  ok(newReal && newReal.includes('New accounts'), 'a brand-new account cannot send a real SOS');
  const newTest = (await rpc('N', 'select public.create_alert($1,$2,null,true) r', [far.lat, far.lng])).r;
  ok(newTest.alert_id && newTest.notified === 2, 'a brand-new account can send a practice alert');
  await as('N', `select public.close_alert($1, 'cancelled')`, [newTest.alert_id]);
  const nHome = (await rpc('N', 'select public.my_alerts() r')).r;
  ok(nHome.me.new_account_until && nHome.me.phone_verified === false && nHome.me.phone_required === false,
     'home screen gets my verification + new-account status');

  // Check-ins and escalation
  const sa = (await rpc('R', 'select public.create_alert($1,$2) r', [far.lat, far.lng])).r;
  await as('X', 'select public.respond_to_alert($1, true)', [sa.alert_id]);
  await as('Y', 'select public.respond_to_alert($1, true)', [sa.alert_id]);
  let claimed = (await db.query('select * from public._claim_due_safety_escalations()')).rows;
  ok(claimed.length === 0, 'nobody is escalated while check-ins are current');
  await db.query(`update public.alert_recipients set last_checkin_at = now() - interval '31 minutes' where alert_id = $1`, [sa.alert_id]);
  ok((await rpc('X', 'select public.confirm_responder_safe($1, true) r', [sa.alert_id])).r.ok, '"I\'m OK, still here" resets the check-in timer');
  const xHome = (await rpc('X', 'select public.my_alerts() r')).r;
  ok(xHome.safety_pending.includes(sa.alert_id), 'home screen lists responses still waiting for "I\'m safe"');
  claimed = (await db.query('select * from public._claim_due_safety_escalations()')).rows;
  ok(claimed.length === 1 && claimed[0].user_id === S.Y && claimed[0].reason === 'no_checkin' && claimed[0].contact_phone === '555 123 4567',
     'a responder who misses a check-in is escalated to their emergency contact (once)');
  ok((await db.query('select * from public._claim_due_safety_escalations()')).rows.length === 0, 'escalations are claimed only once');
  ok(!!(await fails('X', 'select * from public._claim_due_safety_escalations()')), 'the app cannot trigger or read escalations');
  // Requester closing the SOS doesn't stop the responder's check-in
  await as('R', `select public.close_alert($1, 'resolved')`, [sa.alert_id]);
  ok((await rpc('X', 'select public.my_alerts() r')).r.safety_pending.includes(sa.alert_id),
     'check-ins continue even if the sender closes the SOS');
  ok((await rpc('X', 'select public.confirm_responder_safe($1) r', [sa.alert_id])).r.ok &&
     !(await rpc('X', 'select public.my_alerts() r')).r.safety_pending.includes(sa.alert_id), '"I\'m safe" ends check-ins');

  // "I feel unsafe"
  const sb = (await rpc('R', 'select public.create_alert($1,$2) r', [far.lat, far.lng])).r;
  await as('X', 'select public.respond_to_alert($1, true)', [sb.alert_id]);
  ok((await rpc('X', 'select public.responder_unsafe($1) r', [sb.alert_id])).r.ok, 'responder can tap "I feel unsafe"');
  const xr = (await db.query('select status, felt_unsafe_at from public.alert_recipients where alert_id=$1 and user_id=$2', [sb.alert_id, S.X])).rows[0];
  ok(xr.status === 'withdrawn' && xr.felt_unsafe_at, '"I feel unsafe" withdraws the responder');
  claimed = (await db.query('select * from public._claim_due_safety_escalations()')).rows;
  ok(claimed.length === 1 && claimed[0].reason === 'unsafe', '"I feel unsafe" contacts their emergency contact immediately');
  ok((await db.query('select count(*)::int c from public.suspended_users where user_id = $1', [S.R])).rows[0].c === 1,
     '"I feel unsafe" puts the SOS sender on hold automatically');
  const held = await fails('R', 'select public.create_alert($1,$2)', [far.lat, far.lng]);
  ok(held && held.includes('suspended'), 'a sender on hold cannot send another SOS');

  // Auto-hold after reports from 2 different responders
  const zc = (await rpc('Z', 'select public.create_alert($1,$2,null,true) r', [far.lat, far.lng])).r;
  await as('X', `select public.report_alert($1, 'fake')`, [zc.alert_id]);
  ok((await db.query('select count(*)::int c from public.suspended_users where user_id = $1', [S.Z])).rows[0].c === 0, 'one "fake" report alone does not hold the sender');
  await as('Y', `select public.report_alert($1, 'no_one_there')`, [zc.alert_id]);
  ok((await db.query('select count(*)::int c from public.suspended_users where user_id = $1', [S.Z])).rows[0].c === 1, 'reports from 2 different responders put the sender on hold');

  console.log('\nPhone verification (when switched on)');
  await db.exec(sql.match(/create or replace function public\._cfg[\s\S]*?\$\$;/)[0].replace("when 'require_verified_phone'   then 0", "when 'require_verified_phone'   then 1"));
  ok((await rpc('Y', 'select public.nearby_responder_count($1,$2) n', [far.lat, far.lng])).n === 0, 'unverified carriers are not matched');
  await db.query(`update auth.users set phone = '15551234567', phone_confirmed_at = now() where id = $1`, [S.X]);
  ok((await rpc('Y', 'select public.nearby_responder_count($1,$2) n', [far.lat, far.lng])).n === 1, 'verified carriers are matched');
  const unv = await fails('Y', 'select public.create_alert($1,$2)', [far.lat, far.lng]);
  ok(unv && unv.includes('Verify your phone'), 'an unverified person cannot send an SOS');
  await db.query(`update auth.users set phone = '15559876543', phone_confirmed_at = now() where id = $1`, [S.Y]);
  const ver = (await rpc('Y', 'select public.create_alert($1,$2,null,true) r', [far.lat, far.lng])).r;
  ok(ver.alert_id && ver.notified === 1, 'a verified person can send an SOS');
  const xv = (await rpc('X', 'select public.get_alert($1) r', [ver.alert_id])).r;
  ok(xv.requester.phone_verified === true, 'responders see the sender is phone-verified');
  await db.exec(sql.match(/create or replace function public\._cfg[\s\S]*?\$\$;/)[0]);  // back to default

  console.log('\nPermissions');
  ok(!!(await fails(null, 'select public.create_alert(1,1)')), 'logged-out callers cannot create alerts');
  ok(!!(await fails(null, 'select public.report_alert(gen_random_uuid(), \'fake\')')), 'logged-out callers cannot report alerts');
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
