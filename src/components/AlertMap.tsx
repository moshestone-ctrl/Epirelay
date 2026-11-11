import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { openDirections } from '@/lib/location';
import { radius, useTheme } from '@/lib/theme';

import { Button, T } from './ui';

export type MapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  kind: 'patient' | 'responder';
};

// Google Maps on Android needs an API key at build time (see app.config.js).
// Without one, opening a map would crash, so we show a simple card instead.
const mapsAvailable =
  Platform.OS !== 'android' || Boolean(Constants.expoConfig?.extra?.androidMapsEnabled);

/** Map with the person in need (red) and responders (blue). Zooms to fit everyone. */
export function AlertMap({ points, showsUserLocation }: { points: MapPoint[]; showsUserLocation?: boolean }) {
  if (!mapsAvailable) return <NoMap points={points} />;
  return <LiveMap points={points} showsUserLocation={showsUserLocation} />;
}

function NoMap({ points }: { points: MapPoint[] }) {
  const t = useTheme();
  const patient = points.find((p) => p.kind === 'patient');
  if (!patient) return null;
  return (
    <View style={[styles.fallback, { backgroundColor: t.card, borderColor: t.border }]}>
      <T kind="small">Live map isn’t set up in this test version.</T>
      <Button
        kind="secondary"
        title="Show location in Google Maps"
        onPress={() => openDirections(patient.latitude, patient.longitude)}
      />
    </View>
  );
}

function LiveMap({ points, showsUserLocation }: { points: MapPoint[]; showsUserLocation?: boolean }) {
  const t = useTheme();
  const map = useRef<MapView>(null);
  const fitKey = points.map((p) => `${p.id}:${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`).join('|');

  useEffect(() => {
    if (points.length > 1) {
      map.current?.fitToCoordinates(points, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }
    // Only refit when someone moves noticeably.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const first = points[0];
  if (!first) return null;

  return (
    <View style={[styles.wrap, { borderColor: t.border }]}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        showsUserLocation={showsUserLocation}
        initialRegion={{
          latitude: first.latitude,
          longitude: first.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}>
        {points.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            title={p.title}
            pinColor={p.kind === 'patient' ? t.danger : t.accent}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 240, borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  fallback: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
});
