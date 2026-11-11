import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Field, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';

/** US-friendly normalisation to E.164 (+15551234567). Returns null if it doesn't look like a phone number. */
function toE164(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function friendly(e: unknown): string {
  const msg = errorMessage(e);
  if (/provider|sms|twilio|messagebird|vonage|textlocal/i.test(msg) && !/rate|seconds/i.test(msg)) {
    return 'Text-message verification isn’t switched on yet. Please try again later.';
  }
  if (/already/i.test(msg)) return 'That number is already used by another EpiRelay account.';
  if (/expired|invalid/i.test(msg)) return 'That code didn’t work. Check it, or send a new one.';
  if (/rate|seconds|too many/i.test(msg)) return 'Please wait a minute before asking for another code.';
  return msg;
}

/** Phone verification by text message (Supabase Auth phone change + one-time code). */
export default function VerifyPhone() {
  const { session, profile, updateProfile } = useAuth();
  const user = session?.user;
  const verifiedNumber = user?.phone && user.phone_confirmed_at ? `+${user.phone.replace(/^\+/, '')}` : null;

  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const send = async () => {
    setError(null);
    const e164 = toE164(phone);
    if (!e164) {
      setError('Enter your mobile number, e.g. (555) 123-4567.');
      return;
    }
    setBusy('send');
    try {
      const { error: err } = await supabase.auth.updateUser({ phone: e164 });
      if (err) throw err;
      setSentTo(e164);
      setCode('');
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!sentTo) return;
    setError(null);
    setBusy('verify');
    try {
      const { error: err } = await supabase.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: 'phone_change' });
      if (err) throw err;
      await updateProfile({ phone: sentTo }).catch(() => {});
      router.back();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  if (verifiedNumber && !changing) {
    return (
      <Screen>
        <Card tone="ok">
          <T kind="heading">Your phone is verified ✓</T>
          <T>{verifiedNumber}</T>
        </Card>
        <Button kind="secondary" title="Use a different number" onPress={() => setChanging(true)} />
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T kind="muted">
        We’ll text you a 6-digit code. A verified number helps stop fake alerts, and responders can see that yours is
        verified. Your number is never shown to other people.
      </T>

      {!sentTo ? (
        <View style={{ gap: space.md }}>
          <Field
            label="Mobile number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder="(555) 123-4567"
            maxLength={20}
          />
          <Button title="Text me a code" onPress={send} loading={busy === 'send'} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <T>Enter the code we sent to {sentTo}.</T>
          <Field
            label="Code"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={8}
            placeholder="123456"
          />
          <Button title="Verify" onPress={verify} loading={busy === 'verify'} disabled={code.trim().length < 6} />
          <Button kind="secondary" title="Send a new code" onPress={send} loading={busy === 'send'} />
          <Button kind="ghost" title="Change number" onPress={() => setSentTo(null)} />
        </View>
      )}

      {error && (
        <Card tone="danger">
          <T>{error}</T>
        </Card>
      )}
      <T kind="small">Message and data rates may apply.</T>
    </Screen>
  );
}
