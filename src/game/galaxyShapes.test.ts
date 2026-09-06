import { describe, expect, it } from 'vitest';
import { GalaxyConfig } from './galaxyConfig';
import { nebulaClouds } from './galaxyShapes';
import {
  BARRED_ARM_ROOT_NEBULA_SPREAD_EXTENT,
  BARRED_ARM_SPREAD_SCALE,
  GALAXY_RADIUS,
  NEBULA_SPREAD,
  NEBULA_STEPS,
} from './constants';

function regularBarredArmSpread(config: GalaxyConfig, t: number) {
  const radiusFraction = config.barLength + (1 - config.barLength) * t;
  const outerTaper = Math.pow(1 - Math.max(0, (t - 0.9) / 0.1), 1.5);
  return GALAXY_RADIUS
    * NEBULA_SPREAD
    * BARRED_ARM_SPREAD_SCALE
    * (0.35 + radiusFraction)
    * (0.5 + 0.5 * outerTaper);
}

describe('barred spiral nebula', () => {
  it('flares at an arm root and returns to its regular width smoothly', () => {
    const config = new GalaxyConfig(() => 0.5, { type: 'barred', numArms: 2 });
    const barCloudCount = Math.round(NEBULA_STEPS * 0.6);
    const arm = nebulaClouds(() => 0.5, config).slice(barCloudCount, barCloudCount + NEBULA_STEPS);
    const first = arm[0];
    const settled = arm.find((cloud) => cloud.t >= BARRED_ARM_ROOT_NEBULA_SPREAD_EXTENT)!;

    expect(first.spread / regularBarredArmSpread(config, first.t)).toBeGreaterThan(2);
    expect(settled.spread).toBeCloseTo(regularBarredArmSpread(config, settled.t));
  });

  it('always creates exactly two opposite arms', () => {
    const config = new GalaxyConfig(() => 0.5, { type: 'barred', numArms: 4 });
    config.galaxyEllipse = 1;
    config.orientation = 0;

    const barCloudCount = Math.round(NEBULA_STEPS * 0.6);
    const clouds = nebulaClouds(() => 0.5, config);
    const step = Math.floor(NEBULA_STEPS / 2);
    const angles = Array.from({ length: config.numArms }, (_, arm) => {
      const cloud = clouds[barCloudCount + arm * NEBULA_STEPS + step];
      return (Math.atan2(cloud.y, cloud.x) + Math.PI * 2) % (Math.PI * 2);
    });

    expect(config.numArms).toBe(2);
    expect(clouds).toHaveLength(barCloudCount + 2 * NEBULA_STEPS);
    expect((angles[1] - angles[0] + Math.PI * 2) % (Math.PI * 2)).toBeCloseTo(Math.PI);
  });
});
