# Pebble Beach

A browser golf simulator for **Pebble Beach Golf Links**. Walk the course in 3D, stand behind the ball, call a shot, and watch it play from that lie. Preview uses the same flight as Hit. The ball stays where it lands; leftover updates for the next shot.

This is a **video-game reconstruction**, not a photoreal twin. Routing and yardages track the real course. Look and feel are stylized Three.js.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/). Starts on **hole 1** (the Lodge opener).

```bash
npm test
npm run build
```

## How to play

1. You stand on the tee (or last lie) in **Stand** camera.
2. Type a shot, or use a suggestion chip. Example: `driver 250 fade`, `7 iron 155 draw`, `pw 80`, `putt 24 ft`.
3. **Preview** draws the flight and miss envelope. **Hit** commits the shot.
4. The ball stays at the landing. Play the leftover from that lie until you hole out.
5. Move to the next hole. The card is all 18.

### Aiming

- Click (or drag) the turf to set a landing target. Default aim follows the **fairway line of play**, not a shortcut to the pin (matters on doglegs and 18).
- Tee boxes face the fairway, same idea.

### Shot prompts

Club, yards, and shape are parsed from plain text:

| Example | Meaning |
| --- | --- |
| `driver 250 slight fade` | Driver, 250 yd carry, fade |
| `7 iron 150 draw` | 7-iron draw |
| `pw 100 into 10 mph wind` | Pitching wedge into wind |
| `3 wood 230 off the left` | Crosswind from the left |
| `putt 18 ft` | Putt |

Lie matters: bunker, rough, and woods change carry and flight. Ocean is a penalty.

### Cameras

| Control | View |
| --- | --- |
| Stand (`a`) | Behind the ball, looking down the play line |
| Tee (`t`) | Elevated tee view down the fairway |
| Flyover (`f`) | Tee-to-green path fly |
| Green (`g`) | Looking at the green |
| Course (`c`) | Full-course overview |

Drag to orbit, right-drag to pan, scroll to zoom. Arrow keys change holes. `r` resets the hole.

### Tees and wind

- **Champ / Blue / Gold / White** scorecard yardages
- Wind on the HUD (direction + speed); it affects carry and leftover

### Round

Play all 18. Scores sync per hole. **New round** resets back to hole 1.

## What is real vs stylized

**Grounded in public data**

- Hole paths, greens, tees, bunkers, fairways from **OpenStreetMap**
- Published scorecard yardages (Champ ~7,040 · Blue ~6,802 · Gold ~6,472 · White ~6,083)
- Ground height from **USGS NED 1/3″** (~10 m) via OpenTopoData

**Stylized / repaired**

- Grass, ocean, trees, Lodge, lighting (Three.js game art)
- Light accents so cliffs and cuts still read in-game
- Thin OSM holes get a repaired green, tee box, or fairway corridor so the full card is playable
- Tee boxes are oriented rectangles facing the fairway line of play

Not LiDAR, not a licensed yardage book, not photogrammetry.

## Project layout

```
src/
  main.ts              App loop, input, camera, HUD wiring
  course/              Course JSON, geometry helpers, OSM repair
  scene/               Terrain, ocean/sky, features, trees
  camera/              Orbit + flyover / address modes
  shot/                Parse, simulate, lie, wind, miss, round, visuals
  ui/                  HUD
scripts/
  extract_osm.py       Build course JSON from OSM extracts
  fetch_ned_elevation.py  Refresh USGS NED elevation grid
public/textures/       Water normals, etc.
```

## Data scripts

If you have fresh OSM XML tiles (same bbox workflow as in `extract_osm.py`):

```bash
python3 scripts/extract_osm.py
```

Refresh elevation from NED (rate-limited public API; takes ~30s):

```bash
python3 scripts/fetch_ned_elevation.py
```

## Stack

- **Vite** + **TypeScript**
- **Three.js** (WebGL scene, water, sky, controls)
- **Vitest** for shot / hole tests

## First holes to try

- **1** — Lodge opener: drive, then play the leftover
- **7** — Short ocean par 3: `8 iron 100` vs a short miss toward the water
- **8** — Fairway aim, then the approach over the cut
- **18** — Sea-wall finisher; default aim stays inland of the Pacific

## License / attribution

Course geometry © OpenStreetMap contributors (ODbL). Elevation © USGS. Scorecard yardages from published public cards. This project is an unofficial fan reconstruction, not affiliated with Pebble Beach Company.
