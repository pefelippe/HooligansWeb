import { createAuthClient } from 'better-auth/react';

// Em produção o vercel.json repassa /api/auth/* e /backend/* para a API no mesmo domínio do web,
// para o cookie de sessão não ser de terceiros (vercel.app e onrender.com são domínios diferentes).
const AUTH_URL: string = import.meta.env.PROD ? window.location.origin : (import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
export const API_URL: string = import.meta.env.PROD ? '/backend' : AUTH_URL;

export const authClient = createAuthClient({ baseURL: AUTH_URL });

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
