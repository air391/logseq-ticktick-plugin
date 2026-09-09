export type TaskPriority = 0 | 1 | 3 | 5;

export interface Project {
    id: string;
    name: string;
    sortOrder?: number;
    viewMode?: string;
    kind?: string;
}

export interface Task {
    id: string;
    projectId: string;
    title: string;
    allDay?: boolean;
    isAllDay?: boolean;
    completedTime?: string;
    content?: string;
    desc?: string;
    dueDate?: string | null;
    items?: Subtask[];
    priority?: TaskPriority;
    reminders?: string[];
    repeat?: string;
    sortOrder?: number;
    startDate?: string | null;
    status?: 0 | 1;
    timeZone?: string;
    taskUrl?: string;
    modifiedTime?: string;
    updatedTime?: string;
    updateTime?: string;
}

export interface ProjectData {
    project: Project;
    tasks: Task[];
    columns?: unknown[];
}

export interface Subtask {
    id?: string;
    title: string;
    status?: 0 | 1;
    completedTime?: string;
    isAllDay?: boolean;
    sortOrder?: number;
    startDate?: string | null;
    timeZone?: string;
}

export interface NewTask extends Partial<Task> {
    title: string;
}

export interface TaskUpdate extends Partial<Task> {
    id: string;
    projectId: string;
    title: string;
}
