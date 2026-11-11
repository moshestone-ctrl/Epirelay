import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';

import { HoldToSos } from '@/components/HoldToSos';
import { Badge, Button, Card, Screen, T, ToggleRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isBackgroundLocationRunning, startBackgroundLocation } from '@/lib/backgroundLocation';
import { EMERGENCY_NUMBER } from '@/lib/config';
import { useInterval, useRealtime } from '@/lib/hooks';
import { callEmergency, clockTime, ensureLocationPermission, formatDistance, getCurrentCoords, timeAgo } from '@/lib/location';
import { cancelSafetyCheckin } from '@/lib/notifications';
import { space, useTheme } from '@/lib/theme';
import type { MyAlerts } from '@/lib/types';

export default function Home() {
  const t = useTheme();
  const { session, profile, updateProfile } = useAuth();
  const [sending, setSending] = useState(false);
  const [practice, setPractice] = useState(false);
  const [mine, setMine] = useState<MyAlerts | null>(null);
  const [nearby, setNearby] = useState<number | null>(null);
  const [bgOn, setBgOn] = useState<boolean | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const applyMine = useCallback((m: MyAlerts) => {
    setMine(m);
    setCheckedAt(Date.now());
  }, []);

  const me = mine?.me;
  const newAccountUntil = me?.new_account_until ? new Date(me.new_account_until) : null;
  const newAccount = Boolean(newAccountUntil && newAccountUntil.getTime() > checkedAt);

  const refresh = useCallback(async () => {
    api.myAlerts().then(applyMine).catch(() => {});
    isBackgroundLocationRunning().then(setBgOn);
    try {
      if (await ensureLocationPermission()) {
        const c = await getCurrentCoords();
        setNearby(await api.nearbyResponderCount(c.latitude, c.longitude));
      }
    } catch {
      setNearby(null);
    }
  }, [applyMine]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useInterval(() => api.myAlerts().then(applyMine).catch(() => {}), 30_000);
  useRealtime(
    'home-invitations',
    [{ table: 'alert_recipients', filter: `user_id=eq.${session?.user.id}` }],
    () => api.myAlerts().then(applyMine).catch(() => {}),
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
      const res = await api.createAlert(c.latitude, c.longitude, practice || newAccount);
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

  // Google Play requires this explanation before asking for location "all the time".
  const askBackground = () =>
    Alert.alert(
      'Get alerts in the background',
      'While you’re marked Available, EpiRelay uses your location in the background — even when the app is ' +
        'closed or not in use — so you can be matched with someone nearby who needs epinephrine.\n\n' +
        'Your location is never shown to other people, and this stops when you turn off Available.\n\n' +
        'On the next screen, choose “Allow all the time”.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            const r = await startBackgroundLocation(true);
            setBgOn(r === 'on');
            if (r === 'needs_always' || r === 'denied') {
              Alert.alert(
                'Location “All the time” is needed',
                'Open Settings → Permissions → Location and choose “Allow all the time”. Until then, alerts only reach you while EpiRelay is open.',
                [{ text: 'Later', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }],
              );
            } else if (r === 'error') {
              Alert.alert('Couldn’t start background alerts', 'Please try again in a moment.');
            }
          },
        },
      ],
    );

  const setAvailable = async (v: boolean) => {
    if (v && !profile?.emergency_contact_phone) {
      Alert.alert(
        'Add an emergency contact first',
        'If you go to help someone and don’t answer a safety check-in, we text this person where you are.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add contact', onPress: () => router.push('/profile') },
        ],
      );
      return;
    }
    try {
      await updateProfile({ available_to_respond: v });
      if (v && !(await isBackgroundLocationRunning())) askBackground();
      if (!v) setBgOn(false);
    } catch (e) {
      Alert.alert('Could not update', errorMessage(e));
    }
  };

  const confirmSafe = async (alertId: string) => {
    try {
      await api.confirmResponderSafe(alertId, false);
      cancelSafetyCheckin(alertId).catch(() => {});
      api.myAlerts().then(applyMine).catch(() => {});
    } catch (e) {
      Alert.alert('Could not update', errorMessage(e));
    }
  };

  const expiry = expiryStatus(profile?.device_expires_on ?? null);
  const invitations = mine?.invitations ?? [];
  // "Are you safe?" for responses that have ended (live ones are handled on the respond screen).
  const respondingIds = new Set(invitations.filter((i) => i.my_status !== 'notified').map((i) => i.alert_id));
  const safetyPending = (mine?.safety_pending ?? []).filter((alertId) => !respondingIds.has(alertId));

  return (
    <Screen>
      {me?.suspended && (
        <Card tone="danger">
          <T kind="heading">Your account is on hold</T>
          <T>
            After a report, your account can’t send or respond to alerts while the EpiRelay team reviews it. In an
            emergency, call {EMERGENCY_NUMBER}.
          </T>
        </Card>
      )}

      {safetyPending.map((alertId) => (
        <Card key={`safe-${alertId}`} tone="warn">
          <T kind="heading">Are you safe?</T>
          <T>You went to help someone. Let us know you’ve left safely, or we’ll check in with your emergency contact.</T>
          <Button title="I’m safe" onPress={() => confirmSafe(alertId)} />
          <Button kind="secondary" title="Open" onPress={() => router.push(`/respond/${alertId}`)} />
        </Card>
      ))}

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
          hint={
            newAccount && newAccountUntil
              ? `New accounts can send practice alerts only, until ${clockTime(newAccountUntil.toISOString())} ` +
                `${newAccountUntil.toDateString() === new Date().toDateString() ? 'today' : 'tomorrow'}. ` +
                'This stops fake alerts from brand-new accounts.'
              : 'Sends a clearly labelled TEST alert. Use it to try the app with friends — never to test strangers.'
          }
          value={practice || newAccount}
          onValueChange={setPractice}
          disabled={newAccount}
        />
      </Card>

      {me && !me.phone_verified && (
        <Card tone={me.phone_required ? 'warn' : undefined}>
          <T kind="heading">Verify your phone number</T>
          <T kind="muted">
            {me.phone_required
              ? 'Required before you can send an SOS or respond to one.'
              : 'Responders see that your number is verified, which helps them trust your SOS.'}
          </T>
          <Button kind="secondary" title="Verify phone" onPress={() => router.push('/verify-phone')} />
        </Card>
      )}

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
            onValueChange={setAvailable}
          />
          {expiry.text ? <Badge text={expiry.text} tone={expiry.tone} /> : null}
          {profile.available_to_respond && expiry.tone !== 'danger' && bgOn === false && (
            <View style={{ gap: space.sm, marginTop: space.xs }}>
              <T kind="small">Right now alerts only reach you while EpiRelay is open.</T>
              <Button kind="secondary" title="Get alerts in the background" onPress={askBackground} />
            </View>
          )}
          {profile.available_to_respond && bgOn === true && (
            <Badge text="BACKGROUND ALERTS ON" tone="ok" />
          )}
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
