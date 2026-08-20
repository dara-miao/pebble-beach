import type { HoleData } from "../course/types";
import type { Cover } from "../scene/cover";
import type { Club, ShotRequest } from "./parse";
import type { BallState } from "./play";
import { simulateShot, type ShotResult, type ShotTrouble } from "./simulate";
import type { Lie } from "./lie";
import type { WindCondition } from "./wind";

export type MissKind = "pull" | "push" | "short" | "long";

export interface MissDispersion {
  lateralYards: number;
  shortYards: number;
  longYards: number;
}

export interface MissLanding {
  kind: MissKind;
  x: number;
  z: number;
  lie: Lie;
  leftoverLabel: string;
  trouble: ShotTrouble;
  carryYards: number;
  result: ShotResult;
}

export interface MissEnvelope {
  called: ShotResult;
  samples: MissLanding[];
  hazard: { ocean: boolean; bunker: boolean; woods: boolean };
  safe: boolean;
  copy: string;
}

const KINDS: MissKind[] = ["pull", "push", "short", "long"];

/** Slight competitive-golfer miss — not a range-bay spray. */
export function missDispersion(club: Club, carryYards: number): MissDispersion {
  if (club === "putter") {
    const ft = Math.max(2, carryYards * 3);
    return {
      lateralYards: Math.min(1.2, 0.25 + ft * 0.02),
      shortYards: Math.min(2.2, 0.5 + ft * 0.04),
      longYards: Math.min(2.4, 0.55 + ft * 0.045),
    };
  }
  const wood = club === "driver" || club.includes("wood") || club === "hybrid";
  const wedge = club === "pw" || club === "gw" || club === "sw" || club === "lw";
  const carry = Math.max(12, carryYards);
  const lat = wood
    ? Math.min(12, Math.max(6, carry * 0.038))
    : wedge
      ? Math.min(7.5, Math.max(3.6, carry * 0.048))
      : Math.min(9.5, Math.max(4.5, carry * 0.042));
  const depth = wood
    ? Math.min(16, Math.max(8, carry * 0.052))
    : wedge
      ? Math.min(9, Math.max(4.5, carry * 0.06))
      : Math.min(12, Math.max(5.5, carry * 0.055));
  return { lateralYards: lat, shortYards: depth * 0.9, longYards: depth };
}

function offsetPoint(
  origin: { x: number; z: number },
  target: { x: number; z: number },
  leftYards: number,
  alongYards: number,
): { x: number; z: number } {
  const vx = target.x - origin.x;
  const vz = target.z - origin.z;
  const len = Math.hypot(vx, vz) || 1;
  const ux = vx / len;
  const uz = vz / len;
  return {
    x: target.x + -uz * leftYards + ux * alongYards,
    z: target.z + ux * leftYards + uz * alongYards,
  };
}

export function missRequest(
  req: ShotRequest,
  kind: MissKind,
  dispersion: MissDispersion,
  origin: { x: number; z: number },
): ShotRequest {
  const next: ShotRequest = {
    ...req,
    target: req.target ? { x: req.target.x, z: req.target.z } : undefined,
  };
  if (kind === "short") {
    next.carryYards = Math.max(req.club === "putter" ? 0.6 : 8, req.carryYards - dispersion.shortYards);
    return next;
  }
  if (kind === "long") {
    next.carryYards = req.carryYards + dispersion.longYards;
    return next;
  }
  const left = kind === "pull" ? dispersion.lateralYards : -dispersion.lateralYards;
  next.aimYardsLeft = req.aimYardsLeft + left;
  if (req.target) next.target = offsetPoint(origin, req.target, left, 0);
  return next;
}

function kindWord(kind: MissKind): string {
  if (kind === "pull") return "left";
  if (kind === "push") return "right";
  return kind;
}

function sampleCopy(sample: MissLanding): string | null {
  if (sample.trouble.ocean) return `miss ${kindWord(sample.kind)}: ocean`;
  if (sample.trouble.bunker) return `miss ${kindWord(sample.kind)}: bunker`;
  if (sample.trouble.woods) return `miss ${kindWord(sample.kind)}: trees`;
  return null;
}

export function missEnvelopeCopy(samples: MissLanding[]): string {
  const bits = samples.map(sampleCopy).filter((s): s is string => s != null);
  const unique = [...new Set(bits)];
  return unique.length ? unique.join(" · ") : "Miss stays safe";
}

export function simulateMissEnvelope(
  hole: HoleData,
  req: ShotRequest,
  heightAt: (x: number, z: number) => number,
  coverAt: (x: number, z: number) => Cover,
  origin: BallState,
  dropped = false,
  holeWind?: WindCondition | null,
): MissEnvelope {
  const called = simulateShot(hole, req, heightAt, coverAt, origin, dropped, holeWind);
  const skip = req.club === "putter" && req.carryYards < 4;
  const dispersion = missDispersion(req.club, req.carryYards);
  const samples: MissLanding[] = skip
    ? []
    : KINDS.map((kind) => {
        const result = simulateShot(
          hole,
          missRequest(req, kind, dispersion, origin),
          heightAt,
          coverAt,
          origin,
          dropped,
          holeWind,
        );
        return {
          kind,
          x: result.end.x,
          z: result.end.z,
          lie: result.landLie,
          leftoverLabel: result.leftoverLabel,
          trouble: result.trouble,
          carryYards: result.carryYards,
          result,
        };
      });

  const hazard = {
    ocean: samples.some((s) => s.trouble.ocean),
    bunker: samples.some((s) => s.trouble.bunker),
    woods: samples.some((s) => s.trouble.woods),
  };
  return {
    called,
    samples,
    hazard,
    safe: !hazard.ocean && !hazard.bunker && !hazard.woods,
    copy: missEnvelopeCopy(samples),
  };
}

export function missShowsHazard(envelope: MissEnvelope, kind: "bunker" | "ocean" | "woods"): boolean {
  return envelope.hazard[kind];
}
