import '@logseq/libs';
import TickTick from './ticktick/ticktick';
import { NewTask, Subtask, Task } from './ticktick/task';
import { logseq as PackageLogseq } from '../package.json';
import { settingsSchema, getTickTickSettings } from './settings';
import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import { getRemoteTaskMapping, saveRemoteTaskMapping } from './sync-state';

const pluginId = PackageLogseq.id;
const ticktick = new TickTick();

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

const applySettings = () => {
  const settings = getTickTickSettings();
  ticktick.setService(settings.service);
  ticktick.setAccessToken(settings.accessToken);
  return settings;
};

const main: () => Promise<void> = async () => {
  console.info(`#${pluginId}: MAIN`);

  logseq.useSettingsSchema(settingsSchema);

  let settings = applySettings();

  logseq.onSettingsChanged(() => {
    settings = applySettings();
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

  logseq.Editor.registerSlashCommand('TT', async () => {
    const blockEntity = await logseq.Editor.getCurrentBlock();
    if (!blockEntity) {
      console.error('No block selected');
      return;
    }

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
};

logseq.ready(main).catch(console.error);
