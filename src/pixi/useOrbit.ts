import { useEffect, useMemo, useRef } from 'react';
import { useApplication } from '@pixi/react';
import { Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { SC_ORBIT_EASE, SC_ORBIT_SENSITIVITY } from '../game/constants';
import { clampOrbitTilt, createSuperclusterCamera, type Camera3D } from './projection';

const FRAME_MS = 1000 / 60;

export function isOrbitGesture(event: { button: number; shiftKey: boolean }): boolean {
  return event.button === 2 || event.shiftKey;
}

export function useOrbit() {
  const { app, isInitialised } = useApplication();
  const camera = useMemo(() => ({ current: createSuperclusterCamera() }), []);
  const target = useRef<Camera3D>(createSuperclusterCamera());
  const isOrbiting = useRef(false);
  const didOrbit = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, yaw: 0, tilt: 0 });

  useEffect(() => {
    if (!isInitialised) return;
    const stage = app.stage;
    const canvas = app.canvas;

    const onDown = (event: FederatedPointerEvent) => {
      didOrbit.current = false;
      if (!isOrbitGesture(event)) return;
      isOrbiting.current = true;
      dragStart.current = {
        x: event.globalX,
        y: event.globalY,
        yaw: target.current.yaw,
        tilt: target.current.tilt,
      };
    };

    const onMove = (event: FederatedPointerEvent) => {
      if (!isOrbiting.current) return;
      didOrbit.current = true;
      const start = dragStart.current;
      target.current.yaw = start.yaw + (event.globalX - start.x) * SC_ORBIT_SENSITIVITY;
      target.current.tilt = clampOrbitTilt(start.tilt - (event.globalY - start.y) * SC_ORBIT_SENSITIVITY);
    };

    const onUp = () => { isOrbiting.current = false; };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    const tick = (ticker: Ticker) => {
      const ease = 1 - Math.pow(1 - SC_ORBIT_EASE, ticker.deltaMS / FRAME_MS);
      camera.current.yaw += (target.current.yaw - camera.current.yaw) * ease;
      camera.current.tilt += (target.current.tilt - camera.current.tilt) * ease;
    };
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMove);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      isOrbiting.current = false;
      didOrbit.current = false;
    };
  }, [app, isInitialised, camera]);

  return { orbitCamera: camera, didOrbit };
}
