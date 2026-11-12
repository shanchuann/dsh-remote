import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRemoteStore } from '../../lib/store';
import type { ChangedFile, WorkspaceChangeSummary, WorkspaceDiff } from '../../lib/types';
import { unifiedDiff } from '../../lib/session-files';
import { CodeBlock } from '../code-block';
import { useSessionFiles } from './session-files';

function FileDiff({ file, seq, index }: { file: ChangedFile; seq: number; index: number }) {
  const { sessionId, open } = useSessionFiles();
  const loadDiff = useRemoteStore(s => s.actions.loadDiff);
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<WorkspaceDiff>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!expanded || !sessionId) return;
    let active = true;
    void loadDiff(sessionId, seq, index).then(value => { if (active) setDiff(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [expanded, sessionId, seq, index, loadDiff]);
  const patch = diff && unifiedDiff(diff);
  return <View className="gap-2">
    <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityState={{ expanded }} className="min-h-12 flex-row items-center gap-2 py-2">
      <Text className="min-w-0 flex-1 font-mono text-xs text-foreground" numberOfLines={2}>{expanded ? '▾ ' : '▸ '}{file.display ?? file.path}</Text>
      <Text className="text-xs text-success">+{file.added}</Text><Text className="text-xs text-destructive">−{file.deleted}</Text>
    </Pressable>
    {expanded ? <View className="gap-2 pb-2">{patch ? <CodeBlock code={patch} language="diff" filename={file.display ?? file.path} /> : <Text className="text-xs text-muted">{error || (!diff ? '正在读取差异…' : diff.unavailable ? '此次改动快照已释放，无法还原当时的差异。' : diff.kind === 'binary' ? '二进制文件' : diff.kind === 'oversized' ? '文件过大，无法预览差异' : '没有可展示的文本差异')}</Text>}
      {diff?.coarse ? <Text className="text-xs text-muted">此文件使用简化差异展示。</Text> : null}
      <Pressable onPress={() => open(file.path)} accessibilityRole="button" className="min-h-11 justify-center"><Text className="text-xs text-primary">查看当前文件</Text></Pressable>
    </View> : null}
  </View>;
}
export function WorkspaceChanges({ seq }: { seq: number }) {
  const { sessionId } = useSessionFiles();
  const loadChanges = useRemoteStore(s => s.actions.loadChanges);
  const [summary, setSummary] = useState<WorkspaceChangeSummary>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    void loadChanges(sessionId, seq).then(s => { if (active) { setSummary(s); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [sessionId, seq, loadChanges, retry]);
  return <View className="mx-4 my-2 rounded-2xl border border-border bg-surface p-3">
    <Text className="text-sm font-medium text-foreground">文件改动{summary?.total !== undefined ? '（' + summary.total + '）' : ''}</Text>
    {summary?.files?.map((file, index) => <FileDiff key={file.path} file={file} seq={seq} index={index} />)}
    {error ? <Pressable onPress={() => { setError(''); setRetry(retry + 1); }} className="min-h-12 justify-center"><Text className="text-xs text-destructive">{error}，点按重试</Text></Pressable> : summary?.unavailable ? <Text className="py-2 text-xs leading-5 text-muted">此历史改动快照已在桌面释放，无法还原当时的文件差异。</Text> : !summary ? <Text className="py-2 text-xs text-muted">正在读取文件改动…</Text> : null}
  </View>;
}
