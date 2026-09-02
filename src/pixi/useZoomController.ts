import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Container } from 'pixi.js';
import { useUIStore } from '../store/uiStore';
import { animateIntro, registerCodexZoomOut, registerZoomOutBack } from './zoomAnim';

interface ZoomControllerOptions {
  onNavigateBack?: () => void;
  getCurrentPos?: () => { x?: number; y?: number } | undefined;
}

export function useZoomController(
  camera: { current: { x: number; y: number; scale: number } },
  worldRef: RefObject<Container | null>,
  isReady: boolean,
  options: ZoomControllerOptions = {},
) {
  const { onNavigateBack, getCurrentPos } = options;
  const onNavigateBackRef = useRef(onNavigateBack);
  const getCurrentPosRef = useRef(getCurrentPos);
  const isAnimatingRef = useRef(false);
  const cancelZoomRef = useRef<(() => void) | null>(null);
  const initialCameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const hasNavigateBack = !!onNavigateBack;

  useEffect(() => {
    onNavigateBackRef.current = onNavigateBack;
    getCurrentPosRef.current = getCurrentPos;
  }, [onNavigateBack, getCurrentPos]);

  useEffect(() => () => { cancelZoomRef.current?.(); }, []);

  useEffect(() => registerCodexZoomOut(camera, worldRef, isAnimatingRef, cancelZoomRef, () => {
    const init = initialCameraRef.current;
    if (!init || !worldRef.current) return;
    camera.current.x = init.x;
    camera.current.y = init.y;
    camera.current.scale = init.scale;
    worldRef.current.scale.set(init.scale);
    worldRef.current.position.set(init.x, init.y);
  }), [camera, worldRef]);

  useEffect(() => {
    if (!hasNavigateBack) return;
    return registerZoomOutBack(
      camera, worldRef, isAnimatingRef, cancelZoomRef,
      () => onNavigateBackRef.current?.(),
      () => {
        useUIStore.getState().setViewTransitioning(true);
        useUIStore.getState().setTransitionBack(true);
      }
    );
  }, [hasNavigateBack, camera, worldRef]);

  useEffect(() => {
    if (!isReady) return;
    if (!initialCameraRef.current) initialCameraRef.current = { ...camera.current };

    const runIntro = () => {
      const ui = useUIStore.getState();
      if (!ui.viewTransitioning || !worldRef.current) return;
      ui.setViewTransitioning(false);
      const back = ui.transitionBack;
      ui.setTransitionBack(false);
      cancelZoomRef.current?.();
      if (back && getCurrentPosRef.current) {
        const pos = getCurrentPosRef.current();
        cancelZoomRef.current = animateIntro(camera, worldRef.current, 700, 5, pos?.x, pos?.y);
      } else {
        cancelZoomRef.current = animateIntro(camera, worldRef.current, 700, 0.2);
      }
    };

    runIntro();
    // Cover the race where viewTransitioning fires before isReady. The
    // isAnimatingRef guard prevents the *outgoing* view (which has an
    // in-progress zoom-to, so isAnimatingRef=true) from intercepting this
    // signal and cancelling its own animation.
    return useUIStore.subscribe((state, prev) => {
      if (state.viewTransitioning && !prev.viewTransitioning && !isAnimatingRef.current) runIntro();
    });
  }, [isReady, camera, worldRef]);

  return { isAnimatingRef, cancelZoomRef };
}
