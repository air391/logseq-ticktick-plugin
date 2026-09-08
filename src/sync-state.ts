import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import { TaskService } from './ticktick/ticktick';
import { Task } from './ticktick/task';

export const TASK_ID_PROPERTY = 'remote-task-id';
export const PROJECT_ID_PROPERTY = 'remote-project-id';
export const SERVICE_PROPERTY = 'remote-task-service';
export const TASK_URL_PROPERTY = 'remote-task-url';

export interface RemoteTaskMapping {
  taskId: string;
  projectId: string;
  service: TaskService;
  taskUrl?: string;
}

const readProperty = (properties: Record<string, any>, key: string): string => {
  const exact = properties[key];
  if (typeof exact === 'string') {
    return exact;
  }

  const namespacedKey = Object.keys(properties).find((candidate) =>
    candidate === key || candidate.endsWith(`.${key}`),
  );
  const value = namespacedKey ? properties[namespacedKey] : undefined;
  return typeof value === 'string' ? value : '';
};

export const getRemoteTaskMapping = async (
  block: BlockEntity,
): Promise<RemoteTaskMapping | null> => {
  const properties = await logseq.Editor.getBlockProperties(block.uuid);
  if (!properties) {
    return null;
  }

  const taskId = readProperty(properties, TASK_ID_PROPERTY);
  const projectId = readProperty(properties, PROJECT_ID_PROPERTY);
  const service = readProperty(properties, SERVICE_PROPERTY) as TaskService;
  const taskUrl = readProperty(properties, TASK_URL_PROPERTY);

  if (!taskId || !projectId || (service !== 'dida' && service !== 'ticktick')) {
    return null;
  }

  return {
    taskId,
    projectId,
    service,
    taskUrl: taskUrl || undefined,
  };
};

export const findBlockBoundToRemoteTask = async (
  taskId: string,
): Promise<BlockEntity | null> => {
  const query = `
    [:find (pull ?b [*])
     :in $ ?task-id
     :where
     [?b :block/properties ?props]
     [(get ?props :remote-task-id) ?remote-id]
     [(= ?remote-id ?task-id)]]
  `;

  try {
    const result = await logseq.DB.datascriptQuery(query, taskId);
    const block = result?.[0]?.[0] as BlockEntity | undefined;
    return block || null;
  } catch (error) {
    console.warn('Failed to query remote task binding', error);
    return null;
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
  ]);
};
