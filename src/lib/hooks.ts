import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from './api';
import { ALERT_POLL_MS } from './config';
import { supabase } from './supabase';
import type { AlertView } from './types';

type ChangeSpec = { table: string; filter?: string; event?: 'INSERT' | 'UPDATE' | '*' };

/** Calls `onChange` whenever a matching row changes in the database (Supabase Realtime). */
export function useRealtime(key: string, specs: ChangeSpec[], onChange: () => void, enabled = true) {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  const specsKey = JSON.stringify(specs);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel(`${key}:${Math.random().toString(36).slice(2)}`);
    for (const s of JSON.parse(specsKey) as ChangeSpec[]) {
      channel.on(
        'postgres_changes' as never,
        { event: s.event ?? '*', schema: 'public', table: s.table, filter: s.filter },
        () => callback.current(),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [key, specsKey, enabled]);
}

/** Runs `fn` every `ms` while the app is in the foreground. */
export function useInterval(fn: () => void, ms: number, enabled = true) {
  const callback = useRef(fn);
  useEffect(() => {
    callback.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => callback.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        callback.current();
        start();
      } else stop();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [ms, enabled]);
}

/** Live view of one alert: instant updates plus a polling safety net. */
export function useAlert(alertId: string) {
  const [view, setView] = useState<AlertView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await api.getAlert(alertId);
      setView(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [alertId]);

  useEffect(() => {
    let ignore = false;
    api.getAlert(alertId).then(
      (v) => {
        if (ignore) return;
        setView(v);
        setLoaded(true);
      },
      (e) => {
        if (ignore) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      },
    );
    return () => {
      ignore = true;
    };
  }, [alertId]);

  const active = view?.alert.status === 'active';
  useInterval(refresh, ALERT_POLL_MS, !loaded || active);
  useRealtime(
    `alert-${alertId}`,
    [
      { table: 'alerts', filter: `id=eq.${alertId}` },
      { table: 'alert_recipients', filter: `alert_id=eq.${alertId}` },
    ],
    refresh,
    active,
  );

  return { view, loaded, error, refresh };
}
