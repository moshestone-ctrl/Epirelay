import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { AlertMap } from '@/components/AlertMap';
import { ChatPanel } from '@/components/ChatPanel';
import { ReportPanel } from '@/components/ReportPanel';
import { Badge, Button, Card, Loading, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { EMERGENCY_NUMBER, RESPONDER_POSITION_MS } from '@/lib/config';
import { useAlert } from '@/lib/hooks';
import { callEmergency, distanceMeters, ensureLocationPermission, formatDistance, openDirections, timeAgo } from '@/lib/location';
import { space } from '@/lib/theme';
import type { Coords } from '@/lib/types';

/** A carrier who was alerted: accept, navigate, hand over. */
export default function RespondScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { view, loaded, refresh } = useAlert(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<Coords | null>(null);
  const lastSent = useRef(0);

  const responderView = view?.role === 'responder' ? view : null;
  const onTheWay =
    responderView?.alert.status === 'active' &&
    (responderView.my_status === 'en_route' || responderView.my_status === 'arrived');

  // Share live position while on the way.
  useEffect(() => {
    if (!onTheWay) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      if (!(await ensureLocationPermission())) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: RESPONDER_POSITION_MS, distanceInterval: 15 },
        (p) => {
          const c = { latitude: p.coords.latitude, longitude: p.coords.longitude };
          setMyPos(c);
          if (Date.now() - lastSent.current >= RESPONDER_POSITION_MS - 500) {
            lastSent.current = Date.now();
            api.updateResponderPosition(id, c.latitude, c.longitude).catch(() => {});
          }
        },
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [onTheWay, id]);

  if (!loaded) return <Loading />;
  if (!responderView) {
    return (
      <Screen>
        <T>This alert isn’t available to you.</T>
        <Button title="Go home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const { alert, my_status: status, requester } = responderView;
  const active = alert.status === 'active';

  const act = async (key: string, fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) {
        const msg =
          r.reason === 'enough_help'
            ? 'Enough people are already on the way. Thank you!'
            : r.reason === 'closed'
              ? 'This alert has already ended.'
              : r.reason === 'suspended'
                ? 'Your account is suspended, so you can’t respond to alerts.'
                : 'Something went wrong.';
        Alert.alert('Update', msg);
      }
      await refresh();
    } catch (e) {
      Alert.alert('Something went wrong', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const accept = () => act('accept', () => api.respond(id, true));
  const decline = () =>
    act('decline', async () => {
      const r = await api.respond(id, false);
      router.replace('/');
      return r;
    });
  const arrived = () => act('arrived', () => api.setResponderStatus(id, 'arrived'));
  const withdraw = () =>
    Alert.alert('Can’t make it?', 'The person will be told so they can look for someone else.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'I can’t make it', style: 'destructive', onPress: () => act('withdraw', () => api.setResponderStatus(id, 'withdrawn')) },
    ]);
  const resolve = () =>
    act('resolve', async () => {
      const r = await api.closeAlert(id, 'resolved');
      router.replace(`/feedback/${id}`);
      return r;
    });

  const target = alert.lat !== null && alert.lng !== null ? { latitude: alert.lat, longitude: alert.lng } : null;
  const liveDistance = target && myPos ? distanceMeters(myPos, target) : alert.distance_m;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {alert.is_test && <Badge text="PRACTICE — TEST ONLY" tone="warn" />}
        {!active && <Badge text="ENDED" />}
      </View>

      {!active ? (
        <Card tone="ok">
          <T kind="heading">This alert has ended</T>
          <T>Thank you for being ready to help.</T>
          {(status === 'en_route' || status === 'arrived' || status === 'withdrawn') && (
            <Button title="Leave quick feedback" onPress={() => router.replace(`/feedback/${id}`)} />
          )}
          <Button kind="secondary" title="Go home" onPress={() => router.replace('/')} />
        </Card>
      ) : status === 'notified' || status === 'declined' || status === 'withdrawn' ? (
        <>
          <Card tone="danger">
            <T kind="heading">
              {requester.name} is about {formatDistance(alert.distance_m)} away and needs epinephrine
            </T>
            <T kind="small">Alert sent {timeAgo(alert.created_at)}</T>
            {responderView.en_route_count > 0 && (
              <T>
                {responderView.en_route_count} of {responderView.max_en_route} responders already on the way.
              </T>
            )}
          </Card>
          <T kind="muted">
            If you go, bring your epinephrine. You’ll see the exact location after you tap “I’m on my way”.
          </T>
          <Button kind="danger" title="I’m on my way" onPress={accept} loading={busy === 'accept'} />
          {status === 'notified' && (
            <Button kind="secondary" title="I can’t help right now" onPress={decline} loading={busy === 'decline'} />
          )}
        </>
      ) : (
        <>
          <Card>
            <T kind="label">{status === 'arrived' ? 'You’ve arrived' : 'You’re on the way'}</T>
            <T kind="heading">
              {requester.name} · {formatDistance(liveDistance)} away
            </T>
            {requester.allergies ? <T>Allergies: {requester.allergies}</T> : null}
            {target && (
              <Button title="Open directions" onPress={() => openDirections(target.latitude, target.longitude)} />
            )}
          </Card>

          {target && (
            <AlertMap
              points={[
                { id: 'patient', ...target, title: requester.name, kind: 'patient' },
                ...(myPos
                  ? [{ id: 'me', ...myPos, title: 'You', subtitle: formatDistance(liveDistance), kind: 'responder' as const }]
                  : []),
              ]}
            />
          )}

          <Card tone="warn">
            <T kind="heading">When you get there</T>
            <T>• Hand the device to the person, or someone with them, so they can use it — following the instructions printed on it.</T>
            <T>• Make sure someone has called {EMERGENCY_NUMBER}. If not, call now.</T>
            <T>• Stay until paramedics arrive if you can. Symptoms can come back.</T>
            <Button kind="secondary" title={`Call ${EMERGENCY_NUMBER}`} onPress={callEmergency} />
          </Card>

          <ChatPanel alertId={id} canSend nameFor={() => requester.name} placeholder="e.g. 2 minutes away" />

          {status === 'en_route' ? (
            <Button kind="primary" title="I’ve arrived" onPress={arrived} loading={busy === 'arrived'} />
          ) : (
            <Button kind="primary" title="Mark as resolved" onPress={resolve} loading={busy === 'resolve'} />
          )}
          <Button kind="ghost" title="I can’t make it" onPress={withdraw} loading={busy === 'withdraw'} />
        </>
      )}
      <ReportPanel alertId={id} />
    </Screen>
  );
}
