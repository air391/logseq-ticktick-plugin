import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import { TaskService } from './ticktick/ticktick';
import { Task } from './ticktick/task';

const TASK_ID_PROPERTY = 'remote-task-id';
const PROJECT_ID_PROPERTY = 'remote-project-id';
const SERVICE_PROPERTY = 'remote-task-service';
const TASK_URL_PROPERTY = 'remote-task-url';

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

export const saveRemoteTaskMapping = async (
  block: BlockEntity,
  service: TaskService,
  task: Task,
): Promise<void> => {
  await Promise.all([
    logseq.Editor.upsertBlockProperty(block.uuid, TASK_ID_PROPERTY, task.id),
    logseq.Editor.upsertBlockProperty(block.uuid, PROJECT_ID_PROPERTY, task.projectId),
    logseq.Editor.upsertBlockProperty(block.uuid, SERVICE_PROPERTY, service),
    logseq.Editor.upsertBlockProperty(block.uuid, TASK_URL_PROPERTY, task.taskUrl || ''),
  ]);
};
