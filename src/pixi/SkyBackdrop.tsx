import { useApplication } from '@pixi/react';
import { Ticker } from 'pixi.js';
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { SKY_FLAT_FOCAL, SKY_PARALLAX_FACTOR, SKY_PARALLAX_MARGIN } from '../game/constants';
import { createSky, flatSkyView, type SkyLook } from './sky';
import type { Camera3D } from './projection';

interface Props {
  themeSeed: number;
  viewSeed: number;
  look: SkyLook;
  camera?: MutableRefObject<{ x: number; y: number; scale: number }>;
  orbit?: MutableRefObject<Camera3D>;
}

export function SkyBackdrop({ themeSeed, viewSeed, look, camera, orbit }: Props) {
  const { app, isInitialised } = useApplication();

  useEffect(() => {
    if (!isInitialised) return;
    const stage = app.stage;
    const renderer = app.renderer;
    const sky = createSky(renderer, themeSeed, look);
    const view = flatSkyView(viewSeed, SKY_FLAT_FOCAL);
    const margin = camera ? SKY_PARALLAX_MARGIN : 0;
    stage.addChildAt(sky.node, 0);

    const followOrbit = () => {
      if (!orbit) return false;
      const { yaw, tilt } = orbit.current;
      if (yaw === view.orbitYaw && tilt === view.orbitTilt) return false;
      view.orbitYaw = yaw;
      view.orbitTilt = tilt;
      return true;
    };
    followOrbit();
    const draw = () => sky.render(app.screen.width + margin * 2, app.screen.height + margin * 2, view);
    draw();
    renderer.on('resize', draw);

    const clampParallax = (offset: number) => Math.max(-margin, Math.min(margin, offset * SKY_PARALLAX_FACTOR));
    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      sky.twinkle(elapsedSecs);
      if (followOrbit()) draw();
      const parallaxX = camera ? clampParallax(camera.current.x - app.screen.width / 2) : 0;
      const parallaxY = camera ? clampParallax(camera.current.y - app.screen.height / 2) : 0;
      sky.node.position.set(parallaxX - margin, parallaxY - margin);
    };
    tick(Ticker.shared);
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      renderer.off('resize', draw);
      stage.removeChild(sky.node);
      sky.destroy();
    };
  }, [app, camera, orbit, isInitialised, themeSeed, viewSeed, look]);

  return null;
}
