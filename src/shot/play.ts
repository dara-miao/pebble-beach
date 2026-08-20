import type { HoleData, TeeSet } from "../course/types";
import { closestOnPath } from "../course/geom";
import type { Cover } from "../scene/cover";
import { classifyLie, lieLabel, type Lie } from "./lie";
import type { ShotResult } from "./simulate";

export interface BallState {
  x: number;
  z: number;
  alongYards: number;
  cover: Cover;
  lie: Lie;
  pinYards: number;
  remainingYards: number;
  holed: boolean;
}

export interface HolePlay {
  holeNumber: number;
  tee: TeeSet;
  holeYards: number;
  strokes: number;
  penalties: number;
  ball: BallState;
  pendingDrop: { x: number; z: number } | null;
  lastShot: ShotResult | null;
}

const HOLE_OUT_YARDS = 1.05;

export function ballAt(x: number, z: number, hole: HoleData, coverAt: (x: number, z: number) => Cover): BallState {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  const cover = coverAt(x, z);
  const lie = classifyLie(cover);
  const pinYards = Math.hypot(x - hole.pin[0], z - hole.pin[1]);
  const along = closestOnPath(path, [x, z]).along;
  const holed = pinYards <= HOLE_OUT_YARDS && (lie === "green" || pinYards <= 0.55);
  return {
    x,
    z,
    alongYards: along,
    cover,
    lie,
    pinYards,
    remainingYards: holed ? 0 : pinYards,
    holed,
  };
}

export function createHolePlay(hole: HoleData, tee: TeeSet, coverAt: (x: number, z: number) => Cover): HolePlay {
  const [x, z] = hole.tee;
  const ball = ballAt(x, z, hole, coverAt);
  const scorecard = hole.yards[tee] ?? ball.pinYards;
  return {
    holeNumber: hole.number,
    tee,
    holeYards: scorecard,
    strokes: 0,
    penalties: 0,
    ball: { ...ball, remainingYards: scorecard },
    pendingDrop: null,
    lastShot: null,
  };
}

export function playableDrop(
  from: { x: number; z: number },
  hole: HoleData,
  coverAt: (x: number, z: number) => Cover,
): { x: number; z: number } {
  const tx = hole.tee[0];
  const tz = hole.tee[1];
  if (classifyLie(coverAt(from.x, from.z)) !== "ocean") return from;
  for (let i = 1; i <= 48; i++) {
    const t = i / 48;
    const x = from.x + (tx - from.x) * t;
    const z = from.z + (tz - from.z) * t;
    if (classifyLie(coverAt(x, z)) !== "ocean") return { x, z };
  }
  return { x: tx, z: tz };
}

export function resolveOrigin(play: HolePlay, hole: HoleData, coverAt: (x: number, z: number) => Cover): {
  origin: BallState;
  dropped: boolean;
} {
  if (play.ball.lie !== "ocean") return { origin: play.ball, dropped: false };
  const raw = play.pendingDrop ?? { x: hole.tee[0], z: hole.tee[1] };
  const drop = playableDrop(raw, hole, coverAt);
  return { origin: ballAt(drop.x, drop.z, hole, coverAt), dropped: true };
}

export function applyShotResult(play: HolePlay, result: ShotResult, hole: HoleData, coverAt: (x: number, z: number) => Cover): HolePlay {
  const ball = ballAt(result.end.x, result.end.z, hole, coverAt);
  const penalty = result.penaltyStrokes;
  return {
    ...play,
    strokes: play.strokes + 1 + penalty,
    penalties: play.penalties + penalty,
    ball,
    pendingDrop: ball.lie === "ocean" ? playableDrop(result.lastPlayable, hole, coverAt) : null,
    lastShot: result,
  };
}

export function leftoverCopy(play: HolePlay): string {
  if (play.ball.holed) return "Holed";
  if (play.ball.lie === "green") return `${Math.round(play.ball.pinYards)} yds to pin`;
  return `${Math.round(play.ball.remainingYards)} yds to pin`;
}

export function lieCopy(play: HolePlay): string {
  if (play.ball.lie === "ocean" && play.pendingDrop) {
    return `${lieLabel(play.ball.lie)} · drop next`;
  }
  return lieLabel(play.ball.lie);
}
