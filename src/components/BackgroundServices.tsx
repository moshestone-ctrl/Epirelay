import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Vibration } from 'react-native';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hasAlwaysPermission, startBackgroundLocation, stopBackgroundLocation } from '@/lib/backgroundLocation';
import { LOCATION_HEARTBEAT_MS } from '@/lib/config';
import { useInterval, useRealtime } from '@/lib/hooks';
import { ensureLocationPermission, getCurrentCoords } from '@/lib/location';
import { alertNow, registerPushToken } from '@/lib/notifications';

/**
 * Invisible helpers that run while a signed-in user has the app open (or running in the background):
 *  • registers the phone for push alerts
 *  • keeps an available carrier's location fresh so they can be matched
 *    (in the background too, once "Allow all the time" is granted)
 *  • sounds an SOS the moment one arrives
 *  • opens the right screen when a notification is tapped (SOS, safety check-in, expiry reminder)
 */
export function BackgroundServices() {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  });

  // 1. Push registration (once per sign-in)
  useEffect(() => {
    if (userId) registerPushToken(userId).then((r) => console.log('[push]', r));
  }, [userId]);

  // 2. Location heartbeat for available carriers
  const isResponder = Boolean(profile?.carries_epinephrine && profile.available_to_respond);
  const heartbeat = async () => {
    try {
      if (!(await ensureLocationPermission())) return;
      const c = await getCurrentCoords();
      await api.updateMyLocation(c.latitude, c.longitude);
    } catch (e) {
      console.log('[heartbeat]', e);
    }
  };
  useEffect(() => {
    if (isResponder) heartbeat();
  }, [isResponder]);
  useInterval(heartbeat, LOCATION_HEARTBEAT_MS, isResponder);

  // 2b. Background updates: on while "Available" (if "Allow all the time" was granted), off otherwise.
  useEffect(() => {
    (async () => {
      if (isResponder) {
        if (await hasAlwaysPermission()) await startBackgroundLocation(false);
      } else {
        await stopBackgroundLocation();
      }
    })();
  }, [isResponder]);

  // 3. Live SOS invitations while the app is open
  useRealtime(
    'invitations',
    [{ table: 'alert_recipients', filter: `user_id=eq.${userId}`, event: 'INSERT' }],
    async () => {
      const mine = await api.myAlerts().catch(() => null);
      const fresh = mine?.invitations.find((i) => i.my_status === 'notified');
      if (!fresh) return;
      Vibration.vibrate([0, 600, 300, 600, 300, 600]);
      alertNow(
        (fresh.is_test ? '[TEST] ' : '') + 'Epinephrine needed nearby',
        'Someone close by needs epinephrine. Tap to respond.',
        { type: 'sos', alertId: fresh.alert_id },
      );
      if (!pathRef.current.startsWith('/sos') && !pathRef.current.startsWith('/respond')) {
        router.push(`/respond/${fresh.alert_id}`);
      }
    },
    Boolean(userId && isResponder),
  );

  // 4. Notification taps
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    const data = lastResponse.notification.request.content.data as
      | { type?: string; kind?: string; alertId?: string }
      | undefined;
    if (data?.alertId && (data.type === 'sos' || data.kind === 'safety')) router.push(`/respond/${data.alertId}`);
    else if (data?.alertId && data.type === 'sos_update') router.push(`/sos/${data.alertId}`);
    else if (data?.kind === 'expiry') router.push('/profile');
    Notifications.clearLastNotificationResponseAsync();
  }, [lastResponse]);

  return null;
}
