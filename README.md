# Laniakea

An interactive, procedurally generated universe explorer built with Vite, React 19, TypeScript, and PixiJS v8. Navigate from the scale of superclusters down to individual star systems, all rendered in real-time with animated nebulae, hyperlane networks, and orbiting planets.

## Overview

The game lets you explore a simulated cosmos across three zoom levels:

1. **Supercluster view** — A 900-million-light-year wide field of thousands of galaxies grouped into clusters and filaments. Tap any galaxy dot to enter it.
2. **Galaxy view** — A procedurally generated spiral galaxy with hundreds of named star systems connected by hyperlanes. Click a system to visit it.
3. **System view** — An animated solar system for the selected star: 3–7 planets across four orbital zones (hot rocky inner planets, habitable worlds, gas giants, ice giants) with moons, rings, asteroid belts, a pulsing corona, and a nebula glow, all orbiting in real time.

A breadcrumb address bar tracks your position through the hierarchy: `Observable Universe > Supercluster > Attractor > Galaxy > System`.

## Features

- **Fully deterministic generation** — Every galaxy, star, hyperlane, and planet is derived from a single integer seed using the mulberry32 PRNG. The same seed always produces the same universe.
- **Spiral galaxy generation** — Configurable arm count (2–5), ellipse shape, and spiral twist. Stars are split across three populations: central bulge, spiral arms, and inter-arm disk.
- **Star classification** — Five spectral types (A, F, G, K, M) with realistic color and size distributions: hot blue/white A-class stars in inner arms grading to cool red M-class dwarfs in the bulge and outer disk.
- **Hyperlane network** — Lanes are derived from Delaunay triangulation with distance cutoffs: generous within arms, tight across arms, creating the feel of a real starmap.
- **Animated nebulae** — Particle-based nebula rendered with blur and displacement filters that animate organically each frame. Inner arms are blue/violet; outer arms use a per-galaxy color palette; the galactic core glows warm white/gold.
- **Supercluster simulation** — Galaxy dots are clustered around 12 named gravitational attractors and connected by filaments, scaled to 900 million light years across.
- **Pan and zoom** — Cursor-anchored zoom via scroll wheel and pointer drag, across all three views.
- **Procedural solar systems** — Each star generates 3–7 planets using zone-based rules: hot rocky inner planets, habitable worlds, gas giants, and ice giants. Orbital speed follows Kepler-like scaling. Planets can have rings (split back/front so the body renders inside the ring plane), moons, and atmospheric glow. A 40% chance asteroid belt is inserted between orbits using Gaussian radial particle distribution.
- **Star rendering** — The sun is rendered with a texture-based gradient, a pulsing scale animation, and a procedural corona (12 long rays + 22 short white rays in screen blend mode that rotates and breathes). A large nebula glow sprite behind the system uses the star's color.
- **Planet resources** — Each planet and moon carries typed resources matching its zone: alloys in the hot zone, nutrients + alloys in the habitable zone, exotic matter from gas and ice giants.
- **Toggleable overlays** — Hyperlane network, attractor labels, and orbit rings can be toggled on/off from the config panel.

## Getting Started

```bash
npm install
npm run dev       # Start dev server with HMR at localhost:5173
npm run build     # Type-check then build for production
npm run preview   # Serve the production build locally
npm run lint      # ESLint
```

## Tech Stack

| Layer | Technology |
|---|---|
| Bundler | Vite |
| UI framework | React 19 + TypeScript |
| Rendering | PixiJS v8 via `@pixi/react` |
| State | Zustand |
| Spatial math | `d3-delaunay` (Delaunay triangulation for hyperlanes) |

## Project Structure

```
src/
  game/       — Pure logic, no rendering (generation, types, constants)
  store/      — Zustand stores (gameStore, uiStore)
  pixi/       — PixiJS scene components (GalaxyStage, Supercluster, SolarSystem)
  ui/         — React DOM overlay components (address bar, config panel)
```

## Controls

| Action | Input |
|---|---|
| Pan | Click and drag |
| Zoom | Scroll wheel (cursor-anchored) |
| Enter galaxy | Click a supercluster dot (zoom ≥ 0.5) |
| Enter system | Click a star in galaxy view |
| Navigate back | Click any breadcrumb segment |
| Toggle hyperlanes | Config panel |
| Toggle labels | Config panel |
| Toggle orbit rings | Config panel |
| New galaxy | Config panel seed input |
