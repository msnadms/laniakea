import { describe, expect, it } from 'vitest';
import {
  buildScanGraph,
  combinedHeat,
  heatAt,
  heatBloom,
  heatColor,
  heatNoise,
  jitteredHeat,
  noiseAmount,
  readHeat,
  type ScanHeatSource,
} from './scanGraph';

const origin = { x: 0, y: 0, z: 0 };

function source(partial: Partial<ScanHeatSource>): ScanHeatSource {
  return {
    x: 0, y: 0, z: 0, radius: 1000,
    bloom: 200, signals: [0, 0, 0, 3],
    ...partial,
  };
}

describe('buildScanGraph', () => {
  it('radiates a connected tree out of the anchor', () => {
    const points = [];
    for (let i = 1; i <= 20; i++) points.push({ x: i * 10, y: 0, z: 0 });
    const graph = buildScanGraph(origin, points);
    expect(graph.nodes.slice(0, 3)).toEqual([0, 0, 0]);
    expect(graph.edges.length).toBe(graph.nodes.length / 3 * 2 - 2);
    const reached = new Set([0]);
    for (let e = 0; e < graph.edges.length; e += 2) {
      expect(reached.has(graph.edges[e])).toBe(true);
      reached.add(graph.edges[e + 1]);
    }
    expect(reached.size).toBe(graph.nodes.length / 3);
  });

  it('samples down to the node budget and never repeats the anchor', () => {
    const points = [origin];
    for (let i = 1; i <= 500; i++) points.push({ x: i, y: i, z: 0 });
    const graph = buildScanGraph(origin, points, 12);
    expect(graph.nodes.length / 3).toBeLessThanOrEqual(12);
    expect(graph.nodes.filter((_, i) => i % 3 === 0).filter((x) => x === 0).length).toBe(1);
  });
});

describe('scan heat', () => {
  it('falls off with distance from the contact and is silent without one', () => {
    const contact = source({});
    expect(heatAt(contact, 0, 0, 0)).toBeGreaterThan(heatAt(contact, 300, 0, 0));
    expect(heatAt(source({ signals: [] }), 0, 0, 0)).toBe(0);
  });

  it('narrows where a tighter sweep overlaps and leaves the rest alone', () => {
    const wide = source({ radius: 1000, bloom: 400 });
    const tight = source({ x: 600, y: 0, z: 0, radius: 200, bloom: 60, signals: [600, 0, 0, 3] });
    expect(combinedHeat([wide, tight], 760, 0, 0)).toBeLessThan(heatAt(wide, 760, 0, 0));
    expect(combinedHeat([wide, tight], 0, 0, 0)).toBe(heatAt(wide, 0, 0, 0));
    const barren = source({ x: 600, y: 0, z: 0, radius: 200, signals: [] });
    expect(combinedHeat([wide, barren], 600, 0, 0)).toBe(0);
    expect(combinedHeat([wide, barren], 0, 0, 0)).toBeGreaterThan(0);
  });

  it('reads nothing outside every swept sphere', () => {
    expect(combinedHeat([source({ radius: 100 })], 500, 0, 0)).toBe(0);
  });
});

describe('re-scanning the same volume', () => {
  const width = (sources: ScanHeatSource[], offset: number) =>
    combinedHeat(sources, offset, 0, 0) / combinedHeat(sources, 0, 0, 0);

  it('keeps the peak and pulls the swell in around it', () => {
    const first = source({ bloom: 200, radius: 2000 });
    const second = source({ bloom: 200, radius: 2000 });
    const offset = heatBloom(first);
    expect(combinedHeat([first, second], 0, 0, 0)).toBeCloseTo(combinedHeat([first], 0, 0, 0));
    expect(width([first, second], offset)).toBeLessThan(width([first], offset) * 0.6);
  });

  it('narrows further with each further reading', () => {
    const sweep = () => source({ bloom: 200, radius: 2000 });
    const offset = heatBloom(sweep());
    const two = width([sweep(), sweep()], offset);
    const three = width([sweep(), sweep(), sweep()], offset);
    expect(three).toBeLessThan(two);
  });

  it('counts the sweeps that covered a point and quiets the noise as they pile up', () => {
    const one = source({ radius: 1000 });
    const two = source({ radius: 1000 });
    expect(readHeat([one, two], 0, 0, 0).coverage).toBe(2);
    expect(readHeat([one, two], 2000, 0, 0).coverage).toBe(0);
    expect(noiseAmount(2)).toBeLessThan(noiseAmount(1) * 0.5);
    expect(noiseAmount(3)).toBeLessThan(noiseAmount(2));
  });
});

describe('what a colour means', () => {
  it('reads a contact hot wherever it sits, however faint the civilisation', () => {
    const faint = source({ signals: [0, 0, 0, 0] });
    const loud = source({ signals: [0, 0, 0, 3] });
    for (const cell of [120, 400, 900]) {
      expect(jitteredHeat([faint], 0, 0, 0, cell)).toBeCloseTo(1);
      expect(jitteredHeat([loud], 0, 0, 0, cell)).toBeCloseTo(1);
    }
  });

  it('never lets a decoy outrank a real contact', () => {
    const swept = source({ signals: [0, 0, 0, 2], bloom: 150, radius: 4000 });
    let hottestDecoy = 0;
    for (let i = 1; i < 400; i++) {
      const far = 3000 + i;
      hottestDecoy = Math.max(hottestDecoy, jitteredHeat([swept], far, 0, 0, 200));
    }
    expect(hottestDecoy).toBeLessThan(noiseAmount(1) + 1e-6);
    expect(hottestDecoy).toBeLessThan(jitteredHeat([swept], 0, 0, 0, 200));
  });

  it('reads nothing at all outside every sweep', () => {
    expect(jitteredHeat([source({ radius: 100 })], 900, 0, 0, 200)).toBe(0);
  });
});

describe('ambiguity', () => {
  it('spreads the peak well past the resolution it was read at', () => {
    const wide = source({ bloom: 200, radius: 2000 });
    expect(heatBloom(wide)).toBeGreaterThan(wide.bloom);
    expect(heatAt(wide, wide.bloom, 0, 0)).toBeGreaterThan(heatAt(wide, 0, 0, 0) * 0.75);
  });

  it('is noisy over a whole neighbourhood, not per node', () => {
    const cell = 400;
    const near = Math.abs(heatNoise(0, 0, 0, cell) - heatNoise(8, 6, 4, cell));
    let far = 0;
    for (let i = 1; i <= 8; i++) far = Math.max(far, Math.abs(heatNoise(0, 0, 0, cell) - heatNoise(i * cell, 0, 0, cell)));
    expect(near).toBeLessThan(0.05);
    expect(far).toBeGreaterThan(near * 4);
  });

  it('keeps the noise inside the unit range', () => {
    for (let i = 0; i < 200; i++) {
      const value = heatNoise(i * 37, i * -19, i * 11, 250);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('several signals', () => {
  it('peaks at each one rather than at their average', () => {
    const pair = source({ bloom: 100, signals: [-600, 0, 0, 3, 600, 0, 0, 3] });
    expect(heatAt(pair, -600, 0, 0)).toBeGreaterThan(heatAt(pair, 0, 0, 0));
    expect(heatAt(pair, 600, 0, 0)).toBeGreaterThan(heatAt(pair, 0, 0, 0));
    expect(heatAt(pair, 600, 0, 0)).toBe(heatAt(pair, -600, 0, 0));
  });

  it('reads every contact at full heat and lets the loud one carry further', () => {
    const faint = source({ bloom: 400, signals: [0, 0, 0, 0] });
    const loud = source({ bloom: 400, signals: [0, 0, 0, 3] });
    expect(heatAt(faint, 0, 0, 0)).toBeCloseTo(heatAt(loud, 0, 0, 0));
    expect(heatAt(loud, 900, 0, 0)).toBeGreaterThan(heatAt(faint, 900, 0, 0));
  });
});

describe('heatColor', () => {
  it('walks the ramp and clamps at both ends', () => {
    expect(heatColor(-1)).toBe(heatColor(0));
    expect(heatColor(2)).toBe(heatColor(1));
    expect(heatColor(0)).not.toBe(heatColor(1));
  });
});
