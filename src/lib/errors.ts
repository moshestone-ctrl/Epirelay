import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const appVersion = `${Constants.expoConfig?.version ?? '?'} (${Constants.expoConfig?.android?.versionCode ?? '?'})`;
let lastReport = '';

/**
 * Sends an error report to the app_errors table (visible in the Supabase "EpiRelay admin" notebook).
 * Only works when someone is signed in; never throws.
 */
export async function reportError(error: unknown, context: string) {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const key = `${context}:${err.message}`;
    if (key === lastReport) return; // don't flood with repeats
    lastReport = key;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.from('app_errors').insert({
      message: err.message.slice(0, 2000) || 'Unknown error',
      stack: err.stack?.slice(0, 8000) ?? null,
      context: context.slice(0, 200),
      platform: `${Platform.OS} ${Platform.Version}`.slice(0, 40),
      app_version: appVersion.slice(0, 40),
    });
  } catch {
    // Reporting must never cause another problem.
  }
}

let installed = false;

/** Catches errors that happen outside screen rendering (e.g. in a button handler) and reports them. */
export function installGlobalErrorReporting() {
  if (installed || Platform.OS === 'web' || typeof ErrorUtils === 'undefined') return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error, isFatal ? 'fatal' : 'uncaught').finally(() => previous(error, isFatal));
  });
}
