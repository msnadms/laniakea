import { Application } from '@pixi/react';
import { useUIStore } from '../store/uiStore';
import { GalaxyWorld } from './GalaxyStage';
import { SuperclusterWorld } from './Supercluster';
import { SolarSystem } from './SolarSystem';
import { UniverseWorld } from './Universe';

export function PixiApp() {
  const view = useUIStore((s) => s.view);
  const viewTransitioning = useUIStore((s) => s.viewTransitioning);
  return (
    <>
      <Application resizeTo={window} background={0x050810} antialias>
        {view === 'universe' && <UniverseWorld />}
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
        zIndex: 4,
      }} />
    </>
  );
}
