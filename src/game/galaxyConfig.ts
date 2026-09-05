import {
    NEBULA_COLORS,
    INNER_NEBULA_COLORS,
    SPIRAL_TWISTS,
    GALAXY_TYPE_WEIGHTS,
    GALAXY_RADIUS,
    BAR_LENGTH_MIN,
    BAR_LENGTH_MAX,
    BARRED_TWIST_MIN,
    BARRED_TWIST_MAX,
    ELLIPTICAL_CONCENTRATION_MIN,
    ELLIPTICAL_CONCENTRATION_MAX,
    ELLIPTICAL_AXIS_MIN,
    ELLIPTICAL_AXIS_MAX,
    IRREGULAR_CLUMP_MIN,
    IRREGULAR_CLUMP_MAX,
    IRREGULAR_CLUMP_SPREAD,
    IRREGULAR_CLUMP_RADIUS_MIN,
    IRREGULAR_CLUMP_RADIUS_MAX,
} from "./constants";
import type { Rng, GalaxyType } from "./types";

export interface GalaxyClump {
    x: number;
    y: number;
    r: number;
    weight: number;
}

export interface GalaxyOverrides {
    numArms?: number;
    type?: GalaxyType;
}

export function pickType(rng: Rng): GalaxyType {
    const entries = Object.entries(GALAXY_TYPE_WEIGHTS) as [GalaxyType, number][];
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = rng() * total;
    for (const [type, weight] of entries) {
        roll -= weight;
        if (roll <= 0) return type;
    }
    return 'spiral';
}

export class GalaxyConfig {
    type: GalaxyType;
    numArms: number;
    galaxyEllipse: number;
    spiralTwist: number;
    numStars: number;
    innerNebulaColors: number[];
    nebulaColors: number[];
    baseAngleOffset: number;
    orientation: number;
    barAngle: number;
    barLength: number;
    axisRatio: number;
    concentration: number;
    clumps: GalaxyClump[];

    constructor(rng: Rng, overrides?: GalaxyOverrides) {
        const randInt = (bound: number) => Math.floor(rng() * bound);
        const randRange = (min: number, max: number) => min + rng() * (max - min);

        this.type = overrides?.type ?? pickType(rng);
        this.numArms = overrides?.numArms ?? (randInt(4) + 2); // 2 to 5
        if (this.type === 'barred' && overrides?.numArms === undefined) {
            this.numArms = randInt(2) === 0 ? 2 : 4;
        }
        // Mild in-plane ellipticity only; inclination comes from the camera tilt.
        this.galaxyEllipse = rng() * 0.08 + 0.92;
        this.spiralTwist = this.type === 'barred'
            ? randRange(BARRED_TWIST_MIN, BARRED_TWIST_MAX)
            : (SPIRAL_TWISTS[this.numArms] ?? 2.0);
        this.numStars = randInt(300) + 400; // 400 to 699
        this.innerNebulaColors = INNER_NEBULA_COLORS[randInt(INNER_NEBULA_COLORS.length)];
        this.nebulaColors = NEBULA_COLORS[randInt(NEBULA_COLORS.length)];
        this.baseAngleOffset = 2 * Math.PI * rng();
        this.orientation = 2 * Math.PI * rng();
        this.barAngle = 2 * Math.PI * rng();
        this.barLength = randRange(BAR_LENGTH_MIN, BAR_LENGTH_MAX);
        this.axisRatio = randRange(ELLIPTICAL_AXIS_MIN, ELLIPTICAL_AXIS_MAX);
        this.concentration = randRange(ELLIPTICAL_CONCENTRATION_MIN, ELLIPTICAL_CONCENTRATION_MAX);
        if (this.type === 'elliptical') this.galaxyEllipse = this.axisRatio;

        const clumpCount = IRREGULAR_CLUMP_MIN + randInt(IRREGULAR_CLUMP_MAX - IRREGULAR_CLUMP_MIN + 1);
        this.clumps = Array.from({ length: clumpCount }, () => {
            const angle = 2 * Math.PI * rng();
            const dist = GALAXY_RADIUS * IRREGULAR_CLUMP_SPREAD * Math.sqrt(rng());
            return {
                x: Math.cos(angle) * dist,
                y: Math.sin(angle) * dist,
                r: GALAXY_RADIUS * randRange(IRREGULAR_CLUMP_RADIUS_MIN, IRREGULAR_CLUMP_RADIUS_MAX),
                weight: randRange(0.4, 1),
            };
        });
    }
}
