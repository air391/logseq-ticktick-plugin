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
const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /(?:^|\s)(\d{2}):(\d{2})(?:\s|$)/;

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
  const dateMatch = value.match(DATE_RE);
  if (!dateMatch) return undefined;
  const timeMatch = value.match(TIME_RE);
  const [, year, month, day] = dateMatch;
  const hour = timeMatch?.[1] || '00';
  const minute = timeMatch?.[2] || '00';
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

const hasExplicitTime = (value?: string): boolean => Boolean(value && TIME_RE.test(value));

export const canonicalRemoteDate = (task: Pick<Task, 'dueDate' | 'startDate'>): string | null =>
  task.dueDate || task.startDate || null;

export const localStateToRemoteTask = (state: LocalTaskState): NewTask => ({
  title: state.title,
  priority: state.priority,
  // Dida OpenAPI normalizes startDate and dueDate to one canonical task date.
  // DEADLINE is therefore the only remote-managed Logseq date. SCHEDULED remains
  // local planning metadata and must not be silently collapsed into the Dida date.
  dueDate: toRemoteDate(state.deadline),
  isAllDay: !hasExplicitTime(state.deadline),
});

const remoteDateToLogseqTimestamp = (value?: string | null, allDay = false): string | undefined => {
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
    // SCHEDULED is intentionally local-only. Remote pulls replace DEADLINE only.
    .filter((line) => !/^\s*DEADLINE:\s*</i.test(line));
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
  const deadline = remoteDateToLogseqTimestamp(canonicalRemoteDate(remote), allDay);
  if (deadline) lines.push(`DEADLINE: <${deadline}>`);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const stableHash = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const localTaskFingerprint = (
  content: string,
  children: string[] = [],
): string => {
  const state = parseLocalTaskState(content);
  return stableHash({
    marker: state.marker === 'DONE' ? 'DONE' : 'OPEN',
    title: state.title,
    priority: state.priority,
    deadline: state.deadline || null,
    children: children.map((child) => {
      const childState = parseLocalTaskState(child);
      return {
        status: childState.marker === 'DONE' ? 1 : 0,
        title: childState.title,
      };
    }),
  });
};

export const remoteTaskFingerprint = (task: Task): string => stableHash({
  status: task.status === 1 || task.completedTime ? 1 : 0,
  title: task.title,
  priority: task.priority || 0,
  dueDate: canonicalRemoteDate(task),
  isAllDay: Boolean(task.isAllDay ?? task.allDay),
  items: (task.items || []).map((item) => ({
    status: item.status || 0,
    title: item.title,
  })),
});

export const remoteModifiedAt = (task: Task): number | null => {
  const raw = task.modifiedTime || task.updatedTime || task.updateTime;
  if (!raw) return null;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
};
