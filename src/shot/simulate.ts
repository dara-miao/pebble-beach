import * as THREE from "three";
import type { HoleData } from "../course/types";
import { dist, pointOnPath } from "../course/geom";
import type { ShotRequest, Shape } from "./parse";
import type { Cover } from "../scene/cover";

export interface ShotPoint {
  position: THREE.Vector3;
  yardsAlong: number;
  airborne: boolean;
}

export interface ShotResult {
  points: ShotPoint[];
  carryYards: number;
  totalYards: number;
  peakYards: number;
  landCover: Cover;
  outcome: string;
  pinDistance: number;
}

function shapeLateral(shape: Shape, t: number, carry: number): number {
  // Lateral yards (positive = right of aim).
  const peak = (() => {
    switch (shape) {
      case "draw":
        return -carry * 0.035;
      case "fade":
        return carry * 0.035;
      case "hook":
        return -carry * 0.07;
      case "slice":
        return carry * 0.07;
      default:
        return 0;
    }
  })();
  // Curve peaking late for fades/draws.
  return peak * Math.sin(t * Math.PI);
}

export function simulateShot(
  hole: HoleData,
  req: ShotRequest,
  heightAt: (x: number, z: number) => number,
  coverAt: (x: number, z: number) => Cover,
  teeSetYards: number,
): ShotResult {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  const holeLen = Math.max(teeSetYards, dist(hole.tee, hole.greenCenter));
  const startAlong = req.startYards != null ? Math.max(0, holeLen - req.startYards) : 0;

  // Wind: negative = downwind (more carry); positive = into/cross (less carry + lateral).
  const carryAdj =
    req.windMph < 0 ? Math.abs(req.windMph) * 1.4 : req.windMph > 0 ? -req.windMph * 1.1 : 0;
  const carry = Math.max(20, req.carryYards + carryAdj);
  const cross = (req.windMph > 0 ? req.windMph : 0) * (req.windFromLeft ? 0.55 : -0.55);

  const launch = req.club === "driver" || req.club.includes("wood") ? 0.22 : req.club === "putter" ? 0.02 : 0.28;
  const peakHeight = Math.max(2, carry * launch * (req.club === "lw" || req.club === "sw" ? 1.35 : 1));

  const samples = Math.max(40, Math.round(carry / 2.5));
  const points: ShotPoint[] = [];
  let landCover: Cover = "fairway";
  let landAlong = startAlong + carry;
  let peakYards = 0;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const along = startAlong + carry * t;
    const lateral = shapeLateral(req.shape, t, carry) + cross * t * t;
    const { point: onPath, dir: d } = pointOnPath(path, along);
    const r: [number, number] = [d[1], -d[0]];
    const x = onPath[0] + r[0] * lateral;
    const z = onPath[1] + r[1] * lateral;
    const ground = heightAt(x, z);
    const flight = Math.sin(t * Math.PI) * peakHeight;
    const y = ground + flight;
    if (flight > peakYards) peakYards = flight;
    points.push({
      position: new THREE.Vector3(x, y, z),
      yardsAlong: along,
      airborne: flight > 0.35 && t < 0.98,
    });
  }

  // Roll after landing: more on fairway/green, less in rough/bunker/ocean.
  const land = points[points.length - 1].position;
  landCover = coverAt(land.x, land.z);
  let roll = 0;
  if (landCover === "green") roll = carry * 0.04;
  else if (landCover === "fairway" || landCover === "tee") roll = carry * 0.08;
  else if (landCover === "rough") roll = carry * 0.03;
  else if (landCover === "bunker" || landCover === "sand") roll = 1;
  else if (landCover === "ocean") roll = 0;
  else roll = carry * 0.04;

  if (req.club === "putter") roll = Math.max(roll, carry * 0.15);

  const rollSamples = Math.max(4, Math.round(roll / 3));
  for (let i = 1; i <= rollSamples; i++) {
    const t = i / rollSamples;
    const along = startAlong + carry + roll * t;
    landAlong = along;
    const { point: onPath, dir: d } = pointOnPath(path, along);
    const lastLat = shapeLateral(req.shape, 1, carry) + cross;
    const r: [number, number] = [d[1], -d[0]];
    // Decay lateral toward path a bit while rolling.
    const lat = lastLat * (1 - t * 0.25);
    const x = onPath[0] + r[0] * lat;
    const z = onPath[1] + r[1] * lat;
    const y = heightAt(x, z) + 0.15;
    points.push({ position: new THREE.Vector3(x, y, z), yardsAlong: along, airborne: false });
  }

  const end = points[points.length - 1].position;
  const pin = hole.pin;
  const pinDistance = Math.hypot(end.x - pin[0], end.z - pin[1]);
  landCover = coverAt(end.x, end.z);

  const remaining = Math.max(0, holeLen - landAlong);
  let outcome = "";
  if (landCover === "ocean") outcome = "In the Pacific. Penalty.";
  else if (landCover === "bunker" || landCover === "sand") outcome = `In a bunker · ${Math.round(pinDistance)} yds to pin`;
  else if (landCover === "green") outcome = `On the green · ${Math.round(pinDistance)} yds to pin`;
  else if (remaining < 15) outcome = `Near the green · ${Math.round(pinDistance)} yds to pin`;
  else outcome = `Landed in ${landCover} · ${Math.round(remaining)} yds to green`;

  return {
    points,
    carryYards: Math.round(carry),
    totalYards: Math.round(carry + roll),
    peakYards: Math.round(peakYards),
    landCover,
    outcome,
    pinDistance: Math.round(pinDistance),
  };
}
