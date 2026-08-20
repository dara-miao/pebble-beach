import type { HoleData, TeeSet } from "../course/types";
import { closestOnPath, teeStance } from "../course/geom";
import type { Cover } from "../scene/cover";
import { classifyLie, lieLabel, type Lie } from "./lie";
import type { Club } from "./parse";
import { CLUB_LABEL } from "./parse";
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

export interface HoleShot {
  club: Club;
  clubLabel: string;
  carryYards: number;
  totalYards: number;
  lieIn: Lie;
  lieOut: Lie;
  leftoverLabel: string;
  leftover: number;
  leftoverUnit: "ft" | "yds" | "";
  penalty: number;
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
  shots: HoleShot[];
}

/** About 2.2 feet — a tap-in a competitive golfer would concede as holed. */
export const HOLE_OUT_YARDS = 0.72;
export const CHIP_IN_YARDS = 0.45;

export function pinDistance3d(x: number, z: number, hole: HoleData): number {
  return Math.hypot(x - hole.pin[0], z - hole.pin[1]);
}

export function isHoledOut(pinYards: number, lie: Lie): boolean {
  if (pinYards <= 0.12) return true;
  return pinYards <= HOLE_OUT_YARDS && (lie === "green" || pinYards <= CHIP_IN_YARDS);
}

export function leftoverAmount(pinYards: number, lie: Lie, holed = false): number {
  if (holed || pinYards <= 0) return 0;
  if (lie === "green") return Math.max(1, Math.round(pinYards * 3));
  return Math.round(pinYards);
}

export function leftoverUnit(lie: Lie, holed = false): "ft" | "yds" | "" {
  if (holed) return "";
  return lie === "green" ? "ft" : "yds";
}

export function formatLeftover(pinYards: number, lie: Lie, holed = false): string {
  if (holed || pinYards <= 0) return "Holed";
  const n = leftoverAmount(pinYards, lie, false);
  return lie === "green" ? `${n} ft to pin` : `${n} yds to pin`;
}

export function ballAt(x: number, z: number, hole: HoleData, coverAt: (x: number, z: number) => Cover): BallState {
  const path = hole.path.length >= 2 ? hole.path : [hole.tee, hole.greenCenter];
  const cover = coverAt(x, z);
  const lie = classifyLie(cover);
  const pinYards = pinDistance3d(x, z, hole);
  const along = closestOnPath(path, [x, z]).along;
  const holed = isHoledOut(pinYards, lie);
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
  const [x, z] = teeStance(hole, tee);
  const ball = ballAt(x, z, hole, coverAt);
  if (!ball.holed && ball.lie !== "ocean") {
    ball.lie = "tee";
    if (ball.cover !== "ocean") ball.cover = "tee";
  }
  const scorecard = hole.yards[tee] ?? ball.pinYards;
  return {
    holeNumber: hole.number,
    tee,
    holeYards: scorecard,
    strokes: 0,
    penalties: 0,
    ball,
    pendingDrop: null,
    lastShot: null,
    shots: [],
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
  const leftover = leftoverAmount(ball.pinYards, ball.lie, ball.holed);
  const shot: HoleShot = {
    club: result.club,
    clubLabel: CLUB_LABEL[result.club],
    carryYards: result.carryYards,
    totalYards: result.totalYards,
    lieIn: result.start.lie,
    lieOut: result.landLie,
    leftoverLabel: result.leftoverLabel,
    leftover,
    leftoverUnit: leftoverUnit(ball.lie, ball.holed),
    penalty,
  };
  return {
    ...play,
    strokes: play.strokes + 1 + penalty,
    penalties: play.penalties + penalty,
    ball,
    pendingDrop: ball.lie === "ocean" ? playableDrop(result.lastPlayable, hole, coverAt) : null,
    lastShot: result,
    shots: [...play.shots, shot],
  };
}

export function leftoverCopy(play: HolePlay): string {
  return formatLeftover(play.ball.pinYards, play.ball.lie, play.ball.holed);
}

export function lieCopy(play: HolePlay): string {
  if (play.strokes === 0 && !play.ball.holed) return "Tee";
  if (play.ball.lie === "ocean" && play.pendingDrop) {
    return `${lieLabel(play.ball.lie)} · drop next`;
  }
  return lieLabel(play.ball.lie);
}

export function scoreCopy(play: HolePlay): string {
  if (play.strokes === 0) return "—";
  return play.penalties ? `${play.strokes} (${play.penalties} pen)` : `${play.strokes}`;
}
