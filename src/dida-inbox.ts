import { BlockEntity, PageEntity } from '@logseq/libs/dist/LSPlugin';
import { Project, Task } from './ticktick/task';

const INBOX_PAGE_NAME = 'Dida Inbox';
const INBOX_TASK_ID_PROPERTY = 'dida-inbox-task-id';
const INBOX_PROJECT_ID_PROPERTY = 'dida-inbox-project-id';
const INBOX_PROJECT_NAME_PROPERTY = 'dida-inbox-project-name';
const INBOX_TASK_URL_PROPERTY = 'dida-inbox-task-url';

const findInboxProjection = async (taskId: string): Promise<BlockEntity | null> => {
  const query = `
    [:find (pull ?b [*])
     :in $ ?task-id
     :where
     [?b :block/properties ?props]
     [(get ?props :dida-inbox-task-id) ?remote-id]
     [(= ?remote-id ?task-id)]]
  `;

  try {
    const result = await logseq.DB.datascriptQuery(query, taskId);
    return (result?.[0]?.[0] as BlockEntity | undefined) || null;
  } catch (error) {
    console.warn('Failed to query Dida Inbox projection', error);
    return null;
  }
};

const listInboxProjections = async (): Promise<BlockEntity[]> => {
  const query = `
    [:find (pull ?b [*])
     :where
     [?b :block/properties ?props]
     [(get ?props :dida-inbox-task-id)]]
  `;

  try {
    const result = await logseq.DB.datascriptQuery(query);
    return (result || []).map((row: any[]) => row[0] as BlockEntity);
  } catch (error) {
    console.warn('Failed to list Dida Inbox projections', error);
    return [];
  }
};

const readInboxTaskId = async (block: BlockEntity): Promise<string> => {
  const properties = await logseq.Editor.getBlockProperties(block.uuid);
  const value = properties?.[INBOX_TASK_ID_PROPERTY];
  return typeof value === 'string' ? value : '';
};

const getOrCreateInboxPage = async (): Promise<PageEntity> => {
  const existing = await logseq.Editor.getPage(INBOX_PAGE_NAME);
  if (existing) return existing;

  const created = await logseq.Editor.createPage(INBOX_PAGE_NAME);
  if (!created) throw new Error('Failed to create Dida Inbox page');
  return created;
};

export const ensureInboxProjection = async (
  project: Project,
  task: Task,
): Promise<BlockEntity | null> => {
  const existing = await findInboxProjection(task.id);
  if (existing) return existing;

  const page = await getOrCreateInboxPage();
  const block = await logseq.Editor.appendBlockInPage(page.uuid, `TODO ${task.title}`);
  if (!block) return null;

  await Promise.all([
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_TASK_ID_PROPERTY, task.id),
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_PROJECT_ID_PROPERTY, task.projectId),
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_PROJECT_NAME_PROPERTY, project.name),
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_TASK_URL_PROPERTY, task.taskUrl || ''),
  ]);

  return block;
};

export const removeInboxProjection = async (taskId: string): Promise<void> => {
  const block = await findInboxProjection(taskId);
  if (!block) return;
  await logseq.Editor.removeBlock(block.uuid);
};

export interface InboxRefreshResult {
  added: number;
  removed: number;
}

export const refreshDidaInbox = async (
  tasks: Array<{ project: Project; task: Task }>,
  isFormallyLinked: (taskId: string) => Promise<boolean>,
): Promise<InboxRefreshResult> => {
  const openTaskIds = new Set(tasks.map(({ task }) => task.id));
  let added = 0;
  let removed = 0;

  for (const projection of await listInboxProjections()) {
    const taskId = await readInboxTaskId(projection);
    if (!taskId) continue;
    if (!openTaskIds.has(taskId) || await isFormallyLinked(taskId)) {
      await logseq.Editor.removeBlock(projection.uuid);
      removed += 1;
    }
  }

  for (const entry of tasks) {
    if (await isFormallyLinked(entry.task.id)) continue;

    const existing = await findInboxProjection(entry.task.id);
    if (existing) continue;
    const created = await ensureInboxProjection(entry.project, entry.task);
    if (created) added += 1;
  }

  return { added, removed };
};
