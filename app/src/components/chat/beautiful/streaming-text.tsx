/** Native BeautifulUI StreamingText: real deltas, markdown and usable share. */
import { useMemo } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';
import { CodeBlock } from '../../code-block';
import { MarkdownText } from '../markdown';
import { splitFencedCode } from '../format';
import { ShareIcon } from '../../common/icons';

export function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  const segments = useMemo(() => splitFencedCode(text), [text]);
  const { color } = useResolveClassNames('text-muted');
  return (
    <View className="gap-2">
      {segments.map((segment, index) => segment.kind === 'code' ? (
        <CodeBlock key={'code-' + index} code={segment.code} language={segment.language} status={streaming && !segment.closed ? 'streaming' : 'complete'}
          maxHeight={280} showLineNumbers={segment.code.split('\n').length > 2} />
      ) : (
        <MarkdownText key={'text-' + index} text={segment.text} streaming={streaming && index === segments.length - 1} />
      ))}
      {streaming ? <View className="h-3 w-0.5 rounded-full bg-foreground" /> : (
        <Pressable hitSlop={8} className="size-8 items-center justify-center self-start rounded-lg active:bg-surface" accessibilityRole="button" accessibilityLabel="分享回复"
          onPress={() => { void Share.share({ message: text }).catch(() => undefined); }}>
          <ShareIcon size={16} color={color} />
        </Pressable>
      )}
    </View>
  );
}
