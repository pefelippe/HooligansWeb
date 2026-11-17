import { randomVisual, TORCIDAS } from '@torcidas/shared';
import { useEffect, useState } from 'react';
import { authClient } from '../api';
import { CharacterPreview } from './CharacterPreview';
import { GoogleButton } from './kit';
import './screens.css';

// O Google volta para cá; em caso de erro o Better Auth acrescenta ?error=<código>.
function signInWithGoogle() {
  const home = window.location.origin + window.location.pathname;
  return authClient.signIn.social({ provider: 'google', callbackURL: home, errorCallbackURL: home });
}

// Dois lutadores se encarando, um de cada torcida (sorteio fixo: a capa não muda a cada visita).
const LEFT = randomVisual(7);
const RIGHT = randomVisual(31);

export function Login({ initialError }: { initialError: string | null }) {
  const [error, setError] = useState(initialError);
  const [redirecting, setRedirecting] = useState(false);

  // Voltar do Google pelo botão do navegador restaura a página do cache com o botão travado.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setRedirecting(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  async function login() {
    setError(null);
    setRedirecting(true);
    const r = await signInWithGoogle();
    if (!r.error) return; // o navegador já está indo para o Google
    setRedirecting(false);
    setError(
      r.error.code === 'PROVIDER_NOT_FOUND'
        ? 'Login com Google não configurado na API (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env)'
        : (r.error.message ?? 'Não foi possível entrar com Google'),
    );
  }

  const [a, b] = TORCIDAS;
  return (
    <main className="ln">
      <div className="ln-lights" aria-hidden="true" />
      <header className="ln-top">
        <span className="ln-mark">T</span>
        <span className="ln-tag">Alfa · Fortaleza</span>
      </header>

      <section className="ln-stage">
        <h1 className="ln-word">Torcidas</h1>
        <figure className="ln-fighter left">
          <CharacterPreview team={0} visual={LEFT} facing={0.55} still className="ln-canvas" />
          <figcaption style={{ ['--c' as string]: a.cores[1] }}>{a.nome}</figcaption>
        </figure>
        <span className="ln-x" aria-hidden="true">×</span>
        <figure className="ln-fighter right">
          <CharacterPreview team={1} visual={RIGHT} facing={-0.55} still className="ln-canvas" />
          <figcaption style={{ ['--c' as string]: b.cores[1] }}>{b.nome}</figcaption>
        </figure>
      </section>

      <section className="ln-panel" aria-labelledby="ln-title">
        <h2 id="ln-title">A briga é lá fora.</h2>
        <p>10 contra 10, do lado de fora do estádio. Escolha a torcida, o nick e a cara do seu lutador.</p>
        <GoogleButton onClick={login} disabled={redirecting}>
          {redirecting ? 'Abrindo o Google…' : 'Entrar com Google'}
        </GoogleButton>
        {error && (
          <p className="ln-error" role="alert">
            {error}
          </p>
        )}
        <small>Usamos só o seu nome e a sua foto do Google. Nada é postado na sua conta.</small>
      </section>
    </main>
  );
}
