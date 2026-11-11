/* eslint-disable import/namespace -- enums below are re-exported via `export *`; they exist at runtime */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// Show alerts as banners with sound even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const SOS_CHANNEL = 'sos';
const REMINDER_CHANNEL = 'reminders';

async function setupAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(SOS_CHANNEL, {
    name: 'Emergency alerts',
    description: 'Someone nearby needs epinephrine',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 600, 300, 600, 300, 600],
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Reminders',
    description: 'Expiration reminders for your epinephrine',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  await setupAndroidChannels(); // must exist before asking on Android 13+
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export type PushSetupResult = 'ok' | 'simulator' | 'expo_go_android' | 'no_project_id' | 'denied' | 'error';

/**
 * Registers this phone for alerts that arrive while the app is closed.
 * Needs a real device and an EAS project ID (see README → "Alerts when the app is closed").
 * Without it the app still works, but alerts only arrive while it's open.
 */
export async function registerPushToken(userId: string): Promise<PushSetupResult> {
  if (!Device.isDevice) return 'simulator';
  const granted = await ensureNotificationPermission();
  if (!granted) return 'denied';
  // Expo Go on Android can't receive remote push (it can still show in-app alerts).
  if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return 'expo_go_android';
  }
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return 'no_project_id';
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
    return error ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}

/** Immediate local alert (sound + banner) — used when an SOS arrives while the app is open. */
export async function alertNow(title: string, body: string, data: Record<string, unknown>) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: 'default' },
    trigger: Platform.OS === 'android' ? { channelId: SOS_CHANNEL } : null,
  });
}

/** Reminders 30 days, 7 days and on the day the user's epinephrine expires (10am local). */
export async function scheduleExpiryReminders(expiresOn: string | null) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.content.data?.kind === 'expiry')
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return;
  if (!(await ensureNotificationPermission())) return;

  const [y, m, d] = expiresOn.split('-').map(Number);
  const reminders = [
    { days: 30, body: 'Your epinephrine expires in 30 days. Time to ask for a refill.' },
    { days: 7, body: 'Your epinephrine expires in a week. Replace it soon so you can keep responding.' },
    { days: 0, body: 'Your epinephrine expires today. You won’t receive SOS alerts until you update it.' },
  ];
  for (const r of reminders) {
    const when = new Date(y, m - 1, d - r.days, 10, 0, 0);
    if (when.getTime() <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Epinephrine expiration', body: r.body, data: { kind: 'expiry' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: REMINDER_CHANNEL,
      },
    });
  }
}
