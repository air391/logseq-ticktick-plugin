import { Task } from './ticktick/task';
import { localStateToRemoteTask, parseLocalTaskState } from './task-state';

export interface ManagedTaskSnapshot {
  title: string;
  completed: boolean;
  priority: 0 | 1 | 3 | 5;
  startDate: string | null;
  dueDate: string | null;
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

export const snapshotFromLocalContent = (content: string): ManagedTaskSnapshot => {
  const local = parseLocalTaskState(content);
  const remoteShape = localStateToRemoteTask(local);
  return {
    title: local.title,
    completed: local.marker === 'DONE',
    priority: local.priority,
    startDate: normalizedDate(remoteShape.startDate),
    dueDate: normalizedDate(remoteShape.dueDate),
  };
};

export const snapshotFromRemoteTask = (task: Task): ManagedTaskSnapshot => ({
  title: task.title || '',
  completed: task.status === 1 || Boolean(task.completedTime),
  priority: task.priority || 0,
  startDate: normalizedDate(task.startDate),
  dueDate: normalizedDate(task.dueDate),
});

export const serializeSnapshot = (snapshot: ManagedTaskSnapshot): string =>
  JSON.stringify(snapshot);

export const parseSnapshot = (value: string | undefined): ManagedTaskSnapshot | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ManagedTaskSnapshot;
    if (typeof parsed.title !== 'string' || typeof parsed.completed !== 'boolean') return null;
    return parsed;
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
