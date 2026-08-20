# Pebble Beach

A browser golf simulator for **Pebble Beach Golf Links**. Walk the course in 3D, stand behind the ball, call a shot, and watch it play from that lie. Preview uses the same flight as Hit. The ball stays where it lands; leftover updates for the next shot.

Video-game look, real course layout. Routing and yardages track Pebble; the scene is built in Three.js.

## Quick start

```bash
git clone https://github.com/dara-miao/pebble-beach.git
cd pebble-beach
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/). Starts on **hole 9**.

```bash
npm test
npm run build
```

## How to play

1. You stand on the tee (or last lie) in **Stand** camera.
2. Type a shot, or use a suggestion chip. Example: `driver 250 fade`, `7 iron 155 draw`, `pw 80`, `putt 24 ft`.
3. **Preview** draws the flight and miss envelope. **Hit** commits the shot.
4. The ball stays at the landing. A short result sting shows leftover and lie (quieter on Preview than Hit).
5. Hole out: a score beat (birdie / par / bogey…), then the next tee. Hole 18 stays put until **New round**. **Reset hole** replays the same hole.

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

Lie matters: bunker, rough, and woods change carry and flight.

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

Play all 18. Scores sync per hole. **New round** resets back to hole 9.

## Real vs stylized

**Real**

- Hole paths, greens, tees, bunkers, fairways from **OpenStreetMap**
- Published scorecard yardages (Champ ~7,040 · Blue ~6,802 · Gold ~6,472 · White ~6,083)
- Ground height from **USGS NED** elevation data

**Stylized**

- Grass, ocean, trees, Lodge, and lighting (Three.js)
- Light terrain accents so cliffs and cuts read clearly
- Repaired greens / tee boxes / fairway corridors where map data was thin
- Tee boxes drawn as fairway-facing rectangles

## Recommended highlight holes to try

- **1** · Lodge opener: drive, then play the leftover
- **7** · Short ocean par 3: try `8 iron 100`, then a short miss toward the water
- **8** · Fairway aim, then the approach over the cut
- **18** · Sea-wall finisher; default aim stays inland of the Pacific

## Project layout

```
src/
  main.ts              App loop, input, camera, HUD wiring
  course/              Course data, geometry, map repair
  scene/               Terrain, ocean/sky, features, trees
  camera/              Orbit + flyover / address modes
  shot/                Parse, simulate, lie, wind, miss, round, visuals
  ui/                  HUD
scripts/               Optional tools to regenerate course data
public/textures/       Water normals, etc.
```

## Regenerating course data (optional)

- `scripts/extract_osm.py` rebuilds layout from OpenStreetMap extracts
- `scripts/fetch_ned_elevation.py` refreshes the elevation grid from USGS NED

## Stack

- **Vite** + **TypeScript**
- **Three.js** (WebGL scene, water, sky, controls)
- **Vitest** for shot / hole tests

## License / attribution

Course geometry © OpenStreetMap contributors (ODbL). Elevation © USGS. Scorecard yardages from published public cards. Unofficial fan project, not affiliated with Pebble Beach Company.
