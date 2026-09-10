# Laniakea

An interactive, procedurally generated universe explorer built with Vite, React 19, TypeScript, and PixiJS v8. Navigate from the scale of superclusters down to individual star systems, all rendered in real time with animated nebulae and orbiting planets.

## Overview

Explore a simulated cosmos across three zoom levels:

1. **Supercluster view** — A 900-million-light-year wide field of thousands of galaxies grouped around named attractors. Tap any galaxy dot to enter it.
2. **Galaxy view** — A procedurally generated galaxy with hundreds of named star systems. Click a system to visit it.
3. **System view** — An animated solar system for the selected star: planets across orbital zones (hot rocky inner planets, habitable worlds, gas giants, ice giants) with moons, rings, asteroid belts, a pulsing corona, and a nebula glow. Click a planet to see its zone and moons.

The navigation HUD tracks your position through the hierarchy (`Observable Universe > Supercluster > Attractor > Galaxy > System`) with coordinates, and holds the Codex, Back, and Jump controls.

## Features

- **Fully deterministic generation** — Every galaxy, star, and planet is derived from a single integer seed using the mulberry32 PRNG. The same seed always produces the same universe.
- **Galaxy generation** — Spiral, barred, elliptical, and irregular galaxies with configurable arm count, ellipse shape, and spiral twist.
- **Star classification** — A, F, G, K, and M stars plus brown dwarfs and neutron stars, with realistic color and size distributions.
- **Animated nebulae** — Particle-based gas rendered with blur and displacement filters. Inner arms are blue/violet, outer arms use a per-galaxy palette, and the core glows warm white/gold.
- **3D views** — Shift-drag or right-drag to turn the supercluster field and the galaxy disk.
- **Procedural solar systems** — Kepler-like orbital speeds, rings drawn around the planet body, moons, and Gaussian asteroid belts.
- **Discovery Codex** — Every supercluster, galaxy, and star you visit is recorded, searchable, and one click away.
- **Jump** — Generate a brand new supercluster from the supercluster view.
- **Toggleable overlays** — Attractor labels, orbit rings, scan lines, and the HUD can be toggled from Settings.

## Getting Started

```bash
npm install
npm run dev       # Start dev server with HMR at localhost:5173
npm run build     # Type-check then build for production
npm test          # Run generation and projection tests
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
| Persistence | Firebase Auth + Firestore |

## Project Structure

```
src/
  game/       — Pure logic, no rendering (generation, types, constants)
  store/      — Zustand stores (gameStore, uiStore, codexStore, authStore)
  pixi/       — PixiJS scene components (Supercluster, GalaxyStage, SolarSystem)
  ui/         — React DOM overlay components (HUD, Codex, planet panel, settings)
```

## Controls

| Action | Input |
|---|---|
| Pan | Click and drag |
| Zoom | Scroll wheel (cursor-anchored) |
| Rotate view | Shift-drag or right-drag |
| Enter galaxy | Click a supercluster dot (zoom ≥ 0.5) |
| Enter system | Click a star in galaxy view |
| Inspect planet | Click a planet in system view |
| Navigate back | Back button |
| New supercluster | Jump button (supercluster view) |
| Revisit a location | Codex |
