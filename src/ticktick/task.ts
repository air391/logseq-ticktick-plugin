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
    completedTime?: string; // Format: "yyyy-MM-dd'T'HH:mm:ssZ", Example: "2019-11-13T03:00:00+0000"
    content?: string;
    desc?: string;
    dueDate?: string; // Format: "yyyy-MM-dd'T'HH:mm:ssZ", Example: "2019-11-13T03:00:00+0000"
    items?: Subtask[];
    priority?: TaskPriority;
    reminders?: string[];
    repeat?: string;
    sortOrder?: number;
    startDate?: string;
    status?: 0 | 1;
    timeZone?: string;
    taskUrl?: string;
}

export interface Subtask {
    id?: string;
    title: string;
    status?: 0 | 1;
    completedTime?: string;
    isAllDay?: boolean;
    sortOrder?: number;
    startDate?: string;
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
