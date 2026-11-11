import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { supabase } from './supabase';

/**
 * Keeps an available responder's location fresh while EpiRelay is in the background, so they can be
 * matched to nearby emergencies. On Android this runs as a foreground service with a visible
 * "Ready to respond" notification, which also keeps the app alive to sound incoming SOS alerts.
 *
 * The task must be defined at startup (this file is imported by the root layout).
 */
export const RESPONDER_LOCATION_TASK = 'epirelay-responder-location';

const SEND_EVERY_MS = 2 * 60 * 1000;
let lastSentAt = 0;

type TaskData = { locations?: Location.LocationObject[] };

TaskManager.defineTask<TaskData>(RESPONDER_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  if (Date.now() - lastSentAt < SEND_EVERY_MS) return;
  const latest = data.locations[data.locations.length - 1];
  try {
    const { data: auth } = await supabase.auth.getSession(); // refreshes the login if needed
    if (!auth.session) {
      await stopBackgroundLocation();
      return;
    }
    lastSentAt = Date.now();
    await supabase.rpc('update_my_location', {
      p_lat: latest.coords.latitude,
      p_lng: latest.coords.longitude,
    });
  } catch {
    // Network hiccup: try again on the next update.
  }
});

export type BackgroundLocationResult = 'on' | 'needs_always' | 'denied' | 'error';

/** True if "Allow all the time" has already been granted. */
export async function hasAlwaysPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function isBackgroundLocationRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(RESPONDER_LOCATION_TASK);
  } catch {
    return false;
  }
}

/**
 * Asks for "Allow all the time" if needed (call only after explaining why), then starts updates.
 * On Android 11+ the system opens the location settings page where the person picks "Allow all the time".
 */
export async function startBackgroundLocation(askIfNeeded: boolean): Promise<BackgroundLocationResult> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) {
      if (!askIfNeeded || !(await Location.requestForegroundPermissionsAsync()).granted) return 'denied';
    }
    let bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted && askIfNeeded && bg.canAskAgain) bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) return 'needs_always';

    if (!(await isBackgroundLocationRunning())) {
      await Location.startLocationUpdatesAsync(RESPONDER_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5 * 60 * 1000,
        distanceInterval: 0,
        deferredUpdatesInterval: 5 * 60 * 1000,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: false,
        foregroundService: {
          notificationTitle: 'EpiRelay: ready to respond',
          notificationBody: 'You’ll be alerted if someone nearby needs epinephrine. Turn off “Available” in the app to stop.',
          notificationColor: '#D21F3C',
          killServiceOnDestroy: false,
        },
      });
    }
    return 'on';
  } catch (e) {
    console.log('[bg-location]', e);
    return 'error';
  }
}

export async function stopBackgroundLocation() {
  try {
    if (await isBackgroundLocationRunning()) await Location.stopLocationUpdatesAsync(RESPONDER_LOCATION_TASK);
  } catch {
    // Already stopped.
  }
}
