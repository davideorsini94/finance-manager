import { create } from 'zustand';
import type { AuthUser } from '@/types/domain';
import { fetchMe, loginRequest, logoutRequest } from './authApi';

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUnauthenticated: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,

  async bootstrap() {
    try {
      const user = await fetchMe();
      set({ status: 'authenticated', user });
    } catch {
      set({ status: 'unauthenticated', user: null });
    }
  },

  async login(email, password) {
    await loginRequest(email, password);
    const user = await fetchMe();
    set({ status: 'authenticated', user });
  },

  async logout() {
    try {
      await logoutRequest();
    } finally {
      set({ status: 'unauthenticated', user: null });
    }
  },

  setUnauthenticated() {
    set({ status: 'unauthenticated', user: null });
  },
}));
