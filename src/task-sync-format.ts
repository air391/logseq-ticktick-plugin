import { BlockEntity } from '@logseq/libs/dist/LSPlugin';
import { NewTask, Task, TaskPriority } from './ticktick/task';

const MARKER_RE = /^(TODO|DONE|DOING|NOW|LATER|WAITING)\s+/i;
const PRIORITY_RE = /\[#([A-C])\]\s*/i;
const SCHEDULED_RE = /^SCHEDULED:\s*<([^>]+)>\s*$/im;
const DEADLINE_RE = /^DEADLINE:\s*<([^>]+)>\s*$/im;

const priorityToNum = (text: string): TaskPriority => {
  const match = text.match(PRIORITY_RE);
  if (!match) return 0;
  if (match[1].toUpperCase() === 'A') return 5;
  if (match[1].toUpperCase() === 'B') return 3;
  return 1;
};

const priorityToTag = (priority?: TaskPriority): string => {
  if (priority === 5) return '[#A] ';
  if (priority === 3) return '[#B] ';
  if (priority === 1) return '[#C] ';
  return '';
};

const parseLogseqDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})(?:\s+[^\s]+)?(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  return new Date(year, month, day, hour, minute, 0, 0).toISOString();
};

const formatLogseqDate = (value: string | undefined, allDay = false): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  if (allDay) return `${yyyy}-${mm}-${dd} ${weekday}`;

  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${weekday} ${hh}:${min}`;
};

const firstContentLine = (content: string): string => {
  return content.split(/\r?\n/)[0] || '';
};

export const blockIsDone = (block: BlockEntity): boolean => {
  if (typeof block.marker === 'string' && block.marker.toUpperCase() === 'DONE') return true;
  return /^DONE\s+/i.test(block.content || '');
};

export const blockToRemoteTask = (block: BlockEntity): NewTask => {
  const content = block.content || '';
  const firstLine = firstContentLine(content);
  const title = firstLine
    .replace(MARKER_RE, '')
    .replace(PRIORITY_RE, '')
    .trim();

  const scheduled = content.match(SCHEDULED_RE)?.[1];
  const deadline = content.match(DEADLINE_RE)?.[1];

  return {
    title,
    priority: priorityToNum(firstLine),
    startDate: parseLogseqDate(scheduled),
    dueDate: parseLogseqDate(deadline),
    items: [],
  };
};

const stripManagedDateLines = (lines: string[]): string[] => {
  return lines.filter((line) => !/^\s*(SCHEDULED|DEADLINE):\s*</i.test(line));
};

export const applyRemoteTaskToBlockContent = (
  currentContent: string,
  remote: Task,
): string => {
  const lines = stripManagedDateLines(currentContent.split(/\r?\n/));
  const currentFirst = lines.shift() || '';
  const markerMatch = currentFirst.match(MARKER_RE);
  const marker = remote.status === 1 || remote.completedTime
    ? 'DONE'
    : markerMatch && markerMatch[1].toUpperCase() !== 'DONE'
      ? markerMatch[1].toUpperCase()
      : 'TODO';

  const firstLine = `${marker} ${priorityToTag(remote.priority)}${remote.title}`.trim();
  const result = [firstLine, ...lines];

  const scheduled = formatLogseqDate(remote.startDate, Boolean(remote.isAllDay ?? remote.allDay));
  const deadline = formatLogseqDate(remote.dueDate, Boolean(remote.isAllDay ?? remote.allDay));
  if (scheduled) result.push(`SCHEDULED: <${scheduled}>`);
  if (deadline) result.push(`DEADLINE: <${deadline}>`);

  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
