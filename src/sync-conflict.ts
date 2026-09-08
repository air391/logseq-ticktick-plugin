import { Task } from './ticktick/task';
import { localStateToRemoteTask, parseLocalTaskState } from './task-state';

export interface ManagedChecklistItemSnapshot {
  title: string;
  completed: boolean;
}

export interface ManagedTaskSnapshot {
  title: string;
  completed: boolean;
  priority: 0 | 1 | 3 | 5;
  startDate: string | null;
  dueDate: string | null;
  items: ManagedChecklistItemSnapshot[];
}

export type SyncDecision =
  | 'unchanged'
  | 'pull-remote'
  | 'keep-local'
  | 'converged'
  | 'conflict';

const normalizedDate = (value?: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

export const snapshotFromLocalContent = (
  content: string,
  items: ManagedChecklistItemSnapshot[] = [],
): ManagedTaskSnapshot => {
  const local = parseLocalTaskState(content);
  const remoteShape = localStateToRemoteTask(local);
  return {
    title: local.title,
    completed: local.marker === 'DONE',
    priority: local.priority,
    startDate: normalizedDate(remoteShape.startDate),
    dueDate: normalizedDate(remoteShape.dueDate),
    items,
  };
};

export const snapshotFromRemoteTask = (task: Task): ManagedTaskSnapshot => ({
  title: task.title || '',
  completed: task.status === 1 || Boolean(task.completedTime),
  priority: task.priority || 0,
  startDate: normalizedDate(task.startDate),
  dueDate: normalizedDate(task.dueDate),
  items: (task.items || []).map((item) => ({
    title: item.title || '',
    completed: item.status === 1 || Boolean(item.completedTime),
  })),
});

export const serializeSnapshot = (snapshot: ManagedTaskSnapshot): string =>
  JSON.stringify(snapshot);

export const parseSnapshot = (value: string | undefined): ManagedTaskSnapshot | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ManagedTaskSnapshot>;
    if (typeof parsed.title !== 'string' || typeof parsed.completed !== 'boolean') return null;
    return {
      title: parsed.title,
      completed: parsed.completed,
      priority: parsed.priority === 1 || parsed.priority === 3 || parsed.priority === 5 ? parsed.priority : 0,
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : null,
      dueDate: typeof parsed.dueDate === 'string' ? parsed.dueDate : null,
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter((item): item is ManagedChecklistItemSnapshot =>
              Boolean(item) && typeof item.title === 'string' && typeof item.completed === 'boolean',
            )
            .map((item) => ({ title: item.title, completed: item.completed }))
        : [],
    };
  } catch {
    return null;
  }
};

const equal = (a: ManagedTaskSnapshot, b: ManagedTaskSnapshot): boolean =>
  serializeSnapshot(a) === serializeSnapshot(b);

export const classifySyncState = (
  baseline: ManagedTaskSnapshot | null,
  local: ManagedTaskSnapshot,
  remote: ManagedTaskSnapshot,
): SyncDecision => {
  if (equal(local, remote)) return baseline && equal(local, baseline) ? 'unchanged' : 'converged';
  if (!baseline) return 'conflict';

  const localChanged = !equal(local, baseline);
  const remoteChanged = !equal(remote, baseline);

  if (!localChanged && remoteChanged) return 'pull-remote';
  if (localChanged && !remoteChanged) return 'keep-local';
  if (!localChanged && !remoteChanged) return 'unchanged';
  return 'conflict';
};
