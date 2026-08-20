import type { CourseData, HoleData, Vec2 } from "./types";

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function pathLength(path: Vec2[]): number {
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) n += dist(path[i], path[i + 1]);
  return n;
}

export function closestOnPath(path: Vec2[], p: Vec2): { point: Vec2; along: number; dist: number } {
  if (path.length < 2) {
    const point = path[0] ?? p;
    return { point, along: 0, dist: dist(point, p) };
  }
  let bestAlong = 0;
  let bestPoint: Vec2 = path[0];
  let bestD = Infinity;
  let walked = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const seg = dist(a, b) || 1e-6;
    const dx = (b[0] - a[0]) / seg;
    const dz = (b[1] - a[1]) / seg;
    const proj = Math.max(0, Math.min(seg, (p[0] - a[0]) * dx + (p[1] - a[1]) * dz));
    const qx = a[0] + dx * proj;
    const qz = a[1] + dz * proj;
    const d = Math.hypot(p[0] - qx, p[1] - qz);
    if (d < bestD) {
      bestD = d;
      bestAlong = walked + proj;
      bestPoint = [qx, qz];
    }
    walked += seg;
  }
  return { point: bestPoint, along: bestAlong, dist: bestD };
}

export function pointOnPath(path: Vec2[], yards: number): { point: Vec2; dir: Vec2 } {
  if (path.length < 2) return { point: path[0] ?? [0, 0], dir: [0, 1] };
  let remaining = Math.max(0, yards);
  for (let i = 0; i < path.length - 1; i++) {
    const seg = dist(path[i], path[i + 1]);
    if (remaining <= seg || i === path.length - 2) {
      const t = seg > 0 ? Math.min(1, remaining / seg) : 0;
      const point = lerp2(path[i], path[i + 1], t);
      const dx = path[i + 1][0] - path[i][0];
      const dz = path[i + 1][1] - path[i][1];
      const len = Math.hypot(dx, dz) || 1;
      return { point, dir: [dx / len, dz / len] };
    }
    remaining -= seg;
  }
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  const dx = last[0] - prev[0];
  const dz = last[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  return { point: last, dir: [dx / len, dz / len] };
}

export function pointInPoly(x: number, z: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polyBBox(poly: Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function ellipseAround(center: Vec2, rx: number, rz: number, n = 24): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([center[0] + Math.cos(a) * rx, center[1] + Math.sin(a) * rz]);
  }
  pts.push(pts[0]);
  return pts;
}

export function greenPolygon(hole: HoleData): Vec2[] {
  if (hole.green?.polygon?.length) return hole.green.polygon;
  return ellipseAround(hole.greenCenter, 14, 11);
}

export function holeByNumber(course: CourseData, n: number): HoleData {
  const hole = course.holes.find((h) => h.number === n);
  if (!hole) throw new Error(`Missing hole ${n}`);
  return hole;
}

/** First tee of the round — the Lodge opener, not the hole-7 test hole. */
export const OPENING_HOLE = 1;

/**
 * Default landing on the hole's play line. Pin-line aim cuts doglegs
 * (and the Pacific on 18); the path is the fairway the golfer should see.
 */
export function defaultFairwayTarget(
  hole: HoleData,
  origin: { x: number; z: number },
  carryYards?: number,
): { x: number; z: number } {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  const pinYards = Math.hypot(origin.x - hole.pin[0], origin.z - hole.pin[1]);
  if (pinYards < 40) return { x: hole.pin[0], z: hole.pin[1] };

  const here = closestOnPath(path, [origin.x, origin.z]);
  const len = pathLength(path);
  const leftOnPath = Math.max(8, len - here.along);
  if (leftOnPath < 35) return { x: hole.pin[0], z: hole.pin[1] };

  const carry = carryYards ?? Math.min(250, Math.max(40, leftOnPath * 0.55));
  const along = Math.min(len - 2, here.along + Math.min(carry, leftOnPath - 6));
  const { point } = pointOnPath(path, Math.max(here.along + 18, along));
  return { x: point[0], z: point[1] };
}

/** Closed stadium polygon along a polyline — used to fill missing fairway OSM. */
export function corridorPolygon(path: Vec2[], halfWidth: number): Vec2[] {
  if (path.length < 2) return [];
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    left.push([path[i][0] + nx * halfWidth, path[i][1] + nz * halfWidth]);
    right.push([path[i][0] - nx * halfWidth, path[i][1] - nz * halfWidth]);
  }
  const poly = [...left, ...right.reverse()];
  poly.push(poly[0]);
  return poly;
}
