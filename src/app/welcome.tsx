import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { APP_NAME, EMERGENCY_NUMBER, TERMS_VERSION } from '@/lib/config';
import { radius, space, useTheme } from '@/lib/theme';

const ACKS = [
  'I am 18 or older.',
  `${APP_NAME} does not replace emergency services. In an emergency I will always call ${EMERGENCY_NUMBER}.`,
  'Responders are volunteers. Nobody is guaranteed to come, or to arrive in time.',
  'Responders bring epinephrine and hand it over. The person who needs it — or someone with them — uses it, following the instructions on the device.',
  'If I go to help, I never have to go inside. I hand the device over at the door or somewhere I can be seen, and I leave if anything feels wrong.',
  `I will only send an SOS in a real emergency. False alerts put responders at risk and get accounts suspended.`,
  'Laws about sharing prescription medicine vary by state. I have read the Safety & legal page.',
];

export default function Welcome() {
  const t = useTheme();
  const { profile, updateProfile } = useAuth();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [checked, setChecked] = useState<boolean[]>(ACKS.map(() => false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = checked.every(Boolean) && name.trim().length > 0;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProfile({
        display_name: name.trim(),
        accepted_terms_version: TERMS_VERSION,
        accepted_terms_at: new Date().toISOString(),
      });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ gap: space.sm, marginTop: space.lg }}>
        <T kind="title">Before you start</T>
        <T kind="muted">Please confirm you understand how {APP_NAME} works.</T>
      </View>

      <Field label="Your first name" value={name} onChangeText={setName} hint="Shown to people you help or who help you." />

      <View style={{ gap: space.sm }}>
        {ACKS.map((text, i) => (
          <Pressable
            key={i}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checked[i] }}
            onPress={() => setChecked(checked.map((c, j) => (j === i ? !c : c)))}
            style={[styles.ack, { backgroundColor: t.card, borderColor: checked[i] ? t.ok : t.border }]}>
            <View style={[styles.box, { borderColor: checked[i] ? t.ok : t.muted, backgroundColor: checked[i] ? t.ok : 'transparent' }]}>
              {checked[i] && <Text style={{ color: '#fff', fontWeight: '900' }}>✓</Text>}
            </View>
            <T style={{ flex: 1 }}>{text}</T>
          </Pressable>
        ))}
      </View>

      <Link href="/safety" asChild>
        <Pressable accessibilityRole="link">
          <T style={{ color: t.accent, fontWeight: '600' }}>Read Safety & legal →</T>
        </Pressable>
      </Link>

      {error && (
        <Card tone="danger">
          <T>{error}</T>
        </Card>
      )}
      <Button title="I understand — continue" onPress={accept} disabled={!allChecked} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  ack: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
