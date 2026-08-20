import type { Cover } from "../scene/cover";
import type { Club } from "./parse";

export type Lie = "tee" | "fairway" | "rough" | "woods" | "bunker" | "sand" | "green" | "ocean" | "rock" | "path";

export interface LieEffect {
  lie: Lie;
  carryScale: number;
  rollScale: number;
  peakScale: number;
  maxCarry: number | null;
  note: string;
}

export function classifyLie(cover: Cover): Lie {
  if (cover === "bunker") return "bunker";
  if (cover === "sand") return "sand";
  if (cover === "ocean") return "ocean";
  if (cover === "woods") return "woods";
  if (cover === "rough") return "rough";
  if (cover === "rock") return "rock";
  if (cover === "green") return "green";
  if (cover === "tee") return "tee";
  if (cover === "path") return "path";
  return "fairway";
}

export function lieLabel(lie: Lie): string {
  switch (lie) {
    case "tee":
      return "Tee";
    case "fairway":
      return "Fairway";
    case "rough":
      return "Rough";
    case "woods":
      return "Trees";
    case "bunker":
      return "Bunker";
    case "sand":
      return "Sand";
    case "green":
      return "Green";
    case "ocean":
      return "Ocean";
    case "rock":
      return "Rock";
    case "path":
      return "Path";
  }
}

export function lieEffect(lie: Lie, club: Club): LieEffect {
  switch (lie) {
    case "bunker":
    case "sand": {
      const isSandClub = club === "sw" || club === "lw";
      const isWedge = isSandClub || club === "pw" || club === "gw";
      return {
        lie,
        carryScale: isSandClub ? 0.82 : isWedge ? 0.55 : 0.28,
        rollScale: 0.1,
        peakScale: 1.4,
        maxCarry: isSandClub ? 90 : isWedge ? 55 : 36,
        note: "Bunker splash",
      };
    }
    case "woods":
      return {
        lie,
        carryScale: 0.55,
        rollScale: 0.22,
        peakScale: 0.42,
        maxCarry: 140,
        note: "Punch from the trees",
      };
    case "rough": {
      const flyer = club === "driver" || club === "3wood" || club === "5wood" || club === "hybrid" || club === "4iron" || club === "5iron";
      const heavy = club === "8iron" || club === "9iron" || club === "pw" || club === "gw" || club === "sw" || club === "lw";
      if (flyer) {
        return {
          lie,
          carryScale: 1.06,
          rollScale: 1.22,
          peakScale: 0.9,
          maxCarry: null,
          note: "Flyer lie",
        };
      }
      if (heavy) {
        return {
          lie,
          carryScale: 0.8,
          rollScale: 0.38,
          peakScale: 0.88,
          maxCarry: null,
          note: "Heavy rough",
        };
      }
      return {
        lie,
        carryScale: 0.86,
        rollScale: 0.5,
        peakScale: 0.92,
        maxCarry: null,
        note: "From the rough",
      };
    }
    case "rock":
      return {
        lie,
        carryScale: 0.58,
        rollScale: 0.18,
        peakScale: 0.48,
        maxCarry: 120,
        note: "Awkward rock lie",
      };
    case "ocean":
      return {
        lie,
        carryScale: 1,
        rollScale: 1,
        peakScale: 1,
        maxCarry: null,
        note: "Penalty drop",
      };
    case "green":
      return {
        lie,
        carryScale: club === "putter" ? 1 : 0.9,
        rollScale: club === "putter" ? 1 : 0.45,
        peakScale: club === "putter" ? 0.2 : 0.85,
        maxCarry: null,
        note: club === "putter" ? "Putt" : "From the green",
      };
    case "path":
      return {
        lie,
        carryScale: 0.94,
        rollScale: 1.15,
        peakScale: 0.95,
        maxCarry: null,
        note: "From the path",
      };
    default:
      return {
        lie,
        carryScale: 1,
        rollScale: lie === "fairway" ? 1.08 : 1,
        peakScale: 1,
        maxCarry: null,
        note: lie === "tee" ? "From the tee" : "Tight fairway",
      };
  }
}

export function applyLieToCarry(lie: Lie, club: Club, requestedCarry: number): { carry: number; effect: LieEffect } {
  const effect = lieEffect(lie, club);
  let carry = requestedCarry * effect.carryScale;
  if (effect.maxCarry != null) carry = Math.min(carry, effect.maxCarry);
  return { carry: Math.max(6, carry), effect };
}
