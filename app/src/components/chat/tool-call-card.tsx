import { useMemo } from "react";
import { View } from "react-native";

import { CodeBlock } from "../code-block";
import { ToolResult, ToolResultOutput } from "../tool-result";
import { ThinkingShimmer } from "../loading-states";
import type { TranscriptItem } from "../../lib/transcript";
import {
  formatClock,
  summarize,
  toolCode,
  toolKind,
  toolLabel,
  toolTarget,
} from "./format";

export type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

/**
 * One tool run: the command (or arguments) as code above the output, with the
 * output scrolling inside a capped card and folding away once the run ends.
 */
export function ToolCallCard({ item }: { item: ToolItem }) {
  const code = useMemo(() => toolCode(item.name, item.input), [item.name, item.input]);
  const target = toolTarget(item.name, item.input);
  const running = item.status === "running";
  const status = running ? "running" : item.status === "error" ? "error" : "success";
  const output = item.result ?? "";
  const hasCode = code !== undefined && code.code.trim().length > 0;
  const meta = target
    ? summarize(target, 56)
    : item.time > 0
      ? formatClock(item.time)
      : undefined;

  return (
    <View className="w-full px-4 py-1">
      <ToolResult
        tool={item.name}
        title={toolLabel(item.name)}
        meta={meta}
        kind={toolKind(item.name)}
        status={status}
        defaultOpen={running || item.status === "error"}
        collapseOnComplete={item.status !== "error"}
        maxHeight={240}
      >
        {hasCode ? (
          <CodeBlock
            code={code.code}
            language={code.language}
            status={running ? "streaming" : "complete"}
            showLineNumbers={code.code.split("\n").length > 3}
            maxHeight={220}
            className="mb-0"
          />
        ) : null}
        {output ? (
          <ToolResultOutput className={hasCode ? "mt-2" : ""}>
            {output}
          </ToolResultOutput>
        ) : running ? (
          <ThinkingShimmer className="text-xs text-muted">
            {toolLabel(item.name) + "…"}
          </ThinkingShimmer>
        ) : (
          <ToolResultOutput className="text-muted">（无输出）</ToolResultOutput>
        )}
      </ToolResult>
    </View>
  );
}
