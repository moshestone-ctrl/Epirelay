import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { AlertMap } from '@/components/AlertMap';
import { ChatPanel } from '@/components/ChatPanel';
import { ReportPanel } from '@/components/ReportPanel';
import { Badge, Button, Card, Loading, Screen, T } from '@/components/ui';
import { api, errorMessage, type Result } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CHECKIN_MINUTES, EMERGENCY_NUMBER, RESPONDER_POSITION_MS } from '@/lib/config';
import { useAlert } from '@/lib/hooks';
import {
  callEmergency,
  clockTime,
  distanceMeters,
  ensureLocationPermission,
  formatDistance,
  getCurrentCoords,
  joinedText,
  openDirections,
  timeAgo,
} from '@/lib/location';
import { cancelSafetyCheckin, scheduleSafetyCheckin } from '@/lib/notifications';
import { space, useTheme } from '@/lib/theme';
import type { Coords } from '@/lib/types';

/** A carrier who was alerted: decide, go, hand over — with safety check-ins until they're back. */
export default function RespondScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { view, loaded, refresh } = useAlert(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<Coords | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastSent = useRef(0);

  const responderView = view?.role === 'responder' ? view : null;
  const safety = responderView?.safety;
  const going = responderView?.my_status === 'en_route' || responderView?.my_status === 'arrived';
  // Keep sharing your position until you say you're safe, so your emergency contact
  // can be told where you were if you stop answering.
  const sharePosition = Boolean(going && safety?.needs_confirmation);
  const dueAt = safety?.checkin_due_at ?? null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sharePosition) return;
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
  }, [sharePosition, id]);

  // Phone reminders for the next safety check-in.
  useEffect(() => {
    if (!loaded) return;
    if (dueAt) scheduleSafetyCheckin(id, dueAt).catch(() => {});
    else cancelSafetyCheckin(id).catch(() => {});
  }, [loaded, id, dueAt]);

  if (!loaded) return <Loading />;
  if (!responderView || !safety) {
    return (
      <Screen>
        <T>This alert isn’t available to you.</T>
        <Button title="Go home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const { alert, my_status: status, requester } = responderView;
  const active = alert.status === 'active';
  const hasContact = Boolean(profile?.emergency_contact_phone);

  const act = async (key: string, fn: () => Promise<Result>) => {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) {
        if (r.reason === 'verify_phone') {
          Alert.alert('Verify your phone first', 'To respond to alerts, verify your phone number. It takes about a minute.', [
            { text: 'Not now', style: 'cancel' },
            { text: 'Verify now', onPress: () => router.push('/verify-phone') },
          ]);
        } else {
          const msg =
            r.reason === 'enough_help'
              ? 'Enough people are already on the way. Thank you!'
              : r.reason === 'closed'
                ? 'This alert has already ended.'
                : r.reason === 'suspended'
                  ? 'Your account is on hold, so you can’t respond to alerts right now.'
                  : 'Something went wrong.';
          Alert.alert('Update', msg);
        }
      }
      await refresh();
      return r;
    } catch (e) {
      Alert.alert('Something went wrong', errorMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const accept = async () => {
    const r = await act('accept', () => api.respond(id, true));
    if (r?.ok && !hasContact) {
      Alert.alert(
        'Add an emergency contact',
        `We’ll check on you every ${CHECKIN_MINUTES} minutes while you help. If you don’t answer, we text your ` +
          'emergency contact where you are. Add someone now — it takes a few seconds.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Add now', onPress: () => router.push('/profile') },
        ],
      );
    }
  };
  const decline = async () => {
    await act('decline', () => api.respond(id, false));
    router.replace('/');
  };
  const arrived = () => act('arrived', () => api.setResponderStatus(id, 'arrived'));
  const withdraw = () =>
    Alert.alert('Can’t make it?', 'The person will be told so they can look for someone else.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'I can’t make it', style: 'destructive', onPress: () => act('withdraw', () => api.setResponderStatus(id, 'withdrawn')) },
    ]);
  const resolve = async () => {
    const r = await act('resolve', () => api.closeAlert(id, 'resolved'));
    if (r?.ok) router.replace(`/feedback/${id}`);
  };
  const checkIn = () => act('checkin', () => api.confirmResponderSafe(id, true));
  const safeLeft = async () => {
    const r = await act('safe', () => api.confirmResponderSafe(id, false));
    if (r?.ok) {
      cancelSafetyCheckin(id).catch(() => {});
      if (!active) router.replace(`/feedback/${id}`);
    }
  };

  const reportUnsafe = async (call911: boolean) => {
    if (call911) callEmergency();
    setBusy('unsafe');
    try {
      // Send the freshest position first, so the text to your contact shows where you are now.
      const c = await getCurrentCoords(4000).catch(() => myPos);
      if (c) await api.updateResponderPosition(id, c.latitude, c.longitude).catch(() => {});
      await api.responderUnsafe(id);
      cancelSafetyCheckin(id).catch(() => {});
      await refresh();
    } catch (e) {
      Alert.alert('Couldn’t reach EpiRelay', `${errorMessage(e)}\n\nIf you’re in danger, call ${EMERGENCY_NUMBER}.`, [
        { text: `Call ${EMERGENCY_NUMBER}`, style: 'destructive', onPress: callEmergency },
        { text: 'OK' },
      ]);
    } finally {
      setBusy(null);
    }
  };
  const unsafe = () =>
    Alert.alert(
      'Get somewhere safe',
      'Leave now and go somewhere public. We’ll stop your response, text your emergency contact where you are, ' +
        'and flag this SOS for review. The person who sent it won’t be told why you left.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Alert my contact', onPress: () => reportUnsafe(false) },
        { text: `Call ${EMERGENCY_NUMBER} + alert`, style: 'destructive', onPress: () => reportUnsafe(true) },
      ],
    );

  const target = alert.lat !== null && alert.lng !== null ? { latitude: alert.lat, longitude: alert.lng } : null;
  const liveDistance = target && myPos ? distanceMeters(myPos, target) : alert.distance_m;
  const overdue = dueAt !== null && new Date(dueAt).getTime() <= now;

  const safetyCard = (
    <Card tone={overdue ? 'danger' : undefined}>
      <T kind="label">Your safety</T>
      <T>
        {overdue
          ? 'Check-in overdue. Tap a button below, or we’ll text your emergency contact.'
          : dueAt
            ? `Next check-in by ${clockTime(dueAt)}. We’ll remind you.`
            : 'Let us know when you’re safe.'}
      </T>
      {!hasContact && (
        <View style={{ gap: space.sm }}>
          <T kind="small">You haven’t added an emergency contact, so nobody can be told if you don’t check in.</T>
          <Button kind="secondary" title="Add emergency contact" onPress={() => router.push('/profile')} />
        </View>
      )}
      {active && <Button kind="secondary" title="I’m OK — still here" onPress={checkIn} loading={busy === 'checkin'} />}
      <Button kind="primary" title="I’m safe — I’ve left" onPress={safeLeft} loading={busy === 'safe'} />
      <Button kind="danger" title="I feel unsafe" onPress={unsafe} loading={busy === 'unsafe'} />
    </Card>
  );

  // After "I feel unsafe"
  if (safety.felt_unsafe_at) {
    return (
      <Screen>
        <Card tone="danger">
          <T kind="heading">Get somewhere safe</T>
          <T>Your response has stopped and this SOS has been flagged for review.</T>
          <T>
            {!hasContact
              ? 'You don’t have an emergency contact saved — call someone you trust.'
              : safety.escalated_at
                ? 'We’ve texted your emergency contact where you are.'
                : 'We’re texting your emergency contact where you are now.'}
          </T>
          <T>If you’re in danger, call {EMERGENCY_NUMBER}.</T>
          <Button kind="danger" title={`Call ${EMERGENCY_NUMBER}`} onPress={callEmergency} />
        </Card>
        <Button kind="secondary" title="Go home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {alert.is_test && <Badge text="PRACTICE — TEST ONLY" tone="warn" />}
        {!active && <Badge text="ENDED" />}
      </View>

      {!active ? (
        <>
          <Card tone="ok">
            <T kind="heading">This alert has ended</T>
            <T>Thank you for being ready to help.</T>
            {(status === 'en_route' || status === 'arrived' || status === 'withdrawn') && !safety.needs_confirmation && (
              <Button title="Leave quick feedback" onPress={() => router.replace(`/feedback/${id}`)} />
            )}
            {!safety.needs_confirmation && <Button kind="secondary" title="Go home" onPress={() => router.replace('/')} />}
          </Card>
          {safety.needs_confirmation && safetyCard}
        </>
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

          <TrustCard
            now={now}
            phoneVerified={requester.phone_verified}
            memberSince={requester.member_since}
            pastResolved={requester.past_resolved}
          />

          <HandOverRules />

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
            <T>• You never have to go inside. Hand the device over at the door, or somewhere you can be seen.</T>
            <T>• The person — or someone with them — uses it, following the instructions printed on it.</T>
            <T>• Make sure someone has called {EMERGENCY_NUMBER}. If not, call now.</T>
            <T>• Stay nearby until paramedics arrive if you feel safe doing so. Symptoms can come back.</T>
            <Button kind="secondary" title={`Call ${EMERGENCY_NUMBER}`} onPress={callEmergency} />
          </Card>

          {safety.needs_confirmation && safetyCard}

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

/** What a responder can see about the person before deciding to go. */
function TrustCard({
  now,
  phoneVerified,
  memberSince,
  pastResolved,
}: {
  now: number;
  phoneVerified: boolean;
  memberSince: string;
  pastResolved: number;
}) {
  return (
    <Card>
      <T kind="label">About this request</T>
      <TrustRow good={phoneVerified} text={phoneVerified ? 'Phone number verified' : 'Phone number not verified'} />
      <TrustRow good={now - new Date(memberSince).getTime() > 7 * 86_400_000} text={joinedText(memberSince)} />
      <TrustRow
        good={pastResolved > 0}
        text={
          pastResolved > 0
            ? `${pastResolved} earlier ${pastResolved === 1 ? 'SOS' : 'SOS alerts'} ended with help arriving`
            : 'No earlier SOS alerts'
        }
      />
    </Card>
  );
}

function TrustRow({ good, text }: { good: boolean; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
      <T style={{ color: good ? t.ok : t.muted, fontWeight: '800', width: 18 }}>{good ? '✓' : '•'}</T>
      <T style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

function HandOverRules() {
  return (
    <Card tone="warn">
      <T kind="heading">Stay safe while you help</T>
      <T>• You never have to go inside. Hand the device over at the door, or ask to meet somewhere you can be seen.</T>
      <T>• We’ll check on you every {CHECKIN_MINUTES} minutes. If you don’t answer, we text your emergency contact.</T>
      <T>• If anything feels wrong, leave and tap “I feel unsafe”.</T>
    </Card>
  );
}
