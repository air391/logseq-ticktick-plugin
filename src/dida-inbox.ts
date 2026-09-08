import { BlockEntity, PageEntity } from '@logseq/libs/dist/LSPlugin';
import { Project, Task } from './ticktick/task';
import { queryBlocksByPluginProperty, readPluginProperty } from './property-query';

const INBOX_PAGE_NAME = 'Dida Inbox';
const INBOX_TASK_ID_PROPERTY = 'dida-inbox-task-id';
const INBOX_PROJECT_ID_PROPERTY = 'dida-inbox-project-id';
const INBOX_PROJECT_NAME_PROPERTY = 'dida-inbox-project-name';
const INBOX_TASK_URL_PROPERTY = 'dida-inbox-task-url';
const INBOX_MANAGED_CONTENT_PROPERTY = 'dida-inbox-managed-content';
const INBOX_PROPERTIES = [
  INBOX_TASK_ID_PROPERTY,
  INBOX_PROJECT_ID_PROPERTY,
  INBOX_PROJECT_NAME_PROPERTY,
  INBOX_TASK_URL_PROPERTY,
  INBOX_MANAGED_CONTENT_PROPERTY,
];

export const projectionVisibleContent = (content: string): string => {
  const propertyPrefixes = INBOX_PROPERTIES.map((property) => `${property}::`);
  return content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !propertyPrefixes.some((prefix) => trimmed.startsWith(prefix));
    })
    .join('\n')
    .trim();
};

const findInboxProjection = async (taskId: string): Promise<BlockEntity | null> => {
  try {
    const blocks = await queryBlocksByPluginProperty(INBOX_TASK_ID_PROPERTY, taskId);
    return blocks[0] || null;
  } catch (error) {
    console.warn('Failed to query Dida Inbox projection', error);
    return null;
  }
};

const listInboxProjections = async (): Promise<BlockEntity[]> => {
  try {
    return await queryBlocksByPluginProperty(INBOX_TASK_ID_PROPERTY);
  } catch (error) {
    console.warn('Failed to list Dida Inbox projections', error);
    return [];
  }
};

const readInboxTaskId = async (block: BlockEntity): Promise<string> => {
  const properties = await logseq.Editor.getBlockProperties(block.uuid);
  return properties ? readPluginProperty(properties, INBOX_TASK_ID_PROPERTY) : '';
};

const clearInboxProjectionProperties = async (block: BlockEntity): Promise<void> => {
  await Promise.all(
    INBOX_PROPERTIES.map((property) => logseq.Editor.removeBlockProperty(block.uuid, property)),
  );
};

const retireInboxProjection = async (block: BlockEntity): Promise<void> => {
  const fresh = await logseq.Editor.getBlock(block.uuid, { includeChildren: true });
  if (!fresh) return;

  const properties = await logseq.Editor.getBlockProperties(fresh.uuid);
  const managedContent = properties
    ? readPluginProperty(properties, INBOX_MANAGED_CONTENT_PROPERTY)
    : '';
  const visibleContent = projectionVisibleContent(fresh.content || '');
  const isKnownUntouched =
    Boolean(managedContent) && visibleContent === managedContent.trim();
  const hasChildren = (fresh.children || []).length > 0;

  // Only delete a projection when we can prove it is still exactly the disposable
  // block created by the plugin. Older projections and anything the user edited or
  // annotated are preserved instead of risking silent note loss.
  if (isKnownUntouched && !hasChildren) {
    await logseq.Editor.removeBlock(fresh.uuid);
    return;
  }

  await clearInboxProjectionProperties(fresh);

  if (isKnownUntouched) {
    const next = visibleContent.replace(/^TODO\s+/i, '').trim();
    if (next) await logseq.Editor.updateBlock(fresh.uuid, next);
  }
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
  const managedContent = `TODO ${task.title}`;
  const block = await logseq.Editor.appendBlockInPage(page.uuid, managedContent);
  if (!block) return null;

  await Promise.all([
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_TASK_ID_PROPERTY, task.id),
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_PROJECT_ID_PROPERTY, task.projectId),
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_PROJECT_NAME_PROPERTY, project.name),
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_TASK_URL_PROPERTY, task.taskUrl || ''),
    logseq.Editor.upsertBlockProperty(block.uuid, INBOX_MANAGED_CONTENT_PROPERTY, managedContent),
  ]);

  return block;
};

export const removeInboxProjection = async (taskId: string): Promise<void> => {
  const block = await findInboxProjection(taskId);
  if (!block) return;
  await retireInboxProjection(block);
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
      await retireInboxProjection(projection);
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
