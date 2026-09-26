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

export interface GalaxyLook {
    type: GalaxyType;
    numArms: number;
    galaxyEllipse: number;
    spiralTwist: number;
    numStars: number;
    innerNebulaColors: number[];
    nebulaColors: number[];
}

export function drawGalaxyLook(rng: Rng, overrides?: GalaxyOverrides): GalaxyLook {
    const randInt = (bound: number) => Math.floor(rng() * bound);
    const randRange = (min: number, max: number) => min + rng() * (max - min);

    const type = overrides?.type ?? pickType(rng);
    let numArms = overrides?.numArms ?? (randInt(4) + 2); // 2 to 5
    if (type === 'barred') {
        // Preserve the historical RNG draw so changing the morphology does
        // not also reroll the rest of a seeded galaxy's configuration.
        if (overrides?.numArms === undefined) randInt(2);
        numArms = 2;
    }
    // Mild in-plane ellipticity only; inclination comes from the camera tilt.
    const galaxyEllipse = rng() * 0.08 + 0.92;
    const spiralTwist = type === 'barred'
        ? randRange(BARRED_TWIST_MIN, BARRED_TWIST_MAX)
        : (SPIRAL_TWISTS[numArms] ?? 2.0);
    const numStars = randInt(300) + 400; // 400 to 699
    const innerNebulaColors = INNER_NEBULA_COLORS[randInt(INNER_NEBULA_COLORS.length)];
    const nebulaColors = NEBULA_COLORS[randInt(NEBULA_COLORS.length)];
    return { type, numArms, galaxyEllipse, spiralTwist, numStars, innerNebulaColors, nebulaColors };
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

        const look = drawGalaxyLook(rng, overrides);
        this.type = look.type;
        this.numArms = look.numArms;
        this.galaxyEllipse = look.galaxyEllipse;
        this.spiralTwist = look.spiralTwist;
        this.numStars = look.numStars;
        this.innerNebulaColors = look.innerNebulaColors;
        this.nebulaColors = look.nebulaColors;
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
