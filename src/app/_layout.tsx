import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { BackgroundServices } from '@/components/BackgroundServices';
import { Card, Loading, Screen, T } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { APP_NAME, TERMS_VERSION } from '@/lib/config';
import { isConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootStack />
    </AuthProvider>
  );
}

function RootStack() {
  const t = useTheme();
  const { session, profile, loading } = useAuth();

  if (!isConfigured) return <NotConfigured />;
  if (loading) return <Loading />;

  const signedIn = Boolean(session);
  const onboarded = signedIn && (profile?.accepted_terms_version ?? 0) >= TERMS_VERSION;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: t.bg },
        }}>
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded} redirectTo={signedIn ? '/' : '/sign-in'}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={onboarded} redirectTo={signedIn ? '/welcome' : '/sign-in'}>
          <Stack.Screen name="index" options={{ title: APP_NAME }} />
          <Stack.Screen name="profile" options={{ title: 'Your profile' }} />
          <Stack.Screen name="sos/[id]" options={{ title: 'SOS', gestureEnabled: false }} />
          <Stack.Screen name="respond/[id]" options={{ title: 'Someone needs help' }} />
          <Stack.Screen name="feedback/[id]" options={{ title: 'How did it go?' }} />
        </Stack.Protected>
        <Stack.Screen name="safety" options={{ title: 'Safety & legal' }} />
      </Stack>
      {onboarded && <BackgroundServices />}
    </View>
  );
}

function NotConfigured() {
  return (
    <Screen edges={['top', 'bottom']}>
      <T kind="title">{APP_NAME}</T>
      <Card tone="warn">
        <T kind="heading">This build isn’t connected to a server yet</T>
        <T>
          The Supabase Project URL and publishable key are missing from the{' '}
          <T style={{ fontWeight: '700' }}>.env</T> file. Add them and build the app again (or restart{' '}
          <T style={{ fontWeight: '700' }}>npx expo start</T> if you’re testing in Expo Go).
        </T>
        <T kind="small">README → Step 3 walks through this.</T>
      </Card>
    </Screen>
  );
}
