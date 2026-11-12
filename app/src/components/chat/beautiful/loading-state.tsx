/** Native adaptation of https://www.beautifului.dev/r/loading-state.json (Dots). */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { useReducedMotionPreference } from '../../../hooks/use-reduced-motion';

function Dot({ phase, delay, reduce }: { phase: SharedValue<number>; delay: number; reduce: boolean }) {
  const style = useAnimatedStyle(() => {
    const cycle = ((phase.value * 650 - delay) % 650 + 650) % 650 / 650;
    return { opacity: reduce ? 0.45 : 0.15 + Math.pow(1 - Math.abs(cycle * 2 - 1), 2) * 0.85 };
  });
  return <Animated.View className="size-1 rounded-full bg-foreground" style={style} />;
}

export function DotsGrid() {
  const reduce = useReducedMotionPreference();
  const phase = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    phase.value = withRepeat(withTiming(1, { duration: 650, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(phase);
  }, [phase, reduce]);
  return (
    <View className="gap-0.5" accessible={false}>
      {[0, 1, 2].map((row) => (
        <View key={row} className="flex-row gap-0.5">
          {[0, 1, 2].map((col) => <Dot key={col} phase={phase} delay={(col + Math.abs(row - 1)) * 90} reduce={reduce} />)}
        </View>
      ))}
    </View>
  );
}

/** Elapsed time measures this live wait, never a simulated model duration. */
export function LoadingState({ label, showElapsed = true }: { label?: string; showElapsed?: boolean }) {
  const [startedAt] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!showElapsed) return;
    const timer = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 250);
    return () => clearInterval(timer);
  }, [showElapsed, startedAt]);
  const seconds = elapsed / 1000;
  return (
    <View className="min-h-8 flex-row items-center gap-2.5" accessibilityLabel={label || '模型正在处理'} accessibilityState={{ busy: true }}>
      <DotsGrid />
      {label ? <Text className="text-[13px] font-medium text-muted">{label}</Text> : null}
      {showElapsed ? <Text className="text-xs tabular-nums text-muted">{seconds < 60 ? seconds.toFixed(1) + 's' : Math.floor(seconds / 60) + 'm ' + Math.floor(seconds % 60) + 's'}</Text> : null}
    </View>
  );
}
