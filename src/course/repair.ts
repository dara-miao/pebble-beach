import type { BunkerFeature, CourseData, HoleData, Vec2 } from "./types";
import {
  closestOnPath,
  corridorPolygon,
  dist,
  ellipseAround,
  greenPolygon,
  pathLength,
  pointInPoly,
} from "./geom";

const BUNKER_ASSIGN_YARDS = 120;

function sideOfPath(point: Vec2, path: Vec2[]): "left" | "right" | "center" {
  const near = closestOnPath(path, point);
  const along = near.along;
  let walked = 0;
  let ux = 0;
  let uz = 1;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = dist(path[i], path[i + 1]) || 1e-6;
    if (along <= walked + seg || i === path.length - 2) {
      ux = (path[i + 1][0] - path[i][0]) / seg;
      uz = (path[i + 1][1] - path[i][1]) / seg;
      break;
    }
    walked += seg;
  }
  const signed = (point[0] - near.point[0]) * uz - (point[1] - near.point[1]) * ux;
  if (Math.abs(signed) < 8) return "center";
  return signed > 0 ? "left" : "right";
}

function inWater(course: CourseData, x: number, z: number): boolean {
  return course.water.some((w) => w.length >= 3 && pointInPoly(x, z, w));
}

function nudgeOffWater(course: CourseData, from: Vec2, toward: Vec2): Vec2 {
  if (!inWater(course, from[0], from[1])) return from;
  for (let i = 1; i <= 48; i++) {
    const t = i / 48;
    const x = from[0] + (toward[0] - from[0]) * t;
    const z = from[1] + (toward[1] - from[1]) * t;
    if (!inWater(course, x, z)) return [x, z];
  }
  return toward;
}

function ensurePath(hole: HoleData): void {
  if (hole.path.length < 2) {
    hole.path = [hole.tee, hole.greenCenter];
  }
  if (dist(hole.path[0], hole.tee) > 12) {
    hole.path = [hole.tee, ...hole.path];
  }
  const end = hole.path[hole.path.length - 1];
  if (dist(end, hole.greenCenter) > 18 && dist(end, hole.pin) > 18) {
    hole.path = [...hole.path, hole.greenCenter];
  }
  hole.osmPathYards = pathLength(hole.path);
}

function ensureGreen(hole: HoleData): void {
  if (hole.green?.polygon && hole.green.polygon.length >= 3) return;
  const polygon = greenPolygon(hole);
  hole.green = { polygon, center: hole.greenCenter };
}

function ensureTeeBox(hole: HoleData): void {
  const onBox = hole.tees.some((t) => t.polygon.length >= 3 && pointInPoly(hole.tee[0], hole.tee[1], t.polygon));
  if (onBox) return;
  hole.tees.push({
    polygon: ellipseAround(hole.tee, 9, 7),
    center: hole.tee,
  });
}

function ensureFairway(hole: HoleData): void {
  if (hole.par < 4 || hole.fairways.length > 0) return;
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  const polygon = corridorPolygon(path, 22);
  if (polygon.length < 4) return;
  const mid = path[Math.floor(path.length / 2)] ?? hole.tee;
  hole.fairways.push({ polygon, center: mid });
}

function ensurePin(course: CourseData, hole: HoleData): void {
  if (inWater(course, hole.pin[0], hole.pin[1])) {
    hole.pin = hole.greenCenter;
  }
  if (inWater(course, hole.greenCenter[0], hole.greenCenter[1])) {
    const inland = nudgeOffWater(course, hole.greenCenter, hole.tee);
    hole.greenCenter = inland;
    if (inWater(course, hole.pin[0], hole.pin[1])) hole.pin = inland;
  }
  hole.tee = nudgeOffWater(course, hole.tee, hole.greenCenter);
}

function assignNearbyBunkers(course: CourseData): void {
  const kept: typeof course.unassignedBunkers = [];
  for (const bunker of course.unassignedBunkers) {
    let best: { hole: HoleData; dist: number; along: number } | null = null;
    for (const hole of course.holes) {
      const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
      const near = closestOnPath(path, bunker.center);
      if (!best || near.dist < best.dist) best = { hole, dist: near.dist, along: near.along };
    }
    if (!best || best.dist > BUNKER_ASSIGN_YARDS) {
      kept.push(bunker);
      continue;
    }
    const path = best.hole.path.length >= 2 ? best.hole.path : [best.hole.tee, best.hole.greenCenter];
    const feature: BunkerFeature = {
      ...bunker,
      side: sideOfPath(bunker.center, path),
      yardsFromTee: Math.round(best.along),
      yardsToGreen: Math.round(dist(bunker.center, best.hole.greenCenter)),
    };
    best.hole.bunkers.push(feature);
    best.hole.bunkers.sort((a, b) => a.yardsFromTee - b.yardsFromTee);
  }
  course.unassignedBunkers = kept;
}

/**
 * OSM leaves some holes thinner than 7/8: missing green, tee box, fairway,
 * or bunkers sitting just outside the assign radius. Fill those so every
 * hole on the card is playable. Idempotent.
 */
export function repairCourse(course: CourseData): CourseData {
  for (const hole of course.holes) {
    ensurePath(hole);
    ensurePin(course, hole);
    ensureGreen(hole);
    ensureTeeBox(hole);
    ensureFairway(hole);
  }
  assignNearbyBunkers(course);
  return course;
}
