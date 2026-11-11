import { useMemo } from "react";
import { View } from "react-native";

import { TodoList } from "../todo-list";
import type { TodoItem as BeUITodoItem } from "../todo-list";
import type { TranscriptItem } from "../../lib/transcript";

export type TodoListItem = Extract<TranscriptItem, { kind: "todo" }>;

/** An agent plan, rendered as beUI's checklist and folded when it completes. */
export function TodoBlock({ item }: { item: TodoListItem }) {
  const items = useMemo<BeUITodoItem[]>(
    () =>
      item.items.map((todo) => ({
        id: todo.id,
        title: todo.title,
        status: todo.status,
        ...(todo.progress === undefined ? {} : { progress: todo.progress }),
      })),
    [item.items],
  );
  const open = items.some((todo) => todo.status !== "completed");
  if (items.length === 0) return null;
  return (
    <View className="w-full px-4 py-1">
      <TodoList
        items={items}
        title="任务清单"
        defaultOpen={open}
        collapseOnComplete
        maxHeight={240}
      />
    </View>
  );
}
