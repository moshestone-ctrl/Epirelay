import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from './supabase';
import type { Profile, ProfilePatch } from './types';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: ProfilePatch) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const fetchProfile = useCallback(async (id: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    return error ? undefined : (data as Profile | null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const p = await fetchProfile(userId);
    if (p !== undefined) setProfile(p);
    setProfileLoadedFor(userId);
  }, [userId, fetchProfile]);

  useEffect(() => {
    if (!userId) return;
    let ignore = false;
    fetchProfile(userId).then((p) => {
      if (ignore) return;
      if (p !== undefined) setProfile(p);
      setProfileLoadedFor(userId);
    });
    return () => {
      ignore = true;
    };
  }, [userId, fetchProfile]);

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single();
      if (error) throw new Error(error.message);
      setProfile(data as Profile);
    },
    [userId],
  );

  const loading = !sessionChecked || (userId !== null && profileLoadedFor !== userId);
  // Never expose a previous user's profile after switching accounts.
  const currentProfile = profile && profile.id === userId ? profile : null;

  return (
    <AuthContext.Provider value={{ session, profile: currentProfile, loading, refreshProfile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
