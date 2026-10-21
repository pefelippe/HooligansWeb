import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  botInput,
  createBrain,
  createMatch,
  bounty,
  DEFAULT_CONSTANTS,
  CONTROL,
  ECONOMY,
  respawnTicksAt,
  enterState,
  generateMap,
  matchBuy,
  MATCH,
  type PlayerInput,
  resolveCircleCollision,
  inRect,
  type MatchState,
  stepMatch,
} from '../src';

function fullBotMatch(seed: number, durationTicks?: number) {
  const m = createMatch('t', seed, durationTicks);
  const brains = [];
  for (const team of [0, 1] as const) {
    for (let i = 0; i < MATCH.teamSize; i++) {
      const id = `bot-${team}-${i}`;
      addPlayer(m, { id, nick: id, team, bot: true });
      brains.push(createBrain(id, seed * 100 + team * 10 + i));
    }
  }
  return { m, brains };
}

describe('mapa: estacionamento do estádio', () => {
  it('é determinístico pela seed', () => {
    expect(generateMap(42)).toEqual(generateMap(42));
    expect(generateMap(42)).not.toEqual(generateMap(43));
  });

  it('spawn, bandeirão e portões dos galpões ficam livres de obstáculos', () => {
    for (const seed of [1, 2, 3, 99]) {
      const map = generateMap(seed);
      for (const sede of map.sedes) {
        for (const pt of [sede.spawn, sede.flag, ...sede.doors.flatMap((d) => [d.outside, d.inside])]) {
          const p = { ...pt };
          resolveCircleCollision(p, 0.35, map);
          expect(p).toEqual(pt);
        }
      }
    }
  });

  it('dá para entrar no galpão pelos portões, mas não atravessar a parede', () => {
    const map = generateMap(5);
    const sede = map.sedes[0];
    for (const door of sede.doors) {
      const p = { ...door.outside };
      for (let i = 0; i < 120; i++) {
        const dx = door.inside.x - p.x;
        const dz = door.inside.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        p.x += (dx / len) * 0.07;
        p.z += (dz / len) * 0.07;
        resolveCircleCollision(p, 0.35, map);
      }
      expect(inRect(p, sede.area)).toBe(true);
    }
    // Parede do fundo: andando reto para dentro a partir de fora, fica de fora.
    const p = { x: sede.area.x - sede.area.hw - 1.5, z: sede.area.z + 3 };
    for (let i = 0; i < 120; i++) {
      p.x += 0.07;
      resolveCircleCollision(p, 0.35, map);
    }
    expect(inRect(p, sede.area)).toBe(false);
  });

  it('carro bloqueia a passagem', () => {
    const map = generateMap(7);
    const car = map.boxes.find((b) => b.kind === 'carro');
    if (!car) throw new Error('sem carro');
    const p = { x: car.x, z: car.z };
    resolveCircleCollision(p, 0.35, map);
    const insideX = Math.abs(p.x - car.x) < car.hw + 0.35 - 1e-9;
    const insideZ = Math.abs(p.z - car.z) < car.hd + 0.35 - 1e-9;
    expect(insideX && insideZ).toBe(false);
  });
});

describe('economia de virada', () => {
  it('quem cai pelo time que está perdendo ganha extra; derrubar quem está em série paga recompensa', () => {
    const m = createMatch('t', 4);
    const a = addPlayer(m, { id: 'a', nick: 'a', team: 0, bot: false });
    const b = addPlayer(m, { id: 'b', nick: 'b', team: 1, bot: false });
    m.sim.rules = {}; // KO direto, sem caído
    a.pos = { x: 0, z: 0 };
    a.facing = 0;
    b.pos = { x: 0, z: 0.9 };
    b.facing = Math.PI;
    a.protectedUntil = b.protectedUntil = 0;
    m.score = [5, 0];
    b.hp = 1;
    b.streak = 4; // b estava numa série
    const moneyA = a.money;
    const moneyB = b.money;
    for (let t = 1; t <= 10; t++) stepMatch(m, { a: { moveX: 0, moveZ: 0, aim: 0, buttons: t === 1 ? 1 : 0 }, b: { moveX: 0, moveZ: 0, aim: Math.PI, buttons: 0 } });
    expect(m.score).toEqual([6, 0]);
    expect(b.money - moneyB).toBe(ECONOMY.deathConsolation + Math.min(ECONOMY.comebackMax, 6 * ECONOMY.comebackPerScore));
    expect(a.money - moneyA).toBe(ECONOMY.hit + ECONOMY.ko + bounty(4));
  });
});

describe('bots', () => {
  it('levantam um aliado caído quando não há inimigo perto', () => {
    const m = createMatch('t', 3);
    const helper = addPlayer(m, { id: 'bot', nick: 'bot', team: 0, bot: true });
    const fallen = addPlayer(m, { id: 'caido', nick: 'caido', team: 0, bot: false });
    addPlayer(m, { id: 'longe', nick: 'longe', team: 1, bot: true }).pos = { x: 30, z: 0 };
    helper.pos = { x: -20, z: 0 };
    fallen.pos = { x: -18, z: 0 };
    fallen.hp = 0;
    enterState(fallen, 'downed', DEFAULT_CONSTANTS.downed.ticks);
    const brain = createBrain('bot', 1);
    let revived = false;
    for (let t = 0; t < 400 && !revived; t++) {
      const ev = stepMatch(m, { bot: botInput(m, brain) });
      revived = ev.some((e) => e.type === 'revive');
    }
    expect(revived).toBe(true);
  });
});

describe('partida 10×10', () => {
  it('bots brigam, pontuam por KO e a partida termina no tempo', () => {
    const duration = 90 * 60; // 90 s
    const { m, brains } = fullBotMatch(5, duration);
    let kos = 0;
    let ended = false;
    const seen = new Set<string>();
    let worst = 0;
    for (let t = 0; t < duration; t++) {
      const inputs: Record<string, PlayerInput> = {};
      for (const b of brains) inputs[b.id] = botInput(m, b);
      const t0 = performance.now();
      const ev = stepMatch(m, inputs);
      worst = Math.max(worst, performance.now() - t0);
      kos += ev.filter((e) => e.type === 'ko').length;
      for (const e of ev) seen.add(e.type);
      if (ev.some((e) => e.type === 'matchEnd')) ended = true;
    }
    expect(m.sim.fighters).toHaveLength(20);
    expect(kos).toBeGreaterThan(0);
    // As mecânicas novas aparecem numa partida só de bots.
    for (const t of ['downed', 'special', 'heal']) expect(seen, t).toContain(t);
    // Placar = nocautes + pontos de controle.
    expect(m.score[0] + m.score[1]).toBe(kos + m.pointScore[0] + m.pointScore[1]);
    expect(ended).toBe(true);
    expect(m.phase).toBe('ended');
    expect(m.result?.mvp).toBeTruthy();
    expect(stepMatch(m, {})).toEqual([]);
    // Orçamento do plano: 4 ms por tick. Folga para CI lento.
    expect(worst).toBeLessThan(40);
  });

  it('compra na partida só na própria sede', () => {
    const m = createMatch('t', 1);
    const f = addPlayer(m, { id: 'p', nick: 'p', team: 0, bot: false });
    expect(matchBuy(m, 'p', 'soqueira').ok).toBe(true);
    f.pos = { x: 0, z: 0 };
    f.money = 10_000;
    expect(matchBuy(m, 'p', 'faca')).toEqual({ ok: false, reason: 'fora_da_sede' });
    expect(m.sim.sedes[0]?.pos).toEqual(m.map.sedes[0].spawn);
  });
});

describe('bandeirão', () => {
  const C = DEFAULT_CONSTANTS;
  const idle = (aim = 0): PlayerInput => ({ moveX: 0, moveZ: 0, aim, buttons: 0 });
  function setup() {
    const m = createMatch('ctf', 9, MATCH.durationTicks, 'bandeirao');
    const a = addPlayer(m, { id: 'a', nick: 'a', team: 0, bot: false });
    const b = addPlayer(m, { id: 'b', nick: 'b', team: 1, bot: false });
    a.protectedUntil = b.protectedUntil = 0;
    return { m, a, b };
  }
  const tickN = (m: MatchState, n: number, inputs: Record<string, PlayerInput> = {}) => {
    const ev = [];
    for (let i = 0; i < n; i++) ev.push(...stepMatch(m, inputs));
    return ev;
  };

  it('encostar no bandeirão rival pega; o carregador fica mais lento e só de punhos', () => {
    const { m, a } = setup();
    a.weapon = 'taco';
    a.pos = { ...m.flags[1].home };
    const ev = tickN(m, 1);
    expect(ev.some((e) => e.type === 'flagTaken')).toBe(true);
    expect(a.carrying).toBe(true);
    expect(m.flags[1].state).toBe('carried');
    // Anda mais devagar.
    const x0 = a.pos.x;
    tickN(m, 31, { a: { moveX: -1, moveZ: 0, aim: -Math.PI / 2, buttons: 0 } });
    expect(Math.abs(a.pos.x - x0)).toBeCloseTo((C.walkSpeed * C.flag.carrierSpeed * 30) / 60, 1);
  });

  it('levar para a própria sede com o próprio bandeirão em casa marca captura', () => {
    const { m, a } = setup();
    a.pos = { ...m.flags[1].home };
    tickN(m, 1);
    a.pos = { ...m.map.sedes[0].flag };
    const ev = tickN(m, 1);
    expect(ev.find((e) => e.type === 'flagCaptured')).toMatchObject({ team: 0, by: 'a' });
    expect(m.captures).toEqual([1, 0]);
    expect(m.flags[1].state).toBe('home');
    expect(a.carrying).toBe(false);
  });

  it('não pontua se o próprio bandeirão foi roubado', () => {
    const { m, a, b } = setup();
    a.pos = { ...m.flags[1].home };
    b.pos = { ...m.flags[0].home };
    tickN(m, 1);
    expect(m.flags[0].state).toBe('carried');
    a.pos = { ...m.map.sedes[0].area, x: m.map.sedes[0].area.x };
    tickN(m, 5);
    expect(m.captures).toEqual([0, 0]);
  });

  it('carregador derrubado larga o bandeirão; aliado do dono encosta e devolve', () => {
    const { m, a, b } = setup();
    a.pos = { ...m.flags[1].home };
    tickN(m, 1);
    a.pos = { x: 0, z: 0 };
    a.hp = 0;
    enterState(a, 'downed', C.downed.ticks);
    let ev = tickN(m, 1);
    expect(ev.some((e) => e.type === 'flagDropped')).toBe(true);
    expect(m.flags[1].state).toBe('dropped');
    b.pos = { x: 0.5, z: 0 };
    ev = tickN(m, 1);
    expect(ev.find((e) => e.type === 'flagReturned')).toMatchObject({ team: 1, by: 'b' });
    expect(m.flags[1].pos).toEqual(m.flags[1].home);
  });

  it('caído sozinho no chão por 30 s volta para a sede', () => {
    const { m, a } = setup();
    a.pos = { ...m.flags[1].home };
    tickN(m, 1);
    a.pos = { x: 0, z: 10 };
    enterState(a, 'downed', C.downed.ticks * 10);
    tickN(m, 1);
    expect(m.flags[1].state).toBe('dropped');
    tickN(m, C.flag.returnTicks);
    expect(m.flags[1].state).toBe('home');
  });

  it('3 capturas encerram a partida com vitória', () => {
    const { m, a } = setup();
    let ended = false;
    for (let i = 0; i < 3; i++) {
      a.protectedUntil = 0; // a proteção ao pegar o bandeirão não deixa pegar de novo no mesmo instante
      a.pos = { ...m.flags[1].home };
      tickN(m, 1);
      a.pos = { ...m.map.sedes[0].flag };
      ended = tickN(m, 1).some((e) => e.type === 'matchEnd');
    }
    expect(ended).toBe(true);
    expect(m.result).toMatchObject({ mode: 'bandeirao', winner: 0, captures: [3, 0] });
    expect(m.result?.mvp).toBe('a');
    void idle;
  });

  it('bots jogam o bandeirão: alguém captura numa partida', () => {
    // Seed fixa: a partida é determinística (mesma seed e mesmos cérebros = mesmo jogo).
    const m = createMatch('ctf-bots', 5, MATCH.durationTicks, 'bandeirao');
    const brains = [];
    for (const team of [0, 1] as const) {
      for (let i = 0; i < MATCH.teamSize; i++) {
        const id = `b${team}-${i}`;
        addPlayer(m, { id, nick: id, team, bot: true });
        brains.push(createBrain(id, 500 + i));
      }
    }
    const seen = new Set<string>();
    for (let t = 0; t < MATCH.durationTicks && m.phase === 'playing'; t++) {
      const inputs: Record<string, PlayerInput> = {};
      for (const br of brains) inputs[br.id] = botInput(m, br);
      for (const e of stepMatch(m, inputs)) seen.add(e.type);
    }
    expect(seen).toContain('flagTaken');
    expect(seen).toContain('flagCaptured');
  });
});

describe('respawn crescente', () => {
  it('5 s no começo, ~12,5 s no meio, 20 s no fim', () => {
    const m = createMatch('r', 1, 6000);
    expect(respawnTicksAt(m)).toBe(DEFAULT_CONSTANTS.respawnTicks);
    m.sim.tick = 3000;
    expect(respawnTicksAt(m)).toBe(750);
    m.sim.tick = 6000;
    expect(respawnTicksAt(m)).toBe(DEFAULT_CONSTANTS.respawnTicksEnd);
  });

  it('quem cai no fim da partida demora mais para voltar', () => {
    const m = createMatch('r', 1, 60000);
    const a = addPlayer(m, { id: 'a', nick: 'a', team: 0, bot: false });
    m.sim.tick = 54000; // 90% da partida: respawn ~18,5 s
    a.hp = 0;
    enterState(a, 'dead');
    a.koTick = m.sim.tick;
    for (let i = 0; i < 400; i++) stepMatch(m, {});
    expect(a.state).toBe('dead'); // com o respawn inicial (300) já teria voltado
    for (let i = 0; i < 800; i++) stepMatch(m, {});
    expect(a.state).not.toBe('dead');
  });
});

describe('pontos de controle (briga)', () => {
  /** Partida sem ninguém; põe lutadores na praça do ponto B. */
  function atB(players: { id: string; team: 0 | 1; dx?: number }[]) {
    const m = createMatch('p', 7, 60000);
    const b = m.points.find((p) => p.id === 'B')!;
    for (const pl of players) {
      const f = addPlayer(m, { id: pl.id, nick: pl.id, team: pl.team, bot: false });
      f.pos = { x: b.pos.x + (pl.dx ?? 0), z: b.pos.z };
      f.protectedUntil = 0;
    }
    return { m, b };
  }
  const run = (m: MatchState, ticks: number) => {
    const evs = [];
    for (let i = 0; i < ticks; i++) evs.push(...stepMatch(m, {}));
    return evs;
  };

  it('sozinho na praça captura em 8 s; dois capturam mais rápido', () => {
    const one = atB([{ id: 'a', team: 0 }]);
    run(one.m, CONTROL.captureTicks - 1);
    expect(one.b.owner).toBeNull();
    const ev = run(one.m, 2);
    expect(one.b.owner).toBe(0);
    expect(ev.find((e) => e.type === 'pointCaptured')).toMatchObject({ point: 'B', team: 0, by: ['a'] });
    const two = atB([{ id: 'a', team: 0 }, { id: 'c', team: 0, dx: 1 }]);
    run(two.m, Math.ceil(CONTROL.captureTicks / 1.5) + 1);
    expect(two.b.owner).toBe(0);
  });

  it('com os dois times dentro, congela; inimigo caído não impede', () => {
    const { m, b } = atB([{ id: 'a', team: 0 }, { id: 'x', team: 1, dx: 2 }]);
    run(m, 200);
    expect(b.contested).toBe(true);
    expect(b.progress).toBe(0);
    const x = m.sim.fighters.find((f) => f.id === 'x')!;
    enterState(x, 'downed', DEFAULT_CONSTANTS.downed.ticks);
    run(m, CONTROL.captureTicks + 2);
    expect(b.owner).toBe(0);
  });

  it('o rival primeiro neutraliza, depois captura', () => {
    const { m, b } = atB([{ id: 'a', team: 0 }]);
    run(m, CONTROL.captureTicks + 2);
    expect(b.owner).toBe(0);
    const a = m.sim.fighters.find((f) => f.id === 'a')!;
    a.pos = { x: 300, z: 0 };
    const x = addPlayer(m, { id: 'x', nick: 'x', team: 1, bot: false });
    x.pos = { ...b.pos };
    const lost = run(m, CONTROL.captureTicks + 2);
    expect(lost.some((e) => e.type === 'pointLost' && e.team === 0)).toBe(true);
    expect(b.owner).toBeNull();
    run(m, CONTROL.captureTicks + 2);
    expect(b.owner).toBe(1);
  });

  it('ponto dominado soma 1 no placar a cada 10 s', () => {
    const { m } = atB([{ id: 'a', team: 0 }]);
    run(m, CONTROL.captureTicks + 2);
    const before = m.score[0];
    run(m, CONTROL.scoreEveryTicks * 3);
    expect(m.score[0] - before).toBe(3);
    expect(m.pointScore[0]).toBeGreaterThanOrEqual(3);
  });

  it('bots disputam os pontos (sem humanos, alguém captura em 1 min)', () => {
    const m = createMatch('bots', 11, 60000);
    const brains = [];
    for (const team of [0, 1] as const) {
      for (let i = 0; i < MATCH.teamSize; i++) {
        const id = `bot-${team}-${i}`;
        addPlayer(m, { id, nick: id, team, bot: true });
        brains.push(createBrain(id, 11 * 1000 + i));
      }
    }
    for (let t = 0; t < 3600; t++) {
      const inputs: Record<string, PlayerInput> = {};
      for (const br of brains) inputs[br.id] = botInput(m, br);
      stepMatch(m, inputs);
    }
    expect(m.points.filter((p) => p.owner !== null).length).toBeGreaterThan(0);
  });
});
