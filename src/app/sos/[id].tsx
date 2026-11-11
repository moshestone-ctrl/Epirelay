import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AlertMap, type MapPoint } from '@/components/AlertMap';
import { ChatPanel } from '@/components/ChatPanel';
import { Badge, Button, Card, Loading, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EMERGENCY_NUMBER, WIDEN_PROMPT_AFTER_MS } from '@/lib/config';
import { useAlert } from '@/lib/hooks';
import { callEmergency, formatDistance, timeAgo } from '@/lib/location';
import { space, useTheme } from '@/lib/theme';

/** The person in need: live status of their SOS. */
export default function SosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { profile } = useAuth();
  const { view, loaded, refresh } = useAlert(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  if (!loaded) return <Loading />;
  if (!view || view.role !== 'requester') {
    return (
      <Screen>
        <T>This alert isn’t available.</T>
        <Button title="Go home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const { alert, responders } = view;
  const active = alert.status === 'active';
  const coming = responders.filter((r) => r.status === 'en_route' || r.status === 'arrived');
  const ageMs = now - new Date(alert.created_at).getTime();
  const canWiden = active && alert.radius_m < 8000 && (coming.length === 0 && (ageMs > WIDEN_PROMPT_AFTER_MS || alert.notified_count === 0));

  const widen = async () => {
    setBusy('widen');
    try {
      const r = await api.widenAlert(alert.id);
      Alert.alert('Search widened', r.notified_new ? `${r.notified_new} more carriers alerted.` : 'No additional carriers found yet. Stay on the line with 911.');
      refresh();
    } catch (e) {
      Alert.alert('Could not widen search', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const close = (outcome: 'resolved' | 'cancelled') => {
    const run = async () => {
      setBusy(outcome);
      try {
        await api.closeAlert(alert.id, outcome);
        router.replace(`/feedback/${alert.id}`);
      } catch (e) {
        Alert.alert('Something went wrong', errorMessage(e));
      } finally {
        setBusy(null);
      }
    };
    if (outcome === 'cancelled') {
      Alert.alert('Cancel your SOS?', 'Responders will be told they’re no longer needed.', [
        { text: 'Keep SOS active', style: 'cancel' },
        { text: 'Cancel SOS', style: 'destructive', onPress: run },
      ]);
    } else run();
  };

  const points: MapPoint[] = [
    { id: 'me', latitude: alert.lat, longitude: alert.lng, title: 'You', kind: 'patient' },
    ...coming
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        id: r.user_id,
        latitude: r.lat!,
        longitude: r.lng!,
        title: r.name,
        subtitle: r.status === 'arrived' ? 'here' : formatDistance(r.distance_m),
        kind: 'responder' as const,
      })),
  ];

  return (
    <Screen>
      {alert.is_test && <Badge text="PRACTICE ALERT — TEST ONLY" tone="warn" />}

      {active ? (
        <Card tone="danger">
          <T kind="heading">Call {EMERGENCY_NUMBER} now</T>
          <T>Even if help is on the way. Tell them it’s a severe allergic reaction (anaphylaxis).</T>
          <Button kind="danger" title={`Call ${EMERGENCY_NUMBER}`} onPress={callEmergency} />
        </Card>
      ) : (
        <Card tone="ok">
          <T kind="heading">This SOS has ended</T>
          <Button title="Done" onPress={() => router.replace('/')} />
        </Card>
      )}

      <AlertMap points={points} radiusM={active ? alert.radius_m : undefined} />

      <Card>
        <T kind="label">Status</T>
        {coming.length > 0 ? (
          <T kind="heading">
            {coming.length === 1 ? `${coming[0].name} is` : `${coming.length} people are`} bringing epinephrine
          </T>
        ) : alert.notified_count > 0 ? (
          <T kind="heading">
            Alerted {alert.notified_count} {alert.notified_count === 1 ? 'carrier' : 'carriers'} nearby — waiting for a reply
          </T>
        ) : (
          <T kind="heading">No available carriers found nearby yet</T>
        )}
        <T kind="small">SOS sent {timeAgo(alert.created_at)} · search radius {formatDistance(alert.radius_m)}</T>

        {responders.map((r) => (
          <View key={r.user_id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
            <T style={{ fontWeight: '600', flex: 1 }}>{r.name}</T>
            <Badge
              text={r.status === 'arrived' ? 'ARRIVED' : r.status === 'withdrawn' ? 'CAN’T COME' : `${formatDistance(r.distance_m)} AWAY`}
              tone={r.status === 'arrived' ? 'ok' : r.status === 'withdrawn' ? 'neutral' : 'warn'}
            />
          </View>
        ))}

        {canWiden && (
          <Button kind="secondary" title="Widen search (~5 miles)" onPress={widen} loading={busy === 'widen'} />
        )}
      </Card>

      {active && profile?.allergies && profile.share_medical_with_responders && (
        <T kind="small">Your allergy info is shared with responders once they’re on their way.</T>
      )}

      <ChatPanel
        alertId={alert.id}
        canSend={active}
        placeholder="e.g. Apartment 4B, door is open"
        nameFor={(sender) => responders.find((r) => r.user_id === sender)?.name ?? 'Responder'}
      />

      {active && (
        <View style={{ gap: space.sm }}>
          <Button kind="primary" title="Help arrived — I’m OK" onPress={() => close('resolved')} loading={busy === 'resolved'} />
          <Button kind="ghost" title="Cancel SOS" onPress={() => close('cancelled')} loading={busy === 'cancelled'} />
        </View>
      )}
      <T kind="small" style={{ color: t.muted, textAlign: 'center' }}>
        Go to the emergency room even if you feel better — symptoms can return.
      </T>
    </Screen>
  );
}
