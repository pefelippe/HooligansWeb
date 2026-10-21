# Torcidas

Briga 10×10 no estacionamento do estádio: **Cearalove × Lions do Pici**. As vagas sem jogador são completadas com bots.

## Rodando

```sh
pnpm install
docker compose up -d                          # Postgres + Redis
pnpm --filter @torcidas/api db:migrate
pnpm dev                                      # api :3000, game :4000, web :5173
pnpm lab                                      # combat lab :5174 (você x boneco, hitboxes, frame data ao vivo)
pnpm test
pnpm --filter @torcidas/game smoke            # fluxo completo contra api+game rodando
pnpm --filter @torcidas/game rooms-smoke      # salas: criar, entrar por código, bots, começar, expulsar
```

O login é com Google. Crie um OAuth Client ID do tipo *Web application* no Google Cloud, com a redirect URI `http://localhost:3000/api/auth/callback/google`, preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e reinicie o `pnpm dev`. No primeiro login o jogador escolhe torcida e nick (sugerido a partir do nome da conta). Para testar com 2 jogadores, entre com outra conta numa janela anônima.

Fora de produção a API também aceita sessão anônima, usada só pelo smoke test.

## Controles

| Tecla | Ação |
| --- | --- |
| WASD | andar |
| Shift | correr (gasta fôlego). Bater correndo leva o embalo |
| Espaço | pular (desvia de chute) |
| Botão esquerdo | golpe leve (combo de 3) |
| Botão direito | pesado (segure para carregar) |
| F | bloquear (logo antes do golpe = parry) |
| C | passo (correndo: rolamento). No último instante = esquiva perfeita |
| E | empurrão (em inimigo atordoado: cabeçada) |
| Q | chute (no ar: voadora) |
| Tab | travar a mira no inimigo para onde você mira (segurado: placar) |
| Roda do mouse | trocar o alvo travado (ou um puxão forte do mouse) |
| R | especial da arma (50 de Raça) |
| G | grito da torcida (100 de Raça): bônus para os aliados perto |
| 4 | curativo |
| X | levantar aliado caído (segure; não dá em combate) / churrasquinho no carrinho |
| J | loja (só na sede) |
| M | som liga/desliga · H esconde os comandos |

## Salas

Além do **Jogar** (partida rápida 10×10), a home tem **Salas**: públicas (aparecem na lista) ou privadas (só com o código ou o link `?sala=CODIGO`). Até 50 lutadores, no máximo 25 por torcida, contando os bots. O líder põe e tira bots, expulsa (o expulso não volta) e começa a partida; no fim todo mundo volta para o lobby. As salas vivem na memória do game server e somem 5 min depois de ficarem vazias.

## Pacotes

| Pacote | O que é |
| --- | --- |
| `packages/shared` | Combate (simulação de 60 Hz determinística), mapa por seed com colisão, regras da partida, bots, protocolo. |
| `apps/game` | Game server WebSocket: N partidas por processo, bots, loja, fim da partida e gravação das estatísticas. `/metrics`. |
| `apps/api` | Fastify + Better Auth (login com Google) + Drizzle/Postgres: perfil, fila (`/queue`), estatísticas. |
| `apps/web` | React + Three.js: home, escolha de torcida, partida 3D (HUD, loja, placar, resultado). |
| `tools/combat-lab` | Ferramenta de ajuste do combate. |

## Ainda falta (próximos marcos)

- Predição no cliente e compensação de lag: hoje tudo é desenhado a partir de snapshots interpolados, com ~70 ms de atraso.
- Fila por torcida no Redis com vários game servers.
- Modelos glTF rigados no lugar dos bonecos procedurais.
- Chat, moderação e deploy.

Variáveis de ambiente: veja `.env.example`. `MATCH_DURATION_S` (só em dev) encurta as partidas para teste.
