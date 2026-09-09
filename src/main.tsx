import '@logseq/libs';
import './index.css';
import TickTick, { isTaskNotFoundError } from './ticktick/ticktick';
import { Subtask, Task } from './ticktick/task';
import { logseq as PackageLogseq } from '../package.json';
import { settingsSchema, getTickTickSettings } from './settings';
import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import {
  findBlockBoundToRemoteTask,
  getRemoteTaskMapping,
  getSyncBaseline,
  listRemoteTaskBindings,
  markSyncConflict,
  removeRemoteTaskMapping,
  saveRemoteTaskMapping,
  saveSyncBaseline,
} from './sync-state';
import { openTaskPicker, TaskChoice } from './task-picker';
import { refreshDidaInbox, removeInboxProjection } from './dida-inbox';
import {
  localStateToRemoteTask,
  parseLocalTaskState,
  remoteTaskToBlockContent,
} from './task-state';
import {
  classifySyncState,
  ManagedChecklistItemSnapshot,
  ManagedTaskSnapshot,
  snapshotFromLocalContent,
  snapshotFromRemoteTask,
} from './sync-conflict';
import { planChecklistApply } from './checklist-plan';

const pluginId = PackageLogseq.id;
const ticktick = new TickTick();
const REFRESH_INTERVAL_MS = 60_000;
const LOCAL_PUSH_DEBOUNCE_MS = 3_000;
const REMOTE_WRITE_SUPPRESSION_MS = 5_000;
const TASK_MARKER_RE = /^(TODO|DONE|DOING|NOW|LATER|WAITING)\s+/i;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;
let settingsOffHook: (() => void) | null = null;
let dbOffHook: (() => void) | null = null;
const localPushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const remoteWriteUntil = new Map<string, number>();

const cleanupRuntime = async (): Promise<void> => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  for (const timer of localPushTimers.values()) clearTimeout(timer);
  localPushTimers.clear();
  remoteWriteUntil.clear();
  refreshInFlight = false;
  settingsOffHook?.();
  settingsOffHook = null;
  dbOffHook?.();
  dbOffHook = null;
};

const suppressLocalPush = (uuid: string): void => {
  remoteWriteUntil.set(uuid, Date.now() + REMOTE_WRITE_SUPPRESSION_MS);
};

const localPushIsSuppressed = (uuid: string): boolean => {
  const until = remoteWriteUntil.get(uuid) || 0;
  if (until <= Date.now()) {
    remoteWriteUntil.delete(uuid);
    return false;
  }
  return true;
};

const getTreeContent = async (block: BlockEntity): Promise<BlockEntity | null> =>
  logseq.Editor.getBlock(block.uuid, { includeChildren: true });

const subtaskTitle = (content: string): string =>
  content
    .replace(TASK_MARKER_RE, '')
    .replace(/\[#([A-C])\]\s*/i, '')
    .split(/\r?\n/)[0]
    .trim();

const managedChecklistChildren = (block: BlockEntity): BlockEntity[] =>
  (block.children || [])
    .map((child) => child as BlockEntity)
    .filter((child) => TASK_MARKER_RE.test((child.content || '').split(/\r?\n/)[0] || ''));

const checklistSnapshotFromBlocks = (
  children: BlockEntity[],
): ManagedChecklistItemSnapshot[] =>
  children.map((child) => ({
    title: subtaskTitle(child.content || ''),
    completed: parseLocalTaskState(child.content || '').marker === 'DONE',
  }));

const snapshotFromLocalTree = (block: BlockEntity): ManagedTaskSnapshot =>
  snapshotFromLocalContent(
    block.content || '',
    checklistSnapshotFromBlocks(managedChecklistChildren(block)),
  );

const subtasksFromLocalTree = (block: BlockEntity): Subtask[] =>
  checklistSnapshotFromBlocks(managedChecklistChildren(block))
    .filter((item) => item.title.length > 0)
    .map((item) => ({
      title: item.title,
      status: item.completed ? 1 : 0,
    }));

const checklistTitlesFromTree = (block: BlockEntity): string[] =>
  managedChecklistChildren(block).map((child) => subtaskTitle(child.content || ''));

const remoteChecklistTitles = (remote: Task): string[] =>
  (remote.items || []).map((item) => item.title || '');

const updateChecklistBlockFromRemote = async (
  block: BlockEntity,
  item: Subtask,
): Promise<boolean> => {
  const current = block.content || '';
  const lines = current.split(/\r?\n/);
  const local = parseLocalTaskState(current);
  const marker = item.status === 1 || item.completedTime
    ? 'DONE'
    : local.marker && local.marker !== 'DONE'
      ? local.marker
      : 'TODO';
  const next = [`${marker} ${item.title}`.trim(), ...lines.slice(1)].join('\n').trim();
  if (next === current.trim()) return false;
  suppressLocalPush(block.uuid);
  await logseq.Editor.updateBlock(block.uuid, next);
  return true;
};

const demoteChecklistBlock = async (block: BlockEntity): Promise<boolean> => {
  const current = block.content || '';
  const lines = current.split(/\r?\n/);
  const firstLine = (lines[0] || '').replace(TASK_MARKER_RE, '').trim();
  const next = [firstLine, ...lines.slice(1)].join('\n').trim();
  if (next === current.trim()) return false;
  suppressLocalPush(block.uuid);
  await logseq.Editor.updateBlock(block.uuid, next);
  return true;
};

interface ChecklistApplyResult {
  changed: boolean;
  blockedDeletion: boolean;
}

const applyRemoteChecklistToBlock = async (
  block: BlockEntity,
  remote: Task,
  forceStructural = false,
): Promise<ChecklistApplyResult> => {
  const tree = await getTreeContent(block);
  if (!tree) return { changed: false, blockedDeletion: false };

  const localChildren = managedChecklistChildren(tree);
  const remoteItems = remote.items || [];
  const plan = planChecklistApply(
    localChildren.map((child) => subtaskTitle(child.content || '')),
    remoteItems.map((item) => item.title || ''),
  );

  if (plan === 'rebuild' && !forceStructural) {
    return { changed: false, blockedDeletion: true };
  }

  let changed = false;
  if (plan === 'rebuild') {
    // Explicit remote-wins resolution preserves every existing Logseq child block
    // and nested note. Removed/reordered checklist blocks become ordinary context,
    // then the authoritative remote checklist is appended as fresh task blocks.
    for (const localChild of localChildren) {
      if (await demoteChecklistBlock(localChild)) changed = true;
    }

    for (const remoteItem of remoteItems) {
      const marker = remoteItem.status === 1 || remoteItem.completedTime ? 'DONE' : 'TODO';
      suppressLocalPush(block.uuid);
      const inserted = await logseq.Editor.insertBlock(
        block.uuid,
        `${marker} ${remoteItem.title}`,
        { sibling: false, before: false },
      );
      if (inserted) {
        suppressLocalPush(inserted.uuid);
        changed = true;
      }
    }
    return { changed, blockedDeletion: false };
  }

  for (let index = 0; index < remoteItems.length; index += 1) {
    const remoteItem = remoteItems[index];
    const localChild = localChildren[index];
    if (localChild) {
      if (await updateChecklistBlockFromRemote(localChild, remoteItem)) changed = true;
      continue;
    }

    const marker = remoteItem.status === 1 || remoteItem.completedTime ? 'DONE' : 'TODO';
    suppressLocalPush(block.uuid);
    const inserted = await logseq.Editor.insertBlock(
      block.uuid,
      `${marker} ${remoteItem.title}`,
      { sibling: false, before: false },
    );
    if (inserted) {
      suppressLocalPush(inserted.uuid);
      changed = true;
    }
  }

  return { changed, blockedDeletion: false };
};

interface RemoteApplyResult {
  changed: boolean;
  blockedChecklistDeletion: boolean;
}

const applyRemoteTaskToBlock = async (
  block: BlockEntity,
  remote: Task,
  forceStructural = false,
): Promise<RemoteApplyResult> => {
  const tree = await getTreeContent(block);
  if (!tree) return { changed: false, blockedChecklistDeletion: false };

  // Preflight the checklist before touching the parent block. This prevents a
  // conflict from partially applying parent fields before a structural checklist
  // problem is discovered.
  const checklistPlan = planChecklistApply(
    checklistTitlesFromTree(tree),
    remoteChecklistTitles(remote),
  );
  if (checklistPlan === 'rebuild' && !forceStructural) {
    return { changed: false, blockedChecklistDeletion: true };
  }

  const current = tree.content || '';
  const next = remoteTaskToBlockContent(remote, current);
  let changed = false;
  if (next !== current.trim()) {
    suppressLocalPush(block.uuid);
    await logseq.Editor.updateBlock(block.uuid, next);
    changed = true;
  }

  const checklist = await applyRemoteChecklistToBlock(block, remote, forceStructural);
  return {
    changed: changed || checklist.changed,
    blockedChecklistDeletion: checklist.blockedDeletion,
  };
};

const pushLocalTask = async (block: BlockEntity, showMessage = true): Promise<boolean> => {
  const { service } = getTickTickSettings();
  const serviceName = service === 'dida' ? 'Dida365' : 'TickTick';

  try {
    const contentTree = await getTreeContent(block);
    if (!contentTree) throw new Error('Cannot get tree content from block entity');

    const local = parseLocalTaskState(contentTree.content || '');
    if (!local.title) {
      if (showMessage) await logseq.UI.showMsg('Task title cannot be empty.', 'warning', { timeout: 3000 });
      return false;
    }

    const payload = {
      ...localStateToRemoteTask(local),
      items: subtasksFromLocalTree(contentTree),
    };
    const mapping = await getRemoteTaskMapping(block);
    if (mapping && mapping.service !== service) {
      const linkedServiceName = mapping.service === 'dida' ? 'Dida365' : 'TickTick';
      if (showMessage) {
        await logseq.UI.showMsg(
          `Current block is already linked to ${linkedServiceName}. Unlink it before switching task services.`,
          'warning',
          { timeout: 5000 },
        );
      } else {
        console.warn(
          `Skipped automatic push because block ${block.uuid} is linked to ${mapping.service}, not ${service}.`,
        );
      }
      return false;
    }

    let remoteTask: Task;
    let action: 'created' | 'updated';

    if (mapping) {
      const currentRemote = await ticktick.getTask(mapping.projectId, mapping.taskId);

      if (!showMessage) {
        const baseline = await getSyncBaseline(contentTree);
        const localSnapshot = snapshotFromLocalTree(contentTree);
        const remoteSnapshot = snapshotFromRemoteTask(currentRemote);
        const decision = classifySyncState(baseline, localSnapshot, remoteSnapshot);

        if (decision === 'pull-remote') {
          console.info(`Skipped automatic push because Dida changed first for task ${mapping.taskId}`);
          return false;
        }
        if (decision === 'conflict') {
          suppressLocalPush(contentTree.uuid);
          await markSyncConflict(contentTree);
          console.warn(`Skipped automatic push because both sides changed for task ${mapping.taskId}`);
          return false;
        }
        if (decision === 'unchanged' || decision === 'converged') {
          if (decision === 'converged') {
            suppressLocalPush(contentTree.uuid);
            await saveSyncBaseline(contentTree, remoteSnapshot);
          }
          return true;
        }
      }

      const remoteCompleted = currentRemote.status === 1 || Boolean(currentRemote.completedTime);
      if (remoteCompleted && local.marker !== 'DONE') {
        if (showMessage) {
          await logseq.UI.showMsg(
            'The Dida task is already completed. Dida Open API cannot reliably reopen it; reopen it in Dida first or pull the remote state.',
            'warning',
            { timeout: 6000 },
          );
        } else {
          console.warn(`Skipped automatic reopen for completed Dida task ${mapping.taskId}`);
        }
        return false;
      }

      remoteTask = await ticktick.updateTask({
        ...payload,
        id: mapping.taskId,
        projectId: mapping.projectId,
        title: payload.title,
        // Dida OpenAPI exposes one canonical task date and accepts null to clear it.
        // Send both fields explicitly so deleting Logseq DEADLINE also removes the
        // remote reminder instead of leaving a stale date behind.
        startDate: payload.dueDate ?? null,
        dueDate: payload.dueDate ?? null,
        status: local.marker === 'DONE' ? 1 : 0,
      });
      action = 'updated';
    } else {
      remoteTask = await ticktick.createTask(payload);
      action = 'created';
    }

    if (local.marker === 'DONE') {
      await ticktick.completeTask(remoteTask.projectId, remoteTask.id);
    }

    // Fetch the authoritative remote representation. Dida regenerates checklist
    // item ids on task update, so no child identity is persisted from update responses.
    remoteTask = await ticktick.getTask(remoteTask.projectId, remoteTask.id);

    suppressLocalPush(block.uuid);
    await saveRemoteTaskMapping(block, service, remoteTask);
    await saveSyncBaseline(block, snapshotFromRemoteTask(remoteTask));
    await removeInboxProjection(remoteTask.id);

    if (showMessage) {
      await logseq.UI.showMsg(`${serviceName} task ${action} from Logseq.`, 'success', {
        timeout: 3000,
      });
    }
    return true;
  } catch (error) {
    console.error(error);
    if (showMessage) {
      await logseq.UI.showMsg(`${serviceName} request failed. Check the access token and network connection.`, 'error', {
        timeout: 4000,
      });
    }
    return false;
  }
};

const detachDeletedRemoteTask = async (block: BlockEntity): Promise<void> => {
  suppressLocalPush(block.uuid);
  await removeRemoteTaskMapping(block);
  console.info(`Detached block ${block.uuid} because its remote task no longer exists`);
};

const pullRemoteTask = async (block: BlockEntity, forceRemote = false): Promise<void> => {
  const mapping = await getRemoteTaskMapping(block);
  if (!mapping) {
    await logseq.UI.showMsg('Current block is not linked to a remote task.', 'warning', {
      timeout: 3000,
    });
    return;
  }

  try {
    const latest = await getTreeContent(block);
    if (!latest) throw new Error('Cannot load current Logseq block');
    const remote = await ticktick.getTask(mapping.projectId, mapping.taskId);
    const remoteSnapshot = snapshotFromRemoteTask(remote);

    if (!forceRemote) {
      const baseline = await getSyncBaseline(latest);
      const localSnapshot = snapshotFromLocalTree(latest);
      const decision = classifySyncState(baseline, localSnapshot, remoteSnapshot);

      if (decision === 'keep-local' || decision === 'conflict') {
        suppressLocalPush(latest.uuid);
        await markSyncConflict(latest);
        await logseq.UI.showMsg(
          decision === 'keep-local'
            ? 'Logseq has unsynchronized local changes. Pull was blocked; use a conflict-resolution command if you want to discard them.'
            : 'Both sides changed or the remote checklist changed structurally. Pull was blocked before any local data was overwritten.',
          'warning',
          { timeout: 6500 },
        );
        return;
      }

      if (decision === 'unchanged' || decision === 'converged') {
        if (decision === 'converged') {
          suppressLocalPush(latest.uuid);
          await saveSyncBaseline(latest, remoteSnapshot);
        }
        await logseq.UI.showMsg('Linked task is already synchronized.', 'success', { timeout: 3000 });
        return;
      }
    }

    const result = await applyRemoteTaskToBlock(latest, remote, forceRemote);
    if (result.blockedChecklistDeletion) {
      suppressLocalPush(latest.uuid);
      await markSyncConflict(latest);
      await logseq.UI.showMsg(
        'Remote checklist structure cannot be applied safely without explicit conflict resolution. No local fields were changed.',
        'warning',
        { timeout: 6500 },
      );
      return;
    }

    suppressLocalPush(latest.uuid);
    await saveRemoteTaskMapping(latest, mapping.service, remote);
    await saveSyncBaseline(latest, remoteSnapshot);
    await logseq.UI.showMsg(
      forceRemote ? 'Conflict resolved using the remote Dida state.' : 'Remote task pulled into Logseq.',
      'success',
      { timeout: 3500 },
    );
  } catch (error) {
    if (isTaskNotFoundError(error)) {
      await detachDeletedRemoteTask(block);
      await logseq.UI.showMsg('Remote task was deleted. The Logseq block was kept and unlinked.', 'warning', {
        timeout: 5000,
      });
      return;
    }
    console.error(error);
    await logseq.UI.showMsg('Failed to pull the linked remote task.', 'error', {
      timeout: 4000 },
    );
  }
};

const pullAllLinkedTasks = async (showMessage = false): Promise<void> => {
  const { service, accessToken } = getTickTickSettings();
  if (!accessToken) return;

  const bindings = await listRemoteTaskBindings();
  let updated = 0;
  let failed = 0;
  let detached = 0;
  let conflicts = 0;
  let localOnly = 0;

  for (const { block, mapping } of bindings) {
    if (mapping.service !== service) continue;
    try {
      const latest = await getTreeContent(block);
      if (!latest) continue;
      const remote = await ticktick.getTask(mapping.projectId, mapping.taskId);
      const baseline = await getSyncBaseline(latest);
      const localSnapshot = snapshotFromLocalTree(latest);
      const remoteSnapshot = snapshotFromRemoteTask(remote);
      const decision = classifySyncState(baseline, localSnapshot, remoteSnapshot);

      if (decision === 'pull-remote') {
        const result = await applyRemoteTaskToBlock(latest, remote);
        if (result.blockedChecklistDeletion) {
          suppressLocalPush(latest.uuid);
          await markSyncConflict(latest);
          conflicts += 1;
          continue;
        }
        if (result.changed) updated += 1;
        suppressLocalPush(latest.uuid);
        await saveRemoteTaskMapping(latest, mapping.service, remote);
        await saveSyncBaseline(latest, remoteSnapshot);
      } else if (decision === 'converged') {
        suppressLocalPush(latest.uuid);
        await saveSyncBaseline(latest, remoteSnapshot);
      } else if (decision === 'keep-local') {
        localOnly += 1;
      } else if (decision === 'conflict') {
        suppressLocalPush(latest.uuid);
        await markSyncConflict(latest);
        conflicts += 1;
      }
    } catch (error) {
      if (isTaskNotFoundError(error)) {
        await detachDeletedRemoteTask(block);
        detached += 1;
        continue;
      }
      failed += 1;
      console.warn(`Failed to pull linked task ${mapping.taskId}`, error);
    }
  }

  if (showMessage) {
    await logseq.UI.showMsg(
      `Linked tasks pulled. ${updated} updated${localOnly ? `, ${localOnly} kept local` : ''}${detached ? `, ${detached} detached` : ''}${conflicts ? `, ${conflicts} conflicts` : ''}${failed ? `, ${failed} failed` : ''}.`,
      failed || conflicts ? 'warning' : 'success',
      { timeout: 4500 },
    );
  }
};

const reconcileLinkedTasks = async (): Promise<void> => {
  const { service, accessToken } = getTickTickSettings();
  if (!accessToken) return;

  const bindings = await listRemoteTaskBindings();
  for (const { block, mapping } of bindings) {
    if (mapping.service !== service) continue;

    try {
      const latest = await getTreeContent(block);
      if (!latest) continue;
      const remote = await ticktick.getTask(mapping.projectId, mapping.taskId);
      const baseline = await getSyncBaseline(latest);
      const localSnapshot = snapshotFromLocalTree(latest);
      const remoteSnapshot = snapshotFromRemoteTask(remote);
      const decision = classifySyncState(baseline, localSnapshot, remoteSnapshot);

      if (decision === 'pull-remote') {
        const result = await applyRemoteTaskToBlock(latest, remote);
        if (result.blockedChecklistDeletion) {
          suppressLocalPush(latest.uuid);
          await markSyncConflict(latest);
          continue;
        }
        suppressLocalPush(latest.uuid);
        await saveRemoteTaskMapping(latest, mapping.service, remote);
        await saveSyncBaseline(latest, remoteSnapshot);
      } else if (decision === 'keep-local') {
        await pushLocalTask(latest, false);
      } else if (decision === 'converged') {
        suppressLocalPush(latest.uuid);
        await saveSyncBaseline(latest, remoteSnapshot);
      } else if (decision === 'conflict') {
        suppressLocalPush(latest.uuid);
        await markSyncConflict(latest);
        const reason = baseline ? 'both sides changed' : 'no sync baseline is available';
        console.warn(`Dida sync conflict for block ${latest.uuid} / task ${mapping.taskId}: ${reason}`);
      }
    } catch (error) {
      if (isTaskNotFoundError(error)) {
        await detachDeletedRemoteTask(block);
        continue;
      }
      console.warn(`Failed to reconcile linked task ${mapping.taskId}`, error);
    }
  }
};

const linkExistingTask = async (block: BlockEntity): Promise<void> => {
  const { service } = getTickTickSettings();
  const serviceName = service === 'dida' ? 'Dida365' : 'TickTick';

  try {
    const existingMapping = await getRemoteTaskMapping(block);
    if (existingMapping) {
      await logseq.UI.showMsg('Current block is already linked. Unlink it before choosing another task.', 'warning', {
        timeout: 4000,
      });
      return;
    }

    const entries = await ticktick.getOpenTasks();
    const choices: TaskChoice[] = await Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        linked: Boolean(await findBlockBoundToRemoteTask(entry.task.id)),
      })),
    );

    openTaskPicker(choices, async (choice) => {
      const alreadyLinked = await findBlockBoundToRemoteTask(choice.task.id);
      if (alreadyLinked && alreadyLinked.uuid !== block.uuid) {
        throw new Error(`Task is already linked to block ${alreadyLinked.uuid}`);
      }

      const latest = await getTreeContent(block);
      if (!latest) throw new Error('Cannot load current Logseq block');
      const local = snapshotFromLocalTree(latest);
      const remote = snapshotFromRemoteTask(choice.task);
      const localHasContent = Boolean(parseLocalTaskState(latest.content || '').title);

      suppressLocalPush(block.uuid);
      await saveRemoteTaskMapping(block, service, choice.task);
      await removeInboxProjection(choice.task.id);

      if (!localHasContent) {
        const result = await applyRemoteTaskToBlock(latest, choice.task);
        if (result.blockedChecklistDeletion) {
          await markSyncConflict(block);
        } else {
          await saveSyncBaseline(block, remote);
        }
      } else if (JSON.stringify(local) === JSON.stringify(remote)) {
        await saveSyncBaseline(block, remote);
      } else {
        await markSyncConflict(block);
        await logseq.UI.showMsg(
          'The Logseq block and Dida task both contain different data. They are linked but not overwritten; choose a conflict-resolution command.',
          'warning',
          { timeout: 6000 },
        );
        return;
      }

      await logseq.UI.showMsg(`${serviceName} task linked.`, 'success', {
        timeout: 3000 },
      );
    });
  } catch (error) {
    console.error(error);
    await logseq.UI.showMsg(`Failed to load ${serviceName} tasks.`, 'error', {
      timeout: 4000 },
    );
  }
};

const unlinkCurrentTask = async (block: BlockEntity): Promise<void> => {
  const mapping = await getRemoteTaskMapping(block);
  if (!mapping) {
    await logseq.UI.showMsg('Current block is not linked to a remote task.', 'warning', {
      timeout: 3000 },
    );
    return;
  }

  suppressLocalPush(block.uuid);
  await removeRemoteTaskMapping(block);
  await logseq.UI.showMsg('Remote task link removed. The Dida task was not deleted.', 'success', {
    timeout: 3000 },
  );
};

const refreshInbox = async (showMessage = true): Promise<void> => {
  const { service, accessToken } = getTickTickSettings();
  if (service !== 'dida' || !accessToken) {
    if (showMessage && service !== 'dida') {
      await logseq.UI.showMsg('Dida Inbox is available when Task Service is set to Dida365.', 'warning', {
        timeout: 3500 },
      );
    }
    return;
  }

  const tasks = await ticktick.getOpenTasks();
  const result = await refreshDidaInbox(tasks, async (taskId) =>
    Boolean(await findBlockBoundToRemoteTask(taskId)),
  );
  if (showMessage) {
    await logseq.UI.showMsg(
      `Dida Inbox refreshed. ${result.added} added, ${result.removed} removed.`,
      'success',
      { timeout: 3500 },
    );
  }
};

const refreshAllSafely = async (): Promise<void> => {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    await reconcileLinkedTasks();
    await refreshInbox(false);
  } catch (error) {
    console.error('Background Dida sync failed', error);
  } finally {
    refreshInFlight = false;
  }
};

const configureAutoRefresh = (): void => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  const settings = getTickTickSettings();
  if (settings.service !== 'dida' || !settings.accessToken || !settings.autoSyncDida) return;

  void refreshAllSafely();
  refreshTimer = setInterval(() => {
    void refreshAllSafely();
  }, REFRESH_INTERVAL_MS);
};

const findManagedBlockForChange = async (changed: BlockEntity): Promise<BlockEntity | null> => {
  let current: BlockEntity | null = await logseq.Editor.getBlock(changed.uuid);
  const seen = new Set<number>();

  for (let depth = 0; current && depth < 32; depth += 1) {
    if (await getRemoteTaskMapping(current)) return current;

    const parentId = current.parent?.id;
    if (!parentId || seen.has(parentId)) return null;
    seen.add(parentId);
    current = await logseq.Editor.getBlock(parentId);
  }

  return null;
};

const scheduleAutomaticPush = async (changed: BlockEntity): Promise<void> => {
  const block = await findManagedBlockForChange(changed);
  if (!block || localPushIsSuppressed(block.uuid)) return;

  const existing = localPushTimers.get(block.uuid);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    localPushTimers.delete(block.uuid);
    void (async () => {
      if (localPushIsSuppressed(block.uuid)) return;
      const latest = await logseq.Editor.getBlock(block.uuid);
      if (!latest) return;
      const mapping = await getRemoteTaskMapping(latest);
      if (!mapping) return;
      await pushLocalTask(latest, false);
    })();
  }, LOCAL_PUSH_DEBOUNCE_MS);

  localPushTimers.set(block.uuid, timer);
};

const getCurrentBlockOrWarn = async (): Promise<BlockEntity | null> => {
  const block = await logseq.Editor.getCurrentBlock();
  if (!block) {
    await logseq.UI.showMsg('No block selected.', 'warning', { timeout: 2500 });
    return null;
  }
  return block;
};

const applySettings = () => {
  const settings = getTickTickSettings();
  ticktick.setService(settings.service);
  ticktick.setAccessToken(settings.accessToken);
  return settings;
};

const main = async (): Promise<void> => {
  console.info(`#${pluginId}: MAIN`);

  logseq.useSettingsSchema(settingsSchema);
  logseq.hideMainUI();

  if (await logseq.App.checkCurrentIsDbGraph()) {
    await logseq.UI.showMsg(
      'Dida365/TickTick Sync currently supports Logseq File Graphs only. Sync is disabled for this DB Graph.',
      'warning',
      { timeout: 7000 },
    );
    console.warn(`#${pluginId}: DB Graph detected; synchronization runtime was not started.`);
    return;
  }

  let settings = applySettings();

  settingsOffHook = logseq.onSettingsChanged(() => {
    settings = applySettings();
    configureAutoRefresh();
    const serviceName = settings.service === 'dida' ? 'Dida365' : 'TickTick';
    logseq.UI.showMsg(`${serviceName} settings updated.`, 'success', {
      timeout: 3000 },
    );
  });

  if (settings.accessToken === '') {
    const serviceName = settings.service === 'dida' ? 'Dida365' : 'TickTick';
    await logseq.UI.showMsg(`${serviceName} access token is not set.`, 'warning', {
      timeout: 3000 },
    );
  }

  dbOffHook = logseq.DB.onChanged(({ blocks }) => {
    for (const block of blocks || []) void scheduleAutomaticPush(block);
  });

  logseq.Editor.registerSlashCommand('Dida Create / Sync', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await pushLocalTask(block);
  });

  logseq.Editor.registerSlashCommand('Dida Pull Remote', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await pullRemoteTask(block);
  });

  logseq.Editor.registerSlashCommand('Dida Pull All Linked', async () => {
    await pullAllLinkedTasks(true);
  });

  logseq.Editor.registerSlashCommand('Dida Link Existing', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await linkExistingTask(block);
  });

  logseq.Editor.registerSlashCommand('Dida Unlink', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await unlinkCurrentTask(block);
  });

  logseq.Editor.registerSlashCommand('Dida Refresh Inbox', async () => {
    await refreshInbox(true);
  });

  logseq.Editor.registerSlashCommand('Dida Resolve Conflict - Keep Logseq', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await pushLocalTask(block, true);
  });

  logseq.Editor.registerSlashCommand('Dida Resolve Conflict - Use Dida', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await pullRemoteTask(block, true);
  });

  // Preserve the original short command for existing users.
  logseq.Editor.registerSlashCommand('TT', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await pushLocalTask(block);
  });

  configureAutoRefresh();
  logseq.beforeunload(cleanupRuntime);
};

logseq.ready(main).catch(console.error);
