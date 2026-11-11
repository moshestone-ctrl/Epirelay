import { useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';

import { SOS_HOLD_MS } from '@/lib/config';
import { useTheme } from '@/lib/theme';

/**
 * Big round SOS button. Must be held for SOS_HOLD_MS so it can't be triggered by accident.
 * Screen-reader users can activate it with a double-tap (the "activate" action).
 */
export function HoldToSos({ onTrigger, busy }: { onTrigger: () => void; busy?: boolean }) {
  const t = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const [holding, setHolding] = useState(false);

  const start = () => {
    if (busy) return;
    setHolding(true);
    Vibration.vibrate(30);
    Animated.timing(progress, {
      toValue: 1,
      duration: SOS_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      setHolding(false);
      if (finished) {
        Vibration.vibrate([0, 120, 80, 120]);
        progress.setValue(0);
        onTrigger();
      }
    });
  };

  const cancel = () => {
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    setHolding(false);
  };

  const fillHeight = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="SOS. Alert nearby people who carry epinephrine"
        accessibilityHint="Press and hold for two seconds"
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && !busy && onTrigger()}
        onPressIn={start}
        onPressOut={cancel}
        style={[styles.button, { backgroundColor: t.danger, shadowColor: t.danger }]}>
        <Animated.View style={[styles.fill, { height: fillHeight }]} />
        {busy ? (
          <ActivityIndicator color={t.onDanger} size="large" />
        ) : (
          <>
            <Text style={[styles.sos, { color: t.onDanger }]}>SOS</Text>
            <Text style={[styles.hint, { color: t.onDanger }]}>{holding ? 'Keep holding…' : 'Hold 2 seconds'}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const SIZE = 210;
const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 8 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fill: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.28)' },
  sos: { fontSize: 54, fontWeight: '900', letterSpacing: 2 },
  hint: { fontSize: 15, fontWeight: '600', opacity: 0.9, marginTop: 2 },
});
