import { useRef, useEffect, useState } from 'react';
import { useApplication } from '@pixi/react';
import type { Container, FederatedPointerEvent } from 'pixi.js';
import {
  CAMERA_MIN_SCALE,
  CAMERA_MAX_SCALE,
  CAMERA_ZOOM_FACTOR,
  DRAG_THRESHOLD_PX,
} from '../game/constants';
import { cancelIntroZoom } from './zoomAnim';

export function useCamera(
  worldRef: React.RefObject<Container | null>,
  initialScale: number,
  onStageTap?: () => void,
  minScale: number = CAMERA_MIN_SCALE,
) {
  const { app, isInitialised } = useApplication();
  const appRef = useRef(app);
  useEffect(() => {
    appRef.current = app;
  }, [app]);
  const camera = useRef({ x: 0, y: 0, scale: initialScale });
  const [isReady, setIsReady] = useState(false);
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const cameraStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    camera.current.x = app.screen.width / 2;
    camera.current.y = app.screen.height / 2;
    worldRef.current.position.set(camera.current.x, camera.current.y);
    worldRef.current.scale.set(camera.current.scale);
    setIsReady(true);
  }, [app, isInitialised, worldRef]);

  useEffect(() => {
    if (!isInitialised) return;
    const pixi = appRef.current;
    const stage = pixi.stage;
    const canvas = pixi.canvas;

    stage.eventMode = 'static';
    stage.hitArea = pixi.screen;

    const onDown = (event: FederatedPointerEvent) => {
      isDragging.current = true;
      hasDragged.current = false;
      dragStart.current = { x: event.globalX, y: event.globalY };
      cameraStart.current = { x: camera.current.x, y: camera.current.y };
    };

    const onMove = (event: FederatedPointerEvent) => {
      if (!isDragging.current || !worldRef.current) return;
      const deltaX = event.globalX - dragStart.current.x;
      const deltaY = event.globalY - dragStart.current.y;
      if (!hasDragged.current && (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX))
        hasDragged.current = true;
      camera.current.x = cameraStart.current.x + deltaX;
      camera.current.y = cameraStart.current.y + deltaY;
      worldRef.current.position.set(camera.current.x, camera.current.y);
    };

    const onUp = (event: FederatedPointerEvent) => {
      if (!hasDragged.current && event.target === stage) onStageTap?.();
      isDragging.current = false;
    };

    const onUpOutside = () => { isDragging.current = false; };

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUpOutside);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!worldRef.current) return;
      cancelIntroZoom();
      const zoomFactor = event.deltaY < 0 ? CAMERA_ZOOM_FACTOR : 1 / CAMERA_ZOOM_FACTOR;
      const mouseX = event.clientX;
      const mouseY = event.clientY;
      const worldX = (mouseX - camera.current.x) / camera.current.scale;
      const worldY = (mouseY - camera.current.y) / camera.current.scale;
      camera.current.scale = Math.max(minScale, Math.min(CAMERA_MAX_SCALE, camera.current.scale * zoomFactor));
      camera.current.x = mouseX - worldX * camera.current.scale;
      camera.current.y = mouseY - worldY * camera.current.scale;
      worldRef.current.position.set(camera.current.x, camera.current.y);
      worldRef.current.scale.set(camera.current.scale);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMove);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUpOutside);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [app, isInitialised, onStageTap, minScale, worldRef]);

  return { camera, isReady };
}
