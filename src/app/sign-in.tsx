import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, Card, Field, Screen, T } from '@/components/ui';
import { APP_NAME } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

export default function SignIn() {
  const t = useTheme();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-up');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'ok'; text: string } | null>(null);

  const submit = async () => {
    setMessage(null);
    if (!email.includes('@')) return setMessage({ tone: 'danger', text: 'Enter a valid email address.' });
    if (password.length < 8) return setMessage({ tone: 'danger', text: 'Password must be at least 8 characters.' });
    setBusy(true);
    try {
      if (mode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage({ tone: 'ok', text: 'Check your email to confirm your account, then sign in.' });
          setMode('sign-in');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <View style={{ gap: space.sm, marginTop: space.xl, marginBottom: space.md }}>
          <T kind="title" style={{ color: t.danger }}>
            {APP_NAME}
          </T>
          <T kind="muted">
            Get epinephrine fast in an allergy emergency — from people nearby who carry it.
          </T>
        </View>

        {mode === 'sign-up' && (
          <Field label="First name" value={name} onChangeText={setName} autoComplete="given-name" placeholder="e.g. Sam" />
        )}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          placeholder="At least 8 characters"
        />

        {message && (
          <Card tone={message.tone}>
            <T>{message.text}</T>
          </Card>
        )}

        <Button title={mode === 'sign-up' ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
        <Button
          kind="ghost"
          title={mode === 'sign-up' ? 'I already have an account' : 'Create a new account'}
          onPress={() => {
            setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
            setMessage(null);
          }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
