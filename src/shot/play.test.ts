import { describe, expect, it } from "vitest";
import type { HoleData } from "../course/types";
import type { Cover } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyLieToCarry } from "./lie";
import { applyShotResult, ballAt, createHolePlay, pinDistance3d, resolveOrigin } from "./play";
import { simulateShot } from "./simulate";

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
