export type Club =
  | "driver"
  | "3wood"
  | "5wood"
  | "hybrid"
  | "4iron"
  | "5iron"
  | "6iron"
  | "7iron"
  | "8iron"
  | "9iron"
  | "pw"
  | "gw"
  | "sw"
  | "lw"
  | "putter";

export type Shape = "straight" | "draw" | "fade" | "hook" | "slice";

export interface ShotRequest {
  raw: string;
  club: Club;
  carryYards: number;
  shape: Shape;
  windMph: number;
  windFromLeft: boolean;
  startYards?: number;
}

const CLUB_ALIASES: Record<string, Club> = {
  driver: "driver",
  "1w": "driver",
  "3wood": "3wood",
  "3w": "3wood",
  "3 wood": "3wood",
  "5wood": "5wood",
  "5w": "5wood",
  "5 wood": "5wood",
  hybrid: "hybrid",
  "3h": "hybrid",
  "4h": "hybrid",
  "4iron": "4iron",
  "4i": "4iron",
  "4 iron": "4iron",
  "5iron": "5iron",
  "5i": "5iron",
  "5 iron": "5iron",
  "6iron": "6iron",
  "6i": "6iron",
  "6 iron": "6iron",
  "7iron": "7iron",
  "7i": "7iron",
  "7 iron": "7iron",
  "8iron": "8iron",
  "8i": "8iron",
  "8 iron": "8iron",
  "9iron": "9iron",
  "9i": "9iron",
  "9 iron": "9iron",
  pw: "pw",
  pitching: "pw",
  "pitching wedge": "pw",
  gw: "gw",
  gap: "gw",
  sw: "sw",
  sand: "sw",
  "sand wedge": "sw",
  lw: "lw",
  lob: "lw",
  putter: "putter",
  putt: "putter",
};

const CLUB_CARRY: Record<Club, number> = {
  driver: 265,
  "3wood": 235,
  "5wood": 215,
  hybrid: 205,
  "4iron": 195,
  "5iron": 180,
  "6iron": 170,
  "7iron": 155,
  "8iron": 140,
  "9iron": 125,
  pw: 110,
  gw: 95,
  sw: 80,
  lw: 60,
  putter: 25,
};

export function parseShotPrompt(raw: string): ShotRequest {
  const text = raw.trim().toLowerCase();
  let club: Club = "7iron";

  const ordered = Object.keys(CLUB_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of ordered) {
    if (text.includes(key)) {
      club = CLUB_ALIASES[key];
      break;
    }
  }

  let shape: Shape = "straight";
  if (/\bhook\b/.test(text)) shape = "hook";
  else if (/\bslice\b/.test(text)) shape = "slice";
  else if (/\bdraw\b/.test(text)) shape = "draw";
  else if (/\bfade\b/.test(text)) shape = "fade";
  else if (/\bslight draw\b/.test(text)) shape = "draw";
  else if (/\bslight fade\b/.test(text)) shape = "fade";

  const yardMatch = text.match(/(\d{2,3})\s*(?:yds?|yards?)?/);
  const carryYards = yardMatch ? Number(yardMatch[1]) : CLUB_CARRY[club];

  let windMph = 0;
  let windFromLeft = true;
  const mphMatch = text.match(/(\d{1,2})\s*mph/);
  if (mphMatch) {
    windMph = Number(mphMatch[1]);
  } else if (/\binto(?:\s+the)?\s+wind\b/.test(text)) {
    windMph = 12;
  } else if (/\bdownwind\b/.test(text)) {
    windMph = 10;
  }

  if (/\boff the right\b|\bfrom the right\b|\bright[- ]to[- ]left\b/.test(text)) {
    windFromLeft = false;
  }
  if (/\boff the left\b|\bfrom the left\b|\bleft[- ]to[- ]right\b/.test(text)) {
    windFromLeft = true;
  }

  const startMatch = text.match(/(?:from|at)\s+(\d{2,3})\s*(?:yds?|yards?)?\s*(?:out)?/);
  const startYards = startMatch ? Number(startMatch[1]) : undefined;

  // If user said downwind, encode as negative windMph for carry boost in sim.
  if (/\bdownwind\b/.test(text)) windMph = -Math.abs(windMph || 10);

  return {
    raw,
    club,
    carryYards: Math.max(15, Math.min(320, carryYards)),
    shape,
    windMph,
    windFromLeft,
    startYards,
  };
}

export function describeShot(req: ShotRequest, fromLie?: string): string {
  const wind =
    req.windMph === 0
      ? "still"
      : req.windMph < 0
        ? `${Math.abs(req.windMph)} mph downwind`
        : `${req.windMph} mph ${req.windFromLeft ? "off the left" : "off the right"}`;
  const lie = fromLie ? ` · from ${fromLie}` : "";
  return `${req.club} · ${req.carryYards} yds · ${req.shape} · ${wind}${lie}`;
}

export function clubForYards(yards: number): Club {
  if (yards <= 22) return "putter";
  let best: Club = "sw";
  let bestErr = Infinity;
  for (const club of Object.keys(CLUB_CARRY) as Club[]) {
    if (club === "putter") continue;
    const err = Math.abs(CLUB_CARRY[club] - yards);
    if (err < bestErr) {
      best = club;
      bestErr = err;
    }
  }
  return best;
}

export { CLUB_CARRY };
