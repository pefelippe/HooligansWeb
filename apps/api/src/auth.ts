import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins';
import { db, schema } from './db';
import { env, googleEnabled, isProd } from './env';

// Login com Google. Cada conta tem perfil e estatísticas próprios (cookie de sessão).
// A sessão anônima só existe fora de produção, para o smoke test do game server.
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  socialProviders: googleEnabled
    ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, prompt: 'select_account' } }
    : {},
  plugins: isProd ? [] : [anonymous()],
});
