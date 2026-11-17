import { describe, expect, it } from 'vitest';
import { Buttons, cloneSim, createSim, DEFAULT_COMBAT_DATA, InputQueue, NEUTRAL_INPUT, type PlayerInput, Predictor, step, toSnapshot } from '../src';

const inp = (buttons = 0, moveX = 0, moveZ = 0, aim = 0): PlayerInput => ({ moveX, moveZ, aim, buttons });

describe('fila de inputs do servidor', () => {
  it('consome um por tick, em ordem, e repete o último quando falta', () => {
    const q = new InputQueue();
    q.push(1, inp(0, 1));
    q.push(2, inp(0, 0, 1));
    expect(q.next().moveX).toBe(1);
    expect(q.ack).toBe(1);
    expect(q.next().moveZ).toBe(1);
    expect(q.next().moveZ).toBe(1); // vazia: repete
    expect(q.ack).toBe(2);
  });

  it('ignora duplicados e fora de ordem', () => {
    const q = new InputQueue();
    q.push(5, inp(Buttons.LIGHT));
    q.push(5, inp(0));
    q.push(3, inp(0));
    expect(q.size).toBe(1);
  });

  it('fila cheia junta os mais antigos sem perder um toque de botão', () => {
    const q = new InputQueue(2);
    q.push(1, inp(Buttons.LIGHT)); // toque rápido
    q.push(2, inp(0));
    q.push(3, inp(0));
    expect(q.size).toBe(2);
    expect(q.next().buttons & Buttons.LIGHT).toBeTruthy();
  });
});

describe('predição do cliente', () => {
  it('reconciliar no meio de uma subida no carro (travessia) chega no mesmo lugar e altura', () => {
    const car = { x: 0, z: 3, hw: 0.95, hd: 2.2, h: 1.45, kind: 'carro' as const, color: '#000' };
    const collision = { boxes: [car], circles: [], halfW: 50, halfD: 50 };
    const server = createSim(
      [
        { id: 'me', team: 0, pos: { x: 0, z: 0 } },
        { id: 'out', team: 1, pos: { x: 20, z: 20 } },
      ],
      { collision },
    );
    // Encosta no carro, Espaço (sobe), anda em cima e cai do outro lado.
    const script = (t: number) => inp(t === 10 ? Buttons.JUMP : 0, 0, t < 60 ? 1 : 0);
    const pred = new Predictor('me', { sedes: server.sedes, arenaHalfSize: server.arenaHalfSize, collision });
    pred.reconcile(0, 0, server.fighters[0]!, server.fighters.map((f) => toSnapshot(server, f)));
    let snap: { tick: number; self: string; others: ReturnType<typeof toSnapshot>[] } | null = null;
    for (let seq = 1; seq <= 40; seq++) {
      pred.applyLocal(seq, script(seq));
      step(server, { me: script(seq) });
      if (seq === 20) snap = { tick: server.tick, self: JSON.stringify(server.fighters[0]), others: server.fighters.map((f) => toSnapshot(server, f)) };
    }
    expect(server.fighters[0]?.state === 'traverse' || (server.fighters[0]?.y ?? 0) > 1).toBe(true);
    if (!snap) return;
    pred.reconcile(snap.tick, 20, JSON.parse(snap.self), snap.others);
    const me = server.fighters[0]!;
    expect(pred.self?.state).toBe(me.state);
    expect(pred.self?.pos.z).toBeCloseTo(me.pos.z, 9);
    expect(pred.self?.y).toBeCloseTo(me.y, 9);
  });

  it('reconciliar com o servidor e reaplicar os inputs pendentes chega no mesmo estado do servidor', () => {
    const server = createSim([
      { id: 'me', team: 0, pos: { x: 0, z: 0 } },
      { id: 'out', team: 1, pos: { x: 20, z: 20 } },
    ]);
    const script = (t: number) => inp((t % 25 === 3 ? Buttons.LIGHT : 0) | (t > 40 && t < 80 ? Buttons.RUN : 0) | (t === 90 ? Buttons.JUMP : 0), Math.sin(t / 20), Math.cos(t / 30), t / 50);
    const pred = new Predictor('me', { sedes: server.sedes, arenaHalfSize: server.arenaHalfSize });
    pred.reconcile(0, 0, server.fighters[0]!, server.fighters.map((f) => toSnapshot(server, f)));

    let snapshot: { tick: number; ack: number; self: string; others: ReturnType<typeof toSnapshot>[] } | null = null;
    for (let seq = 1; seq <= 150; seq++) {
      pred.applyLocal(seq, script(seq));
      step(server, { me: script(seq) });
      // O servidor "responde" com 6 ticks de atraso: guarda o snapshot do tick 100.
      if (seq === 100) snapshot = { tick: server.tick, ack: seq, self: JSON.stringify(server.fighters[0]), others: server.fighters.map((f) => toSnapshot(server, f)) };
    }
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    // A rede entrega JSON: o estado tem que sobreviver à serialização.
    pred.reconcile(snapshot.tick, snapshot.ack, JSON.parse(snapshot.self), snapshot.others);
    const me = server.fighters[0]!;
    expect(pred.self?.pos.x).toBeCloseTo(me.pos.x, 9);
    expect(pred.self?.pos.z).toBeCloseTo(me.pos.z, 9);
    expect(pred.self?.state).toBe(me.state);
    expect(pred.self?.stamina).toBeCloseTo(me.stamina, 9);
    expect(pred.unconfirmed).toBe(50);
  });

  it('estado do lutador sobrevive a JSON (sem Infinity virando null)', () => {
    const s = createSim([{ id: 'a', team: 0 }]);
    const copy = cloneSim(s);
    const viaJson = JSON.parse(JSON.stringify(s.fighters[0]));
    expect(viaJson).toEqual(copy.fighters[0]);
  });
});

describe('compensação de lag do tiro', () => {
  it('acerta onde o atirador via o alvo, mesmo que o alvo já tenha saído da linha', () => {
    const run = (view?: Map<string, { x: number; z: number }>) => {
      const s = createSim([
        { id: 'a', team: 0, pos: { x: 0, z: 0 }, facing: 0, weapon: 'pistola' },
        // Agora o alvo está 3 m para o lado (fora da linha); na tela do atirador ainda estava na frente.
        { id: 'b', team: 1, pos: { x: 3, z: 10 }, facing: Math.PI },
      ]);
      const hooks = view ? { shotView: (id: string) => (id === 'a' ? view : undefined) } : undefined;
      const hits = [];
      for (let t = 1; t <= 12; t++) {
        const ev = step(s, { a: { ...NEUTRAL_INPUT, aim: 0, buttons: t === 1 ? Buttons.LIGHT : 0 } }, DEFAULT_COMBAT_DATA, hooks);
        hits.push(...ev.filter((e) => e.type === 'hit'));
      }
      return hits.length;
    };
    expect(run()).toBe(0);
    expect(run(new Map([['b', { x: 0, z: 10 }]]))).toBe(1);
  });
});
