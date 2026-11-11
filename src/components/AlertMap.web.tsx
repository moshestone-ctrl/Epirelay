import { View } from 'react-native';

import { radius, useTheme } from '@/lib/theme';

import type { MapPoint } from './AlertMap';
import { T } from './ui';

/** Web preview only — the real map (react-native-maps) runs on phones. */
export function AlertMap({ points }: { points: MapPoint[]; showsUserLocation?: boolean }) {
  const t = useTheme();
  if (points.length === 0) return null;
  return (
    <View
      style={{
        height: 240,
        borderRadius: radius.md,
        backgroundColor: t.cardAlt,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}>
      <T kind="muted">Map (shows on phones)</T>
      {points.map((p) => (
        <T key={p.id} kind="small">
          {p.kind === 'patient' ? '🔴' : '🔵'} {p.title}
        </T>
      ))}
    </View>
  );
}
