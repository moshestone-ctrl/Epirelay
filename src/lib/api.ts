import { supabase } from './supabase';
import type { AlertView, MyAlerts } from './types';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

type Result = { ok: boolean; reason?: 'closed' | 'not_invited' | 'enough_help' | 'not_responding' | 'suspended' };

/** Thin wrappers around the database functions in supabase/schema.sql. */
export const api = {
  updateMyLocation: (lat: number, lng: number) =>
    rpc<void>('update_my_location', { p_lat: lat, p_lng: lng }),

  nearbyResponderCount: (lat: number, lng: number) =>
    rpc<number>('nearby_responder_count', { p_lat: lat, p_lng: lng }),

  createAlert: (lat: number, lng: number, isTest: boolean) =>
    rpc<{ alert_id: string; notified: number; existing: boolean }>('create_alert', {
      p_lat: lat,
      p_lng: lng,
      p_is_test: isTest,
    }),

  widenAlert: (alertId: string) =>
    rpc<Result & { notified_new?: number; notified_total?: number }>('widen_alert', { p_alert_id: alertId }),

  respond: (alertId: string, accept: boolean) =>
    rpc<Result>('respond_to_alert', { p_alert_id: alertId, p_accept: accept }),

  updateResponderPosition: (alertId: string, lat: number, lng: number) =>
    rpc<void>('update_responder_position', { p_alert_id: alertId, p_lat: lat, p_lng: lng }),

  setResponderStatus: (alertId: string, status: 'arrived' | 'withdrawn') =>
    rpc<Result>('set_responder_status', { p_alert_id: alertId, p_status: status }),

  closeAlert: (alertId: string, outcome: 'resolved' | 'cancelled') =>
    rpc<Result>('close_alert', { p_alert_id: alertId, p_outcome: outcome }),

  getAlert: (alertId: string) => rpc<AlertView | null>('get_alert', { p_alert_id: alertId }),

  reportAlert: (alertId: string, reason: 'fake' | 'no_one_there' | 'abusive' | 'other', note?: string) =>
    rpc<Result>('report_alert', { p_alert_id: alertId, p_reason: reason, p_note: note ?? null }),

  myAlerts: () => rpc<MyAlerts>('my_alerts'),

  deleteMyAccount: () => rpc<void>('delete_my_account'),
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
