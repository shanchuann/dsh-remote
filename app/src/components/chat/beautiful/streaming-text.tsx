/** Native BeautifulUI StreamingText: real deltas and markdown. */
import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { CodeBlock } from '../../code-block';
import { MarkdownText } from '../markdown';
import { splitFencedCode } from '../format';

const StableCodeBlock = memo(CodeBlock);
const StableMarkdownText = memo(MarkdownText);

export function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  const segments = useMemo(() => splitFencedCode(text), [text]);
  return (
    <View className="gap-2">
      {segments.map((segment, index) => segment.kind === 'code' ? (
        <StableCodeBlock key={'code-' + index} code={segment.code} language={segment.language} status={streaming && !segment.closed ? 'streaming' : 'complete'}
          maxHeight={280} showLineNumbers={segment.code.split('\n').length > 2} />
      ) : (
        <StableMarkdownText key={'text-' + index} text={segment.text} streaming={streaming && index === segments.length - 1} />
      ))}
      {streaming ? <View className="h-3 w-0.5 rounded-full bg-foreground" /> : null}
    </View>
  );
}
