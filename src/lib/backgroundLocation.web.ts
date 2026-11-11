// Background location is phone-only; the web preview uses these no-ops.
export const RESPONDER_LOCATION_TASK = 'epirelay-responder-location';
export type BackgroundLocationResult = 'on' | 'needs_always' | 'denied' | 'error';
export async function hasAlwaysPermission() {
  return false;
}
export async function isBackgroundLocationRunning() {
  return false;
}
export async function startBackgroundLocation(_askIfNeeded: boolean): Promise<BackgroundLocationResult> {
  return 'error';
}
export async function stopBackgroundLocation() {}
