import { api } from '@/lib/api/client';

export interface ChatSessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName: string | null;
  createdAt: string;
}

export interface ChatSession extends ChatSessionSummary {
  messages: ChatMessage[];
}

export const chatApi = {
  listSessions: () => api.get('chat/sessions').json<ChatSessionSummary[]>(),
  createSession: (title?: string) =>
    api.post('chat/sessions', { json: { title } }).json<ChatSessionSummary>(),
  getSession: (id: string) => api.get(`chat/sessions/${id}`).json<ChatSession>(),
  deleteSession: (id: string) => api.delete(`chat/sessions/${id}`),
};
