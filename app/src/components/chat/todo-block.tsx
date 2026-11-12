import type { TranscriptItem } from "../../lib/transcript";
import { TaskRows } from "./beautiful/task-rows";

export type TodoListItem = Extract<TranscriptItem, { kind: "todo" }>;

export function TodoBlock({ item }: { item: TodoListItem }) {
  return <TaskRows items={item.items} />;
}
