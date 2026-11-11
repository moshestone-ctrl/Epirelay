import { AlertMap } from '@/components/AlertMap';
import { Screen, T } from '@/components/ui';

// Sample data for the automated build check (the emulator opens epirelay://map-check to make sure the map
// draws before a build is published). Not linked from anywhere in the app.
const C = { latitude: 40.7484, longitude: -73.9857 };

export default function MapCheck() {
  return (
    <Screen>
      <T kind="muted">Sample SOS map (for testing)</T>
      <AlertMap
        radiusM={3000}
        points={[
          { id: 'you', ...C, title: 'You', kind: 'patient' },
          { id: 'a', latitude: C.latitude + 0.006, longitude: C.longitude - 0.004, title: 'Bea', subtitle: '0.5 mi', kind: 'responder' },
          { id: 'b', latitude: C.latitude - 0.009, longitude: C.longitude + 0.007, title: 'Marcus', subtitle: '0.7 mi', kind: 'responder' },
        ]}
      />
      <T kind="small">Map check</T>
    </Screen>
  );
}
