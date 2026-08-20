import * as THREE from "three";
import type { HoleData } from "../course/types";
import { closestOnPath } from "../course/geom";
import type { ShotRequest } from "./parse";
import type { Cover } from "../scene/cover";
import { applyLieToCarry, classifyLie, type Lie } from "./lie";
import { formatLeftover, isHoledOut, type BallState } from "./play";

export interface ShotPoint {
  position: THREE.Vector3;
  yardsAlong: number;
  airborne: boolean;
  phase: "carry" | "roll";
}

export interface ShotTrouble {
  ocean: boolean;
  bunker: boolean;
  woods: boolean;
  shortSided: boolean;
}

export interface ShotResult {
  points: ShotPoint[];
  club: ShotRequest["club"];
  carryYards: number;
  rollYards: number;
  totalYards: number;
  peakYards: number;
  landCover: Cover;
  landLie: Lie;
  outcome: string;
  pinDistance: number;
  remainingYards: number;
  leftoverLabel: string;
  start: { x: number; z: number; lie: Lie };
  end: { x: number; z: number; cover: Cover; lie: Lie; alongYards: number; pinYards: number };
  carryEnd: { x: number; z: number; cover: Cover; lie: Lie };
  lastPlayable: { x: number; z: number };
  lieNote: string;
  elevNote: string;
  penaltyStrokes: number;
  trouble: ShotTrouble;
  aim: { ux: number; uz: number; leftYards: number; target: { x: number; z: number } };
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

export function pinFrame(origin: { x: number; z: number }, pin: [number, number]) {
  const toPinX = pin[0] - origin.x;
  const toPinZ = pin[1] - origin.z;
  const pinLen = Math.hypot(toPinX, toPinZ) || 1;
  const pux = toPinX / pinLen;
  const puz = toPinZ / pinLen;
  return { pux, puz, prx: -puz, prz: pux, pinLen };
}

/** Convert a world landing point into pin-line carry and yards left of that line. */
export function aimFromPoint(
  origin: { x: number; z: number },
  pin: [number, number],
  target: { x: number; z: number },
): { landYards: number; aimYardsLeft: number; ux: number; uz: number; rx: number; rz: number } {
  const { pux, puz, prx, prz } = pinFrame(origin, pin);
  const vx = target.x - origin.x;
  const vz = target.z - origin.z;
  const landYards = vx * pux + vz * puz;
  const aimYardsLeft = vx * prx + vz * prz;
  let ux = vx;
  let uz = vz;
  const len = Math.hypot(ux, uz) || 1;
  ux /= len;
  uz /= len;
  return { landYards, aimYardsLeft, ux, uz, rx: -uz, rz: ux };
}

export function resolveAim(
  hole: HoleData,
  origin: { x: number; z: number },
  req: Pick<ShotRequest, "aimYardsLeft" | "landYards" | "target">,
): { ux: number; uz: number; rx: number; rz: number; leftYards: number; target: { x: number; z: number } } {
  const pin: [number, number] = [hole.pin[0], hole.pin[1]];
  const { pux, puz, prx, prz, pinLen } = pinFrame(origin, pin);

  if (req.target) {
    const aimed = aimFromPoint(origin, pin, req.target);
    return {
      ux: aimed.ux,
      uz: aimed.uz,
      rx: aimed.rx,
      rz: aimed.rz,
      leftYards: aimed.aimYardsLeft,
      target: { x: req.target.x, z: req.target.z },
    };
  }

  let tx = pin[0];
  let tz = pin[1];
  if (req.landYards != null && req.landYards > 0) {
    const along = Math.min(req.landYards, pinLen);
    tx = origin.x + pux * along;
    tz = origin.z + puz * along;
  }

  const left = req.aimYardsLeft ?? 0;
  tx += prx * left;
  tz += prz * left;

  let ux = tx - origin.x;
  let uz = tz - origin.z;
  const len = Math.hypot(ux, uz) || 1;
  ux /= len;
  uz /= len;
  return { ux, uz, rx: -uz, rz: ux, leftYards: left, target: { x: tx, z: tz } };
}

function elevationDelta(
  origin: { x: number; z: number },
  ux: number,
  uz: number,
  yards: number,
  heightAt: (x: number, z: number) => number,
  coverAt: (x: number, z: number) => Cover,
): number {
  const startY = heightAt(origin.x, origin.z);
  const steps = 8;
  let landY = startY;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = origin.x + ux * yards * t;
    const z = origin.z + uz * yards * t;
    if (coverAt(x, z) === "ocean") break;
    landY = heightAt(x, z);
  }
  return Math.max(-22, Math.min(22, landY - startY));
}

function isShortSided(end: { x: number; z: number }, hole: HoleData, lie: Lie, pinDist: number): boolean {
  if (lie === "green" || lie === "ocean" || lie === "tee") return false;
  if (pinDist > 22) return false;
  const g = hole.greenCenter;
  const toEndX = end.x - g[0];
  const toEndZ = end.z - g[1];
  const toPinX = hole.pin[0] - g[0];
  const toPinZ = hole.pin[1] - g[1];
  const endR = Math.hypot(toEndX, toEndZ);
  const pinR = Math.hypot(toPinX, toPinZ);
  const dot = toEndX * toPinX + toEndZ * toPinZ;
  return pinDist < 18 && endR > 8 && dot > 0 && pinR < endR;
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
  const aim = resolveAim(hole, origin, req);
  const { ux, uz, rx, rz } = aim;

  const isPutt = req.club === "putter";
  const windAdj = isPutt ? 0 : req.windMph < 0 ? Math.abs(req.windMph) * 1.4 : req.windMph > 0 ? -req.windMph * 1.1 : 0;
  const requested = Math.max(isPutt ? 0.6 : 8, req.carryYards + windAdj);
  const { carry: lieCarry, effect } = applyLieToCarry(origin.lie, req.club, requested);

  const elev = isPutt ? 0 : elevationDelta(origin, ux, uz, lieCarry, heightAt, coverAt);
  const elevK = req.club === "driver" || req.club.includes("wood") ? 0.5 : 0.85;
  const elevAdj = -elev * elevK;
  const carry = isPutt ? 0 : Math.max(6, lieCarry + elevAdj);
  const rollPlanned = isPutt
    ? Math.max(0.6, requested * effect.rollScale)
    : (() => {
        let roll = 0;
        const probeX = origin.x + ux * carry;
        const probeZ = origin.z + uz * carry;
        const landCover = coverAt(probeX, probeZ);
        if (landCover === "green") roll = carry * 0.04;
        else if (landCover === "fairway" || landCover === "tee") roll = carry * 0.08;
        else if (landCover === "rough") roll = carry * 0.03;
        else if (landCover === "woods") roll = carry * 0.015;
        else if (landCover === "bunker" || landCover === "sand") roll = 1;
        else if (landCover === "ocean") roll = 0;
        else roll = carry * 0.04;
        return roll * effect.rollScale;
      })();

  const cross = isPutt ? 0 : (req.windMph > 0 ? req.windMph : 0) * (req.windFromLeft ? 0.55 : -0.55);
  const launch = isPutt ? 0.008 : req.club === "driver" || req.club.includes("wood") ? 0.22 : 0.28;
  const peakHeight = isPutt
    ? 0.35
    : Math.max(1.2, carry * launch * (req.club === "lw" || req.club === "sw" ? 1.35 : 1)) * effect.peakScale;

  const samples = Math.max(40, Math.round((isPutt ? rollPlanned : carry) / 2.5));
  const points: ShotPoint[] = [];
  let lastPlayable = { x: origin.x, z: origin.z };
  let peakYards = 0;
  let carryEnd = { x: origin.x, z: origin.z, cover: origin.cover, lie: origin.lie };
  const holeHit: { pos: { x: number; z: number } | null } = { pos: null };

  const pushPoint = (x: number, z: number, along: number, airborne: boolean, phase: "carry" | "roll") => {
    const ground = heightAt(x, z);
    const flight = phase === "carry" ? Math.sin(Math.min(1, along / Math.max(carry, 0.01)) * Math.PI) * peakHeight : 0;
    const y = ground + (phase === "carry" ? flight : 0.12);
    if (flight > peakYards) peakYards = flight;
    const cover = coverAt(x, z);
    if (cover !== "ocean") lastPlayable = { x, z };
    const pinD = Math.hypot(x - pin[0], z - pin[1]);
    const nearGround = phase === "roll" || flight < 0.85;
    if (!holeHit.pos && nearGround && isHoledOut(pinD, classifyLie(cover))) holeHit.pos = { x: pin[0], z: pin[1] };
    points.push({
      position: new THREE.Vector3(x, y, z),
      yardsAlong: origin.alongYards + along,
      airborne: airborne && !holeHit.pos,
      phase,
    });
    return cover;
  };

  pushPoint(origin.x, origin.z, 0, false, isPutt ? "roll" : "carry");

  if (!isPutt) {
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const along = carry * t;
      const lateral = shapeLateral(req.shape, t, carry) + cross * t * t;
      const x = origin.x + ux * along + rx * lateral;
      const z = origin.z + uz * along + rz * lateral;
      const cover = pushPoint(x, z, along, t < 0.98, "carry");
      if (i === samples) carryEnd = { x, z, cover, lie: classifyLie(cover) };
      if (holeHit.pos) break;
    }
  } else {
    carryEnd = { x: origin.x, z: origin.z, cover: origin.cover, lie: origin.lie };
  }

  if (!holeHit.pos && rollPlanned > 0.2) {
    const rollSamples = Math.max(4, Math.round(rollPlanned / (isPutt ? 0.8 : 3)));
    const lastLat = isPutt ? 0 : shapeLateral(req.shape, 1, Math.max(carry, 1)) + cross;
    for (let i = 1; i <= rollSamples; i++) {
      const t = i / rollSamples;
      const along = carry + rollPlanned * t;
      const lat = lastLat * (1 - t * 0.25);
      const x = origin.x + ux * along + rx * lat;
      const z = origin.z + uz * along + rz * lat;
      const cover = pushPoint(x, z, along, false, "roll");
      if (cover === "ocean" || cover === "bunker" || cover === "sand") break;
      if (holeHit.pos) break;
    }
  }

  if (holeHit.pos && points.length) {
    const y = heightAt(holeHit.pos.x, holeHit.pos.z) + 0.08;
    points.push({
      position: new THREE.Vector3(holeHit.pos.x, y, holeHit.pos.z),
      yardsAlong: origin.alongYards + carry + rollPlanned,
      airborne: false,
      phase: "roll",
    });
  }

  const end = points.length ? points[points.length - 1].position : new THREE.Vector3(origin.x, heightAt(origin.x, origin.z), origin.z);
  const landCover = coverAt(end.x, end.z);
  const landLie = classifyLie(landCover);
  const pinDistance = Math.hypot(end.x - pin[0], end.z - pin[1]);
  const alongEnd = closestOnPath(path, [end.x, end.z]).along;
  const holed = holeHit.pos != null || isHoledOut(pinDistance, landLie);
  const remaining = holed ? 0 : pinDistance;
  const leftoverLabel = formatLeftover(remaining, landLie, holed);
  const penaltyStrokes = landLie === "ocean" ? 1 : 0;
  const shortSided = isShortSided(end, hole, landLie, pinDistance);
  const trouble: ShotTrouble = {
    ocean: landLie === "ocean",
    bunker: landLie === "bunker" || landLie === "sand",
    woods: landLie === "woods",
    shortSided,
  };

  const elevNote =
    Math.abs(elev) < 2.5
      ? ""
      : elev < 0
        ? `Downhill ${Math.round(Math.abs(elev))} yds`
        : `Uphill ${Math.round(elev)} yds`;

  const landLine = (() => {
    if (holed) return "Holed out";
    if (landLie === "ocean") return "In the Pacific. Penalty drop next";
    if (landLie === "bunker" || landLie === "sand") return `In a bunker · ${leftoverLabel}`;
    if (landLie === "woods") return `In the trees · ${leftoverLabel}`;
    if (shortSided) return `Short-sided · ${leftoverLabel}`;
    if (landLie === "green") return `On the green · ${leftoverLabel}`;
    if (remaining < 15) return `Near the green · ${leftoverLabel}`;
    return `Landed in ${landLie} · ${leftoverLabel}`;
  })();

  const bits: string[] = [];
  if (dropped) bits.push("Penalty drop");
  if (effect.note && origin.lie !== "fairway" && origin.lie !== "tee") bits.push(effect.note);
  if (elevNote) bits.push(elevNote);
  bits.push(landLine);

  const rollYards = Math.max(0, Math.hypot(end.x - carryEnd.x, end.z - carryEnd.z));

  return {
    points,
    club: req.club,
    carryYards: Math.round(carry),
    rollYards: Math.round(rollYards),
    totalYards: Math.round(carry + rollYards),
    peakYards: Math.round(peakYards),
    landCover,
    landLie,
    outcome: bits.join(" · "),
    pinDistance: Math.round(pinDistance * 10) / 10,
    remainingYards: remaining,
    leftoverLabel,
    start: { x: origin.x, z: origin.z, lie: origin.lie },
    end: { x: end.x, z: end.z, cover: landCover, lie: landLie, alongYards: alongEnd, pinYards: pinDistance },
    carryEnd,
    lastPlayable,
    lieNote: effect.note,
    elevNote,
    penaltyStrokes,
    trouble,
    aim: { ux, uz, leftYards: aim.leftYards, target: aim.target },
  };
}
