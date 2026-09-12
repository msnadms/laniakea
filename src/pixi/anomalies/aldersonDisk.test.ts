import { describe, expect, it } from 'vitest';
import { aldersonDiskOuterRadius } from './aldersonDisk';

describe('Alderson disk sizing', () => {
  it('uses the preferred planet clearance when the disk has ample room', () => {
    expect(aldersonDiskOuterRadius(100, 1_000)).toBe(880);
  });

  it('never extends beyond the first surviving planet clearance', () => {
    expect(aldersonDiskOuterRadius(100, 500)).toBe(500);
  });
});
