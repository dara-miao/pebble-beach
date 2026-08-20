import * as THREE from "three";
import type { HoleData } from "../course/types";
import { closestOnPath } from "../course/geom";
import type { ShotRequest } from "./parse";
import type { Cover } from "../scene/cover";
import { applyLieToCarry, classifyLie, type Lie } from "./lie";
import type { BallState } from "./play";

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
  landLie: Lie;
  outcome: string;
  pinDistance: number;
  remainingYards: number;
  start: { x: number; z: number; lie: Lie };
  end: { x: number; z: number; cover: Cover; lie: Lie; alongYards: number; pinYards: number };
  lastPlayable: { x: number; z: number };
  lieNote: string;
  penaltyStrokes: number;
}

function shapeLateral(shape: ShotRequest["shape"], t: number, carry: number): number {
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
  return peak * Math.sin(t * Math.PI);
}

export function simulateShot(
  hole: HoleData,
  req: ShotRequest,
  heightAt: (x: number, z: number) => number,
  coverAt: (x: number, z: number) => Cover,
  origin: BallState,
  dropped = false,
): ShotResult {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  const pin: [number, number] = [hole.pin[0], hole.pin[1]];
  const aimDx = pin[0] - origin.x;
  const aimDz = pin[1] - origin.z;
  const aimLen = Math.hypot(aimDx, aimDz) || 1;
  const ux = aimDx / aimLen;
  const uz = aimDz / aimLen;
  const rx = uz;
  const rz = -ux;

  const windAdj = req.windMph < 0 ? Math.abs(req.windMph) * 1.4 : req.windMph > 0 ? -req.windMph * 1.1 : 0;
  const requested = Math.max(8, req.carryYards + windAdj);
  const { carry: lieCarry, effect } = applyLieToCarry(origin.lie, req.club, requested);
  const carry = lieCarry;
  const cross = (req.windMph > 0 ? req.windMph : 0) * (req.windFromLeft ? 0.55 : -0.55);

  const launch = req.club === "driver" || req.club.includes("wood") ? 0.22 : req.club === "putter" ? 0.02 : 0.28;
  const peakHeight = Math.max(1.2, carry * launch * (req.club === "lw" || req.club === "sw" ? 1.35 : 1)) * effect.peakScale;

  const samples = Math.max(40, Math.round(carry / 2.5));
  const points: ShotPoint[] = [];
  let lastPlayable = { x: origin.x, z: origin.z };
  let peakYards = 0;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const along = carry * t;
    const lateral = shapeLateral(req.shape, t, carry) + cross * t * t;
    const x = origin.x + ux * along + rx * lateral;
    const z = origin.z + uz * along + rz * lateral;
    const ground = heightAt(x, z);
    const flight = Math.sin(t * Math.PI) * peakHeight;
    const y = ground + flight;
    if (flight > peakYards) peakYards = flight;
    if (coverAt(x, z) !== "ocean") lastPlayable = { x, z };
    points.push({
      position: new THREE.Vector3(x, y, z),
      yardsAlong: origin.alongYards + along,
      airborne: flight > 0.35 && t < 0.98,
    });
  }

  const land = points[points.length - 1].position;
  let landCover = coverAt(land.x, land.z);
  let roll = 0;
  if (landCover === "green") roll = carry * 0.04;
  else if (landCover === "fairway" || landCover === "tee") roll = carry * 0.08;
  else if (landCover === "rough") roll = carry * 0.03;
  else if (landCover === "woods") roll = carry * 0.015;
  else if (landCover === "bunker" || landCover === "sand") roll = 1;
  else if (landCover === "ocean") roll = 0;
  else roll = carry * 0.04;

  roll *= effect.rollScale;
  if (req.club === "putter") roll = Math.max(roll, carry * 0.15 * effect.rollScale);

  const rollSamples = Math.max(4, Math.round(Math.max(roll, 0.01) / 3));
  if (roll > 0.2) {
    for (let i = 1; i <= rollSamples; i++) {
      const t = i / rollSamples;
      const along = carry + roll * t;
      const lastLat = shapeLateral(req.shape, 1, carry) + cross;
      const lat = lastLat * (1 - t * 0.25);
      const x = origin.x + ux * along + rx * lat;
      const z = origin.z + uz * along + rz * lat;
      const y = heightAt(x, z) + 0.15;
      if (coverAt(x, z) !== "ocean") lastPlayable = { x, z };
      points.push({ position: new THREE.Vector3(x, y, z), yardsAlong: origin.alongYards + along, airborne: false });
    }
  }

  const end = points[points.length - 1].position;
  landCover = coverAt(end.x, end.z);
  const landLie = classifyLie(landCover);
  const pinDistance = Math.hypot(end.x - pin[0], end.z - pin[1]);
  const alongEnd = closestOnPath(path, [end.x, end.z]).along;
  const holed = pinDistance <= 1.05 && (landLie === "green" || pinDistance <= 0.55);
  const remaining = holed ? 0 : pinDistance;
  const leftover = Math.round(remaining);
  const penaltyStrokes = landLie === "ocean" ? 1 : 0;

  const landLine = (() => {
    if (holed) return "Holed out";
    if (landLie === "ocean") return "In the Pacific. Penalty drop next";
    if (landLie === "bunker" || landLie === "sand") return `In a bunker · ${leftover} yds to pin`;
    if (landLie === "green") return `On the green · ${leftover} yds to pin`;
    if (landLie === "woods") return `In the trees · ${leftover} yds to pin`;
    if (remaining < 15) return `Near the green · ${leftover} yds to pin`;
    return `Landed in ${landLie} · ${leftover} yds to pin`;
  })();

  const bits: string[] = [];
  if (dropped) bits.push("Penalty drop");
  if (effect.note && origin.lie !== "fairway" && origin.lie !== "tee") bits.push(effect.note);
  bits.push(landLine);

  return {
    points,
    carryYards: Math.round(carry),
    totalYards: Math.round(carry + roll),
    peakYards: Math.round(peakYards),
    landCover,
    landLie,
    outcome: bits.join(" · "),
    pinDistance: Math.round(pinDistance),
    remainingYards: remaining,
    start: { x: origin.x, z: origin.z, lie: origin.lie },
    end: { x: end.x, z: end.z, cover: landCover, lie: landLie, alongYards: alongEnd, pinYards: pinDistance },
    lastPlayable,
    lieNote: effect.note,
    penaltyStrokes,
  };
}
