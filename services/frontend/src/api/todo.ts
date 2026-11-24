/**
 * The To do list of the signed-in user (GET /api/todo). The server decides
 * what needs somebody (services/api/utils/todo.py); lib/todo-lines.ts turns
 * each item into words and a link.
 */
import apiClient from './client';

export interface TodoItem {
  kind: string;
  count: number;
  overdue?: number | null; // my_tasks: how many of them are overdue
  target?: string | null; // integration_error: earthranger | sensingclues
}

export interface TodoProject {
  project_id: number;
  project_name: string;
  items: TodoItem[];
}

export interface Todo {
  projects: TodoProject[];
  server: TodoItem[];
}

/** A line someone marked not needed: hidden for everyone until undone. */
export interface NotNeeded {
  kind: string;
  project_id: number | null; // null for a server line
  by: string | null; // email
  at: string;
}

export const todoApi = {
  get: async (): Promise<Todo> => {
    const { data } = await apiClient.get('/api/todo');
    return data;
  },
  notNeeded: async (): Promise<NotNeeded[]> => {
    const { data } = await apiClient.get('/api/todo/not-needed');
    return data;
  },
  markNotNeeded: async (kind: string, projectId: number | null): Promise<void> => {
    await apiClient.post('/api/todo/not-needed', { kind, project_id: projectId });
  },
  undoNotNeeded: async (kind: string, projectId: number | null): Promise<void> => {
    await apiClient.delete('/api/todo/not-needed', { params: { kind, project_id: projectId ?? undefined } });
  },
};

// Under one root, so any change refreshes the list and the marks together.
export const todoKeys = {
  all: ['todo'] as const,
  notNeeded: ['todo', 'not-needed'] as const,
};
