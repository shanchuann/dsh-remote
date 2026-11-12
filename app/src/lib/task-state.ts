/** Team tasks outlive individual turns; revisions prevent stale replay overwrites. */
export function mergeTeamTask(current: unknown[] = [], data: unknown): unknown[] {
  const task = data && typeof data === 'object' ? (data as { task?: Record<string, unknown> }).task : undefined;
  if (!task || typeof task.id !== 'string') return current;
  const index = current.findIndex(row => !!row && typeof row === 'object' && (row as { id?: unknown }).id === task.id);
  if (index < 0) return [...current, task];
  const old = current[index] as Record<string, unknown>;
  if (typeof old.revision === 'number' && typeof task.revision === 'number' && old.revision > task.revision) return current;
  return current.map((row, i) => i === index ? task : row);
}
export function teamTasksFromProjection(value: unknown): unknown[] {
  const tasks = value && typeof value === 'object' ? (value as { tasks?: unknown }).tasks : undefined;
  return Array.isArray(tasks) ? tasks : [];
}
