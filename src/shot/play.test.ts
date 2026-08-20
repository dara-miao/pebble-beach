import { describe, expect, it } from "vitest";
import type { HoleData } from "../course/types";
import type { Cover } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyLieToCarry } from "./lie";
import { applyShotResult, ballAt, createHolePlay, pinDistance3d, resolveOrigin } from "./play";
import { missShowsHazard, simulateMissEnvelope } from "./miss";
import { clearHole, createRound, recordHole, resetRound, roundThru, syncHoleScore } from "./round";
import { aimFromPoint, simulateShot } from "./simulate";
import { bookFromHere, clearStatus, suggestShot } from "./yardage";
import { projectWind, resolveFlightWind, windBlowVector } from "./wind";

function mockHole(over: Partial<HoleData> = {}): HoleData {
  return {
    number: 7,
    par: 3,
    handicap: 17,
    note: "Test hole",
    yards: { championship: 110, blue: 100, gold: 95, white: 90 },
    path: [
      [0, 0],
      [0, 100],
    ],
    osmPathYards: 100,
    tee: [0, 0],
    greenCenter: [0, 100],
    pin: [0, 100],
    green: {
      polygon: [
        [-10, 90],
        [10, 90],
        [10, 110],
        [-10, 110],
      ],
      center: [0, 100],
    },
    tees: [],
    fairways: [],
    bunkers: [
      {
        side: "right",
        yardsFromTee: 85,
        yardsToGreen: 15,
        center: [8, 85],
        polygon: [
          [2, 79],
          [14, 79],
          [14, 91],
          [2, 91],
        ],
      },
    ],
    ...over,
  };
}

function coverAt(x: number, z: number): Cover {
  if (z > 132) return "ocean";
  if (Math.hypot(x - 8, z - 85) < 6) return "bunker";
  if (Math.hypot(x, z - 100) < 10) return "green";
  if (x < -14) return "woods";
  if (Math.abs(x) > 9) return "rough";
  if (z < 6 && Math.abs(x) < 6) return "tee";
  return "fairway";
}

function heightAt(): number {
  return 4;
}

function playShot(play: ReturnType<typeof createHolePlay>, hole: HoleData, prompt: string) {
  const { origin, dropped } = resolveOrigin(play, hole, coverAt);
  const result = simulateShot(hole, parseShotPrompt(prompt), heightAt, coverAt, origin, dropped);
  return { result, play: applyShotResult(play, result, hole, coverAt) };
}

function mockCourse() {
  const seven = mockHole();
  const eight = mockHole({
    number: 8,
    par: 4,
    tee: [40, 10],
    path: [
      [40, 10],
      [40, 220],
    ],
    greenCenter: [40, 220],
    pin: [40, 220],
  });
  return {
    name: "Test",
    location: "Test",
    origin: { lat: 0, lon: 0, note: "" },
    units: "yards",
    par: 7,
    scorecard: {
      blue: { name: "Blue", total: 320, holes: [100, 220] },
    },
    holes: [seven, eight],
    unassignedBunkers: [],
    rough: [],
    cartpaths: [],
    coastline: [],
    water: [],
    woods: [],
    trees: [],
    elevation: { originX: 0, originZ: 0, stepX: 1, stepZ: 1, width: 2, height: 2, heightsYards: [[0, 0], [0, 0]] },
    source: "test",
  };
}

describe("sequential lie play", () => {
  it("starts the next shot from the exact landed position", () => {
    const hole = mockHole();
    const first = playShot(createHolePlay(hole, "blue", coverAt), hole, "7 iron 70");
    expect(first.play.ball.x).toBeCloseTo(first.result.end.x, 5);
    expect(first.play.ball.z).toBeCloseTo(first.result.end.z, 5);
    expect(first.play.strokes).toBe(1);
    expect(first.play.ball.lie).not.toBe("ocean");

    const second = playShot(first.play, hole, "pw 30");
    expect(second.result.start.x).toBeCloseTo(first.play.ball.x, 5);
    expect(second.result.start.z).toBeCloseTo(first.play.ball.z, 5);
    expect(second.result.start.lie).toBe(first.play.ball.lie);
    expect(second.play.strokes).toBe(2);
  });

  it("reduces leftover yards after a shot toward the pin", () => {
    const hole = mockHole();
    const start = createHolePlay(hole, "blue", coverAt);
    const { play, result } = playShot(start, hole, "7 iron 70");
    expect(start.ball.remainingYards).toBeCloseTo(pinDistance3d(hole.tee[0], hole.tee[1], hole), 5);
    expect(play.ball.remainingYards).toBeLessThan(start.ball.remainingYards - 40);
    expect(result.remainingYards).toBeGreaterThan(15);
    expect(result.carryYards).toBeGreaterThan(60);
  });

  it("keeps leftover yards equal to 3D distance to the pin", () => {
    const hole = mockHole();
    const start = createHolePlay(hole, "blue", coverAt);
    expect(start.ball.remainingYards).toBeCloseTo(Math.hypot(hole.tee[0] - hole.pin[0], hole.tee[1] - hole.pin[1]), 5);
    const { play, result } = playShot(start, hole, "7 iron 70");
    const endDist = Math.hypot(play.ball.x - hole.pin[0], play.ball.z - hole.pin[1]);
    expect(play.ball.remainingYards).toBeCloseTo(endDist, 5);
    expect(result.remainingYards).toBeCloseTo(endDist, 5);
    expect(result.end.pinYards).toBeCloseTo(endDist, 5);
  });

  it("reports ball-to-pin leftover from a mid-hole lie, not the scorecard", () => {
    const hole = mockHole();
    const mid = ballAt(4, 58, hole, coverAt);
    expect(mid.remainingYards).toBeCloseTo(pinDistance3d(4, 58, hole), 5);
    expect(mid.remainingYards).not.toBe(hole.yards.blue);
    expect(mid.remainingYards).toBeGreaterThan(35);
    expect(mid.remainingYards).toBeLessThan(55);
  });

  it("matches preview to Hit when aiming at a world landing target", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const target = { x: -10, z: 72 };
    const aimed = aimFromPoint(origin, hole.pin, target);
    const req = { ...parseShotPrompt("7 iron 70"), target, landYards: aimed.landYards, aimYardsLeft: aimed.aimYardsLeft };
    const preview = simulateShot(hole, req, heightAt, coverAt, origin);
    const hit = simulateShot(hole, req, heightAt, coverAt, origin);
    const pinLine = simulateShot(hole, parseShotPrompt("7 iron 70"), heightAt, coverAt, origin);
    expect(hit.end.x).toBeCloseTo(preview.end.x, 8);
    expect(hit.end.z).toBeCloseTo(preview.end.z, 8);
    expect(hit.remainingYards).toBeCloseTo(preview.remainingYards, 8);
    expect(hit.carryYards).toBe(preview.carryYards);
    expect(hit.trouble).toEqual(preview.trouble);
    expect(hit.aim.target.x).toBeCloseTo(target.x, 5);
    expect(hit.aim.target.z).toBeCloseTo(target.z, 5);
    expect(hit.end.x).toBeLessThan(pinLine.end.x - 4);
    expect(aimed.aimYardsLeft).toBeGreaterThan(6);
  });

  it("gives hazard-clear numbers from a mid-hole lie", () => {
    const hole = mockHole();
    const origin = ballAt(0, 40, hole, coverAt);
    expect(origin.remainingYards).toBeCloseTo(pinDistance3d(0, 40, hole), 5);
    const book = bookFromHere(origin, hole, { ux: 0, uz: 1 }, coverAt);
    expect(book.firstTrouble?.kind).toBe("bunker");
    expect(book.firstTrouble!.carryYards).toBeGreaterThan(30);
    expect(book.firstTrouble!.carryYards).toBeLessThan(50);
    expect(book.coverYards).toBeGreaterThan(book.firstTrouble!.carryYards);
    expect(clearStatus(20, book.firstTrouble!)).toBe("short");
    expect(clearStatus(book.firstTrouble!.exitYards + 4, book.firstTrouble!)).toBe("covers");
    const short = simulateShot(hole, parseShotPrompt("pw 20"), heightAt, coverAt, origin);
    expect(short.carryYards).toBeLessThan(book.firstTrouble!.carryYards);
    const cover = simulateShot(hole, parseShotPrompt(`pw ${book.coverYards! + 8}`), heightAt, coverAt, origin);
    expect(cover.carryYards).toBeGreaterThanOrEqual(book.firstTrouble!.exitYards);
  });

  it("suggests a bunker splash, fairway iron, or putt from leftover + lie", () => {
    expect(suggestShot("bunker", 28, 28).prompt).toMatch(/sw /);
    expect(suggestShot("fairway", 155, 155).club).toBe("7iron");
    expect(suggestShot("green", 8, 8).prompt).toMatch(/putt \d+ ft/);
    expect(suggestShot("woods", 140, 140).prompt).toMatch(/7 iron/);
  });

  it("records the hole story and clears it on reset", () => {
    const hole = mockHole();
    const first = playShot(createHolePlay(hole, "blue", coverAt), hole, "7 iron 70");
    expect(first.play.shots).toHaveLength(1);
    expect(first.play.shots[0].club).toBe("7iron");
    expect(first.play.shots[0].lieIn).toBe("tee");
    expect(first.play.shots[0].leftover).toBeGreaterThan(0);
    const second = playShot(first.play, hole, "pw 30");
    expect(second.play.shots).toHaveLength(2);
    expect(second.play.strokes).toBe(2);
    const reset = createHolePlay(hole, "blue", coverAt);
    expect(reset.shots).toHaveLength(0);
    expect(reset.strokes).toBe(0);
  });

  it("uses the same flight, land, leftover, and trouble for preview and hit", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const req = parseShotPrompt("7 iron 70 fade");
    const preview = simulateShot(hole, req, heightAt, coverAt, origin);
    const hit = simulateShot(hole, req, heightAt, coverAt, origin);
    expect(hit.end.x).toBeCloseTo(preview.end.x, 8);
    expect(hit.end.z).toBeCloseTo(preview.end.z, 8);
    expect(hit.landLie).toBe(preview.landLie);
    expect(hit.remainingYards).toBeCloseTo(preview.remainingYards, 8);
    expect(hit.carryYards).toBe(preview.carryYards);
    expect(hit.rollYards).toBe(preview.rollYards);
    expect(hit.trouble).toEqual(preview.trouble);
    expect(hit.outcome).toBe(preview.outcome);
  });

  it("aims from the ball toward the pin, with optional left/right of that line", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const straight = simulateShot(hole, parseShotPrompt("7 iron 70"), heightAt, coverAt, origin);
    const left = simulateShot(hole, parseShotPrompt("7 iron 70 12 left"), heightAt, coverAt, origin);
    const right = simulateShot(hole, parseShotPrompt("7 iron 70 12 right"), heightAt, coverAt, origin);
    expect(parseShotPrompt("7 iron 70 12 left").aimYardsLeft).toBe(12);
    expect(parseShotPrompt("driver 250 at 220").landYards).toBe(220);
    expect(left.end.x).toBeLessThan(straight.end.x - 4);
    expect(right.end.x).toBeGreaterThan(straight.end.x + 4);
    expect(straight.aim.leftYards).toBe(0);
  });

  it("plays a bunker lie shorter and steeper than the same club from fairway", () => {
    const hole = mockHole();
    const req = parseShotPrompt("7 iron 155");
    const fairway = simulateShot(hole, req, heightAt, coverAt, ballAt(0, 70, hole, coverAt));
    const bunker = simulateShot(hole, req, heightAt, coverAt, ballAt(8, 85, hole, coverAt));
    expect(bunker.start.lie).toBe("bunker");
    expect(fairway.start.lie).toBe("fairway");
    expect(bunker.carryYards).toBeLessThan(fairway.carryYards * 0.4);
    expect(bunker.totalYards).toBeLessThan(fairway.totalYards * 0.4);
    expect(bunker.outcome.toLowerCase()).toMatch(/bunker splash/);
    expect(applyLieToCarry("bunker", "7iron", 155).carry).toBeLessThan(40);
  });

  it("punches out of trees with a lower, shorter flight than fairway", () => {
    const hole = mockHole();
    const req = parseShotPrompt("7 iron 155");
    const fairway = simulateShot(hole, req, heightAt, coverAt, ballAt(0, 50, hole, coverAt));
    const woods = simulateShot(hole, req, heightAt, coverAt, ballAt(-18, 50, hole, coverAt));
    expect(woods.start.lie).toBe("woods");
    expect(woods.carryYards).toBeLessThan(fairway.carryYards * 0.7);
    expect(woods.peakYards).toBeLessThan(fairway.peakYards * 0.6);
    expect(woods.outcome.toLowerCase()).toMatch(/punch|trees/);
  });

  it("drops from the ocean and plays the next shot from grass, not water", () => {
    const hole = mockHole();
    const first = playShot(createHolePlay(hole, "blue", coverAt), hole, "driver 265");
    expect(first.result.landLie).toBe("ocean");
    expect(first.play.ball.lie).toBe("ocean");
    expect(first.play.penalties).toBe(1);
    expect(first.play.strokes).toBe(2);

    const nextOrigin = resolveOrigin(first.play, hole, coverAt);
    expect(nextOrigin.dropped).toBe(true);
    expect(nextOrigin.origin.lie).not.toBe("ocean");

    const second = playShot(first.play, hole, "pw 80");
    expect(second.result.start.lie).not.toBe("ocean");
    expect(second.result.outcome.toLowerCase()).toMatch(/penalty drop/);
  });

  it("resets to the tee and changing holes starts on that tee", () => {
    const seven = mockHole();
    const after = playShot(createHolePlay(seven, "blue", coverAt), seven, "7 iron 70").play;
    expect(after.strokes).toBeGreaterThan(0);

    const reset = createHolePlay(seven, "blue", coverAt);
    expect(reset.strokes).toBe(0);
    expect(reset.ball.x).toBe(seven.tee[0]);
    expect(reset.ball.z).toBe(seven.tee[1]);
    expect(reset.ball.remainingYards).toBe(100);

    const eight = mockHole({ number: 8, tee: [40, 10], path: [[40, 10], [40, 220]], greenCenter: [40, 220], pin: [40, 220] });
    const nextHole = createHolePlay(eight, "blue", coverAt);
    expect(nextHole.holeNumber).toBe(8);
    expect(nextHole.ball.x).toBe(40);
    expect(nextHole.ball.z).toBe(10);
    expect(nextHole.strokes).toBe(0);
  });

  it("marks the hole complete when the ball finishes on the pin", () => {
    const hole = mockHole();
    const tap = simulateShot(hole, parseShotPrompt("putt 1"), heightAt, coverAt, ballAt(0, 100, hole, coverAt));
    const play = applyShotResult(createHolePlay(hole, "blue", coverAt), tap, hole, coverAt);
    expect(play.ball.holed).toBe(true);
    expect(play.ball.remainingYards).toBe(0);
  });

  it("reduces carry from rough versus fairway", () => {
    const hole = mockHole();
    const req = parseShotPrompt("6 iron 170");
    const fairway = simulateShot(hole, req, heightAt, coverAt, ballAt(0, 40, hole, coverAt));
    const rough = simulateShot(hole, req, heightAt, coverAt, ballAt(12, 40, hole, coverAt));
    expect(rough.start.lie).toBe("rough");
    expect(rough.carryYards).toBeLessThan(fairway.carryYards);
    expect(rough.totalYards).toBeLessThan(fairway.totalYards);
  });

  it("treats flyer and heavy rough differently from a tight fairway", () => {
    const hole = mockHole();
    const fairway = ballAt(0, 40, hole, coverAt);
    const rough = ballAt(12, 40, hole, coverAt);
    const flyer = simulateShot(hole, parseShotPrompt("driver 250"), heightAt, coverAt, rough);
    const fairDrive = simulateShot(hole, parseShotPrompt("driver 250"), heightAt, coverAt, fairway);
    const heavy = simulateShot(hole, parseShotPrompt("pw 110"), heightAt, coverAt, rough);
    const fairWedge = simulateShot(hole, parseShotPrompt("pw 110"), heightAt, coverAt, fairway);
    expect(flyer.outcome.toLowerCase()).toMatch(/flyer/);
    expect(flyer.carryYards).toBeGreaterThan(fairDrive.carryYards);
    expect(heavy.outcome.toLowerCase()).toMatch(/heavy/);
    expect(heavy.carryYards).toBeLessThan(fairWedge.carryYards * 0.9);
    expect(applyLieToCarry("rough", "driver", 250).carry).toBeGreaterThan(250);
    expect(applyLieToCarry("rough", "pw", 110).carry).toBeLessThan(95);
  });

  it("adds carry downhill and takes it away uphill", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const req = parseShotPrompt("7 iron 150");
    const flat = simulateShot(hole, req, () => 10, coverAt, origin);
    const downhill = simulateShot(hole, req, (_x, z) => 10 - z * 0.12, coverAt, origin);
    const uphill = simulateShot(hole, req, (_x, z) => 10 + z * 0.12, coverAt, origin);
    expect(downhill.carryYards).toBeGreaterThan(flat.carryYards);
    expect(uphill.carryYards).toBeLessThan(flat.carryYards);
    expect(downhill.elevNote.toLowerCase()).toMatch(/downhill/);
    expect(uphill.elevNote.toLowerCase()).toMatch(/uphill/);
  });

  it("rolls a putt on the green and holes out when it reaches the pin", () => {
    const hole = mockHole();
    const from = ballAt(0, 92, hole, coverAt);
    expect(from.lie).toBe("green");
    expect(from.remainingYards).toBeCloseTo(8, 5);
    const lag = simulateShot(hole, parseShotPrompt("putt 24 ft"), heightAt, coverAt, from);
    expect(lag.landLie).toBe("green");
    expect(lag.points.every((p) => !p.airborne || p.phase === "roll")).toBe(true);
    const play = applyShotResult(createHolePlay(hole, "blue", coverAt), lag, hole, coverAt);
    expect(play.ball.holed).toBe(true);
    expect(play.ball.remainingYards).toBe(0);
    expect(lag.leftoverLabel).toBe("Holed");
    expect(lag.outcome.toLowerCase()).toMatch(/holed/);
  });
});

describe("miss envelope", () => {
  it("shows a push into the bunker while the called shot stays safe", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const env = simulateMissEnvelope(hole, parseShotPrompt("7 iron 85"), heightAt, coverAt, origin);
    expect(env.called.trouble.bunker).toBe(false);
    expect(env.called.trouble.ocean).toBe(false);
    expect(env.called.landLie).not.toBe("bunker");
    expect(missShowsHazard(env, "bunker")).toBe(true);
    const push = env.samples.find((s) => s.kind === "push");
    expect(push?.trouble.bunker).toBe(true);
    expect(env.copy.toLowerCase()).toMatch(/bunker/);
    expect(env.safe).toBe(false);
  });

  it("shows a long miss into the ocean and a conservative shot that stays safe", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const long = simulateMissEnvelope(hole, parseShotPrompt("6 iron 120"), heightAt, coverAt, origin);
    expect(long.called.trouble.ocean).toBe(false);
    expect(missShowsHazard(long, "ocean")).toBe(true);
    expect(long.copy.toLowerCase()).toMatch(/ocean/);

    const safe = simulateMissEnvelope(hole, parseShotPrompt("pw 45"), heightAt, coverAt, origin);
    expect(safe.called.landLie).toBe("fairway");
    expect(safe.safe).toBe(true);
    expect(safe.copy).toBe("Miss stays safe");
    expect(missShowsHazard(safe, "bunker")).toBe(false);
    expect(missShowsHazard(safe, "ocean")).toBe(false);
  });

  it("keeps Hit on the called line — envelope samples are preview only", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const req = parseShotPrompt("7 iron 85");
    const env = simulateMissEnvelope(hole, req, heightAt, coverAt, origin);
    const hit = simulateShot(hole, req, heightAt, coverAt, origin);
    expect(hit.end.x).toBeCloseTo(env.called.end.x, 8);
    expect(hit.end.z).toBeCloseTo(env.called.end.z, 8);
    expect(env.samples).toHaveLength(4);
    expect(env.samples.some((s) => Math.hypot(s.x - hit.end.x, s.z - hit.end.z) > 3)).toBe(true);
  });
});

describe("hole wind", () => {
  it("moves carry and landing when the hole wind changes", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const req = parseShotPrompt("7 iron 150");
    const still = simulateShot(hole, req, heightAt, coverAt, origin, false, { mph: 0, from: "S" });
    const into = simulateShot(hole, req, heightAt, coverAt, origin, false, { mph: 16, from: "S" });
    const down = simulateShot(hole, req, heightAt, coverAt, origin, false, { mph: 16, from: "N" });
    expect(still.wind.carryAdj).toBe(0);
    expect(into.carryYards).toBeLessThan(still.carryYards);
    expect(down.carryYards).toBeGreaterThan(still.carryYards);
    expect(into.end.z).toBeLessThan(still.end.z);
    expect(down.end.z).toBeGreaterThan(still.end.z);
    expect(into.wind.alongMph).toBeLessThan(0);
    expect(down.wind.alongMph).toBeGreaterThan(0);
  });

  it("pushes the miss envelope with a crosswind", () => {
    const hole = mockHole();
    const origin = ballAt(0, 0, hole, coverAt);
    const req = parseShotPrompt("7 iron 80");
    const still = simulateMissEnvelope(hole, req, heightAt, coverAt, origin, false, { mph: 0, from: "W" });
    const offRight = simulateMissEnvelope(hole, req, heightAt, coverAt, origin, false, { mph: 18, from: "W" });
    expect(offRight.called.end.x).not.toBeCloseTo(still.called.end.x, 0);
    expect(Math.abs(offRight.called.end.x - still.called.end.x)).toBeGreaterThan(3);
    const stillPush = still.samples.find((s) => s.kind === "push")!;
    const windPush = offRight.samples.find((s) => s.kind === "push")!;
    expect(Math.abs(windPush.x - stillPush.x)).toBeGreaterThan(2);
  });

  it("projects compass wind onto the shot using course axes", () => {
    expect(windBlowVector("N")).toEqual({ wx: 0, wz: 1 });
    expect(windBlowVector("W")).toEqual({ wx: 1, wz: 0 });
    const into = projectWind({ mph: 10, from: "S" }, 0, 1);
    expect(into.alongMph).toBeCloseTo(-10, 5);
    expect(into.carryAdj).toBeCloseTo(-11, 5);
    const down = projectWind({ mph: 10, from: "N" }, 0, 1);
    expect(down.alongMph).toBeCloseTo(10, 5);
    expect(down.carryAdj).toBeCloseTo(14, 5);
    const prompt = resolveFlightWind(parseShotPrompt("7 iron 150 into the wind"), 0, 1, { mph: 0, from: "W" });
    expect(prompt.carryAdj).toBeLessThan(0);
  });
});

describe("round scorecard", () => {
  it("keeps par, strokes, and to-par across two holes", () => {
    const course = mockCourse();
    let card = createRound(course, "blue");
    expect(roundThru(card).label).toBe("—");

    card = recordHole(card, 7, 4, true);
    let thru = roundThru(card);
    expect(thru.played).toBe(1);
    expect(thru.strokes).toBe(4);
    expect(thru.par).toBe(3);
    expect(thru.toPar).toBe(1);
    expect(thru.label).toBe("+1");

    card = recordHole(card, 8, 4, true);
    thru = roundThru(card);
    expect(thru.played).toBe(2);
    expect(thru.strokes).toBe(8);
    expect(thru.par).toBe(7);
    expect(thru.toPar).toBe(1);
    expect(thru.label).toBe("+1");
    expect(card.holes.find((h) => h.number === 7)?.strokes).toBe(4);

    card = clearHole(card, 7);
    thru = roundThru(card);
    expect(card.holes.find((h) => h.number === 7)?.strokes).toBeNull();
    expect(thru.played).toBe(1);
    expect(thru.strokes).toBe(4);
    expect(thru.par).toBe(4);
    expect(thru.label).toBe("E");

    card = resetRound(card);
    expect(roundThru(card).played).toBe(0);
    expect(card.holes.every((h) => h.strokes == null)).toBe(true);
  });

  it("syncs in-progress hole strokes and survives switching holes", () => {
    const seven = mockHole();
    const eight = mockHole({ number: 8, par: 4, tee: [40, 10], path: [[40, 10], [40, 220]], greenCenter: [40, 220], pin: [40, 220] });
    const course = mockCourse();
    let card = createRound(course, "blue");
    const onSeven = playShot(createHolePlay(seven, "blue", coverAt), seven, "7 iron 70").play;
    card = syncHoleScore(card, 7, onSeven.strokes, onSeven.ball.holed);
    const onEight = playShot(createHolePlay(eight, "blue", coverAt), eight, "driver 180").play;
    card = syncHoleScore(card, 8, onEight.strokes, onEight.ball.holed);
    expect(card.holes.find((h) => h.number === 7)?.strokes).toBe(onSeven.strokes);
    expect(card.holes.find((h) => h.number === 8)?.strokes).toBe(onEight.strokes);
    expect(roundThru(card).played).toBe(2);
    expect(onSeven.strokes).toBeGreaterThan(0);
    expect(onEight.strokes).toBeGreaterThan(0);
  });
});
