import { type CharacterVisual, createSim, type FighterSnapshot, type TeamSide, toSnapshot } from '@torcidas/shared';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CharacterView } from '../game/character';

interface Props {
  team: TeamSide;
  visual: CharacterVisual;
}

interface Stage {
  scene: THREE.Scene;
  view: CharacterView | null;
  snap: FighterSnapshot;
}

/** Prévia 3D do personagem: o mesmo boneco da partida, em guarda, girando (arraste para girar). */
export function CharacterPreview({ team, visual }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const yaw = useRef(0.5);
  const dragging = useRef<number | null>(null);

  // Renderer e cena: um só por prévia (trocar opção não cria outro contexto WebGL).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2118, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(0, 1.25, 3.6);
    camera.lookAt(0, 0.98, 0);
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
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (dragging.current === null) yaw.current += dt * 0.6;
      const st = stage.current;
      st?.view?.update({ ...st.snap, facing: yaw.current }, camera, dt);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
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

  // Boneco: remonta quando o visual ou a torcida mudam.
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const view = new CharacterView('preview', team, '', true, true, visual);
    st.scene.add(view.root);
    st.view = view;
    st.snap = { ...st.snap, team };
    return () => {
      st.scene.remove(view.root);
      view.dispose();
      if (st.view === view) st.view = null;
    };
  }, [team, visual]);

  return (
    <canvas
      ref={canvasRef}
      className="char-preview"
      aria-label="Prévia do personagem (arraste para girar)"
      onPointerDown={(e) => {
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
