import { NewTask, Project, Task, TaskUpdate } from './task';

export type TaskService = 'dida' | 'ticktick';

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
            throw new Error(`Task service request failed: ${detail}`);
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
            throw new Error(`Failed to get access token: ${data.error_description || data.error || response.statusText}`);
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
