import { Ticker } from 'pixi.js';
import type { Container } from 'pixi.js';
import { useUIStore } from '../store/uiStore';

let _backZoomFn: (() => boolean) | null = null;
export function registerBackZoom(fn: (() => boolean) | null): void { _backZoomFn = fn; }
export function fireBackZoom(): boolean { return _backZoomFn ? _backZoomFn() : false; }

type CodexNavigateFn = (onFadeStart: () => void, onComplete: () => void) => boolean;
let _codexNavigateFn: CodexNavigateFn | null = null;
export function registerCodexNavigate(fn: CodexNavigateFn | null): void { _codexNavigateFn = fn; }
export function fireCodexNavigate(onFadeStart: () => void, onComplete: () => void): boolean {
  return _codexNavigateFn ? _codexNavigateFn(onFadeStart, onComplete) : false;
}

const FADE_START_T = 0.9;

// Anchor math is intentionally identical to scroll-wheel zoom: worldX/Y stays pinned at anchorScreenX/Y.
export function animateZoomTo(
  camera: { current: { x: number; y: number; scale: number } },
  world: Container,
  worldX: number,
  worldY: number,
  anchorScreenX: number,
  anchorScreenY: number,
  scaleMult: number,
  durationMs: number,
  onFadeStart: () => void,
  onComplete: () => void,
  easeOut = false,
): () => void {
  const fadeStart = easeOut ? 0.2 : FADE_START_T;
  const startScale = camera.current.scale;
  const targetScale = startScale * scaleMult;
  let elapsed = 0;
  let fadeFired = false;

  const tick = (ticker: Ticker) => {
    elapsed += ticker.deltaMS;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = easeOut
      ? (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
      : (t === 0 ? 0 : Math.pow(2, 10 * t - 10));

    const scale = startScale + (targetScale - startScale) * eased;
    camera.current.scale = scale;
    camera.current.x = anchorScreenX - worldX * scale;
    camera.current.y = anchorScreenY - worldY * scale;
    world.scale.set(scale);
    world.position.set(camera.current.x, camera.current.y);

    if (!fadeFired && t >= fadeStart) {
      fadeFired = true;
      onFadeStart();
    }

    if (t >= 1) {
      Ticker.shared.remove(tick);
      onComplete();
    }
  };

  Ticker.shared.add(tick);
  return () => Ticker.shared.remove(tick);
}

// startScaleMult < 1 → zoom-in (camera position fixed); > 1 → zoom-out (pinX/Y pinned to screen center).
export function animateIntro(
  camera: { current: { x: number; y: number; scale: number } },
  world: Container,
  durationMs: number,
  startScaleMult: number,
  pinWorldX?: number,
  pinWorldY?: number,
): () => void {
  const targetScale = camera.current.scale;
  const startScale = targetScale * startScaleMult;
  const pinned = startScaleMult > 1;
  const screenCX = window.innerWidth / 2;
  const screenCY = window.innerHeight / 2;
  const wx = pinWorldX ?? 0;
  const wy = pinWorldY ?? 0;
  const anchorX = camera.current.x;
  const anchorY = camera.current.y;
  const getX = pinned ? (s: number) => screenCX - wx * s : () => anchorX;
  const getY = pinned ? (s: number) => screenCY - wy * s : () => anchorY;

  camera.current.scale = startScale;
  camera.current.x = getX(startScale);
  camera.current.y = getY(startScale);
  world.scale.set(startScale);
  world.position.set(camera.current.x, camera.current.y);

  let elapsed = 0;

  const tick = (ticker: Ticker) => {
    elapsed += ticker.deltaMS;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    const scale = startScale + (targetScale - startScale) * eased;
    camera.current.scale = scale;
    camera.current.x = getX(scale);
    camera.current.y = getY(scale);
    world.scale.set(scale);
    world.position.set(camera.current.x, camera.current.y);
    if (t >= 1) Ticker.shared.remove(tick);
  };

  Ticker.shared.add(tick);
  return () => Ticker.shared.remove(tick);
}

export function registerCodexZoomOut(
  camera: { current: { x: number; y: number; scale: number } },
  worldRef: { current: Container | null },
  isAnimatingRef: { current: boolean },
  cancelZoomRef: { current: (() => void) | null },
  resetCamera?: () => void,
): () => void {
  registerCodexNavigate((onFadeStart, onComplete) => {
    if (isAnimatingRef.current || !worldRef.current) return false;
    cancelZoomRef.current?.();
    isAnimatingRef.current = true;
    const cx = (window.innerWidth / 2 - camera.current.x) / camera.current.scale;
    const cy = (window.innerHeight / 2 - camera.current.y) / camera.current.scale;
    cancelZoomRef.current = animateZoomTo(
      camera, worldRef.current, cx, cy,
      window.innerWidth / 2, window.innerHeight / 2,
      1 / 12, 1200,
      onFadeStart,
      () => {
        isAnimatingRef.current = false;
        cancelZoomRef.current = null;
        const viewBefore = useUIStore.getState().view;
        onComplete();
        // If the view didn't change (same-view Codex navigation), no new component
        // will mount to pick up viewTransitioning, so run the intro directly here.
        if (useUIStore.getState().view === viewBefore && worldRef.current) {
          const ui = useUIStore.getState();
          if (ui.viewTransitioning) {
            ui.setViewTransitioning(false);
            resetCamera?.();
            cancelZoomRef.current = animateIntro(camera, worldRef.current, 700, 0.2);
          }
        }
      },
      true
    );
    return true;
  });
  return () => registerCodexNavigate(null);
}

export function registerZoomOutBack(
  camera: { current: { x: number; y: number; scale: number } },
  worldRef: { current: Container | null },
  isAnimatingRef: { current: boolean },
  cancelZoomRef: { current: (() => void) | null },
  onNavigate: () => void,
  onFadeStart: () => void,
): () => void {
  registerBackZoom(() => {
    if (isAnimatingRef.current || !worldRef.current) return false;
    isAnimatingRef.current = true;
    const cx = (window.innerWidth / 2 - camera.current.x) / camera.current.scale;
    const cy = (window.innerHeight / 2 - camera.current.y) / camera.current.scale;
    cancelZoomRef.current = animateZoomTo(
      camera, worldRef.current, cx, cy,
      window.innerWidth / 2, window.innerHeight / 2,
      1 / 12, 1200,
      onFadeStart,
      () => {
        isAnimatingRef.current = false;
        cancelZoomRef.current = null;
        onNavigate();
      },
      true
    );
    return true;
  });
  return () => registerBackZoom(null);
}
