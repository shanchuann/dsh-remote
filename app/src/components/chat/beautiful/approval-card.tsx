/** BeautifulUI choice-card layout adapted to the host's allow/reject contract. */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AppButton } from '../../common/app-button';
import { LoadingState } from './loading-state';

export function ApprovalCard({ title, description, pendingCount, submitting, onAllow, onReject }: {
  title: string; description: string; pendingCount: number; submitting: boolean; onAllow: () => void; onReject: () => void;
}) {
  const [decision, setDecision] = useState<'allow' | 'reject' | null>(null);
  const choices = [{ value: 'allow' as const, label: '允许本次执行' }, { value: 'reject' as const, label: '拒绝执行' }];
  return (
    <View className="gap-4 rounded-2xl border border-border bg-surface p-4" accessibilityLabel="工具执行确认">
      <View className="gap-1.5">
        <Text className="text-base font-semibold leading-6 text-foreground">{title}</Text>
        <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
          <Text selectable className="text-sm leading-[22px] text-muted">{description}</Text>
        </ScrollView>
      </View>
      <View className="gap-1" accessibilityRole="radiogroup">
        {choices.map((choice) => {
          const selected = decision === choice.value;
          return (
            <Pressable key={choice.value} disabled={submitting} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: submitting }}
              onPress={() => setDecision(choice.value)} className={'min-h-12 flex-row items-center gap-3 rounded-xl px-3 py-2 ' + (selected ? 'bg-primary/10' : 'active:bg-background')}>
              <View className={'size-4 items-center justify-center rounded-full border ' + (selected ? 'border-primary bg-primary' : 'border-border-strong')}>
                {selected ? <View className="size-1.5 rounded-full bg-on-primary" /> : null}
              </View>
              <Text className="flex-1 text-sm leading-5 text-foreground">{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <View className="min-w-24 grow">
          {submitting ? <LoadingState showElapsed={false} label="正在提交" /> : <Text className="text-xs tabular-nums text-muted">{pendingCount > 1 ? '1 / ' + pendingCount : '等待确认'}</Text>}
        </View>
        <View className="min-w-32 grow">
          <AppButton className="min-h-12" size="md" disabled={decision === null || submitting} onPress={() => { if (decision === 'allow') onAllow(); else if (decision === 'reject') onReject(); }}>
            确认选择
          </AppButton>
        </View>
      </View>
    </View>
  );
}
