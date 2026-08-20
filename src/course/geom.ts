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
