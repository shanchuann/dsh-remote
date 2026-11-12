import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useResolveClassNames } from 'uniwind';

import { useReducedMotionPreference } from '../../hooks/use-reduced-motion';

const SweepContext = createContext<SharedValue<number> | null>(null);

/** One soft sweep shared by every placeholder, respecting reduced motion. */
export function SkeletonGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  const progress = useSharedValue(-1);
  const reduce = useReducedMotionPreference();
  useEffect(() => {
    if (reduce) {
      progress.value = -1;
      return;
    }
    progress.value = withRepeat(withDelay(300, withTiming(2, { duration: 1500, easing: Easing.inOut(Easing.quad) })), -1, false);
    return () => cancelAnimation(progress);
  }, [progress, reduce]);
  return (
    <SweepContext.Provider value={progress}>
      <View className={className} accessibilityLabel="正在读取内容" accessibilityState={{ busy: true }}>
        {children}
      </View>
    </SweepContext.Provider>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  const progress = useContext(SweepContext);
  const width = useSharedValue(0);
  const { color } = useResolveClassNames('text-foreground');
  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress?.value ?? -1) * width.value }],
  }));
  return (
    <View className={'overflow-hidden rounded-md bg-border ' + className} onLayout={(event) => { width.value = event.nativeEvent.layout.width; }}>
      <Animated.View className="absolute inset-y-0 w-1/2" style={sweep}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="sweep" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0" stopColor={typeof color === 'string' ? color : '#8b8f9a'} stopOpacity={0} />
              <Stop offset="0.5" stopColor={typeof color === 'string' ? color : '#8b8f9a'} stopOpacity={0.06} />
              <Stop offset="1" stopColor={typeof color === 'string' ? color : '#8b8f9a'} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#sweep)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
