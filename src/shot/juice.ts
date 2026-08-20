import { lieLabel, type Lie } from "./lie";
import { leftoverAmount, leftoverUnit } from "./play";
import { formatToPar } from "./round";

export const SHOT_STING_MS = 1000;
export const HOLE_OUT_HOLD_MS = 2000;
export const LAST_HOLE = 18;

export type JuiceTone = "good" | "neutral" | "bad";

export interface ShotStingInput {
  landLie: Lie;
  remainingYards: number;
  leftoverLabel: string;
  penaltyStrokes: number;
  trouble: { ocean: boolean; bunker: boolean; woods: boolean };
}

export interface HoleOutInput {
  holeNumber: number;
  strokes: number;
}

export interface ShotSting {
  kind: "shot";
  headline: string;
  detail: string;
  tone: JuiceTone;
  holdMs: number;
}

export interface HoleOutBeat {
  kind: "hole-out" | "round-done";
  hole: number;
  strokes: number;
  par: number;
  toPar: number;
  toParLabel: string;
  scoreName: string;
  headline: string;
  detail: string;
  thruLabel: string;
  nextHole: number | null;
  holdMs: number;
}

export type JuiceBeat = ShotSting | HoleOutBeat;

export function nextHoleAfter(hole: number): number | null {
  return hole >= LAST_HOLE ? null : hole + 1;
}

export function holeScoreName(strokes: number, par: number): { name: string; label: string; toPar: number } {
  const toPar = strokes - par;
  if (toPar <= -3) return { name: "albatross", label: "Albatross", toPar };
  if (toPar === -2) return { name: "eagle", label: "Eagle", toPar };
  if (toPar === -1) return { name: "birdie", label: "Birdie", toPar };
  if (toPar === 0) return { name: "par", label: "Par", toPar };
  if (toPar === 1) return { name: "bogey", label: "Bogey", toPar };
  if (toPar === 2) return { name: "double", label: "Double", toPar };
  if (toPar === 3) return { name: "triple", label: "Triple", toPar };
  const label = formatToPar(toPar);
  return { name: label, label, toPar };
}

export function leftoverShort(pinYards: number, lie: Lie, holed = false): string {
  if (holed) return "Holed";
  const n = leftoverAmount(pinYards, lie, false);
  return leftoverUnit(lie, false) === "ft" ? `${n} ft` : `${n} yds`;
}

export function shotStingFrom(result: ShotStingInput): ShotSting {
  const holed = result.leftoverLabel === "Holed";
  const leftover = leftoverShort(result.remainingYards, result.landLie, holed);
  if (result.trouble.ocean || result.landLie === "ocean") {
    return { kind: "shot", headline: "Ocean", detail: "Penalty", tone: "bad", holdMs: SHOT_STING_MS };
  }
  if (result.penaltyStrokes > 0) {
    return { kind: "shot", headline: "Penalty", detail: leftover, tone: "bad", holdMs: SHOT_STING_MS };
  }
  if (result.trouble.bunker || result.landLie === "bunker" || result.landLie === "sand") {
    return { kind: "shot", headline: "Bunker", detail: leftover, tone: "bad", holdMs: SHOT_STING_MS };
  }
  if (result.trouble.woods || result.landLie === "woods") {
    return { kind: "shot", headline: "Trees", detail: leftover, tone: "bad", holdMs: SHOT_STING_MS };
  }
  if (result.landLie === "green") {
    return {
      kind: "shot",
      headline: result.remainingYards <= 8 ? "Sits tight" : "Nice",
      detail: leftover,
      tone: "good",
      holdMs: SHOT_STING_MS,
    };
  }
  if (result.remainingYards <= 12) {
    return { kind: "shot", headline: "Sits tight", detail: leftover, tone: "good", holdMs: SHOT_STING_MS };
  }
  return {
    kind: "shot",
    headline: leftover,
    detail: lieLabel(result.landLie),
    tone: "neutral",
    holdMs: SHOT_STING_MS,
  };
}

export function holeOutBeatFrom(play: HoleOutInput, par: number, thruLabel: string): HoleOutBeat {
  const scored = holeScoreName(play.strokes, par);
  const nextHole = nextHoleAfter(play.holeNumber);
  const roundDone = nextHole == null;
  return {
    kind: roundDone ? "round-done" : "hole-out",
    hole: play.holeNumber,
    strokes: play.strokes,
    par,
    toPar: scored.toPar,
    toParLabel: formatToPar(scored.toPar),
    scoreName: scored.name,
    headline: scored.label,
    detail: `Hole ${play.holeNumber} · ${play.strokes} · ${formatToPar(scored.toPar)}`,
    thruLabel,
    nextHole,
    holdMs: HOLE_OUT_HOLD_MS,
  };
}
