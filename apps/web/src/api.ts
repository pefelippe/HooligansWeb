import { createAuthClient } from 'better-auth/react';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const authClient = createAuthClient({ baseURL: API_URL });

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
