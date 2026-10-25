# Reef

A real-time diorama of a Bermuda patch reef: an 80 × 50 m slab of beach, lagoon and coral, rendered with three.js WebGPU and TSL. You can orbit it from above or dive in. It runs a full day and night cycle with a moving sun, moonlight and bioluminescence.

## Running

```sh
git lfs install && git lfs pull   # models, textures and animation data live in LFS
npm install
npm run dev                       # http://localhost:5173
```

It needs a WebGPU browser: Chrome or Edge 113+, or Safari 18+. `npm run build` type-checks and writes a static site to `dist/`.

## Controls

| | |
|---|---|
| Drag / scroll | Orbit and zoom. Zooming into the water takes you under the surface. |
| Double-click | Orbit around the clicked spot on the seabed. |
| Time arc (bottom right) | Drag the sun or moon to set the time of day. |
| Speaker button | Ambient sound (off by default). |
| Camera button or `P` | Photo mode: freezes fish and waves and adds depth of field. Click to focus, then Save for a full-resolution PNG. `Esc` exits. |
| `` ` `` or `?dev` | Developer panel and performance HUD. |

## How it works

- **Ocean** (`src/ocean`). FFT waves in three cascades on GPU compute. The surface shading includes foam, refraction and sky reflection. Caustics are projected onto the seabed.
- **Sky and light** (`src/world/sky.ts`, `atmosphere.ts`). The sun follows its true path at 32.3°N. A sky lookup table is re-baked whenever the sun moves. A full moon and stars take over at night. Exposure adapts like an eye.
- **Underwater** (`src/underwater`). Distance fog, god rays, marine snow, and bioluminescent sparks in the wakes of fish and in breaking foam at night.
- **Reef** (`src/reef`). Instanced rocks, corals, gorgonians and seagrass are scattered by density rules. Corals settle on the real surface, rock tops included, through a height field of everything placed before them.
- **Fauna** (`src/fauna`). Reef fish and bait balls use CPU steering, with the bait as boids on a grid. Barracuda hunt the bait. A turtle surfaces to breathe. Everything steers over the reef rather than through it. Fish swim with a shader wave; the barracuda and turtle play baked vertex animation (VAT).
- **Sound** (`src/audio/ambience.ts`). Synthesized live with Web Audio, with no sample files:
  - surf and wind, plus gulls by day and crickets by night;
  - a muffled rumble, snapping shrimp and bubbles underwater;
  - mixed by depth, distance from the shore and time of day.

## Assets

Every model is built by a Python script running in Blender. There is no hand modelling and no AI generation.

```sh
npm run assets:build        # blender/assets/*.py → assets/raw/*.glb (+ .blend sources); BLENDER=/path/to/blender
npm run assets:optimize     # assets/raw → public/assets (meshopt, quantized)
npm run assets:textures     # CC0 Poly Haven rock and sand texture sets → public/assets/textures
```

Generated textures, such as brain coral, the sea fan lattice and fish patterns, come from `blender/textures` and the asset scripts. `tools/shot.mjs` takes headless screenshots for checking changes.
