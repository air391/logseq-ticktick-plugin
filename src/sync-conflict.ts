import { Task } from './ticktick/task';
import { canonicalRemoteDate, localStateToRemoteTask, parseLocalTaskState } from './task-state';

export interface ManagedChecklistItemSnapshot {
  title: string;
  completed: boolean;
}

export interface ManagedTaskSnapshot {
  title: string;
  completed: boolean;
  priority: 0 | 1 | 3 | 5;
  // Retained in the serialized schema for backward compatibility. New snapshots
  // always store the single Dida-managed date in dueDate and leave startDate null.
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

const normalizedDate = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

const canonicalizeSnapshotDate = (snapshot: ManagedTaskSnapshot): ManagedTaskSnapshot => ({
  ...snapshot,
  startDate: null,
  dueDate: normalizedDate(snapshot.dueDate || snapshot.startDate),
});

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
    startDate: null,
    dueDate: normalizedDate(remoteShape.dueDate),
    items,
  };
};

export const snapshotFromRemoteTask = (task: Task): ManagedTaskSnapshot => ({
  title: task.title || '',
  completed: task.status === 1 || Boolean(task.completedTime),
  priority: task.priority || 0,
  startDate: null,
  dueDate: normalizedDate(canonicalRemoteDate(task)),
  items: (task.items || []).map((item) => ({
    title: item.title || '',
    completed: item.status === 1 || Boolean(item.completedTime),
  })),
});

export const serializeSnapshot = (snapshot: ManagedTaskSnapshot): string =>
  JSON.stringify(canonicalizeSnapshotDate(snapshot));

export const parseSnapshot = (value: string | undefined): ManagedTaskSnapshot | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ManagedTaskSnapshot>;
    if (typeof parsed.title !== 'string' || typeof parsed.completed !== 'boolean') return null;
    return canonicalizeSnapshotDate({
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
    });
  } catch {
    return null;
  }
};

const equal = (a: ManagedTaskSnapshot, b: ManagedTaskSnapshot): boolean =>
  serializeSnapshot(a) === serializeSnapshot(b);

const itemTitles = (snapshot: ManagedTaskSnapshot): string[] =>
  snapshot.items.map((item) => item.title);

const sameTitleMultiset = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  return [...a].sort().every((value, index) => value === [...b].sort()[index]);
};

const isPrefix = (prefix: string[], full: string[]): boolean =>
  prefix.length <= full.length && prefix.every((value, index) => value === full[index]);

const remoteChecklistChangeIsUnsafe = (
  baseline: ManagedTaskSnapshot,
  remote: ManagedTaskSnapshot,
): boolean => {
  const baselineTitles = itemTitles(baseline);
  const remoteTitles = itemTitles(remote);

  if (remoteTitles.length < baselineTitles.length) return true;
  if (remoteTitles.length > baselineTitles.length) {
    // Appending is deterministic with the current Logseq SDK. Inserting items in
    // the middle would shift positional identity and could attach local notes to
    // the wrong checklist item.
    return !isPrefix(baselineTitles, remoteTitles);
  }

  // A pure reorder cannot be distinguished safely from item identity because
  // Dida regenerates checklist item ids on every task update.
  const orderChanged = baselineTitles.some((value, index) => value !== remoteTitles[index]);
  return orderChanged && sameTitleMultiset(baselineTitles, remoteTitles);
};

export const classifySyncState = (
  baseline: ManagedTaskSnapshot | null,
  local: ManagedTaskSnapshot,
  remote: ManagedTaskSnapshot,
): SyncDecision => {
  if (equal(local, remote)) return baseline && equal(local, baseline) ? 'unchanged' : 'converged';
  if (!baseline) return 'conflict';

  const localChanged = !equal(local, baseline);
  const remoteChanged = !equal(remote, baseline);

  if (!localChanged && remoteChanged) {
    return remoteChecklistChangeIsUnsafe(baseline, remote) ? 'conflict' : 'pull-remote';
  }
  if (localChanged && !remoteChanged) {
    // Local checklist deletion is allowed only through an explicit manual push.
    // Automatic synchronization turns it into a conflict instead of deleting
    // remote checklist data silently.
    if (local.items.length < baseline.items.length) return 'conflict';
    return 'keep-local';
  }
  if (!localChanged && !remoteChanged) return 'unchanged';
  return 'conflict';
};
