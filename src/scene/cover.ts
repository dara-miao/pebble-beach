import type { CourseData, HoleData, Vec2 } from "../course/types";
import { greenPolygon, pointInPoly, polyBBox } from "../course/geom";

export type Cover = "ocean" | "sand" | "rock" | "rough" | "fairway" | "green" | "tee" | "bunker" | "path";

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
  fairway: [0.28, 0.58, 0.26],
  green: [0.36, 0.72, 0.34],
  tee: [0.32, 0.62, 0.3],
  bunker: [0.86, 0.72, 0.46],
  path: [0.5, 0.46, 0.4],
};

function add(index: IndexedPoly[], type: Cover, poly: Vec2[]) {
  if (!poly || poly.length < 3) return;
  const b = polyBBox(poly);
  index.push({ type, poly, ...b });
}

export function buildCoverIndex(course: CourseData): IndexedPoly[] {
  const index: IndexedPoly[] = [];
  for (const r of course.rough) add(index, "rough", r.polygon);
  for (const w of course.woods) add(index, "rough", w);
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
    bunker: 8,
    green: 9,
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
  const h = h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  return Math.min(58, h);
}

function softBump(d: number, radius: number, height: number): number {
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return height * t * t * (3 - 2 * t);
}

function pathFrame(hole: HoleData): { along: (p: Vec2) => number; side: (p: Vec2) => number; len: number } {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  let len = 0;
  const segs: { a: Vec2; b: Vec2; start: number; segLen: number; ux: number; uz: number }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    segs.push({
      a,
      b,
      start: len,
      segLen,
      ux: (b[0] - a[0]) / segLen,
      uz: (b[1] - a[1]) / segLen,
    });
    len += segLen;
  }

  return {
    len,
    along: (p) => {
      let best = 0;
      let bestD = 1e9;
      for (const s of segs) {
        const vx = p[0] - s.a[0];
        const vz = p[1] - s.a[1];
        const t = Math.max(0, Math.min(1, vx * s.ux + vz * s.uz));
        const qx = s.a[0] + t * s.ux * s.segLen;
        const qz = s.a[1] + t * s.uz * s.segLen;
        const d = Math.hypot(p[0] - qx, p[1] - qz);
        if (d < bestD) {
          bestD = d;
          best = s.start + t * s.segLen;
        }
      }
      return best;
    },
    side: (p) => {
      let best = 0;
      let bestD = 1e9;
      for (const s of segs) {
        const vx = p[0] - s.a[0];
        const vz = p[1] - s.a[1];
        const t = Math.max(0, Math.min(1, (vx * s.ux + vz * s.uz) / 1));
        const alongT = Math.max(0, Math.min(1, vx * s.ux + vz * s.uz));
        const qx = s.a[0] + alongT * s.ux * s.segLen;
        const qz = s.a[1] + alongT * s.uz * s.segLen;
        const d = Math.hypot(p[0] - qx, p[1] - qz);
        // left = (uz, -ux) in xz for forward (ux, uz)
        const signed = (p[0] - qx) * s.uz - (p[1] - qz) * s.ux;
        if (d < bestD) {
          bestD = d;
          best = signed;
        }
        void t;
      }
      return best;
    },
  };
}

/** Artistic sculpting so 7 / 8 / 18 read like the famous holes in a game art style. */
function sculptSignature(course: CourseData, x: number, z: number, base: number): number {
  let y = base;
  const h7 = course.holes[6];
  const h8 = course.holes[7];
  const h18 = course.holes[17];
  if (!h7 || !h8 || !h18) return y;

  // Hole 7 — high tee knoll, green perched just above the rocks, ocean beyond.
  {
    const tee = h7.tee;
    const green = h7.greenCenter;
    const dTee = Math.hypot(x - tee[0], z - tee[1]);
    const dGreen = Math.hypot(x - green[0], z - green[1]);
    y += softBump(dTee, 55, 16);
    y += softBump(dGreen, 32, 2.5);
    // Drop toward ocean south of the green.
    const southOfGreen = z - green[1];
    if (southOfGreen > 8 && Math.abs(x - green[0]) < 70) {
      const drop = Math.min(22, (southOfGreen - 8) * 0.55);
      y -= drop;
    }
    // Cliff band around the green tip.
    if (dGreen > 18 && dGreen < 55 && southOfGreen > -5) {
      y -= softBump(Math.abs(dGreen - 36), 18, 8);
    }
  }

  // Hole 8 — ravine / chasm on the approach to the green.
  {
    const frame = pathFrame(h8);
    const along = frame.along([x, z]);
    const side = frame.side([x, z]);
    const t = frame.len > 0 ? along / frame.len : 0;
    // Chasm sits in the last third, crossing the line of play.
    if (t > 0.42 && t < 0.78 && Math.abs(side) < 55) {
      const mid = 1 - Math.abs((t - 0.6) / 0.18);
      const across = 1 - Math.abs(side) / 55;
      const depth = 22 * Math.max(0, mid) * Math.max(0, across);
      y -= depth;
    }
    // Green headland bump.
    y += softBump(Math.hypot(x - h8.greenCenter[0], z - h8.greenCenter[1]), 40, 5);
    // Tee shelf near 7 green.
    y += softBump(Math.hypot(x - h8.tee[0], z - h8.tee[1]), 35, 3);
  }

  // Hole 18 — ocean cliff on the left (seaward), gentle rise into the Lodge green.
  {
    const frame = pathFrame(h18);
    const along = frame.along([x, z]);
    const side = frame.side([x, z]);
    const t = frame.len > 0 ? along / frame.len : 0;
    if (t > -0.05 && t < 1.05 && Math.abs(side) < 120) {
      // Seaward side drops hard (signed side > 0 ≈ left of play for this routing).
      if (side > 18) {
        const edge = Math.min(1, (side - 18) / 35);
        y -= 18 * edge * edge;
      }
      // Fairway shelf stays playable.
      if (Math.abs(side) < 22) {
        y = Math.max(y, 4.5 + t * 2.5);
      }
    }
    y += softBump(Math.hypot(x - h18.greenCenter[0], z - h18.greenCenter[1]), 45, 4);
    y += softBump(Math.hypot(x - h18.tee[0], z - h18.tee[1]), 40, 2);
  }

  return y;
}

export function heightAt(
  course: CourseData,
  index: IndexedPoly[],
  x: number,
  z: number,
): { y: number; cover: Cover } {
  const cover = coverAt(x, z, index);
  let y = sculptSignature(course, x, z, sampleElevation(course, x, z));

  if (cover === "ocean") {
    return { y: -1.2, cover };
  }
  if (!cover) {
    if (y < 2.2) return { y: -1.5, cover: "ocean" };
    return { y, cover: y < 7 ? "rock" : "rough" };
  }
  if (cover === "bunker") y -= 1.15;
  if (cover === "green" || cover === "tee") {
    y = Math.max(y, 3.5);
  } else {
    y = Math.max(y, 2.2);
  }
  return { y, cover };
}

export function coverColor(cover: Cover): [number, number, number] {
  return COLORS[cover];
}
