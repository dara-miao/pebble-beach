import type { CourseData, TeeSet } from "../course/types";

export interface HoleCard {
  number: number;
  par: number;
  strokes: number | null;
  completed: boolean;
}

export interface RoundCard {
  tee: TeeSet;
  holes: HoleCard[];
}

export interface RoundThru {
  played: number;
  completed: number;
  strokes: number;
  par: number;
  toPar: number;
  label: string;
}

export function createRound(course: CourseData, tee: TeeSet = "blue"): RoundCard {
  return {
    tee,
    holes: course.holes
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((h) => ({ number: h.number, par: h.par, strokes: null, completed: false })),
  };
}

export function formatToPar(toPar: number, played = 1): string {
  if (played <= 0) return "—";
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

export function roundThru(round: RoundCard): RoundThru {
  const posted = round.holes.filter((h) => h.strokes != null);
  const strokes = posted.reduce((n, h) => n + (h.strokes ?? 0), 0);
  const par = posted.reduce((n, h) => n + h.par, 0);
  const toPar = strokes - par;
  const completed = posted.filter((h) => h.completed).length;
  return {
    played: posted.length,
    completed,
    strokes,
    par,
    toPar,
    label: formatToPar(toPar, posted.length),
  };
}

export function recordHole(round: RoundCard, hole: number, strokes: number, completed = false): RoundCard {
  return {
    ...round,
    holes: round.holes.map((h) =>
      h.number === hole ? { ...h, strokes: Math.max(0, Math.round(strokes)), completed } : h,
    ),
  };
}

export function clearHole(round: RoundCard, hole: number): RoundCard {
  return {
    ...round,
    holes: round.holes.map((h) => (h.number === hole ? { ...h, strokes: null, completed: false } : h)),
  };
}

export function resetRound(round: RoundCard): RoundCard {
  return {
    ...round,
    holes: round.holes.map((h) => ({ ...h, strokes: null, completed: false })),
  };
}

export function syncHoleScore(
  round: RoundCard,
  hole: number,
  strokes: number,
  completed: boolean,
): RoundCard {
  if (strokes <= 0 && !completed) return clearHole(round, hole);
  return recordHole(round, hole, strokes, completed);
}
