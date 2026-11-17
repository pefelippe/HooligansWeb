import { PROTOCOL_VERSION, type FighterSnapshot, type ServerMessage } from './protocol';

// Snapshot binário. Os lutadores (a parte que cresce com a sala) vão em campos fixos,
// com as strings (ids, golpes, armas, estados) numa tabela no começo da mensagem.
// O resto (placar, `self` da predição, arremessos, nuvens) vai num JSON curto no fim.
//
//   u8 versão · u8 tipo · u32 tick · u32 ackSeq
//   u16 nStrings · (u8 len · utf8)×n
//   u16 nLutadores · lutador×n
//   u32 lenJson · json

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

const KIND_SNAPSHOT = 1;
const NULL_STR = 0xffff;
const NULL_I16 = -32768;

type FieldType = 'str' | 'str?' | 'strs' | 'bool' | 'u8' | 'i16?' | 'i32' | 'f32' | 'cm' | 'rad';

/** Ordem e tipo de cada campo do lutador. Mudou aqui, sobe o PROTOCOL_VERSION. */
const FIGHTER_FIELDS: readonly (readonly [keyof FighterSnapshot, FieldType])[] = [
  ['id', 'str'],
  ['team', 'u8'],
  ['y', 'f32'],
  ['running', 'bool'],
  ['facing', 'rad'],
  ['hp', 'f32'],
  ['stamina', 'f32'],
  ['state', 'str'],
  ['stateTick', 'i32'],
  ['stateDuration', 'i32'],
  ['move', 'str?'],
  ['charge', 'f32'],
  ['weapon', 'str'],
  ['level', 'i32'],
  ['durability', 'i16?'],
  ['bag', 'strs'],
  ['invulnerable', 'bool'],
  ['parryLive', 'bool'],
  ['armored', 'bool'],
  ['bleeding', 'u8'],
  ['hitstop', 'u8'],
  ['lockTarget', 'str?'],
  ['money', 'i32'],
  ['kos', 'i32'],
  ['deaths', 'i32'],
  ['assists', 'i32'],
  ['curativos', 'u8'],
  ['bandagens', 'u8'],
  ['bombas', 'u8'],
  ['gases', 'u8'],
  ['colete', 'i32'],
  ['inHand', 'str?'],
  ['koTick', 'i32'],
  ['raca', 'f32'],
  ['fury', 'f32'],
  ['slowed', 'bool'],
  ['buffed', 'bool'],
  ['counter', 'bool'],
  ['dodgeKind', 'str'],
  ['channel', 'f32'],
];

// Node e navegador têm os dois; o tsconfig do shared não carrega os tipos de nenhum dos dois.
const g = globalThis as unknown as {
  TextEncoder: new () => { encode(s: string): Uint8Array };
  TextDecoder: new () => { decode(b: Uint8Array): string };
};
const enc = new g.TextEncoder();
const dec = new g.TextDecoder();

class Writer {
  private buf = new ArrayBuffer(4096);
  private view = new DataView(this.buf);
  private bytes = new Uint8Array(this.buf);
  at = 0;

  private need(n: number): void {
    if (this.at + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.at + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.bytes.subarray(0, this.at));
    this.buf = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }
  u8(v: number) { this.need(1); this.view.setUint8(this.at, v); this.at += 1; }
  u16(v: number) { this.need(2); this.view.setUint16(this.at, v); this.at += 2; }
  i16(v: number) { this.need(2); this.view.setInt16(this.at, v); this.at += 2; }
  u32(v: number) { this.need(4); this.view.setUint32(this.at, v); this.at += 4; }
  i32(v: number) { this.need(4); this.view.setInt32(this.at, v); this.at += 4; }
  f32(v: number) { this.need(4); this.view.setFloat32(this.at, v); this.at += 4; }
  raw(b: Uint8Array) { this.need(b.length); this.bytes.set(b, this.at); this.at += b.length; }
  done(): Uint8Array { return this.bytes.slice(0, this.at); }
}

class Reader {
  private view: DataView;
  at = 0;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() { return this.view.getUint8(this.at++); }
  u16() { const v = this.view.getUint16(this.at); this.at += 2; return v; }
  i16() { const v = this.view.getInt16(this.at); this.at += 2; return v; }
  u32() { const v = this.view.getUint32(this.at); this.at += 4; return v; }
  i32() { const v = this.view.getInt32(this.at); this.at += 4; return v; }
  f32() { const v = this.view.getFloat32(this.at); this.at += 4; return v; }
  raw(n: number) { const b = this.bytes.subarray(this.at, this.at + n); this.at += n; return b; }
}

/** Arredonda como o float32 guarda, com 3 casas (o JSON também mandava 3). */
const f3 = (v: number) => Math.round(v * 1000) / 1000;
const clampI16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)));

export function encodeSnapshot(msg: Snapshot): Uint8Array {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const sid = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  // Primeiro os lutadores num buffer próprio (a tabela de strings sai pronta no fim).
  const body = new Writer();
  body.u16(msg.fighters.length);
  for (const f of msg.fighters) {
    body.i16(clampI16(f.pos.x * 100));
    body.i16(clampI16(f.pos.z * 100));
    for (const [key, type] of FIGHTER_FIELDS) {
      const v = f[key] as unknown;
      switch (type) {
        case 'str': body.u16(sid(v as string)); break;
        case 'str?': body.u16(v === null ? NULL_STR : sid(v as string)); break;
        case 'strs': {
          const xs = v as string[];
          body.u8(xs.length);
          for (const x of xs) body.u16(sid(x));
          break;
        }
        case 'bool': body.u8(v ? 1 : 0); break;
        case 'u8': body.u8(Math.max(0, Math.min(255, v as number))); break;
        case 'i16?': body.i16(v === null ? NULL_I16 : clampI16(v as number)); break;
        case 'i32': body.i32(v as number); break;
        case 'f32': body.f32(v as number); break;
        case 'cm': body.i16(clampI16((v as number) * 100)); break;
        case 'rad': body.i16(clampI16(Math.atan2(Math.sin(v as number), Math.cos(v as number)) * 10000)); break;
      }
    }
  }
  if (strings.length >= NULL_STR) throw new Error('snapshot: strings demais');
  const { t: _t, tick, ackSeq, fighters: _f, ...rest } = msg;
  const json = enc.encode(JSON.stringify(rest));

  const w = new Writer();
  w.u8(PROTOCOL_VERSION);
  w.u8(KIND_SNAPSHOT);
  w.u32(tick);
  w.u32(ackSeq);
  w.u16(strings.length);
  for (const s of strings) {
    const b = enc.encode(s);
    if (b.length > 255) throw new Error('snapshot: string longa demais');
    w.u8(b.length);
    w.raw(b);
  }
  w.raw(body.done());
  w.u32(json.length);
  w.raw(json);
  return w.done();
}

/** null: versão ou tipo desconhecido (servidor de outra versão). */
export function decodeSnapshot(bytes: Uint8Array): Snapshot | null {
  const r = new Reader(bytes);
  if (r.u8() !== PROTOCOL_VERSION || r.u8() !== KIND_SNAPSHOT) return null;
  const tick = r.u32();
  const ackSeq = r.u32();
  const strings: string[] = [];
  for (let n = r.u16(), i = 0; i < n; i++) strings.push(dec.decode(r.raw(r.u8())));
  const str = (i: number) => strings[i] ?? '';
  const fighters: FighterSnapshot[] = [];
  for (let n = r.u16(), i = 0; i < n; i++) {
    const f: Record<string, unknown> = { pos: { x: r.i16() / 100, z: r.i16() / 100 } };
    for (const [key, type] of FIGHTER_FIELDS) {
      switch (type) {
        case 'str': f[key] = str(r.u16()); break;
        case 'str?': { const i2 = r.u16(); f[key] = i2 === NULL_STR ? null : str(i2); break; }
        case 'strs': { const xs: string[] = []; for (let k = r.u8(); k > 0; k--) xs.push(str(r.u16())); f[key] = xs; break; }
        case 'bool': f[key] = r.u8() === 1; break;
        case 'u8': f[key] = r.u8(); break;
        case 'i16?': { const v = r.i16(); f[key] = v === NULL_I16 ? null : v; break; }
        case 'i32': f[key] = r.i32(); break;
        case 'f32': f[key] = f3(r.f32()); break;
        case 'cm': f[key] = r.i16() / 100; break;
        case 'rad': f[key] = r.i16() / 10000; break;
      }
    }
    fighters.push(f as unknown as FighterSnapshot);
  }
  const rest = JSON.parse(dec.decode(r.raw(r.u32()))) as Omit<Snapshot, 't' | 'tick' | 'ackSeq' | 'fighters'>;
  return { t: 'snapshot', tick, ackSeq, fighters, ...rest };
}
