import type { TranscriptItem } from "../../lib/transcript";
import { ToolChips } from "./beautiful/tool-chips";

export type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

export function ToolCallCard({ item }: { item: ToolItem }) {
  return <ToolChips items={[item]} />;
}
