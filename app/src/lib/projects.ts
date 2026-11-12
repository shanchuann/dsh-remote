import type { SessionListResponse, SessionRow, WorkspaceRow } from './types.ts';

/** Read every page so child tasks cannot crowd main conversations out of view. */
export async function readAllSessions(listPage: (cursor?: string) => Promise<SessionListResponse>): Promise<SessionRow[]> {
  return (await readSessionCatalog(listPage)).sessions;
}

export async function readSessionCatalog(listPage: (cursor?: string) => Promise<SessionListResponse>): Promise<{
  sessions: SessionRow[]; workspaces?: WorkspaceRow[];
}> {
  const rows = new Map<string, SessionRow>();
  const seen = new Set<string>();
  let workspaces: WorkspaceRow[] | undefined;
  let cursor: string | undefined;
  do {
    const page = await listPage(cursor);
    // Each catalog is complete, independent of the session page size.
    if (Array.isArray(page.workspaces)) workspaces = page.workspaces;
    for (const row of page.items ?? []) {
      if (typeof row?.sessionId === 'string') rows.set(row.sessionId, row);
    }
    cursor = page.nextCursor || undefined;
    if (cursor) {
      if (seen.has(cursor)) throw new Error('会话列表分页异常，请重试');
      seen.add(cursor);
    }
  } while (cursor);
  return { sessions: [...rows.values()], workspaces };
}

export interface SessionProject {
  id: string;
  name: string;
  cwd?: string;
  workspaceId?: string;
  sessions: SessionRow[];
}

export function isSubagentSession(row: SessionRow): boolean {
  const origin = row.origin;
  return Boolean(row.parentSessionId?.trim()) || origin === 'subagent' ||
    (typeof origin === 'object' && origin !== null && 'kind' in origin && origin.kind === 'subagent');
}

/** Windows paths compare without case; POSIX paths retain their case. */
function projectPath(cwd: string): string {
  const path = cwd.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return /^[a-z]:/i.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
}

export function groupSessionProjects(rows: readonly SessionRow[], workspaces?: readonly WorkspaceRow[]): SessionProject[] {
  const projects = new Map<string, SessionProject>();
  for (const workspace of workspaces ?? []) {
    const id = 'workspace:' + workspace.id;
    projects.set(id, {
      id, workspaceId: workspace.id, name: workspace.title?.trim() || projectName(workspace.path),
      cwd: workspace.path, sessions: [],
    });
  }
  for (const row of rows) {
    if (isSubagentSession(row)) continue;
    const authoritative = row.workspaceId !== undefined;
    const workspaceId = row.workspaceId || undefined;
    const cwd = authoritative ? (workspaceId ? row.workspacePath?.trim() || row.cwd?.trim() : undefined) : row.cwd?.trim() || undefined;
    const id = authoritative ? (workspaceId ? 'workspace:' + workspaceId : '') : (cwd ? projectPath(cwd) : '');
    let project = projects.get(id);
    if (!project) {
      const name = (workspaceId && row.workspaceTitle?.trim()) || cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd || (authoritative ? '未分组' : '未指定项目');
      project = { id, name, cwd, workspaceId, sessions: [] };
      projects.set(id, project);
    }
    project.sessions.push(row);
  }
  for (const project of projects.values()) {
    project.sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  // Keep desktop project order when its complete catalog is available.
  if (workspaces !== undefined) return [...projects.values()];
  return [...projects.values()].sort((a, b) =>
    (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0));
}

function projectName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

/** Follow parent links, including nested agents, without leaking other projects. */
export function sessionSubagents(rows: readonly SessionRow[], sessionId?: string): SessionRow[] {
  if (!sessionId) return [];
  const related = new Set([sessionId]);
  const result = new Map<string, SessionRow>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (related.has(row.sessionId) || !row.parentSessionId || !related.has(row.parentSessionId)) continue;
      related.add(row.sessionId);
      result.set(row.sessionId, row);
      changed = true;
    }
  }
  return [...result.values()].sort((a, b) => Number(Boolean(b.running)) - Number(Boolean(a.running)) ||
    (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
