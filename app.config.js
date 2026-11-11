// App configuration. Values in CAPS come from the build environment (GitHub Actions secrets) and are optional.
//
//   GOOGLE_MAPS_ANDROID_API_KEY  – turns on the live map on Android (without it, the app shows distances
//                                  and a "Open in Google Maps" button instead of an in-app map)
//   APP_VERSION_CODE             – set automatically by the GitHub build so each new APK installs over the last
//
// The backend address and key live in the .env file (EXPO_PUBLIC_SUPABASE_*).

const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || '';
const versionCode = Number(process.env.APP_VERSION_CODE || 1);

module.exports = {
  expo: {
    name: 'EpiRelay',
    slug: 'epi-relay',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'epirelay',
    userInterfaceStyle: 'automatic',
    platforms: ['ios', 'android'],
    ios: {
      bundleIdentifier: 'com.epirelay.app',
      supportsTablet: false,
    },
    android: {
      package: 'com.epirelay.app',
      versionCode,
      adaptiveIcon: {
        backgroundColor: '#D21F3C',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // Only what the app needs.
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            "EpiRelay uses your location to find people nearby who carry epinephrine when you send an SOS, and to match you with nearby emergencies when you're available to respond.",
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#D21F3C',
          defaultChannel: 'sos',
        },
      ],
      [
        'expo-splash-screen',
        {
          backgroundColor: '#D21F3C',
          image: './assets/images/splash-icon.png',
          imageWidth: 110,
        },
      ],
      ['react-native-maps', mapsKey ? { androidGoogleMapsApiKey: mapsKey } : {}],
    ],
    extra: {
      androidMapsEnabled: Boolean(mapsKey),
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
