# Plano: movimento fluido + combate no terreno

Objetivo: o boneco atravessa o estacionamento como num jogo de parkour leve. Pula grade, desliza no capô, sobe no carro e salta de cima. O combate passa a usar esse espaço: pisão de cima do carro, empurrão que esmaga o inimigo contra a lataria e quem está no alto fica protegido do soco, mas não do taco.

Tudo que é regra entra **no sim compartilhado** (`packages/shared/src/combat`). O servidor e a predição do cliente rodam o mesmo código, então cada mecânica nova já funciona online sem netcode extra. O cliente só ganha animação, som e câmera.

---

## Status (2026-11-17)

Implementado: Fases 1–4 no sim (altura no mapa, chão local, coyote e jump buffer, travessias pular/capô/subir e auto-mantle, rolamento de aterrissagem, queda com dano, alcance vertical, magnetismo, splat, pisão, carrinho, cancelamento recovery → pulo, golpe no capô → voadora), protocolo 7 com `airborne` e `traverse` no snapshot, predição com a altura dos inimigos, cliente (animações novas no `fighter.glb`, câmera seguindo a altura, sons e feed de splat/queda, arremesso com `OverhandThrow`, tiro com `Pistol_Shoot`), bots pulando grade/capô quando travam e o lab com carro, grade, sofá e muro. Testes em `test/movement.test.ts`, `net.test.ts`, `match.test.ts` e `fighterAnim.test.ts`. Benchmark: tick p50 0,81 → 0,87 ms.

Feito diferente do plano:
- Queda alta parado: fica lento por 20 ticks (sem correr) em vez de travar 8 ticks.
- Magnetismo: gira com a taxa normal do golpe em direção ao alvo (sair de lado ainda faz errar).
- Saída da travessia não confere se tem outro lutador no ponto de chegada (a separação empurra depois).
- Splat não exige "um por golpe" por campo: a velocidade zera no impacto, então só acontece de novo com outro golpe.

Ainda não feito:
- Overlay de `Jump_Start` e `Jump_Land` (precisa de memória no cliente; hoje o ar todo é `Jump_Loop`).
- Clipes `_Rec` no recovery, reação de hit pela direção, tremida de câmera proporcional ao hitstop.
- Bot preferindo empurrar o rival contra o carro.
- Fúria e explosão sem checagem de altura (todo mundo até 1,6 m é alcançado, o que coincide com a regra).
- Teste no navegador e tuning no lab.

---

## 0. Onde estamos (levantamento)

| O que | Onde | Situação |
|---|---|---|
| Pulo | `sim.ts:300-305`, `sim.ts:478` | Existe. `jumpVelocity 6.5`, `gravity 24` → **apex 0,88 m**, 0,54 s no ar. Aterrissa sempre em `y = 0`. |
| Colisão com o mapa | `map.ts` `resolveCircleCollision` | **2D**. Toda caixa é parede infinita. `Box.h` só serve para desenhar. |
| Alturas do mapa | `map.ts` | barreira 1,1 · móvel 0,75–1,2 · balcão 1,1 · **carro 1,45** · grade 2,2 · barraca 2,4 · muro 2,5 · quiosque 2,6 · ônibus 3,4 · galpão 6 |
| Controle no ar | `sim.ts:327` | Em `idle` no ar anda com walk/run speed cheio (bom, mantém). |
| Voadora | `sim.ts:668`, `weapons.ts` `VOADORA` | Q no ar. |
| Esquiva | `sim.ts:712` | Passo (parado/andando) e rolamento (correndo). Bloqueada no ar. |
| Render de altura | `character.ts:1350` | `root.position.set(pos.x, f.y, pos.z)`: altura absoluta, já funciona. |
| Câmera | `engine.ts:1008` | Pivô fixo em `y = 1.65`. **Não acompanha `f.y`.** |
| Predição | `net.ts:85-101` | Self vai inteiro em JSON (campo novo do `Fighter` viaja sozinho). Inimigos viram dummies criados **sem `y`**. |
| Snapshot | `codec.ts:21` | `y` f32 e `state` str já existem. Estado novo não muda o codec. |
| Clipes no `fighter.glb` | `apps/web/scripts/build-models.mjs` | Já tem `Jump_Start`, `Jump_Loop`, `Jump_Land` e `Roll`. `pickAnim` só usa `Jump_Loop`. |
| Clipes disponíveis e não usados | `assets-src/quaternius/...UAL2_Standard.glb` | `ClimbUp_1m`, `NinjaJump_Start/Idle_Loop/Land`, `Slide_Start/Loop/Exit`, `Shield_Dash`, `Sword_Regular_A_Rec/B_Rec`, `Melee_Hook_Rec`, `OverhandThrow` |
| | `UAL1_Standard.glb` | `Pistol_Shoot`, `Pistol_Aim_Neutral`, `Pistol_Idle_Loop`, `Interact`, `Push_Loop` |
| Combat lab | `tools/combat-lab` | Sem colisão de mapa (raio `sedeRadius`). Precisa de carro e grade para tunar. |
| Benchmark | `pnpm --filter @torcidas/game load` | Tempo de tick e tamanho de snapshot. |

---

## Decisões (mude se discordar)

1. **A altura decide o que dá pra escalar, não o tipo da caixa.** `topo − chão ≤ 1,6 m` dá pra subir. Barraca, quiosque, grade, muro, ônibus e galpão ficam de fora sozinhos, sem campo novo no `Box`.
2. **Em cima de carro dá pra ficar de pé.** Na barreira, não: ela é fina demais (`hd 0,12`), então só se pula por cima.
3. **`f.y` continua altura absoluta** (render e hit usam isso). O "no ar" passa a ser `f.y > chão local + ε`, com o chão vindo de `groundHeight()`. Não vai campo de chão no snapshot: o cliente tem o mapa e calcula.
4. **Travessia é estado roteirizado, não física.** Na entrada o sim calcula de onde sai e onde chega (`x, z, y`) e interpola. É determinístico, a predição reconcilia fácil e não trava em quina.
5. **Sem lag de aterrissagem.** Fluidez acima de realismo. Exceção: queda alta sem estar correndo (ver 2.6).
6. **Quem está no alto é protegido de golpe curto, não de tudo.** Arma longa, chute baixo de quem também está em cima, tiro, bomba e gás alcançam. Isso evita "camping" de teto.
7. **Ordem da Fase 3: o mais barato com mais impacto primeiro.** Magnetismo → wall splat → pisão → carrinho.

---

## Antes de começar

- O branch `feat/mvp-base` tem muito trabalho do editor visual sem commit (`VisualEditor.tsx`, `visual.ts`...). Commitar isso **antes**, ou abrir um branch novo (`feat/movimento`) a partir de um estado limpo.
- Subir `PROTOCOL_VERSION` (`protocol.ts:10`, hoje 6 → 7) na Fase 1. O comportamento do sim muda, e um cliente velho prevendo com regra velha vai dar rubber-band.

---

## Fase 1: o mundo ganha altura

> Ao fim: dá pra subir num carro pulando a partir de um capô de 0,75 m (sofá, mesa), andar em cima, cair pela borda e aterrissar no teto de outro carro. Nada de vault ainda. Tudo que hoje assume chão em 0 continua funcionando.

### 1.1 `map.ts`: consultas com altura

- [ ] `export const STEP_UP = 0.3`: degrau que se sobe andando, sem pular (meio-fio, palete).
- [ ] `export const CLIMB_MAX = 1.6`: topo mais alto que dá pra escalar (vault/mantle, Fase 2).
- [ ] `groundHeight(map, pos: Vec2, y: number): number` devolve o maior `b.h` entre as caixas com **o centro do pé dentro** (`|x−b.x| ≤ b.hw && |z−b.z| ≤ b.hd`) e `b.h ≤ y + STEP_UP`. Senão devolve 0. Círculos (poste, coqueiro, lixeira) não são pisáveis.
  - Centro do pé, e não o círculo inteiro: você cai quando o **centro** sai da borda. Com o círculo inteiro, ficaria "flutuando" com 1 cm de sola em cima.
- [ ] `resolveCircleCollision(pos, radius, map, y = 0): number`. Ganha `y` e **ignora a caixa cujo `b.h ≤ y + 0.05`** (o pé está acima). Retorna o **quanto empurrou** (soma das correções, em m), para o wall splat da Fase 3.
  - Callers: `sim.ts:1250` (`separate`) e `map.test.ts`. Bots não chamam.
- [ ] `segmentBoxHit` não muda (já é 3D).

### 1.2 `sim.ts`: gravidade e chão local

- [ ] Helper `groundOf(s, f)` = `s.collision ? groundHeight(s.collision, f.pos, f.y) : 0`.
- [ ] Helper exportado `isAirborne(s, f)` = `f.y > groundOf(s, f) + 0.01 || f.vy > 0`.
- [ ] `advance` (`sim.ts:300-305`): a gravidade vale quando `isAirborne`. Aterrissa em `groundOf` e não em 0. **Andar pra fora da borda**: se `f.y > ground` e `vy == 0`, a queda começa sozinha (a condição já cobre).
- [ ] Coyote time: `f.groundedTick` (último tick com o pé no chão). Pulo vale até `coyoteTicks = 6` depois de sair da borda. Isso dá a sensação de "fluido".
- [ ] Jump buffer: o JUMP apertado até `inputBufferTicks` antes de aterrissar sai na aterrissagem. Hoje o pulo usa `pressed` direto e não entra no buffer: criar `f.jumpBufferTick`.
- [ ] Trocar todo "chão = 0":
  - [ ] `sim.ts:463` throw `f.y <= 0` → `!isAirborne`.
  - [ ] `sim.ts:466` `grounded` → `!isAirborne` (ou coyote).
  - [ ] `sim.ts:647` `airborne = f.y > 0` → `isAirborne`. **Sem isso, quem está em cima do carro fica "no ar" pra sempre**: Q vira voadora e não dá pra esquivar, curar, gritar nem arremessar.
  - [ ] `sim.ts:774` `t.y > kickMaxTargetHeight` → `t.y - groundOf(t) > kickMaxTargetHeight` **e** a regra de altura do golpe (1.4).
  - [ ] `sim.ts:392` respawn `y = 0`: mantém (spawn é no chão), mas zera `vy` e os campos novos.
- [ ] Queda livre em qualquer estado (knockdown no teto → cai do carro): já vale, porque a gravidade roda antes do switch de estado.

### 1.3 `separate()` (`sim.ts:1229`)

- [ ] Pular o par se `|a.y − b.y| > 1.0`. Quem está no teto não empurra quem está embaixo.
- [ ] Passar `f.y` para `resolveCircleCollision`.

### 1.4 Regra de altura nos golpes (`resolveHits`, `sim.ts:753`)

- [ ] `MoveDef.vReach?: number`: alcance vertical **para cima** (m). Padrão 0,9. Arma longa (`taco`, `barra`, `cassetete`): 1,6. Mão, faca e garrafa ficam no padrão.
- [ ] Para baixo (atacante mais alto) o padrão é 1,0. Do teto você não acerta quem está no chão com golpe normal: tem que pular (pisão, Fase 3).
- [ ] `dy = t.y − a.y`. Corpo a corpo só conecta se `−1.0 ≤ dy ≤ vReach`.
- [ ] Tiro: `SHOT_FROM_Y` e `SHOT_TO_Y` (`sim.ts:795`) viram `a.y + 1.35` e `t.y + 1.2`. **Sem isso, quem atira de cima do carro acerta o próprio carro.** O tiro ignora `vReach`.
- [ ] Arremesso: a origem `THROW_ARC_Y` (`sim.ts:993`) vira `f.y + 2.5`.
- [ ] Explosão de bomba/gás e fúria: alcançam quem está a até 1,6 m de altura do centro (o gás sobe e a bomba derruba do carro).

### 1.5 Predição (`net.ts:88-91`)

- [ ] Dummies recebem `y: o.y`. Senão o inimigo de pé no carro "cai" dentro da caixa no cliente e a colisão local o cospe pro lado (separação errada na predição).

### 1.6 Cliente

- [ ] `fighterAnim.ts:128`: `f.y > 0.02` → usar `airborne` (vem de `isAirborne` calculado no engine com o mapa e passado no `Snap`). Senão toca `Jump_Loop` pra sempre em cima do carro.
- [ ] `character.ts:958`: mesma troca.
- [ ] `engine.ts:497-502`: SFX de pulo e aterrissagem e passos usam `y − chão` (passos no teto do carro: som de lata = `HitMaterial 'metal'`, de graça).
- [ ] Câmera `engine.ts:1008`: `pivot.y = 1.65 + lerp(f.y)` (suavizado ~0,15 s pra não trepidar no degrau). O `cam.y = max(0.4, ...)` passa a ser relativo ao chão do jogador.
- [ ] Animação de pulo completa (de graça, já está no glb): `Jump_Start` nos primeiros ~6 ticks subindo, `Jump_Loop` no ar e `Jump_Land` ~8 ticks depois de aterrissar, como overlay curto, sem travar o input.

### 1.7 Testes da Fase 1

- `packages/shared/test/map.test.ts`:
  - `groundHeight` no centro do carro = 1,45; na borda (centro fora) = 0; empilhado (y alto) = o maior.
  - `resolveCircleCollision` com `y = 1.5` não empurra pra fora do carro; com `y = 1.0` empurra; o retorno é > 0 quando empurrou.
- `packages/shared/test/combat2.test.ts` (ou `movement.test.ts` novo):
  - Pular de um sofá (0,9 m) pra cima do carro aterrissa em 1,45.
  - Andar pra fora do teto cai e aterrissa em 0 em ~0,35 s.
  - Coyote: pular 4 ticks depois de sair da borda funciona; com 10 ticks não.
  - Em cima do carro: Q sai chute (não voadora), C esquiva, curativo funciona.
  - Soco de quem está no chão em quem está no teto não conecta; taco conecta.
  - Tiro de cima do carro acerta quem está no chão atrás de outro carro mais baixo.
- `packages/shared/test/net.test.ts`: reconcile com o self em cima do carro não diverge.
- `apps/game/test/match.test.ts`: partida de bots completa sem erro.
- **Benchmark:** `pnpm --filter @torcidas/game load` antes e depois. Adiciona um loop de caixas por lutador por tick (`groundHeight`). Se o tick subir > 15%, fazer um grid espacial simples do `map.boxes` (células de 8 m), usado também pela colisão.

---

## Fase 2: parkour contextual (travessias)

> Ao fim: correndo, você aperta Espaço perto de uma grade e passa por cima sem parar. Perto do carro, desliza no capô ou sobe nele. No ar, encostar numa borda alcançável sobe sozinho.

### 2.1 Estado `traverse` na FSM (`fsm.ts`)

- [ ] `FighterStateName` ganha `'traverse'`.
- [ ] Campos novos no `Fighter` (defaults no `createFighter`, reset no `respawn`):
  ```ts
  traverseKind: 'pular' | 'capo' | 'subir';
  traverseFrom: Vec3;   // x, y, z na entrada
  traverseTo: Vec3;     // x, y, z na saída
  traverseTicks: number; // duração total
  ```
- [ ] Em `advance`, `case 'traverse'`: `k = stateTick / traverseTicks`. A posição em XZ é `lerp(from, to, easeInOut(k))`. A altura `y` é `lerp(from.y, to.y, k) + arco(k)`, com `arco = sin(πk) · (topo − max(from.y, to.y) + 0.25)`. Aqui a gravidade **não** roda.
- [ ] `timedTransition`: `traverse` → `idle` quando `stateTick ≥ traverseTicks`. O `running` continua se RUN ainda está apertado (a corrida não quebra).
- [ ] Interação com o resto:
  - `isActionable`: **não**. Ataque e esquiva apertados entram no buffer e saem na saída (ver 2.5 para o golpe durante a travessia).
  - `isInvulnerable`: **não** (atravessar não é esquiva). Mas `pular` e `capo` têm `hurtRadius` normal e `y` alto, então golpe baixo não pega naturalmente.
  - Levar golpe no `traverse`: entra em hitstun/knockdown normalmente. O `y` fica onde estava e a gravidade derruba. **Ser derrubado do capô é ótimo.**
  - `separate`: ignora quem está em `traverse` (não empurra nem é empurrado).
  - Colisão de mapa: **pula** a colisão durante `traverse`, porque a saída já foi validada. No tick de saída, roda a colisão normal com o `y` final.

### 2.2 Detecção: `findTraverse(map, f, dir)` em `map.ts` (pura, testável)

Entrada: posição, `y`, chão atual e a direção pedida (`moveDir`, ou `facing` se parado). Saída: `{ kind, to: Vec3, ticks } | null`.

1. Sonda: segmento de `pos` até `pos + dir · 1.0 m`. Pega a **primeira caixa** atravessada com `b.h > chão + STEP_UP` (é obstáculo, não degrau).
2. `alto = b.h − chão`. Se `alto > CLIMB_MAX` → `null`.
3. `prof` = espessura da caixa **na direção** `dir` (projeção das meias-medidas: `2·(|dir.x|·hw + |dir.z|·hd)`).
4. Regras, na ordem:

| Tipo | Condição | Saída | Ticks | Clipe |
|---|---|---|---|---|
| `pular` | `alto ≤ 1.2` **e** `prof ≤ 0.8` | lado oposto: borda + raio + 0,35 m, no chão de lá | 20 (correndo: 16) | `NinjaJump_Start` → `NinjaJump_Land` |
| `capo` | caixa `carro`, **correndo**, `prof ≤ 2.2` (atravessando a largura) | lado oposto, no chão | 22 | `Slide_Start` → `Slide_Loop` → `Slide_Exit` (deitado de lado no capô) |
| `subir` | `alto ≤ CLIMB_MAX` e a caixa cabe o pé (`min(hw,hd) ≥ hurtRadius`) | 0,5 m pra dentro da borda, `y = b.h` | 18 + 10·`alto` (carro ≈ 33) | `ClimbUp_1m` com tempo escalado para a altura |

5. **Validação da saída**: o ponto `to` não pode colidir com nada na altura `to.y` (`resolveCircleCollision` não move) e não pode ter lutador de pé encostado. Inválido → tenta o próximo tipo da tabela (ex.: não dá pra pular por cima → tenta subir) → senão `null`, e Espaço vira pulo normal.
6. Determinismo: só usa caixas e números do sim. Nada de `Math.random`.

### 2.3 Entrada (`processInput`, `case 'idle'`, `sim.ts:478`)

- [ ] JUMP apertado (ou no buffer) com o pé no chão, ou dentro do coyote: **primeiro** `findTraverse`. Achou → `enterTraverse`. Senão pulo normal.
- [ ] **Auto-mantle no ar**: `isAirborne`, `vy ≤ 2` (subindo devagar ou caindo), andando em direção a uma caixa com `b.h − f.y ≤ 0.9` (a mão alcança) e `b.h − chão ≤ CLIMB_MAX` → `subir` com duração curta (12 ticks, só o fim do `ClimbUp_1m`). É isso que faz "pular perto do carro" virar "subir no carro" sem precisar de timing perfeito.
- [ ] Custo: `pular`/`capo` correndo custa **0** de stamina (fluidez). Parado ou andando custa `jumpStaminaCost` (12). `subir` custa 12.
- [ ] Carregando o bandeirão: só `pular` e `subir` (sem `capo`), com 1,5× os ticks.
- [ ] Bloqueado se: `slowUntil` (acabou de apanhar), `downed`, segurando arremessável? (não: pode).

### 2.4 Descer e saltar do alto

- [ ] Andar pra fora da borda = queda (Fase 1).
- [ ] Pulo de cima do carro = pulo normal, que cai mais (`1.45 + 0.88`, ~0,9 s no ar). Controle no ar como já é.
- [ ] **Rolamento de aterrissagem**: aterrissou de queda ≥ 1,5 m (`maxY − ground` registrado no ar) com RUN apertado e direção pedida → entra em `dodge` `roll` **grátis** (sem stamina, sem i-frames: `iframes [0,0]` via flag `landingRoll`). O embalo continua.
- [ ] Queda ≥ 1,5 m sem rolar → `landLag` de 8 ticks (o único lag do sistema). Quem rola não paga.

### 2.5 Cancelamentos (o "fluido" do combate)

- [ ] Recovery de golpe → **travessia/pulo**, igual à esquiva hoje (`sim.ts:643` `recoveryDodge`). Bater, pular a grade, sair correndo.
- [ ] Golpe apertado durante `pular`/`capo` (após 50% da travessia) → sai como **voadora** na saída (`startAttack(voadora)` no último tick do traverse). Combo de assinatura: deslizar no capô → voadora.
- [ ] Esquiva no `traverse`: não.

### 2.6 Constantes novas (`CombatConstants`, `weapons.ts`). Chute até o lab

```ts
traverse: {
  probe: 1.0,          // m à frente para achar obstáculo
  vaultMaxHeight: 1.2, vaultMaxDepth: 0.8, vaultTicks: 20, vaultRunTicks: 16,
  hoodMaxDepth: 2.2, hoodTicks: 22,
  climbBaseTicks: 18, climbTicksPerMeter: 10, airMantleReach: 0.9, airMantleTicks: 12,
  cost: 12,            // parado/andando; correndo pular/capô = 0
},
coyoteTicks: 6,
landing: { rollMinFall: 1.5, lagMinFall: 1.5, lagTicks: 8 },
```

### 2.7 Cliente

- [ ] `build-models.mjs`: adicionar da UAL2 `ClimbUp_1m`, `NinjaJump_Start`, `NinjaJump_Land`, `Slide_Start`, `Slide_Loop`, `Slide_Exit`. Conferir o tamanho final do `fighter.glb` (cada clipe ~30–80 KB).
- [ ] `pickAnim`, `case 'traverse'`: o clipe vem do `traverseKind`. O tempo é posicionado pelo tick (como os golpes), então nunca dessincroniza.
  - `subir`: `ClimbUp_1m` foi feito pra 1 m. Para 1,45 m, escala só a velocidade (a raiz vem do sim, então o pé não patina).
- [ ] `traverseKind` no snapshot: **um campo novo** no `FIGHTER_FIELDS` (`str?`), ou embutido no `move` (`'traverse:capo'`). Vou de campo novo, que é mais claro.
- [ ] SFX: mão batendo na lata (`subir`/`capo` no carro → `metal`), corpo raspando no capô, aterrissagem.
- [ ] Câmera: no `capo` e no `pular`, segura o pivô em `y` suavizado (0,25 s) pra não pular junto com o arco.

### 2.8 Testes da Fase 2

- `map.test.ts` (`findTraverse` puro):
  - De frente pra barreira → `pular`, saída do outro lado.
  - Carro de lado, correndo → `capo`; andando → `subir`.
  - Carro de frente pelo comprimento (prof 4,4) correndo → `subir` (não `capo`).
  - Quiosque (2,6) → `null`.
  - Saída bloqueada por outro carro colado → cai pro próximo tipo / `null`.
- `combat2.test.ts`:
  - Pular a barreira correndo não gasta stamina e termina correndo do outro lado.
  - Levar soco no meio do `capo` → hitstun e cai do capô.
  - Auto-mantle: pular encostado no carro termina em cima dele.
  - Recovery → pulo cancela.
  - Golpe no `capo` → voadora na saída.
  - Queda de 2,3 m correndo → roll grátis; parado → 8 ticks de lag.
- `net.test.ts`: input atrasado de 6 ticks no meio de um `subir` reconcilia sem divergir (`traverseFrom/To` vêm no self).
- `fighterAnim.test.ts`: `traverse` de cada tipo escolhe o clipe certo, tempo dentro de `[0, duration]`.

---

## Fase 3: combate que usa o terreno

### 3.1 Magnetismo leve (o mais barato, muda muito a sensação)

Hoje, sem lock-on, o golpe sai pra onde a câmera aponta. Errar por 20° = soco no vazio.

- [ ] Em `startAttack` (menos tiro, especial multiHit e quem está com lock): procurar o inimigo de pé mais perto dentro de `magnet.range = 2.6 m` e cone `magnet.coneDeg = 35°` em volta do `facing`, com `dy` dentro do alcance vertical do golpe.
- [ ] Achou: `facing` gira até ele (máx. o cone) e o lunge ganha `min(magnet.maxExtraLunge = 0.8, distância − alcance do hitbox + 0.2)`, distribuído no startup (o código do lunge já faz isso).
- [ ] Não atravessa parede: `segmentBoxHit` na altura do peito antes de aceitar o alvo.
- [ ] Teste: inimigo 25° fora da mira a 2 m → o soco conecta; a 50° → não.

### 3.2 Wall splat (esmagar contra o carro)

- [ ] Em `separate()`: `pushed = resolveCircleCollision(...)` (Fase 1 já retorna isso). Se `pushed > 0.02` e `|f.vel| ≥ splat.minSpeed` (2,5 m/s) e o estado ∈ {hitstun, knockdown, guardbreak, staggered} e não deu splat neste golpe (`f.splatTick < f.lastHitTakenTick`):
  - `damage += splat.damage = 6` (atribuído a quem deu o último golpe, via `damagedBy`), `enterState('staggered', splat.stunTicks = 35)` (knockdown continua knockdown), `vel = 0`, `hitstop = 4`, evento `{ type: 'splat', fighter, attacker, material }` (material da caixa: carro = metal).
  - Conta pro quebra-trava (é um hit a mais).
- [ ] Campo novo `splatTick`.
- [ ] Combos que nascem disso: **empurrão (`shove`) contra o carro → splat → pesado carregado.**
  - Conta: o knockback decai `×0.85` por tick (`knockbackFriction`). O shove de hoje (`knockback 5`) anda só ~0,55 m no total e fica acima de 4 m/s por **1 tick**, então quase nunca dá splat. Ajuste: `splat.minSpeed = 2.5` e o shove sobe pra `knockback 8` (anda ~0,9 m e fica > 2,5 m/s por ~7 ticks). Resultado: splat com o alvo a ≤ ~0,8 m da lataria.
- [ ] Cliente: câmera chacoalha, som de lata amassando, decal/partícula de vidro se `material === 'vidro'` (futuro: janela do carro).
- [ ] Teste: shove a 0,5 m de um carro → evento `splat`, estado `staggered`; a 3 m → nada.

### 3.3 Pisão / voadora de cima (ataque de queda)

- [ ] `MoveDef` novo em `common`: `pisao`. Sai quando se aperta **chute ou pesado no ar** com `f.y − chão ≥ 1.0` (caiu de altura, não pulo normal), ou na hora da saída de cima do carro.
  - Fica "pendurado" até aterrissar: startup = até tocar o chão (máx. 40 ticks); active = 4 ticks na aterrissagem; hitbox `arc` 360°, `range 1.6`; `damage 18`; `knockdown`; `low: false`; `unblockable: false`, mas com `guardDamage 2.5`.
  - Recovery 22 (punível se errar).
- [ ] A voadora normal continua no pulo baixo.
- [ ] Bônus de altura: `+25%` de dano por metro de queda acima de 1 m (cap +50%).
- [ ] Teste: pular do carro em cima de 3 inimigos → os 3 derrubados; do chão (pulo normal) → voadora, não pisão.

### 3.4 Carrinho (chute correndo)

- [ ] Q **correndo** no chão → `carrinho` (em vez do chute parado): `low`, `knockdown`, `lunge 3.0`, startup 8, active 12, recovery 24, stamina 22. O corpo fica baixo durante o active: golpe que não é `low` não pega do frame 4 ao 12 (checagem no `resolveHits`, igual ao "pulou o golpe baixo" ao contrário). Chute e outro carrinho pegam.
- [ ] Clipes `Slide_*` (os mesmos do capô).
- [ ] Teste: carrinho derruba; soco de frente no meio do carrinho passa por cima.

### 3.5 Queda do alto como dano

- [ ] Derrubado/arremessado (knockback, splat, fúria, bomba) de cima do carro: ao aterrissar de ≥ 1,2 m em hitstun/knockdown → `fallDamage = 5` + knockdown (se ainda não estava). O crédito vai pra quem deu o último golpe.

### 3.6 Sensação de golpe (cliente, sem mexer no sim)

- [ ] Reação de hit **pela direção e força**, não pela paridade do `stateDuration` (`fighterAnim.ts`, `case 'hitstun'`): golpe forte/pesado → `Hit_Knockback` curto, leve na cabeça (arc alto) → `Hit_Head`, resto → `Hit_Chest`. A direção do empurrão já vem no evento `hit` (atacante → alvo).
- [ ] Recovery com clipes `_Rec` (UAL2: `Sword_Regular_A_Rec`, `Sword_Regular_B_Rec`, `Melee_Hook_Rec`): hoje o recovery reaproveita o fim do clipe de ataque. Com o clipe de recuperação o combo fica menos robótico.
- [ ] Armas de fogo com `Pistol_Shoot` e `Pistol_Aim_Neutral` (UAL1) em vez do `Punch_Jab`.
- [ ] Arremessável com `OverhandThrow`.
- [ ] Tremida de câmera por peso do golpe (`hitstop` como intensidade) e hit-pause visual alinhado ao `hitstop` do sim (conferir o que o `engine.ts` já faz com `shake`).

### 3.7 Constantes novas da Fase 3. Chute até o lab

```ts
magnet: { range: 2.6, coneDeg: 35, maxExtraLunge: 0.8 },
splat: { minSpeed: 2.5, damage: 6, stunTicks: 35 },
plunge: { minHeight: 1.0, maxHangTicks: 40, bonusPerMeter: 0.25, maxBonus: 0.5 },
fall: { minHeight: 1.2, damage: 5 },
vReachUp: 0.9, vReachDown: 1.0,   // padrão do MoveDef.vReach
```

---

## Fase 4: lab, bots e polimento

### 4.1 Combat lab (`tools/combat-lab`)

- [ ] Montar um "cenário de teste" com `collision`: 1 carro, 1 barreira, 1 sofá e a parede de um galpão perto do spawn do dummy.
- [ ] Render (`render.ts`): caixas com altura (hoje o lab é plano).
- [ ] Painel (`panel.ts`): grupos `traverse`, `magnet`, `splat`, `plunge` editáveis ao vivo (o `buildConstantsEditor` já gera a partir do objeto, então deve sair sozinho).
- [ ] Dummy mode novo: "parado colado no carro" (testar splat e pisão).

### 4.2 Bots (`packages/shared/src/bots.ts`)

- [ ] Preso (`stuckTicks > 20`, `bots.ts:187`): antes de dar strafe, testar `findTraverse` na direção do objetivo. Achou → aperta JUMP. Grade e capô deixam de ser parede pra bot.
- [ ] Em luta, perto de um carro com o alvo de costas pra lataria → prefere shove (splat).
- [ ] Bot **não** sobe em carro pra lutar nesta fase (evita bot "acampando" no teto).

### 4.3 Polimento

- [ ] Passar no lab e anotar os números finais nos comentários das constantes (como o resto do `weapons.ts` faz).
- [ ] Rodar o benchmark de novo.
- [ ] Playtest 5v5 com bots: contar quantas vezes por partida acontece vault, capô, splat e pisão (eventos já existem). Se o pisão dominar, aumentar o recovery.

---

## Riscos e pontos de atenção

| Risco | Mitigação |
|---|---|
| Ficar preso em quina entre dois carros colados durante a queda | Saída da travessia sempre validada. A colisão empurra pelo lado mais próximo (já é assim). Teste com carros a 0,1 m. |
| Teto vira camping | `vReach` de arma longa, tiro, bomba/gás com alcance vertical e queda dando dano. Bots não sobem. |
| Rubber-band no vault online | A travessia é roteirizada e `from/to` vêm no self, então o reconcile reproduz igual. Teste em `net.test.ts` com atraso. |
| Custo de CPU (`groundHeight` + colisão por tick) | Benchmark na Fase 1. Grid espacial se passar de 15%. |
| `ClimbUp_1m` escalado pra 1,45 m ficar estranho | O sim é a verdade (posição). A animação só precisa "parecer". Plano B: subir em 2 tempos (`Jump_Start` + `ClimbUp_1m`). |
| Clientes antigos | `PROTOCOL_VERSION` 7. |
| Ponto de controle/bandeira em cima de carro | Praças já não têm caixa (`inPlaza`). Bandeira dropada em cima do carro: `pickupRange` usa distância 2D. Aceitar, ou exigir `|dy| < 1`. Decidir no playtest. |
| Spawn protection/sede com móveis escaláveis | Móvel dentro do galpão vira lugar de pular. Inofensivo, e até divertido. |

---

## Ordem de entrega (1 PR por linha)

1. **Fase 1**: altura no mundo + correção de todo "chão = 0" + câmera + `Jump_Start/Land` + testes + benchmark.
2. **Fase 2a**: `traverse` `pular` e `subir`, mais o auto-mantle (sim + testes).
3. **Fase 2b**: `capo` e rolamento de aterrissagem + clipes novos no glb + cliente.
4. **Fase 2c**: cancelamentos (recovery → pulo, traverse → voadora).
5. **Fase 3a**: magnetismo + wall splat.
6. **Fase 3b**: pisão + queda com dano + carrinho.
7. **Fase 3c**: sensação de golpe (clipes `_Rec`, pistola, reação por direção).
8. **Fase 4**: lab com cenário, bots usando travessia, tuning.

Critério de pronto de cada PR: `pnpm test` verde, partida de bots completa no `match.test.ts` e um vídeo/gif curto do lab ou do jogo mostrando a mecânica.
