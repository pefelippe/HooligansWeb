import { type CharacterVisual, createSim, type FighterSnapshot, type TeamSide, toSnapshot } from '@torcidas/shared';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CharacterView } from '../game/character';
import { fighterAsset, loadFighterModel } from '../game/fighterModel';

interface Props {
  team: TeamSide;
  visual: CharacterVisual;
  /** Fixa para onde o boneco olha (rad) em vez de girar sozinho; arrastar ainda gira. */
  facing?: number;
  className?: string;
  /** Sem arrastar (decorativo). */
  still?: boolean;
  /** Enquadramento: corpo inteiro ou rosto (editando cabelo, barba, acessório). */
  framing?: 'body' | 'head';
}

// Câmera (posição e alvo) de cada enquadramento; a troca desliza.
const BODY = { pos: new THREE.Vector3(0, 1.25, 3.9), look: new THREE.Vector3(0, 1, 0) }; // cabe 2,00 m de pé
/** Altura da cabeça acompanha a altura do visual (o modelo tem 1,75 m). */
const headFrame = (altura: number) => ({
  pos: new THREE.Vector3(0, (1.72 * altura) / 175, 1.35),
  look: new THREE.Vector3(0, (1.68 * altura) / 175, 0),
});

interface Stage {
  scene: THREE.Scene;
  view: CharacterView | null;
  snap: FighterSnapshot;
}

/** Prévia 3D do personagem: o mesmo boneco da partida, em guarda, girando (arraste para girar). */
export function CharacterPreview({ team, visual, facing, className, still, framing = 'body' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const yaw = useRef(facing ?? 0.5);
  const spin = useRef(facing === undefined);
  const dragging = useRef<number | null>(null);
  const frame = useRef(BODY);
  frame.current = framing === 'head' ? headFrame(visual.altura) : BODY;
  const [model, setModel] = useState(() => fighterAsset() !== null);

  useEffect(() => {
    let live = true;
    void loadFighterModel().then((a) => live && setModel(a !== null));
    return () => {
      live = false;
    };
  }, []);

  // Renderer e cena: um só por prévia (trocar opção não cria outro contexto WebGL).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Um boneco só: dá para renderizar a 2–3× e suavizar as bordas pintadas e do toon.
    renderer.setPixelRatio(Math.min(3, Math.max(2, window.devicePixelRatio * 1.5)));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2118, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.copy(frame.current.pos);
    const look = frame.current.look.clone();
    camera.lookAt(look);
    // Lutador parado em guarda: o snapshot inicial da simulação.
    const sim = createSim([{ id: 'preview', team: 0, pos: { x: 0, z: 0 }, facing: 0 }]);
    stage.current = { scene, view: null, snap: toSnapshot(sim, sim.fighters[0]!) };

    const resize = () => {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (dragging.current === null && spin.current) yaw.current += dt * 0.6;
      const k = 1 - Math.exp(-dt * 8);
      camera.position.lerp(frame.current.pos, k);
      camera.lookAt(look.lerp(frame.current.look, k));
      const st = stage.current;
      st?.view?.update({ ...st.snap, facing: yaw.current }, camera, dt);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.current?.view?.dispose();
      stage.current = null;
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
    };
  }, []);

  // Boneco: remonta quando o visual ou a torcida mudam (pelo conteúdo: o objeto pode ser recriado a cada render).
  const visualKey = JSON.stringify(visual);
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const view = new CharacterView('preview', team, '', true, true, JSON.parse(visualKey) as CharacterVisual);
    st.scene.add(view.root);
    st.view = view;
    st.snap = { ...st.snap, team };
    return () => {
      st.scene.remove(view.root);
      view.dispose();
      if (st.view === view) st.view = null;
    };
  }, [team, visualKey, model]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'char-preview'}
      {...(still ? { 'aria-hidden': true } : { 'aria-label': 'Prévia do personagem (arraste para girar)' })}
      onPointerDown={(e) => {
        if (still) return;
        dragging.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragging.current === null) return;
        yaw.current += (e.clientX - dragging.current) * 0.012;
        dragging.current = e.clientX;
      }}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    />
  );
}
