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
  /** @deprecated kept for older prompts; treated as a landing-target distance */
  startYards?: number;
  /** Yards left of the pin line (negative = right). Shape is relative to this aim. */
  aimYardsLeft: number;
  /** Optional landing target, yards from the ball along the pin line. */
  landYards?: number;
  /** World landing point; when set, aim is ball → this point. */
  target?: { x: number; z: number };
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
  "1 wood": "driver",
  "gap wedge": "gw",
  "lob wedge": "lw",
  "3 hybrid": "hybrid",
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

export interface ShotParseFallback {
  club?: Club;
  carryYards?: number;
}

function take(work: string, re: RegExp): { work: string; match: RegExpMatchArray | null } {
  const match = work.match(re);
  return { work: match ? work.replace(match[0], " ") : work, match };
}

const CLUB_KEYS = Object.keys(CLUB_ALIASES).sort((a, b) => b.length - a.length);

function matchClub(text: string): Club | undefined {
  for (const key of CLUB_KEYS) {
    const body = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`(?:^|[^a-z0-9])${body}(?![a-z])`);
    if (re.test(text)) return CLUB_ALIASES[key];
  }
  return undefined;
}

function impliedClub(text: string): Club | undefined {
  if (/\bbomb(?:\s+it)?\b|\bnuke\b|\bsmash\b|\bhit it hard\b/.test(text)) return "driver";
  if (/\bpunch\b/.test(text)) return "8iron";
  return undefined;
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampCarry(club: Club, yards: number): number {
  const n = finiteNumber(yards, CLUB_CARRY[club]);
  return club === "putter" ? Math.max(0.6, Math.min(80, n)) : Math.max(15, Math.min(320, n));
}

export function parseShotPrompt(raw: string | null | undefined, fallback?: ShotParseFallback): ShotRequest {
  const rawText = raw == null ? "" : String(raw);
  const text = rawText.trim().toLowerCase();
  const namedClub = matchClub(text);
  const club: Club = namedClub ?? impliedClub(text) ?? fallback?.club ?? "7iron";

  let shape: Shape = "straight";
  if (/\bhook\b/.test(text)) shape = "hook";
  else if (/\bslice\b/.test(text)) shape = "slice";
  else if (/\bdraw\b/.test(text)) shape = "draw";
  else if (/\bfade\b/.test(text)) shape = "fade";
  else if (/\bslight draw\b/.test(text)) shape = "draw";
  else if (/\bslight fade\b/.test(text)) shape = "fade";

  let work = text;
  let aimYardsLeft = 0;
  const aimNum = take(work, /(?:aim\s+)?(\d{1,2})\s*(?:yds?|yards?)?\s*(left|right)(?:\s+of(?:\s+the)?\s+pin)?\b/);
  work = aimNum.work;
  if (aimNum.match) {
    aimYardsLeft = Number(aimNum.match[1]) * (aimNum.match[2] === "left" ? 1 : -1);
  } else {
    const aimWord = take(work, /\baim\s+(left|right)\b/);
    work = aimWord.work;
    if (aimWord.match) aimYardsLeft = aimWord.match[1] === "left" ? 10 : -10;
  }

  let landYards: number | undefined;
  const land = take(work, /\b(?:land(?:ing)?|target|at)\s+(\d{2,3})\s*(?:yds?|yards?)?\s*(?:out)?\b/);
  work = land.work;
  if (land.match) landYards = Number(land.match[1]);
  const from = take(work, /\bfrom\s+(\d{2,3})\s*(?:yds?|yards?)?\s*(?:out)?\b/);
  work = from.work;
  if (from.match && landYards == null) landYards = Number(from.match[1]);

  work = work
    .replace(/\d{1,2}\s*mph/g, " ")
    .replace(/\binto(?:\s+the)?\s+wind\b/g, " ")
    .replace(/\bdownwind\b/g, " ")
    .replace(/\boff the (?:left|right)\b/g, " ")
    .replace(/\bfrom the (?:left|right)\b/g, " ")
    .replace(/\b(?:left|right)[- ]to[- ](?:left|right)\b/g, " ");

  let carryYards = CLUB_CARRY[club];
  let foundYards = false;
  const onlySignedNumber = /^\s*-[\d.]+\s*$/.test(text);
  if (club === "putter") {
    const ft = work.match(/(\d{1,3})\s*(?:ft|feet)\b/);
    const yds = work.match(/(\d{1,3})\s*(?:yds?|yards?)\b/);
    const bare = work.match(/putt(?:er)?\s+(\d{1,3})\b/) || work.match(/\b(\d{1,3})\b/);
    if (ft) {
      carryYards = Number(ft[1]) / 3;
      foundYards = true;
    } else if (yds) {
      carryYards = Number(yds[1]);
      foundYards = true;
    } else if (bare && !onlySignedNumber) {
      carryYards = Number(bare[1]) / 3;
      foundYards = true;
    }
  } else if (!onlySignedNumber) {
    const yardMatch = work.match(/(?<![-\d])(\d{2,3})\s*(?:yds?|yards?)?/);
    if (yardMatch) {
      carryYards = Number(yardMatch[1]);
      foundYards = true;
    }
  }

  if (!foundYards && !namedClub && !impliedClub(text) && fallback?.carryYards != null && Number.isFinite(fallback.carryYards)) {
    carryYards = fallback.carryYards;
  }

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
    if (!mphMatch && windMph === 0) windMph = 10;
  }
  if (/\boff the left\b|\bfrom the left\b|\bleft[- ]to[- ]right\b/.test(text)) {
    windFromLeft = true;
    if (!mphMatch && windMph === 0) windMph = 10;
  }

  if (/\bdownwind\b/.test(text)) windMph = -Math.abs(windMph || 10);

  const resolvedClub = namedClub || impliedClub(text) || (foundYards ? clubForYards(carryYards) : club);
  const clamped = clampCarry(resolvedClub, carryYards);

  return {
    raw: rawText,
    club: resolvedClub,
    carryYards: clamped,
    shape,
    windMph: finiteNumber(windMph, 0),
    windFromLeft,
    startYards: landYards,
    aimYardsLeft: finiteNumber(aimYardsLeft, 0),
    landYards: landYards != null && Number.isFinite(landYards) ? landYards : undefined,
  };
}

export function promptSpecifiesAim(raw: string | null | undefined): boolean {
  const text = raw == null ? "" : String(raw).trim().toLowerCase();
  return (
    /(?:aim\s+)?\d{1,2}\s*(?:yds?|yards?)?\s*(left|right)(?:\s+of(?:\s+the)?\s+pin)?\b/.test(text) ||
    /\baim\s+(left|right)\b/.test(text) ||
    /\b(?:land(?:ing)?|target|at)\s+\d{2,3}\s*(?:yds?|yards?)?\s*(?:out)?\b/.test(text) ||
    /\bfrom\s+\d{2,3}\s*(?:yds?|yards?)?\s*(?:out)?\b/.test(text)
  );
}

export const CLUB_LABEL: Record<Club, string> = {
  driver: "driver",
  "3wood": "3w",
  "5wood": "5w",
  hybrid: "hybrid",
  "4iron": "4i",
  "5iron": "5i",
  "6iron": "6i",
  "7iron": "7i",
  "8iron": "8i",
  "9iron": "9i",
  pw: "pw",
  gw: "gw",
  sw: "sw",
  lw: "lw",
  putter: "putt",
};

export function describeShot(req: ShotRequest, fromLie?: string, windCopy?: string): string {
  const wind =
    windCopy ??
    (req.windMph === 0
      ? "still"
      : req.windMph < 0
        ? `${Math.abs(req.windMph)} mph downwind`
        : `${req.windMph} mph ${req.windFromLeft ? "off the left" : "off the right"}`);
  const lie = fromLie ? ` · from ${fromLie}` : "";
  const aim =
    req.aimYardsLeft === 0
      ? req.landYards != null
        ? ` · land ${Math.round(req.landYards)}`
        : ""
      : ` · ${Math.abs(req.aimYardsLeft)} ${req.aimYardsLeft > 0 ? "left" : "right"} of pin`;
  const dist = req.club === "putter" && req.carryYards < 20 ? `${Math.round(req.carryYards * 3)} ft` : `${req.carryYards} yds`;
  return `${req.club} · ${dist} · ${req.shape} · ${wind}${aim}${lie}`;
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
