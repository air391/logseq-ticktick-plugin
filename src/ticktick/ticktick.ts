import { NewTask, Project, ProjectData, Task, TaskUpdate } from './task';

export type TaskService = 'dida' | 'ticktick';

export class TaskServiceError extends Error {
    public readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'TaskServiceError';
        this.status = status;
    }
}

export const isTaskNotFoundError = (error: unknown): boolean =>
    error instanceof TaskServiceError && error.status === 404;

interface ServiceConfig {
    apiBaseUrl: string;
    authUrl: string;
    webUrl: string;
}

const SERVICE_CONFIG: Record<TaskService, ServiceConfig> = {
    dida: {
        apiBaseUrl: 'https://api.dida365.com/open/v1',
        authUrl: 'https://dida365.com/oauth/token',
        webUrl: 'https://dida365.com/webapp',
    },
    ticktick: {
        apiBaseUrl: 'https://api.ticktick.com/open/v1',
        authUrl: 'https://ticktick.com/oauth/token',
        webUrl: 'https://ticktick.com/webapp',
    },
};

class TickTick {
    private accessToken = '';
    private service: TaskService;

    constructor(accessToken?: string, service: TaskService = 'ticktick') {
        this.service = service;
        if (accessToken) {
            this.accessToken = accessToken;
        }
    }

    public setService(service: TaskService): void {
        this.service = service;
    }

    public setAccessToken(accessToken: string): void {
        this.accessToken = accessToken;
    }

    private get config(): ServiceConfig {
        return SERVICE_CONFIG[this.service];
    }

    private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', `Bearer ${this.accessToken}`);
        if (init.body !== undefined) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
            ...init,
            headers,
        });

        if (!response.ok) {
            let detail = `${response.status} ${response.statusText}`;
            try {
                const data = await response.json();
                detail = data.error_description || data.error || data.message || detail;
            } catch {
                // Keep the HTTP status as the error detail when the body is not JSON.
            }
            throw new TaskServiceError(response.status, `Task service request failed: ${detail}`);
        }

        if (response.status === 204) {
            return undefined as T;
        }

        const text = await response.text();
        if (!text) {
            return undefined as T;
        }
        return JSON.parse(text) as T;
    }

    public async getAccessToken(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<string> {
        const response = await fetch(this.config.authUrl, {
            method: 'POST',
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new TaskServiceError(
                response.status,
                `Failed to get access token: ${data.error_description || data.error || response.statusText}`,
            );
        }

        this.accessToken = data.access_token;
        return data.access_token;
    }

    private generateTaskUrl(task: Task): string {
        return `${this.config.webUrl}/#p/${encodeURIComponent(task.projectId)}/task/${encodeURIComponent(task.id)}`;
    }

    private withTaskUrl(task: Task): Task {
        return {
            ...task,
            taskUrl: this.generateTaskUrl(task),
        };
    }

    public async getProjects(): Promise<Project[]> {
        return this.request<Project[]>('/project');
    }

    public async getProjectData(projectId: string): Promise<ProjectData> {
        return this.request<ProjectData>(`/project/${encodeURIComponent(projectId)}/data`);
    }

    private async getOpenTaskSources(): Promise<ProjectData[]> {
        const projects = await this.getProjects();
        const sources = await Promise.all(
            projects.map(async (project) => {
                try {
                    return await this.getProjectData(project.id);
                } catch (error) {
                    console.warn(`Failed to load project ${project.id}`, error);
                    return null;
                }
            }),
        );

        const available = sources.filter((source): source is ProjectData => source !== null);

        if (this.service === 'dida') {
            try {
                // Dida's system Inbox is a real project-data source, but it is not
                // returned by GET /project. Some runtimes omit the embedded project
                // metadata, so callers must tolerate a missing `project` object.
                available.push(await this.getProjectData('inbox'));
            } catch (error) {
                console.warn('Failed to load Dida system Inbox', error);
            }
        }

        return available;
    }

    public async getOpenTasks(): Promise<Array<{ project: Project; task: Task }>> {
        const sources = await this.getOpenTaskSources();
        const tasks: Array<{ project: Project; task: Task }> = [];
        const seenTaskIds = new Set<string>();

        for (const data of sources) {
            for (const task of data.tasks || []) {
                if (task.status === 1 || task.completedTime || seenTaskIds.has(task.id)) continue;
                seenTaskIds.add(task.id);
                const project = data.project || {
                    id: task.projectId || 'inbox',
                    name: 'Inbox',
                } as Project;
                tasks.push({
                    project,
                    task: this.withTaskUrl(task),
                });
            }
        }
        return tasks;
    }

    public async getTask(projectId: string, taskId: string): Promise<Task> {
        const task = await this.request<Task>(
            `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
        );
        return this.withTaskUrl(task);
    }

    public async createTask(newTask: NewTask): Promise<Task> {
        const task = await this.request<Task>('/task', {
            method: 'POST',
            body: JSON.stringify(newTask),
        });
        return this.withTaskUrl(task);
    }

    public async updateTask(task: TaskUpdate): Promise<Task> {
        const updated = await this.request<Task>(`/task/${encodeURIComponent(task.id)}`, {
            method: 'POST',
            body: JSON.stringify(task),
        });
        return this.withTaskUrl(updated);
    }

    public async completeTask(projectId: string, taskId: string): Promise<void> {
        await this.request<void>(
            `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
            { method: 'POST' },
        );
    }

    public async deleteTask(projectId: string, taskId: string): Promise<void> {
        await this.request<void>(
            `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
            { method: 'DELETE' },
        );
    }
}

export default TickTick;
