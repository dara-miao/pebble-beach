import type { ShotRequest } from "./parse";

/** Compass direction the wind is coming FROM. */
export const WIND_FROM = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type WindFrom = (typeof WIND_FROM)[number];

export interface WindCondition {
  mph: number;
  from: WindFrom;
}

export interface FlightWind {
  alongMph: number;
  crossLeftMph: number;
  carryAdj: number;
  cross: number;
}

export const DEFAULT_WIND: WindCondition = { mph: 0, from: "W" };

/** World axes: +X east, +Z south. Vector is the way the wind blows. */
export function windBlowVector(from: WindFrom): { wx: number; wz: number } {
  const s = Math.SQRT1_2;
  switch (from) {
    case "N":
      return { wx: 0, wz: 1 };
    case "NE":
      return { wx: -s, wz: s };
    case "E":
      return { wx: -1, wz: 0 };
    case "SE":
      return { wx: -s, wz: -s };
    case "S":
      return { wx: 0, wz: -1 };
    case "SW":
      return { wx: s, wz: -s };
    case "W":
      return { wx: 1, wz: 0 };
    case "NW":
      return { wx: s, wz: s };
  }
}

export function clampWindMph(mph: number): number {
  if (!Number.isFinite(mph)) return 0;
  return Math.max(0, Math.min(32, Math.round(mph)));
}

export function normalizeWind(wind: WindCondition): WindCondition {
  return { mph: clampWindMph(wind.mph), from: wind.from };
}

/**
 * Project hole wind onto the shot. +along is tailwind; +crossLeft pushes the ball left of aim.
 * Carry uses the same 1.4 / 1.1 coefficients as the old prompt wind.
 */
export function projectWind(wind: WindCondition, ux: number, uz: number): FlightWind {
  const mph = clampWindMph(wind.mph);
  if (mph === 0) return { alongMph: 0, crossLeftMph: 0, carryAdj: 0, cross: 0 };
  const { wx, wz } = windBlowVector(wind.from);
  const alongMph = (wx * ux + wz * uz) * mph;
  const crossLeftMph = (wx * -uz + wz * ux) * mph;
  const carryAdj = alongMph >= 0 ? alongMph * 1.4 : alongMph * 1.1;
  return { alongMph, crossLeftMph, carryAdj, cross: crossLeftMph * 0.55 };
}

export function promptFlightWind(req: Pick<ShotRequest, "windMph" | "windFromLeft">): FlightWind {
  const mph = req.windMph;
  const alongMph = mph < 0 ? Math.abs(mph) : mph > 0 ? -mph : 0;
  const carryAdj = mph < 0 ? Math.abs(mph) * 1.4 : mph > 0 ? -mph * 1.1 : 0;
  const crossLeftMph = mph > 0 ? (req.windFromLeft ? mph : -mph) : 0;
  return { alongMph, crossLeftMph, carryAdj, cross: crossLeftMph * 0.55 };
}

/** Hole wind wins when she set mph; otherwise the prompt's wind still applies. */
export function resolveFlightWind(
  req: Pick<ShotRequest, "windMph" | "windFromLeft">,
  ux: number,
  uz: number,
  holeWind?: WindCondition | null,
): FlightWind {
  if (holeWind && holeWind.mph > 0) return projectWind(holeWind, ux, uz);
  return promptFlightWind(req);
}

export function windLabel(wind: WindCondition): string {
  if (wind.mph <= 0) return "still";
  return `${wind.from} ${wind.mph} mph`;
}

export function windOnShotCopy(wind: WindCondition, ux: number, uz: number): string {
  if (wind.mph <= 0) return `from ${wind.from} · still`;
  const { alongMph, crossLeftMph, carryAdj } = projectWind(wind, ux, uz);
  const face =
    alongMph > 2.2 ? "downwind" : alongMph < -2.2 ? "into" : Math.abs(crossLeftMph) > 2.2 ? "across" : "quiet";
  const side =
    crossLeftMph > 2.2 ? "off the right" : crossLeftMph < -2.2 ? "off the left" : "";
  const yds = Math.round(Math.abs(carryAdj));
  const carry =
    yds < 2 ? "" : carryAdj > 0 ? `helps ${yds}` : `takes ${yds}`;
  return [windLabel(wind), face, side, carry].filter(Boolean).join(" · ");
}
