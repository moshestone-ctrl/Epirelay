import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { HoldToSos } from '@/components/HoldToSos';
import { Badge, Button, Card, Screen, T, ToggleRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EMERGENCY_NUMBER } from '@/lib/config';
import { useInterval, useRealtime } from '@/lib/hooks';
import { callEmergency, ensureLocationPermission, formatDistance, getCurrentCoords, timeAgo } from '@/lib/location';
import { space, useTheme } from '@/lib/theme';
import type { MyAlerts } from '@/lib/types';

export default function Home() {
  const t = useTheme();
  const { session, profile, updateProfile } = useAuth();
  const [sending, setSending] = useState(false);
  const [practice, setPractice] = useState(false);
  const [mine, setMine] = useState<MyAlerts | null>(null);
  const [nearby, setNearby] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    api.myAlerts().then(setMine).catch(() => {});
    try {
      if (await ensureLocationPermission()) {
        const c = await getCurrentCoords();
        setNearby(await api.nearbyResponderCount(c.latitude, c.longitude));
      }
    } catch {
      setNearby(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useInterval(() => api.myAlerts().then(setMine).catch(() => {}), 30_000);
  useRealtime(
    'home-invitations',
    [{ table: 'alert_recipients', filter: `user_id=eq.${session?.user.id}` }],
    () => api.myAlerts().then(setMine).catch(() => {}),
    Boolean(session),
  );

  const sendSos = async () => {
    setSending(true);
    try {
      if (!(await ensureLocationPermission())) {
        Alert.alert(
          'Location is off',
          `We need your location to find people nearby. Turn it on in Settings. Call ${EMERGENCY_NUMBER} now.`,
          [{ text: `Call ${EMERGENCY_NUMBER}`, style: 'destructive', onPress: callEmergency }, { text: 'OK' }],
        );
        return;
      }
      const c = await getCurrentCoords();
      const res = await api.createAlert(c.latitude, c.longitude, practice);
      router.push(`/sos/${res.alert_id}`);
    } catch (e) {
      Alert.alert('Could not send alert', `${errorMessage(e)}\n\nCall ${EMERGENCY_NUMBER} now.`, [
        { text: `Call ${EMERGENCY_NUMBER}`, style: 'destructive', onPress: callEmergency },
        { text: 'OK' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const expiry = expiryStatus(profile?.device_expires_on ?? null);
  const invitations = mine?.invitations ?? [];

  return (
    <Screen>
      {mine?.my_active_alert_id && (
        <Card tone="danger">
          <T kind="heading">Your SOS is active</T>
          <Button kind="danger" title="Open my SOS" onPress={() => router.push(`/sos/${mine.my_active_alert_id}`)} />
        </Card>
      )}

      {invitations.map((inv) => (
        <Card key={inv.alert_id} tone="warn">
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            {inv.is_test && <Badge text="TEST" tone="warn" />}
            <Badge text={inv.my_status === 'notified' ? 'NEEDS HELP' : 'YOU’RE RESPONDING'} tone="danger" />
          </View>
          <T kind="heading">Someone {formatDistance(inv.distance_m)} away needs epinephrine</T>
          <T kind="small">{timeAgo(inv.created_at)}</T>
          <Button title="Open" onPress={() => router.push(`/respond/${inv.alert_id}`)} />
        </Card>
      ))}

      <View style={{ alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
        <T kind="muted" style={{ textAlign: 'center' }}>
          Having a severe allergic reaction and don’t have epinephrine?
        </T>
        <HoldToSos onTrigger={sendSos} busy={sending} />
        <T kind="small" style={{ textAlign: 'center' }}>
          {nearby === null
            ? 'Alerts people nearby who carry epinephrine.'
            : nearby === 0
              ? 'No available carriers within ~2 miles right now. Call 911 first.'
              : `${nearby} available ${nearby === 1 ? 'carrier' : 'carriers'} within ~2 miles.`}
        </T>
      </View>

      <Button kind="secondary" title={`Call ${EMERGENCY_NUMBER}`} onPress={callEmergency} />

      <Card>
        <ToggleRow
          label="Practice mode"
          hint="Sends a clearly labelled TEST alert. Use it to try the app with friends — never to test strangers."
          value={practice}
          onValueChange={setPractice}
        />
      </Card>

      {profile?.carries_epinephrine ? (
        <Card tone={expiry.tone === 'danger' ? 'danger' : undefined}>
          <T kind="label">Responder</T>
          <ToggleRow
            label="Available to respond"
            hint={
              expiry.tone === 'danger'
                ? 'Your epinephrine has expired, so you won’t get alerts. Update the date in your profile.'
                : 'You’ll get an alert when someone nearby needs epinephrine.'
            }
            value={profile.available_to_respond}
            onValueChange={(v) =>
              updateProfile({ available_to_respond: v }).catch((e) => Alert.alert('Could not update', errorMessage(e)))
            }
          />
          {expiry.text ? <Badge text={expiry.text} tone={expiry.tone} /> : null}
        </Card>
      ) : (
        <Card>
          <T kind="heading">Carry epinephrine?</T>
          <T kind="muted">Become a responder and help someone nearby in the minutes before an ambulance arrives.</T>
          <Button kind="secondary" title="Set up responder profile" onPress={() => router.push('/profile')} />
        </Card>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs }}>
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="link">
            <T style={{ color: t.accent, fontWeight: '600' }}>Profile & medical info</T>
          </Pressable>
        </Link>
        <Link href="/safety" asChild>
          <Pressable accessibilityRole="link">
            <T style={{ color: t.accent, fontWeight: '600' }}>Safety & legal</T>
          </Pressable>
        </Link>
      </View>
    </Screen>
  );
}

function expiryStatus(date: string | null): { text: string | null; tone: 'ok' | 'warn' | 'danger' } {
  if (!date) return { text: 'Add your expiration date in your profile', tone: 'warn' };
  const [y, m, d] = date.split('-').map(Number);
  const days = Math.floor((new Date(y, m - 1, d).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days < 0) return { text: 'EXPIRED', tone: 'danger' };
  if (days <= 30) return { text: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'warn' };
  return { text: `Expires ${date}`, tone: 'ok' };
}
