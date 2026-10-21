import { Buttons, dist, type Fighter, moveTotalFrames, type PlayerInput, yawTo } from '@torcidas/shared';

export type DummyMode = 'parado' | 'bloqueio' | 'parry' | 'esquiva' | 'ataca' | 'troca' | 'especial' | 'perfeita';

export const DUMMY_MODES: Record<DummyMode, string> = {
  parado: 'Parado (saco de pancada)',
  bloqueio: 'Bloqueio segurado',
  parry: 'Parry no tempo (antecedência ajustável)',
  esquiva: 'Esquiva no tempo',
  ataca: 'Ataca (combo leve quando perto)',
  troca: 'Ataca e bloqueia alternando',
  especial: 'Dá o especial quando perto (Raça infinita)',
  perfeita: 'Esquiva perfeita (passo lateral no tempo)',
};

export interface DummyOptions {
  mode: DummyMode;
  /** Ticks antes do primeiro frame ativo do golpe do jogador em que o boneco reage. */
  reactLead: number;
}

/** IA simples do boneco: lê o frame data do golpe do jogador e reage no tick escolhido. */
export function dummyInput(self: Fighter, foe: Fighter, tick: number, o: DummyOptions): PlayerInput {
  const aim = yawTo(self.pos, foe.pos);
  const input: PlayerInput = { moveX: 0, moveZ: 0, aim, buttons: 0 };
  const ticksToActive = foe.state === 'attack' && foe.move ? foe.move.def.startup + 1 - foe.stateTick : Infinity;
  const threatened = ticksToActive >= 0 && ticksToActive <= o.reactLead;
  const near = dist(self.pos, foe.pos) < 1.6;

  switch (o.mode) {
    case 'parado':
      break;
    case 'bloqueio':
      input.buttons = Buttons.BLOCK;
      break;
    case 'parry':
      // Segura o bloqueio a partir de `reactLead` ticks antes do impacto até o golpe acabar.
      if (foe.state === 'attack' && foe.move && (threatened || foe.stateTick > foe.move.def.startup) && foe.stateTick <= moveTotalFrames(foe.move.def)) {
        input.buttons = Buttons.BLOCK;
      }
      break;
    case 'esquiva':
      if (threatened && ticksToActive === o.reactLead) input.buttons = Buttons.DODGE;
      break;
    case 'ataca':
      if (near) {
        input.buttons = tick % 6 === 0 ? Buttons.LIGHT : 0;
      } else {
        input.moveX = Math.sin(aim);
        input.moveZ = Math.cos(aim);
      }
      break;
    case 'especial':
      self.raca = 100;
      if (near) input.buttons = tick % 30 === 0 ? Buttons.SPECIAL : 0;
      else {
        input.moveX = Math.sin(aim);
        input.moveZ = Math.cos(aim);
      }
      break;
    case 'perfeita':
      // Passo lateral 2 ticks antes do primeiro frame ativo: cai dentro da janela perfeita.
      if (ticksToActive === 2) {
        input.buttons = Buttons.DODGE;
        input.moveX = Math.cos(aim);
        input.moveZ = -Math.sin(aim);
      }
      break;
    case 'troca': {
      const phase = Math.floor(tick / 120) % 2;
      if (phase === 0) input.buttons = Buttons.BLOCK;
      else if (near) input.buttons = tick % 6 === 0 ? Buttons.LIGHT : 0;
      break;
    }
  }
  return input;
}
