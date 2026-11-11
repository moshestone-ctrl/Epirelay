import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, Card, Field, Loading, Screen, T } from '@/components/ui';
import { createTemporaryClient, supabase } from '@/lib/supabase';

type Client = typeof supabase;

/** Reads `#access_token=…&refresh_token=…` (or `#error_description=…`) from the reset link. */
function parseFragment(url: string | null): Record<string, string> {
  if (!url) return {};
  const hash = url.split('#')[1] ?? '';
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const out: Record<string, string> = {};
  for (const part of [...query.split('&'), ...hash.split('&')]) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v ?? '').replace(/\+/g, ' '));
  }
  return out;
}

/** Opened from the "Reset your password" email link. */
export default function ResetPassword() {
  const url = Linking.useLinkingURL();
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [client, setClient] = useState<Client | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = parseFragment(url);
      if (p.error_description || p.error) {
        if (!cancelled) {
          setProblem(p.error_description || p.error);
          setState('invalid');
        }
        return;
      }
      if (p.access_token && p.refresh_token) {
        // Use a separate client so the app's own login state doesn't change mid-screen.
        const temp = createTemporaryClient();
        const { error: err } = await temp.auth.setSession({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
        });
        if (!cancelled) {
          setProblem(err?.message ?? null);
          setClient(err ? null : temp);
          setState(err ? 'invalid' : 'ready');
        }
        return;
      }
      // Opened without a link: allow it only if already signed in (e.g. changing password).
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setClient(data.session ? supabase : null);
        setState(data.session ? 'ready' : 'invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const save = async () => {
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    if (!client) return;
    setBusy(true);
    const { error: err } = await client.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    if (client !== supabase) await client.auth.signOut({ scope: 'local' });
    setState('done');
  };

  if (state === 'checking') return <Loading />;

  if (state === 'done') {
    return (
      <Screen>
        <Card tone="ok">
          <T kind="heading">Password updated</T>
          <T>{client === supabase ? 'You’re all set.' : 'Sign in with your new password.'}</T>
        </Card>
        <Button title="Continue" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (state === 'invalid') {
    return (
      <Screen>
        <Card tone="warn">
          <T kind="heading">This reset link didn’t work</T>
          <T>{problem ? `${problem}. ` : ''}Links expire after a while and can only be used once. Request a new one from the sign-in screen.</T>
        </Card>
        <Button title="Back to sign in" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T kind="muted">Choose a new password for your EpiRelay account.</T>
      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        placeholder="At least 8 characters"
      />
      <Field label="Type it again" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      {error && (
        <Card tone="danger">
          <T>{error}</T>
        </Card>
      )}
      <Button title="Save new password" onPress={save} loading={busy} />
    </Screen>
  );
}
