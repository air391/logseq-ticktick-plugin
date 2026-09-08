import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import { TaskService } from './ticktick/ticktick';
import { Task } from './ticktick/task';
import { ManagedTaskSnapshot, parseSnapshot, serializeSnapshot } from './sync-conflict';
import { queryBlocksByPluginProperty, readPluginProperty } from './property-query';

export const TASK_ID_PROPERTY = 'remote-task-id';
export const PROJECT_ID_PROPERTY = 'remote-project-id';
export const SERVICE_PROPERTY = 'remote-task-service';
export const TASK_URL_PROPERTY = 'remote-task-url';
export const SYNC_BASELINE_PROPERTY = 'remote-sync-baseline';
export const SYNC_CONFLICT_PROPERTY = 'remote-sync-conflict';

export interface RemoteTaskMapping {
  taskId: string;
  projectId: string;
  service: TaskService;
  taskUrl?: string;
}

export const getRemoteTaskMapping = async (
  block: BlockEntity,
): Promise<RemoteTaskMapping | null> => {
  const properties = await logseq.Editor.getBlockProperties(block.uuid);
  if (!properties) return null;

  const taskId = readPluginProperty(properties, TASK_ID_PROPERTY);
  const projectId = readPluginProperty(properties, PROJECT_ID_PROPERTY);
  const service = readPluginProperty(properties, SERVICE_PROPERTY) as TaskService;
  const taskUrl = readPluginProperty(properties, TASK_URL_PROPERTY);

  if (!taskId || !projectId || (service !== 'dida' && service !== 'ticktick')) return null;

  return {
    taskId,
    projectId,
    service,
    taskUrl: taskUrl || undefined,
  };
};

export const getSyncBaseline = async (
  block: BlockEntity,
): Promise<ManagedTaskSnapshot | null> => {
  const properties = await logseq.Editor.getBlockProperties(block.uuid);
  if (!properties) return null;
  return parseSnapshot(readPluginProperty(properties, SYNC_BASELINE_PROPERTY));
};

export const saveSyncBaseline = async (
  block: BlockEntity,
  snapshot: ManagedTaskSnapshot,
): Promise<void> => {
  await Promise.all([
    logseq.Editor.upsertBlockProperty(block.uuid, SYNC_BASELINE_PROPERTY, serializeSnapshot(snapshot)),
    logseq.Editor.removeBlockProperty(block.uuid, SYNC_CONFLICT_PROPERTY),
  ]);
};

export const markSyncConflict = async (block: BlockEntity): Promise<void> => {
  await logseq.Editor.upsertBlockProperty(block.uuid, SYNC_CONFLICT_PROPERTY, 'true');
};

export const findBlockBoundToRemoteTask = async (
  taskId: string,
): Promise<BlockEntity | null> => {
  try {
    const blocks = await queryBlocksByPluginProperty(TASK_ID_PROPERTY, taskId);
    return blocks[0] || null;
  } catch (error) {
    console.warn('Failed to query remote task binding', error);
    return null;
  }
};

export const listRemoteTaskBindings = async (): Promise<
  Array<{ block: BlockEntity; mapping: RemoteTaskMapping }>
> => {
  try {
    const rows = await queryBlocksByPluginProperty(TASK_ID_PROPERTY);
    const bindings: Array<{ block: BlockEntity; mapping: RemoteTaskMapping }> = [];
    for (const block of rows) {
      const mapping = await getRemoteTaskMapping(block);
      if (mapping) bindings.push({ block, mapping });
    }
    return bindings;
  } catch (error) {
    console.warn('Failed to list remote task bindings', error);
    return [];
  }
};

export const saveRemoteTaskMapping = async (
  block: BlockEntity,
  service: TaskService,
  task: Task,
): Promise<void> => {
  const existing = await findBlockBoundToRemoteTask(task.id);
  if (existing && existing.uuid !== block.uuid) {
    throw new Error(`Remote task is already linked to block ${existing.uuid}`);
  }

  await Promise.all([
    logseq.Editor.upsertBlockProperty(block.uuid, TASK_ID_PROPERTY, task.id),
    logseq.Editor.upsertBlockProperty(block.uuid, PROJECT_ID_PROPERTY, task.projectId),
    logseq.Editor.upsertBlockProperty(block.uuid, SERVICE_PROPERTY, service),
    logseq.Editor.upsertBlockProperty(block.uuid, TASK_URL_PROPERTY, task.taskUrl || ''),
  ]);
};

export const removeRemoteTaskMapping = async (
  block: BlockEntity,
): Promise<void> => {
  await Promise.all([
    logseq.Editor.removeBlockProperty(block.uuid, TASK_ID_PROPERTY),
    logseq.Editor.removeBlockProperty(block.uuid, PROJECT_ID_PROPERTY),
    logseq.Editor.removeBlockProperty(block.uuid, SERVICE_PROPERTY),
    logseq.Editor.removeBlockProperty(block.uuid, TASK_URL_PROPERTY),
    logseq.Editor.removeBlockProperty(block.uuid, SYNC_BASELINE_PROPERTY),
    logseq.Editor.removeBlockProperty(block.uuid, SYNC_CONFLICT_PROPERTY),
  ]);
};
