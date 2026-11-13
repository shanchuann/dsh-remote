import { useEffect, useState } from 'react';
import { Text, type TextProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotionPreference } from '../../../hooks/use-reduced-motion';

function StreamDelta({ text }: { text: string }) {
  const opacity = useSharedValue(0.45);
  useEffect(() => { opacity.value = withTiming(1, { duration: 220 }); }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.Text style={style}>{text}</Animated.Text>;
}

/** Resolve only the newest live delta; old prose never replays an animation. */
export function StreamingSpan({ text, streaming = false, ...props }: TextProps & { text: string; streaming?: boolean }) {
  // Completed spans need neither native accessibility subscriptions nor animation state.
  return streaming ? <LiveStreamingSpan text={text} {...props} /> : <Text {...props}>{text}</Text>;
}

function LiveStreamingSpan({ text, ...props }: TextProps & { text: string }) {
  const streaming = true;
  const reduce = useReducedMotionPreference();
  const [frame, setFrame] = useState({ text, streaming, prefix: streaming ? 0 : text.length, revision: 0 });
  if (text !== frame.text || streaming !== frame.streaming) {
    setFrame({ text, streaming, prefix: streaming && text.startsWith(frame.text) ? frame.text.length : text.length, revision: frame.revision + 1 });
  }
  if (!streaming || reduce || frame.prefix >= text.length) return <Text {...props}>{text}</Text>;
  return (
    <Text {...props}>
      {text.slice(0, frame.prefix)}
      <StreamDelta key={frame.revision} text={text.slice(frame.prefix)} />
    </Text>
  );
}
