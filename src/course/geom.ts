import type { CourseData, HoleData, TeeSet, Vec2 } from "./types";

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

/** First tee of the round — hole 9 (coast stretch) for a strong opening view. */
export const OPENING_HOLE = 9;

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

/**
 * Line of play from a stance: down the fairway path, not a shortcut to the pin.
 * Used for tee-box orientation and the address/tee camera.
 */
export function fairwayDirection(
  hole: HoleData,
  origin: { x: number; z: number } = { x: hole.tee[0], z: hole.tee[1] },
): Vec2 {
  const target = defaultFairwayTarget(hole, origin, 180);
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) {
    const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
    const { dir } = pointOnPath(path, Math.min(60, pathLength(path) * 0.2));
    return dir;
  }
  return [dx / len, dz / len];
}

/** Rectangle in XZ: depth along forward, width across. Closed polygon. */
export function orientedRect(center: Vec2, forward: Vec2, halfWidth: number, halfDepth: number): Vec2[] {
  const fx = forward[0];
  const fz = forward[1];
  const rx = -fz;
  const rz = fx;
  const corners: Vec2[] = [
    [center[0] - fx * halfDepth - rx * halfWidth, center[1] - fz * halfDepth - rz * halfWidth],
    [center[0] - fx * halfDepth + rx * halfWidth, center[1] - fz * halfDepth + rz * halfWidth],
    [center[0] + fx * halfDepth + rx * halfWidth, center[1] + fz * halfDepth + rz * halfWidth],
    [center[0] + fx * halfDepth - rx * halfWidth, center[1] + fz * halfDepth - rz * halfWidth],
  ];
  corners.push(corners[0]);
  return corners;
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

/** Dedupe tee centers that sit on top of each other. */
function uniqueTeeCenters(hole: HoleData): Vec2[] {
  const out: Vec2[] = [];
  for (const t of hole.tees) {
    const c = t.center;
    if (!Array.isArray(c) || c.length < 2) continue;
    if (out.some((p) => dist(p, c) < 8)) continue;
    out.push(c);
  }
  return out;
}

/** Move along the hole path; positive yards is toward the green. */
export function shiftAlongPath(hole: HoleData, from: Vec2, yardsTowardGreen: number): Vec2 {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  const here = closestOnPath(path, from);
  const len = pathLength(path);
  const along = here.along + yardsTowardGreen;
  if (along >= 0 && along <= len) return pointOnPath(path, along).point;
  if (along < 0) {
    const { point, dir } = pointOnPath(path, 0);
    return [point[0] - dir[0] * -along, point[1] - dir[1] * -along];
  }
  const overshoot = along - len;
  const { point, dir } = pointOnPath(path, len);
  return [point[0] + dir[0] * overshoot, point[1] + dir[1] * overshoot];
}

/**
 * Physical stance for a scorecard tee set. Blue stays on the official hole.tee;
 * other sets shift along the path by the yardage gap vs Blue. When an OSM tee
 * box sits near that spot, snap to it so the ball sits on the painted box.
 */
export function teeStance(hole: HoleData, tee: TeeSet): Vec2 {
  const blueYards = hole.yards.blue ?? dist(hole.tee, hole.greenCenter);
  const want = hole.yards[tee] ?? blueYards;
  const delta = blueYards - want;
  if (Math.abs(delta) < 1) return hole.tee;

  const ideal = shiftAlongPath(hole, hole.tee, delta);
  let best: Vec2 | null = null;
  let bestD = 14;
  for (const c of uniqueTeeCenters(hole)) {
    const d = dist(c, ideal);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ?? ideal;
}
