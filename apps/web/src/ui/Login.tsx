import { TORCIDAS } from '@torcidas/shared';
import { useEffect, useState } from 'react';
import { authClient } from '../api';
import { Crest, GoogleButton } from './kit';

// O Google volta para cá; em caso de erro o Better Auth acrescenta ?error=<código>.
function signInWithGoogle() {
  const home = window.location.origin + window.location.pathname;
  return authClient.signIn.social({ provider: 'google', callbackURL: home, errorCallbackURL: home });
}

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

  return (
    <main className="screen home">
      <header className="brand">
        <h1>Torcidas</h1>
        <p>Briga 10×10 no estacionamento do estádio</p>
      </header>
      <section className="versus">
        <div className="vs-side mine">
          <Crest torcida={TORCIDAS[0]} size={72} />
          <b>{TORCIDAS[0].nome}</b>
        </div>
        <span className="vs">×</span>
        <div className="vs-side mine">
          <Crest torcida={TORCIDAS[1]} size={72} />
          <b>{TORCIDAS[1].nome}</b>
        </div>
      </section>
      <section className="profile-card login">
        <div className="login-copy">
          <h2>Bora pro estacionamento</h2>
          <p>Entre, escolha o seu lado e o seu nick. Leva menos de um minuto.</p>
        </div>
        <GoogleButton onClick={login} disabled={redirecting}>
          {redirecting ? 'Abrindo o Google…' : 'Entrar com Google'}
        </GoogleButton>
        {error && (
          <p className="banner danger" role="alert">
            {error}
          </p>
        )}
        <small className="fine">Usamos só o seu nome e a sua foto do Google. Nada é postado na sua conta.</small>
      </section>
    </main>
  );
}
