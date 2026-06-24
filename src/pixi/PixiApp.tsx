import { Application } from '@pixi/react';
import { useUIStore } from '../store/uiStore';
import { GalaxyWorld } from './GalaxyStage';
import { SuperclusterWorld } from './Supercluster';
import { SolarSystem } from './SolarSystem';

export function PixiApp() {
  const view = useUIStore((s) => s.view);
  const viewTransitioning = useUIStore((s) => s.viewTransitioning);
  return (
    <>
      <Application resizeTo={window} background={0x050810} antialias>
        {view === 'supercluster' && <SuperclusterWorld />}
        {view === 'galaxy' && <GalaxyWorld />}
        {view === 'system' && <SolarSystem />}
      </Application>
      <div style={{
        position: 'fixed', inset: 0,
        background: '#000',
        opacity: viewTransitioning ? 1 : 0,
        transition: 'opacity 150ms ease',
        pointerEvents: 'none',
        zIndex: 9999,
      }} />
    </>
  );
}
