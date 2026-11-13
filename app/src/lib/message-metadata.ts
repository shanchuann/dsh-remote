/** Compact display of recorded usage; input + output is used only when both exist. */
export function messageUsageLabel(usage?: Record<string, number>): string {
  const count = usage?.totalTokens ?? (usage?.inputTokens !== undefined && usage?.outputTokens !== undefined ? usage.inputTokens + usage.outputTokens : undefined);
  if (count === undefined || !Number.isSafeInteger(count) || count < 0) return '用量未记录';
  const scale = count >= 1_000_000 ? 1_000_000 : count >= 1_000 ? 1_000 : 1;
  const unit = scale === 1_000_000 ? 'M' : scale === 1_000 ? 'K' : '';
  return '用量 ' + (count / scale).toLocaleString('en-US', { maximumFractionDigits: scale === 1 ? 0 : 1 }) + unit + ' tok';
}

export function messageTimeLabel(time: number): string | undefined {
  if (!Number.isFinite(time) || time <= 0) return undefined;
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
