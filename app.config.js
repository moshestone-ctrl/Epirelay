// App configuration. Values in CAPS come from the build environment (GitHub settings) and are optional.
//
//   GOOGLE_MAPS_ANDROID_API_KEY  – turns on the live map on Android (without it, the app shows distances
//                                  and a "Open in Google Maps" button instead of an in-app map)
//   EAS_PROJECT_ID               – your Expo project ID; turns on alerts that arrive while the app is closed
//                                  (together with google-services.json from Firebase, see README)
//   APP_VERSION_CODE             – set automatically by the GitHub build so each new APK installs over the last
//
// The backend address and key live in the .env file (EXPO_PUBLIC_SUPABASE_*).

const fs = require('fs');
const path = require('path');

const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || '';
const versionCode = Number(process.env.APP_VERSION_CODE || 1);
const easProjectId = process.env.EAS_PROJECT_ID || '';
const hasFirebaseConfig = fs.existsSync(path.join(process.cwd(), 'google-services.json'));

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
      ...(hasFirebaseConfig ? { googleServicesFile: './google-services.json' } : {}),
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
      'expo-task-manager',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            "EpiRelay uses your location to find people nearby who carry epinephrine when you send an SOS, and to match you with nearby emergencies when you're available to respond.",
          locationAlwaysAndWhenInUsePermission:
            "While you're marked Available, EpiRelay uses your location in the background so you can be matched with someone nearby who needs epinephrine. It is never shown to other people.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          isIosBackgroundLocationEnabled: true,
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
      [
        'expo-build-properties',
        {
          android: {
            // Code shrinking (R8) stripped a class Android's WorkManager needs at startup and the app
            // crashed on launch. Keep it off; the APK is a little bigger but starts reliably.
            enableMinifyInReleaseBuilds: false,
            enableShrinkResourcesInReleaseBuilds: false,
          },
        },
      ],
    ],
    extra: {
      androidMapsEnabled: Boolean(mapsKey),
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
