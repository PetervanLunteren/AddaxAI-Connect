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

export const todoApi = {
  get: async (): Promise<Todo> => {
    const { data } = await apiClient.get('/api/todo');
    return data;
  },
};

export const todoKeys = { all: ['todo'] as const };
