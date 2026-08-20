import type { HoleData } from "../course/types";
import type { Cover } from "../scene/cover";
import { lieLabel, type Lie } from "./lie";
import { CLUB_CARRY, CLUB_LABEL, clubForYards, type Club } from "./parse";
import { leftoverAmount, leftoverUnit } from "./play";

export type LineHazardKind = "bunker" | "ocean" | "woods";
export type ClearStatus = "covers" | "short" | "in";

export interface LineHazard {
  kind: LineHazardKind;
  label: string;
  carryYards: number;
  exitYards: number;
  side: "left" | "right" | "on";
}

export interface SuggestedShot {
  club: Club;
  carryYards: number;
  prompt: string;
  label: string;
}

export interface HereBook {
  leftoverYards: number;
  leftoverLabel: string;
  leftoverUnit: "ft" | "yds" | "";
  pinYards: number;
  hazards: LineHazard[];
  firstTrouble: LineHazard | null;
  coverYards: number | null;
  inPlay: ClearStatus | null;
  suggest: SuggestedShot;
}

function hazardLabel(kind: LineHazardKind, side: LineHazard["side"]): string {
  if (kind === "ocean") return "Ocean";
  if (kind === "woods") return side === "on" ? "Trees" : `Trees ${side}`;
  if (side === "on") return "Bunker";
  return `Bunker ${side}`;
}

function coverKind(cover: Cover): LineHazardKind | null {
  if (cover === "bunker" || cover === "sand") return "bunker";
  if (cover === "ocean") return "ocean";
  if (cover === "woods") return "woods";
  return null;
}

function sideOf(lat: number): LineHazard["side"] {
  if (lat > 3.5) return "left";
  if (lat < -3.5) return "right";
  return "on";
}

/** Walk the aim line and record bunker / water / trees the shot must deal with. */
export function scanLineHazards(
  origin: { x: number; z: number },
  ux: number,
  uz: number,
  maxYards: number,
  coverAt: (x: number, z: number) => Cover,
  hole?: HoleData,
): LineHazard[] {
  const limit = Math.max(24, Math.min(360, maxYards));
  const found: LineHazard[] = [];
  let open: { kind: LineHazardKind; start: number } | null = null;

  const close = (endYards: number) => {
    if (!open) return;
    found.push({
      kind: open.kind,
      label: hazardLabel(open.kind, "on"),
      carryYards: Math.round(open.start),
      exitYards: Math.round(Math.max(open.start + 4, endYards)),
      side: "on",
    });
    open = null;
  };

  const step = 1;
  for (let yds = 1; yds <= limit; yds += step) {
    const kind = coverKind(coverAt(origin.x + ux * yds, origin.z + uz * yds));
    if (kind && !open) open = { kind, start: yds };
    else if (open && kind !== open.kind) {
      close(yds);
      if (kind) open = { kind, start: yds };
    }
  }
  close(limit);

  if (hole) {
    const rx = -uz;
    const rz = ux;
    for (const b of hole.bunkers) {
      const vx = b.center[0] - origin.x;
      const vz = b.center[1] - origin.z;
      const along = vx * ux + vz * uz;
      const lat = vx * rx + vz * rz;
      if (along < 6 || along > limit || Math.abs(lat) > 18) continue;
      const already = found.some((h) => h.kind === "bunker" && Math.abs(h.carryYards - along) < 12);
      if (already) continue;
      const side = sideOf(lat);
      found.push({
        kind: "bunker",
        label: hazardLabel("bunker", side),
        carryYards: Math.round(along),
        exitYards: Math.round(along + 8),
        side,
      });
    }
  }

  found.sort((a, b) => a.carryYards - b.carryYards);
  return found;
}

export function clearStatus(carryYards: number, hazard: LineHazard): ClearStatus {
  if (carryYards + 0.5 < hazard.carryYards) return "short";
  if (carryYards + 0.5 < hazard.exitYards) return "in";
  return "covers";
}

export function suggestShot(
  lie: Lie,
  leftoverYards: number,
  pinYards = leftoverYards,
  targetYards?: number,
): SuggestedShot {
  const aim = targetYards != null && targetYards > 4 ? targetYards : leftoverYards;

  if (lie === "green" || leftoverYards <= 18) {
    const feet = Math.max(3, Math.round(pinYards * 3));
    return { club: "putter", carryYards: feet / 3, prompt: `putt ${feet} ft`, label: `putt ${feet} ft` };
  }
  if (lie === "bunker" || lie === "sand") {
    const carry = Math.max(12, Math.min(40, Math.round(leftoverYards * 0.85)));
    return { club: "sw", carryYards: carry, prompt: `sw ${carry}`, label: `sw splash ${carry}` };
  }
  if (lie === "woods") {
    const carry = Math.max(40, Math.min(120, Math.round(leftoverYards * 0.7)));
    return { club: "7iron", carryYards: carry, prompt: `7 iron ${carry}`, label: `punch 7i ${carry}` };
  }
  if (lie === "ocean") {
    return { club: "pw", carryYards: 80, prompt: "pw 80", label: "pw after drop" };
  }

  const club = clubForYards(aim);
  const stock = CLUB_CARRY[club];
  const carry = Math.max(15, Math.round(aim));
  const label = `${CLUB_LABEL[club]} ${carry}`;
  return { club, carryYards: carry || stock, prompt: `${club === "7iron" ? "7 iron" : club} ${carry}`, label };
}

export function bookFromHere(
  origin: { x: number; z: number; lie: Lie; pinYards: number; remainingYards: number; holed: boolean },
  hole: HoleData,
  aim: { ux: number; uz: number },
  coverAt: (x: number, z: number) => Cover,
  plannedCarry?: number,
  targetYards?: number,
): HereBook {
  const leftover = leftoverAmount(origin.pinYards, origin.lie, origin.holed);
  const unit = leftoverUnit(origin.lie, origin.holed);
  const leftoverLabel = origin.holed ? "Holed" : unit === "ft" ? `${leftover} ft to pin` : `${leftover} yds to pin`;
  const maxScan = Math.max(origin.pinYards + 36, 90);
  const hazards = origin.holed ? [] : scanLineHazards(origin, aim.ux, aim.uz, maxScan, coverAt, hole);
  const firstTrouble = hazards[0] ?? null;
  const coverYards = firstTrouble ? firstTrouble.exitYards : null;
  const inPlay = firstTrouble && plannedCarry != null ? clearStatus(plannedCarry, firstTrouble) : null;
  return {
    leftoverYards: leftover,
    leftoverLabel,
    leftoverUnit: unit,
    pinYards: origin.pinYards,
    hazards,
    firstTrouble,
    coverYards,
    suggest: suggestShot(origin.lie, origin.remainingYards, origin.pinYards, targetYards),
    inPlay,
  };
}

export function hazardClearCopy(hazard: LineHazard, plannedCarry?: number): string {
  if (plannedCarry == null) return `${hazard.carryYards} to cover`;
  const status = clearStatus(plannedCarry, hazard);
  if (status === "covers") return `${hazard.carryYards} · covers`;
  if (status === "in") return `${hazard.carryYards} · in it`;
  return `${hazard.carryYards} · need ${hazard.exitYards}`;
}

export function lieShort(lie: Lie): string {
  if (lie === "woods") return "trees";
  if (lie === "bunker" || lie === "sand") return "sand";
  if (lie === "fairway") return "fw";
  return lieLabel(lie).toLowerCase();
}
