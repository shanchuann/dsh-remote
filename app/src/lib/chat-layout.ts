/** Reserve readable message space while allowing short boards to size to content. */
export function taskPanelMaxHeight(viewport: number, header: number, controls: number): number {
  const available = Math.max(0, viewport - header - controls);
  return Math.max(48, Math.min(400, available * 0.5, available - 96));
}
