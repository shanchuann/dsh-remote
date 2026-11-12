import { ThinkingState } from "./beautiful/thinking-state";

export function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  return <ThinkingState reasoning={reasoning} active={streaming} />;
}
