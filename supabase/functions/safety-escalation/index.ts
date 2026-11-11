// Safety escalation: texts a responder's emergency contact when they miss a safety check-in
// or tap "I feel unsafe". Called every minute by the `safety-escalations` pg_cron job (see schema.sql).
//
// SMS needs these Edge Function secrets (Supabase dashboard → Edge Functions → Secrets):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM, a phone number)
// Without them, escalations are still recorded (visible in the "EpiRelay admin" notebook) as
// "sms_not_configured".
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
const serviceKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

type Due = {
  alert_id: string;
  user_id: string;
  responder_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  reason: 'unsafe' | 'no_checkin';
  last_lat: number | null;
  last_lng: number | null;
  dest_lat: number;
  dest_lng: number;
};

/** US-friendly normalisation to E.164 (+15551234567). */
function e164(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function sendSms(to: string, body: string): Promise<string> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const service = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
  const from = Deno.env.get('TWILIO_FROM');
  if (!sid || !token || !(service || from)) return 'sms_not_configured';
  const params = new URLSearchParams({ To: to, Body: body });
  if (service) params.set('MessagingServiceSid', service);
  else params.set('From', from!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (res.ok) return 'sms_sent';
  const detail = await res.text().catch(() => '');
  return `sms_failed_${res.status}: ${detail.slice(0, 120)}`;
}

Deno.serve(async (req) => {
  // Only the scheduled job knows this value (it's kept in the database's Vault).
  const { data: expected } = await admin.rpc('_safety_cron_secret');
  if (!expected || req.headers.get('x-cron-secret') !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  const { data, error } = await admin.rpc('_claim_due_safety_escalations');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results: string[] = [];
  for (const row of (data ?? []) as Due[]) {
    const to = row.contact_phone ? e164(row.contact_phone) : null;
    let result: string;
    if (!to) {
      result = 'no_emergency_contact';
    } else {
      const lat = row.last_lat ?? row.dest_lat;
      const lng = row.last_lng ?? row.dest_lng;
      const where = `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`;
      const name = row.responder_name.split(' ')[0];
      const body =
        row.reason === 'unsafe'
          ? `EpiRelay safety alert: ${name} was helping someone in an allergy emergency and tapped "I feel unsafe". ` +
            `Last known location: ${where} — please call them now. If you can't reach them, call 911.`
          : `EpiRelay safety alert: ${name} went to help someone in an allergy emergency and hasn't checked in. ` +
            `Last known location: ${where} — please call them. If you can't reach them, call 911.`;
      result = await sendSms(to, body);
    }
    await admin.rpc('_record_escalation_result', {
      p_alert_id: row.alert_id,
      p_user_id: row.user_id,
      p_result: result,
    });
    results.push(result);
  }
  return Response.json({ processed: results.length, results });
});
