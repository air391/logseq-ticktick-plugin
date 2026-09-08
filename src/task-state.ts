import { NewTask, Task } from './ticktick/task';

export type LogseqMarker = 'TODO' | 'DONE' | 'DOING' | 'NOW' | 'LATER' | 'WAITING' | null;

export interface LocalTaskState {
  marker: LogseqMarker;
  title: string;
  priority: 0 | 1 | 3 | 5;
  scheduled?: string;
  deadline?: string;
}

const MARKER_RE = /^(TODO|DONE|DOING|NOW|LATER|WAITING)\s+/;
const PRIORITY_RE = /\[#([A-C])\]\s*/;
const SCHEDULED_RE = /(?:^|\n)SCHEDULED:\s*<([^>]+)>/i;
const DEADLINE_RE = /(?:^|\n)DEADLINE:\s*<([^>]+)>/i;

const priorityFromContent = (content: string): 0 | 1 | 3 | 5 => {
  const match = content.match(PRIORITY_RE);
  if (!match) return 0;
  if (match[1] === 'A') return 5;
  if (match[1] === 'B') return 3;
  if (match[1] === 'C') return 1;
  return 0;
};

const priorityTag = (priority?: 0 | 1 | 3 | 5): string => {
  if (priority === 5) return '[#A] ';
  if (priority === 3) return '[#B] ';
  if (priority === 1) return '[#C] ';
  return '';
};

const extractTimestamp = (content: string, regex: RegExp): string | undefined =>
  content.match(regex)?.[1]?.trim() || undefined;

const stripMetadataLines = (content: string): string =>
  content
    .replace(/(?:^|\n)SCHEDULED:\s*<[^>]+>/gi, '')
    .replace(/(?:^|\n)DEADLINE:\s*<[^>]+>/gi, '')
    .trim();

export const parseLocalTaskState = (content: string): LocalTaskState => {
  const firstLine = stripMetadataLines(content);
  const markerMatch = firstLine.match(MARKER_RE);
  const marker = (markerMatch?.[1] as LogseqMarker) || null;
  const title = firstLine
    .replace(MARKER_RE, '')
    .replace(PRIORITY_RE, '')
    .trim();

  return {
    marker,
    title,
    priority: priorityFromContent(firstLine),
    scheduled: extractTimestamp(content, SCHEDULED_RE),
    deadline: extractTimestamp(content, DEADLINE_RE),
  };
};

const parseLogseqTimestamp = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+\w{3})?(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return undefined;
  const [, year, month, day, hour = '00', minute = '00'] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  );
};

const toRemoteDate = (value?: string): string | undefined => {
  const date = parseLogseqTimestamp(value);
  return date?.toISOString();
};

export const localStateToRemoteTask = (state: LocalTaskState): NewTask => ({
  title: state.title,
  priority: state.priority,
  startDate: toRemoteDate(state.scheduled),
  dueDate: toRemoteDate(state.deadline),
  isAllDay: !/\d{2}:\d{2}/.test(state.scheduled || state.deadline || ''),
});

const remoteDateToLogseqTimestamp = (value?: string): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${weekdays[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const remoteTaskToBlockContent = (remote: Task, currentContent: string): string => {
  const current = parseLocalTaskState(currentContent);
  const marker = remote.status === 1 || remote.completedTime ? 'DONE' : (current.marker === 'DONE' ? 'TODO' : current.marker || 'TODO');
  const lines = [`${marker} ${priorityTag(remote.priority)}${remote.title}`.trim()];

  const scheduled = remoteDateToLogseqTimestamp(remote.startDate);
  const deadline = remoteDateToLogseqTimestamp(remote.dueDate);
  if (scheduled) lines.push(`SCHEDULED: <${scheduled}>`);
  if (deadline) lines.push(`DEADLINE: <${deadline}>`);
  return lines.join('\n');
};
