function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Variável de ambiente ${name} não definida (veja .env.example)`);
  return v;
}

export const isProd = process.env.NODE_ENV === 'production';

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: required('DATABASE_URL', isProd ? undefined : 'postgres://torcidas:torcidas@localhost:5432/torcidas'),
  BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET', isProd ? undefined : 'dev-secret-nao-use-em-producao-0000'),
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  MATCH_TICKET_SECRET: required('MATCH_TICKET_SECRET', isProd ? undefined : 'dev-ticket-secret-0000'),
  INTERNAL_SECRET: required('INTERNAL_SECRET', isProd ? undefined : 'dev-internal-secret-0000'),
  /** Como a API fala com o game server (HTTP interno). */
  GAME_INTERNAL_URL: process.env.GAME_INTERNAL_URL ?? 'http://localhost:4000',
  /** URL que o navegador usa para conectar no game server. */
  GAME_PUBLIC_URL: process.env.GAME_PUBLIC_URL ?? 'ws://localhost:4000',
  /** Login com Google: sem as duas, ninguém consegue entrar pelo web. */
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || undefined,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || undefined,
};

export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
