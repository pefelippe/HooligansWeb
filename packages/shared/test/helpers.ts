import { Buttons, createCombatData, createSim, type CombatData, type NewFighter, type PlayerInput, type Sede, type SimEvent, type SimRules, type SimState, step } from '../src';

export { Buttons };

export const FACE_PLUS_Z = 0;
export const FACE_MINUS_Z = Math.PI;

/** A em (0,0) olhando +Z; B a 0.9 m olhando para A. */
export function duel(opts: { a?: Partial<NewFighter>; b?: Partial<NewFighter>; sedes?: Sede[]; data?: CombatData; rules?: SimRules; collision?: SimState['collision'] } = {}) {
  const data = opts.data ?? createCombatData();
  const s = createSim(
    [
      { id: 'a', team: 0, pos: { x: 0, z: 0 }, facing: FACE_PLUS_Z, ...opts.a },
      { id: 'b', team: 1, pos: { x: 0, z: 0.9 }, facing: FACE_MINUS_Z, ...opts.b },
    ],
    { sedes: opts.sedes ?? [], ...(opts.rules ? { rules: opts.rules } : {}), ...(opts.collision ? { collision: opts.collision } : {}) },
    data,
  );
  return { s, data };
}

export function fighter(s: SimState, id: string) {
  const f = s.fighters.find((x) => x.id === id);
  if (!f) throw new Error(`lutador ${id} não existe`);
  return f;
}

export function inp(buttons = 0, aim = 0, moveX = 0, moveZ = 0): PlayerInput {
  return { moveX, moveZ, aim, buttons };
}

/**
 * Roda `ticks` ticks. `script(tick)` devolve os inputs daquele tick (tick já incrementado,
 * ou seja, o primeiro tick simulado é 1). Lutadores sem input mantêm a direção.
 */
export function run(s: SimState, data: CombatData, ticks: number, script: (tick: number) => Record<string, PlayerInput> = () => ({})): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(s, script(s.tick + 1), data));
  return events;
}

export function ofType<T extends SimEvent['type']>(events: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** Pressiona o botão somente no tick indicado (borda de subida). */
export const tap = (bit: number, onTick: number, tick: number) => (tick === onTick ? bit : 0);
