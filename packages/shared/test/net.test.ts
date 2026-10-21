import { describe, expect, it } from 'vitest';
import { Buttons, cloneSim, createSim, InputQueue, type PlayerInput, Predictor, step, toSnapshot } from '../src';

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
