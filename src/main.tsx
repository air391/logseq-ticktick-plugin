import '@logseq/libs';
import './index.css';
import TickTick from './ticktick/ticktick';
import { NewTask, Subtask, Task } from './ticktick/task';
import { logseq as PackageLogseq } from '../package.json';
import { settingsSchema, getTickTickSettings } from './settings';
import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import {
  findBlockBoundToRemoteTask,
  getRemoteTaskMapping,
  removeRemoteTaskMapping,
  saveRemoteTaskMapping,
} from './sync-state';
import { openTaskPicker, TaskChoice } from './task-picker';
import { refreshDidaInbox, removeInboxProjection } from './dida-inbox';

const pluginId = PackageLogseq.id;
const ticktick = new TickTick();
const INBOX_REFRESH_INTERVAL_MS = 60_000;
let inboxRefreshTimer: ReturnType<typeof setInterval> | null = null;
let inboxRefreshInFlight = false;

const priorityToNum = (text: string): 0 | 1 | 3 | 5 => {
  const priority = text.match(/\[#([A-C])\]/);
  if (priority) {
    switch (priority[1]) {
      case 'A':
        return 5;
      case 'B':
        return 3;
      case 'C':
        return 1;
    }
  }
  return 0;
};

const parseTask = (text: string): NewTask => {
  const priority = priorityToNum(text);
  let title = text.replace(/\[#([A-C])\]/, '');
  title = title.replace(/TODO/, '').replace(/DONE/, '').trim();

  return {
    title,
    priority,
    items: [],
  };
};

const getTreeContent: (
  block: BlockEntity,
) => Promise<BlockEntity | null> = async (block) => {
  const blockEntity = await logseq.Editor.getBlock(block.uuid, {
    includeChildren: true,
  });

  return blockEntity;
};

const flattenTree: (node: BlockEntity) => BlockEntity[] = (node) => {
  const result: BlockEntity[] = [node];

  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child as BlockEntity));
    }
  }

  return result;
};

const syncTask = async (task: NewTask, block: BlockEntity): Promise<void> => {
  const { service } = getTickTickSettings();
  const serviceName = service === 'dida' ? 'Dida365' : 'TickTick';

  try {
    const mapping = await getRemoteTaskMapping(block);
    let remoteTask: Task;
    let action: 'created' | 'updated';

    if (mapping && mapping.service === service) {
      remoteTask = await ticktick.updateTask({
        ...task,
        id: mapping.taskId,
        projectId: mapping.projectId,
        title: task.title,
      });
      action = 'updated';
    } else {
      remoteTask = await ticktick.createTask(task);
      action = 'created';
    }

    await saveRemoteTaskMapping(block, service, remoteTask);
    await removeInboxProjection(remoteTask.id);

    await logseq.UI.showMsg(`${serviceName} task ${action}.`, 'success', {
      timeout: 3000,
    });
  } catch (error) {
    console.error(error);
    await logseq.UI.showMsg(`${serviceName} request failed. Check the access token and network connection.`, 'error', {
      timeout: 4000,
    });
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

      const normalized = block.content
        .replace(/^(TODO|DONE|DOING|NOW|LATER|WAITING)\s+/, '')
        .trim();
      if (!normalized) {
        await logseq.Editor.updateBlock(block.uuid, `TODO ${choice.task.title}`);
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
  if (service !== 'dida' || !accessToken || inboxRefreshInFlight) {
    if (showMessage && service !== 'dida') {
      await logseq.UI.showMsg('Dida Inbox is available when Task Service is set to Dida365.', 'warning', {
        timeout: 3500,
      });
    }
    return;
  }

  inboxRefreshInFlight = true;
  try {
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
  } catch (error) {
    console.error(error);
    if (showMessage) {
      await logseq.UI.showMsg('Failed to refresh Dida Inbox.', 'error', {
        timeout: 4000,
      });
    }
  } finally {
    inboxRefreshInFlight = false;
  }
};

const configureInboxAutoRefresh = (): void => {
  if (inboxRefreshTimer) {
    clearInterval(inboxRefreshTimer);
    inboxRefreshTimer = null;
  }

  const settings = getTickTickSettings();
  if (settings.service !== 'dida' || !settings.accessToken || !settings.autoRefreshDidaInbox) return;

  void refreshInbox(false);
  inboxRefreshTimer = setInterval(() => {
    void refreshInbox(false);
  }, INBOX_REFRESH_INTERVAL_MS);
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

const main: () => Promise<void> = async () => {
  console.info(`#${pluginId}: MAIN`);

  logseq.useSettingsSchema(settingsSchema);
  logseq.hideMainUI();

  let settings = applySettings();

  logseq.onSettingsChanged(() => {
    settings = applySettings();
    configureInboxAutoRefresh();
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
    const blockEntity = await getCurrentBlockOrWarn();
    if (!blockEntity) return;

    const contentTree = await getTreeContent(blockEntity);
    if (!contentTree) {
      console.error('Cannot get tree content from block entity');
      return;
    }

    const flatContentTree = flattenTree(contentTree);
    const subtasks: Subtask[] = flatContentTree.slice(1).map((child) => ({
      title: child.content.replace(/TODO/, '').replace(/DONE/, '').replace(/\[#([A-C])\]/, '').trim(),
    }));

    const task = parseTask(flatContentTree[0]?.content || '');
    task.items = subtasks;

    if (task.title.length === 0) {
      await logseq.UI.showMsg('Task title cannot be empty.', 'warning', {
        timeout: 3000,
      });
      return;
    }

    await syncTask(task, flatContentTree[0]);
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
    if (!block) return;
    const contentTree = await getTreeContent(block);
    if (!contentTree) return;
    const flatContentTree = flattenTree(contentTree);
    const task = parseTask(flatContentTree[0]?.content || '');
    task.items = flatContentTree.slice(1).map((child) => ({
      title: child.content.replace(/TODO/, '').replace(/DONE/, '').replace(/\[#([A-C])\]/, '').trim(),
    }));
    if (task.title.length === 0) return;
    await syncTask(task, flatContentTree[0]);
  });

  configureInboxAutoRefresh();
  window.addEventListener('beforeunload', () => {
    if (inboxRefreshTimer) clearInterval(inboxRefreshTimer);
  });
};

logseq.ready(main).catch(console.error);
