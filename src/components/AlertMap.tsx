import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
  type CameraRef,
  type LngLatBounds,
} from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius as radii, useTheme } from '@/lib/theme';

export type MapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  /** Shown after the title, e.g. "0.3 mi". */
  subtitle?: string;
  kind: 'patient' | 'responder';
};

/**
 * Free, open map tiles (OpenFreeMap / OpenStreetMap): no API key or account needed.
 * Attribution is shown in the corner of the map, as the licence requires.
 */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const PADDING = { top: 56, right: 40, bottom: 40, left: 40 };

/** Circle around a point as a GeoJSON polygon (for the SOS search area). */
function circle(lat: number, lng: number, radiusM: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

function boundsOf(points: MapPoint[], area?: { lat: number; lng: number; radiusM: number }): LngLatBounds {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  if (area) {
    const dLat = area.radiusM / 111320;
    const dLng = area.radiusM / (111320 * Math.max(Math.cos((area.lat * Math.PI) / 180), 0.01));
    lats.push(area.lat - dLat, area.lat + dLat);
    lngs.push(area.lng - dLng, area.lng + dLng);
  }
  let [w, s, e, n] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  // Keep a sensible minimum span (~300 m) so a single point isn't zoomed in to street level.
  const minSpan = 0.003;
  if (n - s < minSpan) [s, n] = [(s + n) / 2 - minSpan / 2, (s + n) / 2 + minSpan / 2];
  if (e - w < minSpan) [w, e] = [(w + e) / 2 - minSpan / 2, (w + e) / 2 + minSpan / 2];
  return [w, s, e, n];
}

/**
 * Live map for an SOS: the person in need (red), responders on their way (blue) with their
 * distance, lines between them, and optionally the search area.
 * The view zooms to fit everyone and follows as responders move.
 */
export function AlertMap({
  points,
  radiusM,
  height = 300,
}: {
  points: MapPoint[];
  /** Draws the SOS search area around the person in need. */
  radiusM?: number;
  height?: number;
  /** Kept for compatibility; the map shows your own position as a labelled marker instead. */
  showsUserLocation?: boolean;
}) {
  const t = useTheme();
  const camera = useRef<CameraRef>(null);
  const patient = points.find((p) => p.kind === 'patient');
  const others = points.filter((p) => p.kind !== 'patient');

  // Show the whole search area until someone is on the way, then zoom to the people.
  const bounds = useMemo(() => {
    const p = points.find((x) => x.kind === 'patient');
    const onlyPatient = points.every((x) => x.kind === 'patient');
    const area = p && radiusM && onlyPatient ? { lat: p.latitude, lng: p.longitude, radiusM } : undefined;
    return boundsOf(points, area);
  }, [points, radiusM]);
  const boundsKey = bounds.map((n) => n.toFixed(4)).join(',');

  useEffect(() => {
    camera.current?.fitBounds(bounds, { padding: PADDING, duration: 700 });
    // Refit only when the area changes noticeably.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  const areaShape = useMemo(
    () => (patient && radiusM ? circle(patient.latitude, patient.longitude, radiusM) : null),
    [patient, radiusM],
  );
  const lines = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(
    () => ({
      type: 'FeatureCollection',
      features: patient
        ? others.map((o) => ({
            type: 'Feature',
            properties: { id: o.id },
            geometry: {
              type: 'LineString',
              coordinates: [
                [o.longitude, o.latitude],
                [patient.longitude, patient.latitude],
              ],
            },
          }))
        : [],
    }),
    [patient, others],
  );

  if (points.length === 0) return null;

  return (
    <View style={[styles.wrap, { height, borderColor: t.border, backgroundColor: t.cardAlt }]}>
      <MapLibreMap
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        attribution
        attributionPosition={{ bottom: 6, right: 6 }}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}>
        <Camera ref={camera} initialViewState={{ bounds, padding: PADDING }} />

        {areaShape && (
          <GeoJSONSource id="sos-area" data={areaShape}>
            <Layer id="sos-area-fill" type="fill" paint={{ 'fill-color': t.danger, 'fill-opacity': 0.08 }} />
            <Layer
              id="sos-area-line"
              type="line"
              paint={{ 'line-color': t.danger, 'line-opacity': 0.5, 'line-width': 1.5 }}
            />
          </GeoJSONSource>
        )}

        {lines.features.length > 0 && (
          <GeoJSONSource id="routes" data={lines}>
            <Layer
              id="routes-line"
              type="line"
              layout={{ 'line-cap': 'round' }}
              paint={{ 'line-color': t.accent, 'line-width': 3, 'line-opacity': 0.55 }}
            />
          </GeoJSONSource>
        )}

        {points.map((p) => {
          const color = p.kind === 'patient' ? t.danger : t.accent;
          return (
            <Marker key={p.id} id={`pt-${p.id}`} lngLat={[p.longitude, p.latitude]} anchor="bottom">
              <View style={styles.marker} accessible accessibilityLabel={`${p.title}${p.subtitle ? `, ${p.subtitle}` : ''}`}>
                <View style={[styles.label, { backgroundColor: color }]}>
                  <Text style={styles.labelText} numberOfLines={1}>
                    {p.title}
                    {p.subtitle ? ` · ${p.subtitle}` : ''}
                  </Text>
                </View>
                <View style={[styles.stem, { backgroundColor: color }]} />
                <View style={[styles.dot, { backgroundColor: color }]} />
              </View>
            </Marker>
          );
        })}
      </MapLibreMap>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radii.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  marker: { alignItems: 'center' },
  label: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    maxWidth: 200,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  labelText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  stem: { width: 2, height: 8 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#FFFFFF' },
});
