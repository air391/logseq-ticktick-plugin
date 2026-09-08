import { NewTask, Task } from './ticktick/task';

export type LogseqMarker = 'TODO' | 'DONE' | 'DOING' | 'NOW' | 'LATER' | 'WAITING' | null;

export interface LocalTaskState {
  marker: LogseqMarker;
  title: string;
  priority: 0 | 1 | 3 | 5;
  scheduled?: string;
  deadline?: string;
}

const MARKER_RE = /^(TODO|DONE|DOING|NOW|LATER|WAITING)\s+/i;
const PRIORITY_RE = /\[#([A-C])\]\s*/i;
const SCHEDULED_RE = /^SCHEDULED:\s*<([^>]+)>\s*$/im;
const DEADLINE_RE = /^DEADLINE:\s*<([^>]+)>\s*$/im;

const priorityFromContent = (content: string): 0 | 1 | 3 | 5 => {
  const match = content.match(PRIORITY_RE);
  if (!match) return 0;
  if (match[1].toUpperCase() === 'A') return 5;
  if (match[1].toUpperCase() === 'B') return 3;
  return 1;
};

const priorityTag = (priority?: 0 | 1 | 3 | 5): string => {
  if (priority === 5) return '[#A] ';
  if (priority === 3) return '[#B] ';
  if (priority === 1) return '[#C] ';
  return '';
};

const firstLine = (content: string): string => content.split(/\r?\n/)[0] || '';

export const parseLocalTaskState = (content: string): LocalTaskState => {
  const titleLine = firstLine(content);
  const markerMatch = titleLine.match(MARKER_RE);
  const marker = (markerMatch?.[1]?.toUpperCase() as LogseqMarker) || null;
  const title = titleLine
    .replace(MARKER_RE, '')
    .replace(PRIORITY_RE, '')
    .trim();

  return {
    marker,
    title,
    priority: priorityFromContent(titleLine),
    scheduled: content.match(SCHEDULED_RE)?.[1]?.trim(),
    deadline: content.match(DEADLINE_RE)?.[1]?.trim(),
  };
};

const parseLogseqTimestamp = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})(?:\s+[^\s]+)?(?:\s+(\d{2}):(\d{2}))?/);
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

const remoteDateToLogseqTimestamp = (value?: string, allDay = false): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${weekdays[date.getDay()]}`;
  if (allDay) return datePart;
  return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const preservedBodyLines = (content: string): string[] => {
  return content
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => !/^\s*(SCHEDULED|DEADLINE):\s*</i.test(line));
};

export const remoteTaskToBlockContent = (remote: Task, currentContent: string): string => {
  const current = parseLocalTaskState(currentContent);
  const marker = remote.status === 1 || remote.completedTime
    ? 'DONE'
    : current.marker && current.marker !== 'DONE'
      ? current.marker
      : 'TODO';

  const lines = [
    `${marker} ${priorityTag(remote.priority)}${remote.title}`.trim(),
    ...preservedBodyLines(currentContent),
  ];

  const allDay = Boolean(remote.isAllDay ?? remote.allDay);
  const scheduled = remoteDateToLogseqTimestamp(remote.startDate, allDay);
  const deadline = remoteDateToLogseqTimestamp(remote.dueDate, allDay);
  if (scheduled) lines.push(`SCHEDULED: <${scheduled}>`);
  if (deadline) lines.push(`DEADLINE: <${deadline}>`);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
