import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import { EMERGENCY_NUMBER, USE_METRIC } from './config';
import type { Coords } from './types';

export async function ensureLocationPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted;
}

/** Best available position quickly: a fresh fix if we get one within a few seconds, else the last known. */
export async function getCurrentCoords(timeoutMs = 8000): Promise<Coords> {
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then(
    (p) => p.coords,
    () => null,
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const coords = await Promise.race([fresh, timeout]);
  if (coords) return { latitude: coords.latitude, longitude: coords.longitude };

  const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
  if (last) return { latitude: last.coords.latitude, longitude: last.coords.longitude };

  // Still waiting on GPS: give it a little longer before giving up.
  const late = await fresh;
  if (late) return { latitude: late.latitude, longitude: late.longitude };
  throw new Error('Could not get your location. Make sure Location Services are on.');
}

export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(m: number): string {
  if (USE_METRIC) {
    if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
    return `${(m / 1000).toFixed(1)} km`;
  }
  if (m < 160) return `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft`;
  return `${(m / 1609.344).toFixed(1)} mi`;
}

/** Opens turn-by-turn directions in Apple Maps (iOS) or Google Maps (Android). */
export function openDirections(lat: number, lng: number) {
  const url =
    Platform.OS === 'ios'
      ? `https://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return Linking.openURL(url);
}

export function callEmergency() {
  return Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
