import { create } from 'zustand';
import type { AuthUser } from '@/types/domain';
import { queryClient } from '@/lib/api/queryClient';
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
    // Svuota la cache delle query: dati di un eventuale utente precedente
    // (es. lista conti) non devono trapelare nella nuova sessione. Senza
    // questo, con `staleTime` attivo il nuovo utente vedrebbe conti altrui
    // omonimi e i giroconti fallirebbero con 403 "Insufficient access".
    queryClient.clear();
    const user = await fetchMe();
    set({ status: 'authenticated', user });
  },

  async logout() {
    try {
      await logoutRequest();
    } finally {
      // Rimuove ogni dato cachato così il prossimo login parte pulito.
      queryClient.clear();
      set({ status: 'unauthenticated', user: null });
    }
  },

  setUnauthenticated() {
    set({ status: 'unauthenticated', user: null });
  },
}));
