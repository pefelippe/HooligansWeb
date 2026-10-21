import type { Fighter } from './combat/fsm';
import { NEUTRAL_INPUT, type PlayerInput } from './combat/input';
import { cloneSim, createFighter, type SimState, step } from './combat/sim';
import type { CombatData } from './combat/types';
import { DEFAULT_COMBAT_DATA } from './combat/weapons';
import type { FighterSnapshot } from './protocol';

// Netcode: fila de inputs no servidor (um input por tick, sem perder toques de botão)
// e predição do cliente (aplica o próprio input na hora e reconcilia com o servidor).

export interface SeqInput {
  seq: number;
  input: PlayerInput;
}

/**
 * Fila de inputs de um jogador no servidor. Consome um por tick, na ordem.
 * Sem input novo, repete o último (seguro: ações só disparam na borda do botão).
 * Se a fila crescer demais, junta os mais antigos com OR nos botões, para não perder um toque.
 */
export class InputQueue {
  private q: SeqInput[] = [];
  private lastPushed = 0;
  last: PlayerInput = NEUTRAL_INPUT;
  /** Último seq consumido (vai no snapshot como ackSeq). */
  ack = 0;

  constructor(private readonly max = 4) {}

  push(seq: number, input: PlayerInput): void {
    if (seq <= this.lastPushed) return; // duplicado ou fora de ordem
    this.lastPushed = seq;
    this.q.push({ seq, input });
    while (this.q.length > this.max) {
      const a = this.q.shift() as SeqInput;
      const b = this.q[0] as SeqInput;
      this.q[0] = { seq: b.seq, input: { ...b.input, buttons: a.input.buttons | b.input.buttons } };
    }
  }

  next(): PlayerInput {
    const x = this.q.shift();
    if (x) {
      this.last = x.input;
      this.ack = x.seq;
    }
    return this.last;
  }

  get size(): number {
    return this.q.length;
  }
}

/**
 * Predição do próprio lutador no cliente. Mantém uma cópia local da simulação só com
 * você de verdade; os outros entram como "bonecos" parados do seu time (só para
 * empurrar/colidir, sem acertos locais). Acerto e dano vêm sempre do servidor.
 */
export class Predictor {
  state: SimState | null = null;
  /** Respawn atual da partida (vem do snapshot): sem ele, a predição renasceria antes do servidor. */
  respawnTicks: number;
  private pending: SeqInput[] = [];

  constructor(
    readonly selfId: string,
    private readonly base: Pick<SimState, 'sedes' | 'arenaHalfSize' | 'collision' | 'rules'>,
    private readonly data: CombatData = DEFAULT_COMBAT_DATA,
  ) {
    this.respawnTicks = data.constants.respawnTicks;
  }

  get self(): Fighter | undefined {
    return this.state?.fighters.find((f) => f.id === this.selfId);
  }

  /** Aplica o input local imediatamente (antes da resposta do servidor). */
  applyLocal(seq: number, input: PlayerInput): void {
    this.pending.push({ seq, input });
    if (this.pending.length > 240) this.pending.shift(); // 4 s sem resposta: descarta o mais velho
    if (this.state) step(this.state, { [this.selfId]: input }, this.data);
  }

  /** Volta ao estado do servidor (tick `tick`, input `ackSeq` já aplicado) e reaplica os inputs ainda não confirmados. */
  reconcile(tick: number, ackSeq: number, serverSelf: Fighter, others: readonly FighterSnapshot[]): void {
    this.pending = this.pending.filter((p) => p.seq > ackSeq);
    const self = cloneFighter(serverSelf);
    const dummies = others
      .filter((o) => o.id !== this.selfId && o.state !== 'ko' && o.state !== 'dead' && o.state !== 'downed')
      .map((o) => createFighter({ id: o.id, team: self.team, pos: o.pos, facing: o.facing }, this.data));
    this.state = {
      tick,
      fighters: [self, ...dummies],
      sedes: this.base.sedes,
      arenaHalfSize: this.base.arenaHalfSize,
      respawnTicks: this.respawnTicks,
      ...(this.base.collision ? { collision: this.base.collision } : {}),
      ...(this.base.rules ? { rules: this.base.rules } : {}),
    };
    for (const p of this.pending) step(this.state, { [this.selfId]: p.input }, this.data);
  }

  get unconfirmed(): number {
    return this.pending.length;
  }
}

function cloneFighter(f: Fighter): Fighter {
  return cloneSim({ tick: 0, fighters: [f], sedes: [], arenaHalfSize: 0, respawnTicks: 0 }).fighters[0] as Fighter;
}
