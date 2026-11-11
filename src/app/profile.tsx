import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, Card, Field, Screen, Segmented, T, ToggleRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { scheduleExpiryReminders } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';
import type { DeviceType } from '@/lib/types';

const DEVICE_OPTIONS: { value: DeviceType; label: string }[] = [
  { value: 'auto_injector', label: 'Auto-injector' },
  { value: 'nasal_spray', label: 'Nasal spray' },
  { value: 'other', label: 'Other' },
];

export default function ProfileScreen() {
  const t = useTheme();
  const { profile, updateProfile } = useAuth();
  const [form, setForm] = useState(() => ({
    display_name: profile?.display_name ?? '',
    phone: profile?.phone ?? '',
    carries_epinephrine: profile?.carries_epinephrine ?? false,
    device_type: profile?.device_type ?? null,
    device_expires_on: profile?.device_expires_on ?? '',
    available_to_respond: profile?.available_to_respond ?? false,
    allergies: profile?.allergies ?? '',
    emergency_contact_name: profile?.emergency_contact_name ?? '',
    emergency_contact_phone: profile?.emergency_contact_phone ?? '',
    share_medical_with_responders: profile?.share_medical_with_responders ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const expires = form.device_expires_on.trim();
    if (form.carries_epinephrine) {
      if (!form.device_type) return Alert.alert('Missing info', 'Choose what kind of epinephrine you carry.');
      if (!isValidDate(expires)) {
        return Alert.alert('Check the date', 'Enter the expiration date printed on your device as YYYY-MM-DD, e.g. 2027-08-31.');
      }
    }
    setBusy(true);
    try {
      const carries = form.carries_epinephrine;
      await updateProfile({
        display_name: form.display_name.trim(),
        phone: form.phone.trim() || null,
        carries_epinephrine: carries,
        device_type: carries ? form.device_type : null,
        device_expires_on: carries ? expires : null,
        available_to_respond: carries && form.available_to_respond,
        allergies: form.allergies.trim() || null,
        emergency_contact_name: form.emergency_contact_name.trim() || null,
        emergency_contact_phone: form.emergency_contact_phone.trim() || null,
        share_medical_with_responders: form.share_medical_with_responders,
      });
      await scheduleExpiryReminders(carries ? expires : null).catch(() => {});
      router.back();
    } catch (e) {
      Alert.alert('Could not save', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => supabase.auth.signOut();

  const deleteAccount = () =>
    Alert.alert('Delete your account?', 'This permanently removes your profile, alerts and messages. It can’t be undone.', [
      { text: 'Keep account', style: 'cancel' },
      {
        text: 'Delete forever',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMyAccount();
            await supabase.auth.signOut({ scope: 'local' });
          } catch (e) {
            Alert.alert('Could not delete', errorMessage(e));
          }
        },
      },
    ]);

  return (
    <Screen>
      <Card>
        <T kind="label">About you</T>
        <Field label="First name" value={form.display_name} onChangeText={(v) => set('display_name', v)} maxLength={60} />
        <Field
          label="Phone (optional)"
          value={form.phone}
          onChangeText={(v) => set('phone', v)}
          keyboardType="phone-pad"
          maxLength={30}
          hint="Not shown to anyone yet — kept for future call-back features."
        />
      </Card>

      <Card>
        <T kind="label">Responder</T>
        <ToggleRow
          label="I carry epinephrine"
          hint="An auto-injector or nasal spray, on me most of the time."
          value={form.carries_epinephrine}
          onValueChange={(v) => set('carries_epinephrine', v)}
        />
        {form.carries_epinephrine && (
          <View style={{ gap: space.md }}>
            <Segmented options={DEVICE_OPTIONS} value={form.device_type} onChange={(v) => set('device_type', v)} />
            <Field
              label="Expiration date"
              value={form.device_expires_on}
              onChangeText={(v) => set('device_expires_on', v)}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              hint="Printed on the device. We’ll remind you before it expires, and pause alerts after."
            />
            <ToggleRow
              label="Available to respond"
              hint="Get alerts when someone near you needs epinephrine."
              value={form.available_to_respond}
              onValueChange={(v) => set('available_to_respond', v)}
            />
          </View>
        )}
      </Card>

      <Card>
        <T kind="label">Medical info (for when you need help)</T>
        <Field
          label="Allergies"
          value={form.allergies}
          onChangeText={(v) => set('allergies', v)}
          multiline
          maxLength={500}
          placeholder="e.g. Peanuts, bee stings"
        />
        <Field
          label="Emergency contact name"
          value={form.emergency_contact_name}
          onChangeText={(v) => set('emergency_contact_name', v)}
          maxLength={60}
        />
        <Field
          label="Emergency contact phone"
          value={form.emergency_contact_phone}
          onChangeText={(v) => set('emergency_contact_phone', v)}
          keyboardType="phone-pad"
          maxLength={30}
        />
        <ToggleRow
          label="Share allergies with responders"
          hint="Only with people who are on their way to you, only during an SOS."
          value={form.share_medical_with_responders}
          onValueChange={(v) => set('share_medical_with_responders', v)}
        />
      </Card>

      <Button title="Save" onPress={save} loading={busy} />

      <View style={{ gap: space.sm, marginTop: space.lg }}>
        <Button kind="secondary" title="Sign out" onPress={signOut} />
        <Button kind="ghost" title="Delete my account" onPress={deleteAccount} style={{ opacity: 0.9 }} />
        <T kind="small" style={{ textAlign: 'center', color: t.muted }}>
          Signed in as {profile?.display_name || 'you'}
        </T>
      </View>
    </Screen>
  );
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
