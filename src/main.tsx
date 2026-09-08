import '@logseq/libs';
import './index.css';
import TickTick from './ticktick/ticktick';
import { Subtask, Task } from './ticktick/task';
import { logseq as PackageLogseq } from '../package.json';
import { settingsSchema, getTickTickSettings } from './settings';
import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import {
  findBlockBoundToRemoteTask,
  getRemoteTaskMapping,
  listRemoteTaskBindings,
  removeRemoteTaskMapping,
  saveRemoteTaskMapping,
} from './sync-state';
import { openTaskPicker, TaskChoice } from './task-picker';
import { refreshDidaInbox, removeInboxProjection } from './dida-inbox';
import {
  localStateToRemoteTask,
  parseLocalTaskState,
  remoteTaskToBlockContent,
} from './task-state';

const pluginId = PackageLogseq.id;
const ticktick = new TickTick();
const REFRESH_INTERVAL_MS = 60_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;

const getTreeContent = async (block: BlockEntity): Promise<BlockEntity | null> => {
  return logseq.Editor.getBlock(block.uuid, { includeChildren: true });
};

const flattenTree = (node: BlockEntity): BlockEntity[] => {
  const result: BlockEntity[] = [node];
  if (node.children) {
    for (const child of node.children) result.push(...flattenTree(child as BlockEntity));
  }
  return result;
};

const subtaskTitle = (content: string): string =>
  content
    .replace(/^(TODO|DONE|DOING|NOW|LATER|WAITING)\s+/i, '')
    .replace(/\[#([A-C])\]\s*/i, '')
    .split(/\r?\n/)[0]
    .trim();

const pushLocalTask = async (block: BlockEntity): Promise<void> => {
  const { service } = getTickTickSettings();
  const serviceName = service === 'dida' ? 'Dida365' : 'TickTick';

  try {
    const contentTree = await getTreeContent(block);
    if (!contentTree) throw new Error('Cannot get tree content from block entity');

    const local = parseLocalTaskState(contentTree.content || '');
    if (!local.title) {
      await logseq.UI.showMsg('Task title cannot be empty.', 'warning', { timeout: 3000 });
      return;
    }

    const flatTree = flattenTree(contentTree);
    const subtasks: Subtask[] = flatTree
      .slice(1)
      .map((child): Subtask => ({
        title: subtaskTitle(child.content || ''),
        status: parseLocalTaskState(child.content || '').marker === 'DONE' ? 1 : 0,
      }))
      .filter((item) => item.title.length > 0);

    const payload = {
      ...localStateToRemoteTask(local),
      items: subtasks,
    };
    const mapping = await getRemoteTaskMapping(block);
    let remoteTask: Task;
    let action: 'created' | 'updated';

    if (mapping && mapping.service === service) {
      remoteTask = await ticktick.updateTask({
        ...payload,
        id: mapping.taskId,
        projectId: mapping.projectId,
        title: payload.title,
        status: local.marker === 'DONE' ? 1 : 0,
      });
      action = 'updated';
    } else {
      remoteTask = await ticktick.createTask(payload);
      action = 'created';
    }

    if (local.marker === 'DONE') {
      await ticktick.completeTask(remoteTask.projectId, remoteTask.id);
      remoteTask.status = 1;
    }

    await saveRemoteTaskMapping(block, service, remoteTask);
    await removeInboxProjection(remoteTask.id);

    await logseq.UI.showMsg(`${serviceName} task ${action} from Logseq.`, 'success', {
      timeout: 3000,
    });
  } catch (error) {
    console.error(error);
    await logseq.UI.showMsg(`${serviceName} request failed. Check the access token and network connection.`, 'error', {
      timeout: 4000,
    });
  }
};

const applyRemoteTaskToBlock = async (block: BlockEntity, remote: Task): Promise<boolean> => {
  const current = block.content || '';
  const next = remoteTaskToBlockContent(remote, current);
  if (next === current.trim()) return false;
  await logseq.Editor.updateBlock(block.uuid, next);
  return true;
};

const pullRemoteTask = async (block: BlockEntity): Promise<void> => {
  const mapping = await getRemoteTaskMapping(block);
  if (!mapping) {
    await logseq.UI.showMsg('Current block is not linked to a remote task.', 'warning', {
      timeout: 3000,
    });
    return;
  }

  try {
    const remote = await ticktick.getTask(mapping.projectId, mapping.taskId);
    await applyRemoteTaskToBlock(block, remote);
    await saveRemoteTaskMapping(block, mapping.service, remote);
    await logseq.UI.showMsg('Remote task pulled into Logseq.', 'success', {
      timeout: 3000,
    });
  } catch (error) {
    console.error(error);
    await logseq.UI.showMsg('Failed to pull the linked remote task.', 'error', {
      timeout: 4000,
    });
  }
};

const pullAllLinkedTasks = async (showMessage = false): Promise<void> => {
  const { service, accessToken } = getTickTickSettings();
  if (!accessToken) return;

  const bindings = await listRemoteTaskBindings();
  let updated = 0;
  let failed = 0;

  for (const { block, mapping } of bindings) {
    if (mapping.service !== service) continue;
    try {
      const remote = await ticktick.getTask(mapping.projectId, mapping.taskId);
      if (await applyRemoteTaskToBlock(block, remote)) updated += 1;
      await saveRemoteTaskMapping(block, mapping.service, remote);
    } catch (error) {
      failed += 1;
      console.warn(`Failed to pull linked task ${mapping.taskId}`, error);
    }
  }

  if (showMessage) {
    await logseq.UI.showMsg(
      `Linked tasks pulled. ${updated} updated${failed ? `, ${failed} failed` : ''}.`,
      failed ? 'warning' : 'success',
      { timeout: 3500 },
    );
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

      await saveRemoteTaskMapping(block, service, choice.task);
      await removeInboxProjection(choice.task.id);

      const local = parseLocalTaskState(block.content || '');
      if (!local.title) {
        await logseq.Editor.updateBlock(block.uuid, remoteTaskToBlockContent(choice.task, block.content || ''));
      }

      await logseq.UI.showMsg(`${serviceName} task linked.`, 'success', {
        timeout: 3000,
      });
    });
  } catch (error) {
    console.error(error);
    await logseq.UI.showMsg(`Failed to load ${serviceName} tasks.`, 'error', {
      timeout: 4000,
    });
  }
};

const unlinkCurrentTask = async (block: BlockEntity): Promise<void> => {
  const mapping = await getRemoteTaskMapping(block);
  if (!mapping) {
    await logseq.UI.showMsg('Current block is not linked to a remote task.', 'warning', {
      timeout: 3000,
    });
    return;
  }

  await removeRemoteTaskMapping(block);
  await logseq.UI.showMsg('Remote task link removed. The Dida task was not deleted.', 'success', {
    timeout: 3000,
  });
};

const refreshInbox = async (showMessage = true): Promise<void> => {
  const { service, accessToken } = getTickTickSettings();
  if (service !== 'dida' || !accessToken) {
    if (showMessage && service !== 'dida') {
      await logseq.UI.showMsg('Dida Inbox is available when Task Service is set to Dida365.', 'warning', {
        timeout: 3500,
      });
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

const refreshAll = async (showMessage = false): Promise<void> => {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    await pullAllLinkedTasks(showMessage);
    await refreshInbox(false);
  } catch (error) {
    console.error('Background Dida refresh failed', error);
    if (showMessage) {
      await logseq.UI.showMsg('Dida refresh failed.', 'error', { timeout: 4000 });
    }
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
  if (settings.service !== 'dida' || !settings.accessToken || !settings.autoRefreshDidaInbox) return;

  void refreshAll(false);
  refreshTimer = setInterval(() => {
    void refreshAll(false);
  }, REFRESH_INTERVAL_MS);
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

  let settings = applySettings();

  logseq.onSettingsChanged(() => {
    settings = applySettings();
    configureAutoRefresh();
    const serviceName = settings.service === 'dida' ? 'Dida365' : 'TickTick';
    logseq.UI.showMsg(`${serviceName} settings updated.`, 'success', {
      timeout: 3000,
    });
  });

  if (settings.accessToken === '') {
    const serviceName = settings.service === 'dida' ? 'Dida365' : 'TickTick';
    await logseq.UI.showMsg(`${serviceName} access token is not set.`, 'warning', {
      timeout: 3000,
    });
  }

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

  // Preserve the original short command for existing users.
  logseq.Editor.registerSlashCommand('TT', async () => {
    const block = await getCurrentBlockOrWarn();
    if (block) await pushLocalTask(block);
  });

  configureAutoRefresh();
  window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });
};

logseq.ready(main).catch(console.error);
