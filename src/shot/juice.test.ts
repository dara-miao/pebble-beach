import { describe, expect, it } from "vitest";
import {
  holeOutBeatFrom,
  holeScoreName,
  leftoverShort,
  nextHoleAfter,
  shotStingFrom,
  HOLE_OUT_HOLD_MS,
  LAST_HOLE,
  SHOT_STING_MS,
} from "./juice";

describe("hole-out score names", () => {
  it("names the usual card: eagle through double", () => {
    expect(holeScoreName(2, 4)).toMatchObject({ name: "eagle", label: "Eagle", toPar: -2 });
    expect(holeScoreName(3, 4)).toMatchObject({ name: "birdie", label: "Birdie", toPar: -1 });
    expect(holeScoreName(4, 4)).toMatchObject({ name: "par", label: "Par", toPar: 0 });
    expect(holeScoreName(5, 4)).toMatchObject({ name: "bogey", label: "Bogey", toPar: 1 });
    expect(holeScoreName(6, 4)).toMatchObject({ name: "double", label: "Double", toPar: 2 });
    expect(holeScoreName(7, 4)).toMatchObject({ name: "triple", label: "Triple", toPar: 3 });
    expect(holeScoreName(1, 4)).toMatchObject({ name: "albatross", label: "Albatross", toPar: -3 });
    expect(holeScoreName(8, 4)).toMatchObject({ name: "+4", label: "+4", toPar: 4 });
  });
});

describe("next hole after a beat", () => {
  it("advances N to N+1 and does not wrap 18 to 1", () => {
    expect(nextHoleAfter(7)).toBe(8);
    expect(nextHoleAfter(17)).toBe(18);
    expect(nextHoleAfter(LAST_HOLE)).toBeNull();
    expect(nextHoleAfter(18)).toBeNull();
  });
});

describe("shot sting", () => {
  it("calls leftover and lie, nice on the green, groan in the ocean", () => {
    expect(leftoverShort(12, "fairway")).toBe("12 yds");
    expect(leftoverShort(4, "green")).toBe("12 ft");
    expect(
      shotStingFrom({
        landLie: "green",
        remainingYards: 18,
        leftoverLabel: "54 ft to pin",
        penaltyStrokes: 0,
        trouble: { ocean: false, bunker: false, woods: false },
      }),
    ).toMatchObject({ kind: "shot", headline: "Nice", tone: "good", holdMs: SHOT_STING_MS });
    expect(
      shotStingFrom({
        landLie: "green",
        remainingYards: 5,
        leftoverLabel: "15 ft to pin",
        penaltyStrokes: 0,
        trouble: { ocean: false, bunker: false, woods: false },
      }).headline,
    ).toBe("Sits tight");
    expect(
      shotStingFrom({
        landLie: "bunker",
        remainingYards: 28,
        leftoverLabel: "28 yds to pin",
        penaltyStrokes: 0,
        trouble: { ocean: false, bunker: true, woods: false },
      }),
    ).toMatchObject({ headline: "Bunker", detail: "28 yds", tone: "bad" });
    expect(
      shotStingFrom({
        landLie: "ocean",
        remainingYards: 40,
        leftoverLabel: "40 yds to pin",
        penaltyStrokes: 1,
        trouble: { ocean: true, bunker: false, woods: false },
      }),
    ).toMatchObject({ headline: "Ocean", detail: "Penalty", tone: "bad" });
    expect(
      shotStingFrom({
        landLie: "fairway",
        remainingYards: 142,
        leftoverLabel: "142 yds to pin",
        penaltyStrokes: 0,
        trouble: { ocean: false, bunker: false, woods: false },
      }),
    ).toMatchObject({ headline: "142 yds", detail: "Fairway", tone: "neutral" });
  });
});

describe("hole-out beat", () => {
  it("holds long enough to read, then points at the next tee — or stays on 18", () => {
    const birdie = holeOutBeatFrom({ holeNumber: 7, strokes: 2 }, 3, "E");
    expect(birdie).toMatchObject({
      kind: "hole-out",
      scoreName: "birdie",
      headline: "Birdie",
      strokes: 2,
      toParLabel: "-1",
      nextHole: 8,
      holdMs: HOLE_OUT_HOLD_MS,
    });
    expect(birdie.holdMs).toBeGreaterThanOrEqual(4500);
    expect(birdie.holdMs).toBeLessThanOrEqual(5500);
    expect(SHOT_STING_MS).toBeGreaterThanOrEqual(1200);
    expect(SHOT_STING_MS).toBeLessThanOrEqual(1800);
    expect(birdie.detail).toMatch(/Hole 7/);

    const last = holeOutBeatFrom({ holeNumber: 18, strokes: 5 }, 5, "+2");
    expect(last.kind).toBe("round-done");
    expect(last.nextHole).toBeNull();
    expect(last.scoreName).toBe("par");
  });
});
