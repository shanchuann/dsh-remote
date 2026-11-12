/** Native Reasoning variant of BeautifulUI ThinkingState, driven by SSE. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';
import Svg, { Path } from 'react-native-svg';
import { useReducedMotionPreference } from '../../../hooks/use-reduced-motion';
import { ChevronDownGlyph } from '../../../primitives/agent-icons';
import { Disclosure } from '../../../primitives/disclosure';
import { ThinkingShimmer } from '../../loading-states';

export function ThinkingState({ reasoning, active }: { reasoning: string; active: boolean }) {
  const [manualOpen, setManualOpen] = useState<boolean | undefined>();
  const open = manualOpen ?? active;
  const reduce = useReducedMotionPreference();
  const { color } = useResolveClassNames('text-muted');
  return (
    <View className="mb-2">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? '收起思考过程' : '展开思考过程'}
        onPress={() => setManualOpen(!open)} className="min-h-12 flex-row items-center gap-2 self-start rounded-lg pr-2 active:bg-surface">
        <Svg width={16} height={16} viewBox="0 0 24 24" fill={color}>
          <Path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </Svg>
        {active ? <ThinkingShimmer style={{ alignSelf: 'center' }} className="text-sm leading-5 text-muted">正在思考</ThinkingShimmer> : <Text className="text-sm font-medium leading-5 text-muted">思考过程</Text>}
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><ChevronDownGlyph size={14} color={color} /></View>
      </Pressable>
      <Disclosure open={open} reduce={reduce}>
        <View className="ml-2 border-l border-border-strong py-1 pl-4 pr-1">
          <Text selectable className="text-sm leading-[22px] text-muted">{reasoning}</Text>
        </View>
      </Disclosure>
    </View>
  );
}
