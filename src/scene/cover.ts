import type { CourseData, HoleData, Vec2 } from "../course/types";
import { greenPolygon, pointInPoly, polyBBox } from "../course/geom";

export type Cover =
  | "ocean"
  | "sand"
  | "rock"
  | "rough"
  | "woods"
  | "fairway"
  | "green"
  | "tee"
  | "bunker"
  | "path";

interface IndexedPoly {
  type: Cover;
  poly: Vec2[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const COLORS: Record<Cover, [number, number, number]> = {
  ocean: [0.1, 0.32, 0.4],
  sand: [0.82, 0.72, 0.52],
  rock: [0.48, 0.44, 0.4],
  rough: [0.2, 0.38, 0.18],
  woods: [0.14, 0.3, 0.16],
  fairway: [0.28, 0.58, 0.26],
  green: [0.36, 0.72, 0.34],
  tee: [0.32, 0.62, 0.3],
  bunker: [0.86, 0.72, 0.46],
  path: [0.5, 0.46, 0.4],
};

/**
 * Light game-art accents only. Real shape comes from USGS NED elevation.
 * These amplify known hazards without inventing big fake hills.
 */
interface HoleAccent {
  /** Soft tee pad so the box reads clearly. */
  teePad?: number;
  /** Soft green pad. */
  greenPad?: number;
  /** Barranca / ravine cut along path (fractional t). */
  cut?: { t0: number; t1: number; depth: number; width: number };
  /** Extra cliff drop on path left/right where DEM is already low. */
  oceanSide?: "left" | "right";
  oceanBoost?: number;
}

const ACCENTS: Record<number, HoleAccent> = {
  1: { teePad: 1.2, greenPad: 1.0 },
  2: { teePad: 1.0, greenPad: 1.2, cut: { t0: 0.78, t1: 0.92, depth: 5, width: 38 } },
  3: { teePad: 1.0, greenPad: 1.2 },
  4: { teePad: 1.2, greenPad: 1.4, oceanSide: "right", oceanBoost: 4 },
  5: { teePad: 1.4, greenPad: 1.2, oceanSide: "right", oceanBoost: 5 },
  6: { teePad: 1.2, greenPad: 1.6, oceanSide: "right", oceanBoost: 5 },
  7: { teePad: 2.0, greenPad: 1.2, oceanSide: "right", oceanBoost: 6 },
  8: { teePad: 1.2, greenPad: 1.6, cut: { t0: 0.45, t1: 0.75, depth: 10, width: 48 } },
  9: { teePad: 1.2, greenPad: 1.2, oceanSide: "right", oceanBoost: 6 },
  10: { teePad: 1.2, greenPad: 1.2, oceanSide: "right", oceanBoost: 6 },
  11: { teePad: 1.0, greenPad: 1.4 },
  12: { teePad: 1.0, greenPad: 1.5 },
  13: { teePad: 1.0, greenPad: 1.6 },
  14: { teePad: 1.0, greenPad: 2.0 },
  15: { teePad: 1.0, greenPad: 1.2 },
  16: { teePad: 1.0, greenPad: 1.2, oceanBoost: 3 },
  17: { teePad: 1.4, greenPad: 1.3, oceanBoost: 5 },
  18: { teePad: 1.0, greenPad: 1.5, oceanSide: "left", oceanBoost: 6 },
};

function add(index: IndexedPoly[], type: Cover, poly: Vec2[]) {
  if (!poly || poly.length < 3) return;
  const b = polyBBox(poly);
  index.push({ type, poly, ...b });
}

export function buildCoverIndex(course: CourseData): IndexedPoly[] {
  const index: IndexedPoly[] = [];
  for (const r of course.rough) add(index, "rough", r.polygon);
  for (const w of course.woods) add(index, "woods", w);
  for (const hole of course.holes) {
    for (const f of hole.fairways) add(index, "fairway", f.polygon);
    for (const t of hole.tees) add(index, "tee", t.polygon);
    add(index, "green", greenPolygon(hole));
    for (const b of hole.bunkers) add(index, "bunker", b.polygon);
  }
  for (const b of course.unassignedBunkers) add(index, "bunker", b.polygon);
  for (const w of course.water) add(index, "ocean", w);
  return index;
}

export function coverAt(x: number, z: number, index: IndexedPoly[]): Cover | null {
  let found: Cover | null = null;
  const rank: Record<Cover, number> = {
    ocean: 1,
    sand: 2,
    rock: 3,
    path: 4,
    rough: 5,
    fairway: 6,
    tee: 7,
    woods: 8,
    bunker: 9,
    green: 10,
  };
  for (const f of index) {
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
    if (!pointInPoly(x, z, f.poly)) continue;
    if (!found || rank[f.type] >= rank[found]) found = f.type;
  }
  return found;
}

export function sampleElevation(course: CourseData, x: number, z: number): number {
  const e = course.elevation;
  const fx = (x - e.originX) / e.stepX;
  const fz = (z - e.originZ) / e.stepZ;
  const x0 = Math.max(0, Math.min(e.width - 2, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(e.height - 2, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - x0));
  const tz = Math.min(1, Math.max(0, fz - z0));
  const h00 = e.heightsYards[z0][x0];
  const h10 = e.heightsYards[z0][x0 + 1];
  const h01 = e.heightsYards[z0 + 1][x0];
  const h11 = e.heightsYards[z0 + 1][x0 + 1];
  return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
}

function softBump(d: number, radius: number, height: number): number {
  if (d >= radius || radius <= 0) return 0;
  const t = 1 - d / radius;
  return height * t * t * (3 - 2 * t);
}

function pathFrame(hole: HoleData): {
  along: (p: Vec2) => number;
  side: (p: Vec2) => number;
  dist: (p: Vec2) => number;
  len: number;
} {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  let len = 0;
  const segs: { a: Vec2; start: number; segLen: number; ux: number; uz: number }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    segs.push({
      a,
      start: len,
      segLen,
      ux: (b[0] - a[0]) / segLen,
      uz: (b[1] - a[1]) / segLen,
    });
    len += segLen;
  }

  const query = (p: Vec2) => {
    let bestAlong = 0;
    let bestSide = 0;
    let bestD = 1e9;
    for (const s of segs) {
      const vx = p[0] - s.a[0];
      const vz = p[1] - s.a[1];
      const alongT = Math.max(0, Math.min(1, vx * s.ux + vz * s.uz));
      const qx = s.a[0] + alongT * s.ux * s.segLen;
      const qz = s.a[1] + alongT * s.uz * s.segLen;
      const d = Math.hypot(p[0] - qx, p[1] - qz);
      const signed = (p[0] - qx) * s.uz - (p[1] - qz) * s.ux;
      if (d < bestD) {
        bestD = d;
        bestAlong = s.start + alongT * s.segLen;
        bestSide = signed;
      }
    }
    return { along: bestAlong, side: bestSide, dist: bestD };
  };

  return {
    len,
    along: (p) => query(p).along,
    side: (p) => query(p).side,
    dist: (p) => query(p).dist,
  };
}

function accentHole(hole: HoleData, accent: HoleAccent, x: number, z: number, demY: number): number {
  let dy = 0;
  const frame = pathFrame(hole);
  const p: Vec2 = [x, z];
  const along = frame.along(p);
  const side = frame.side(p);
  const pathDist = frame.dist(p);
  const t = frame.len > 0 ? along / frame.len : 0;

  if (accent.teePad) {
    dy += softBump(Math.hypot(x - hole.tee[0], z - hole.tee[1]), 28, accent.teePad);
  }
  if (accent.greenPad) {
    dy += softBump(Math.hypot(x - hole.greenCenter[0], z - hole.greenCenter[1]), 26, accent.greenPad);
  }

  if (accent.cut && pathDist < accent.cut.width && t > accent.cut.t0 && t < accent.cut.t1) {
    const mid = (accent.cut.t0 + accent.cut.t1) / 2;
    const half = (accent.cut.t1 - accent.cut.t0) / 2 || 0.01;
    const alongFactor = 1 - Math.abs(t - mid) / half;
    const across = 1 - Math.abs(side) / accent.cut.width;
    dy -= accent.cut.depth * Math.max(0, alongFactor) * Math.max(0, across);
  }

  // Only deepen ocean edges where DEM is already low (near sea level).
  if (accent.oceanSide && accent.oceanBoost && demY < 12 && pathDist < 90) {
    const start = 16;
    const seaward = accent.oceanSide === "left" ? side > start : side < -start;
    const edgeDist = accent.oceanSide === "left" ? side - start : -side - start;
    if (seaward && edgeDist > 0) {
      const edge = Math.min(1, edgeDist / 28);
      const low = Math.max(0, 1 - demY / 12);
      dy -= accent.oceanBoost * edge * edge * low;
    }
  }

  // Ocean long of 16/17: drop only if DEM is already coastal-low past green.
  if (accent.oceanBoost && !accent.oceanSide && demY < 10) {
    const g = hole.greenCenter;
    const tee = hole.tee;
    const dx = g[0] - tee[0];
    const dz = g[1] - tee[1];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const ahead = (x - g[0]) * ux + (z - g[1]) * uz;
    const lateral = Math.abs((x - g[0]) * uz - (z - g[1]) * ux);
    if (ahead > 8 && ahead < 55 && lateral < 45) {
      dy -= accent.oceanBoost * Math.min(1, (ahead - 8) / 25) * (1 - demY / 10);
    }
  }

  return dy;
}

/** DEM-first height with light per-hole accents. */
function sculptTerrain(course: CourseData, x: number, z: number, base: number): number {
  let y = base;
  const p: Vec2 = [x, z];

  let best: { hole: HoleData; accent: HoleAccent; dist: number } | null = null;
  for (const hole of course.holes) {
    const accent = ACCENTS[hole.number];
    if (!accent) continue;
    const frame = pathFrame(hole);
    const d = Math.min(
      frame.dist(p),
      Math.hypot(x - hole.tee[0], z - hole.tee[1]) * 0.9,
      Math.hypot(x - hole.greenCenter[0], z - hole.greenCenter[1]) * 0.9,
    );
    if (!best || d < best.dist) best = { hole, accent, dist: d };
  }

  if (best && best.dist < 120) {
    y += accentHole(best.hole, best.accent, x, z, base);
  }

  // Mild readability boost: exaggerate DEM relief a touch without inventing shape.
  const mean = 12;
  y = mean + (y - mean) * 1.15;

  return y;
}

export function heightAt(
  course: CourseData,
  index: IndexedPoly[],
  x: number,
  z: number,
): { y: number; cover: Cover } {
  const cover = coverAt(x, z, index);
  const dem = sampleElevation(course, x, z);
  let y = sculptTerrain(course, x, z, dem);

  if (cover === "ocean") {
    return { y: -1.2, cover };
  }
  if (!cover) {
    if (y < 1.8 || dem < 1.2) return { y: -1.5, cover: "ocean" };
    return { y, cover: y < 6 ? "rock" : "rough" };
  }
  if (cover === "bunker") y -= 1.0;
  if (cover === "green" || cover === "tee") {
    y = Math.max(y, dem + 0.4);
  } else {
    y = Math.max(y, Math.min(dem, 2.0));
  }
  return { y, cover };
}

export function coverColor(cover: Cover): [number, number, number] {
  return COLORS[cover];
}
