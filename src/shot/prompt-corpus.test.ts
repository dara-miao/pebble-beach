import { describe, expect, it } from "vitest";
import { holeByNumber } from "../course/geom";
import { loadCourse } from "../course/load";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyShotResult, ballAt, createHolePlay, resolveOrigin, type HolePlay } from "./play";
import { simulateShot } from "./simulate";
import { suggestShot } from "./yardage";
import type { Lie } from "./lie";

const course = loadCourse();
const index = buildCoverIndex(course);
const heightAt = (x: number, z: number) => sampleHeight(course, index, x, z).y;
const coverAt = (x: number, z: number) => sampleHeight(course, index, x, z).cover;

const HOLES = [1, 7, 8, 18];

const CORPUS: { prompt: string; note: string }[] = [
  { prompt: "driver 250 fade", note: "normal driver fade" },
  { prompt: "3 wood 230", note: "normal 3 wood" },
  { prompt: "7 iron 155 draw", note: "normal 7 iron draw" },
  { prompt: "pw 80", note: "normal pw" },
  { prompt: "sw 35", note: "normal sw" },
  { prompt: "lw 20", note: "normal lw" },
  { prompt: "putt 24 ft", note: "normal putt feet" },
  { prompt: "putt 8", note: "bare putt number" },
  { prompt: "1w", note: "alias 1w" },
  { prompt: "3w", note: "alias 3w" },
  { prompt: "5i", note: "alias 5i" },
  { prompt: "gap", note: "alias gap" },
  { prompt: "sand wedge", note: "alias sand wedge" },
  { prompt: "lob", note: "alias lob" },
  { prompt: "putt", note: "alias putt" },
  { prompt: "10 left", note: "aim left" },
  { prompt: "12 right of pin", note: "aim right of pin" },
  { prompt: "driver 250 at 220", note: "land target" },
  { prompt: "pw 80 8 left", note: "pw with aim" },
  { prompt: "into 12 mph", note: "wind mph only" },
  { prompt: "downwind", note: "downwind word" },
  { prompt: "off the left", note: "crosswind word" },
  { prompt: "into the wind", note: "into the wind" },
  { prompt: "", note: "empty" },
  { prompt: "   ", note: "spaces" },
  { prompt: "asdf", note: "garbage" },
  { prompt: "9999", note: "extreme yards" },
  { prompt: "driver", note: "club only" },
  { prompt: "hit it hard", note: "messy bomb" },
  { prompt: "7i", note: "short iron alias" },
  { prompt: "PITCHING WEDGE 110", note: "uppercase wedge" },
  { prompt: "driver250", note: "glued club yards" },
  { prompt: "50 yards punch", note: "punch" },
  { prompt: "-10", note: "negative number" },
  { prompt: "putt 0 ft", note: "zero putt" },
  { prompt: "bomb it", note: "bomb slang" },
  { prompt: "hybrid 200 hook", note: "hybrid hook" },
  { prompt: "3h 190 slice", note: "3h slice" },
];

function fallbackFor(play: HolePlay) {
  const { origin } = resolveOrigin(play, holeByNumber(course, play.holeNumber), coverAt);
  const suggestion = suggestShot(origin.lie, origin.remainingYards, origin.pinYards);
  return { club: suggestion.club, carryYards: suggestion.carryYards, origin };
}

function expectFiniteShot(prompt: string, play: HolePlay) {
  const { origin, ...fallback } = fallbackFor(play);
  const req = parseShotPrompt(prompt, fallback);
  expect(Number.isFinite(req.carryYards)).toBe(true);
  expect(Number.isFinite(req.aimYardsLeft)).toBe(true);
  expect(Number.isFinite(req.windMph)).toBe(true);
  expect(Number.isNaN(req.carryYards)).toBe(false);
  const hole = holeByNumber(course, play.holeNumber);
  const result = simulateShot(hole, req, heightAt, coverAt, origin);
  expect(Number.isFinite(result.carryYards)).toBe(true);
  expect(Number.isFinite(result.totalYards)).toBe(true);
  expect(Number.isFinite(result.remainingYards)).toBe(true);
  expect(Number.isFinite(result.peakYards)).toBe(true);
  expect(result.landLie).toMatch(/tee|fairway|rough|woods|bunker|sand|green|ocean|rock|path/);
  return { req, result, origin, fallback };
}

describe("prompt corpus parse + simulate", () => {
  it.each(HOLES)("hole %i: every corpus prompt stays finite and lands somewhere", (n) => {
    const hole = holeByNumber(course, n);
    const play = createHolePlay(hole, "blue", coverAt);
    for (const { prompt, note } of CORPUS) {
      expect(() => expectFiniteShot(prompt, play), `${note} :: ${JSON.stringify(prompt)}`).not.toThrow();
      const { req, result } = expectFiniteShot(prompt, play);
      expect(result.landLie, `${note} land lie`).toBeTruthy();
      expect(req.carryYards, `${note} carry clamp`).toBeLessThanOrEqual(320);
      expect(req.carryYards, `${note} carry min`).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("does not treat wind mph as the carry, and off-the-left actually blows", () => {
    const hole = holeByNumber(course, 7);
    const play = createHolePlay(hole, "blue", coverAt);
    const { origin, ...fallback } = fallbackFor(play);

    const into = parseShotPrompt("into 12 mph", fallback);
    expect(into.windMph).toBe(12);
    expect(into.carryYards).toBeGreaterThan(40);
    expect(into.carryYards).not.toBe(15);

    const down = parseShotPrompt("downwind", fallback);
    expect(down.windMph).toBeLessThan(0);

    const still = simulateShot(hole, parseShotPrompt("driver 250", fallback), heightAt, coverAt, origin);
    const off = parseShotPrompt("driver 250 off the left", fallback);
    expect(off.windMph).toBeGreaterThan(0);
    expect(off.windFromLeft).toBe(true);
    const blown = simulateShot(hole, off, heightAt, coverAt, origin);
    expect(Math.hypot(blown.end.x - still.end.x, blown.end.z - still.end.z)).toBeGreaterThan(2);
  });

  it("clamps extremes and maps aliases / glued / slang", () => {
    const fb = { club: "7iron" as const, carryYards: 155 };
    expect(parseShotPrompt("9999", fb).carryYards).toBe(320);
    expect(parseShotPrompt("1w", fb).club).toBe("driver");
    expect(parseShotPrompt("3w", fb).club).toBe("3wood");
    expect(parseShotPrompt("5i", fb).club).toBe("5iron");
    expect(parseShotPrompt("gap", fb).club).toBe("gw");
    expect(parseShotPrompt("sand wedge", fb).club).toBe("sw");
    expect(parseShotPrompt("lob", fb).club).toBe("lw");
    expect(parseShotPrompt("PITCHING WEDGE 110", fb).club).toBe("pw");
    expect(parseShotPrompt("PITCHING WEDGE 110", fb).carryYards).toBe(110);
    expect(parseShotPrompt("driver250", fb).club).toBe("driver");
    expect(parseShotPrompt("driver250", fb).carryYards).toBe(250);
    expect(parseShotPrompt("50 yards punch", fb).club).toBe("8iron");
    expect(parseShotPrompt("50 yards punch", fb).carryYards).toBe(50);
    expect(parseShotPrompt("hit it hard", fb).club).toBe("driver");
    expect(parseShotPrompt("bomb it", fb).club).toBe("driver");
    expect(parseShotPrompt("hybrid 200 hook", fb).shape).toBe("hook");
    expect(parseShotPrompt("3h 190 slice", fb).club).toBe("hybrid");
    expect(parseShotPrompt("3h 190 slice", fb).shape).toBe("slice");
    expect(parseShotPrompt("10 left", fb).aimYardsLeft).toBe(10);
    expect(parseShotPrompt("12 right of pin", fb).aimYardsLeft).toBe(-12);
    expect(parseShotPrompt("driver 250 at 220", fb).landYards).toBe(220);
    expect(parseShotPrompt("pw 80 8 left", fb).aimYardsLeft).toBe(8);
    expect(parseShotPrompt("pw 80 8 left", fb).carryYards).toBe(80);
    expect(parseShotPrompt("putt 8", fb).club).toBe("putter");
    expect(parseShotPrompt("putt 8", fb).carryYards).toBeCloseTo(8 / 3, 5);
    expect(parseShotPrompt("putt 0 ft", fb).carryYards).toBe(0.6);
    expect(parseShotPrompt("-10", fb).carryYards).toBeCloseTo(155, 5);
    expect(parseShotPrompt("asdf", fb).carryYards).toBeCloseTo(155, 5);
    expect(parseShotPrompt("", fb).carryYards).toBeCloseTo(155, 5);
    expect(() => parseShotPrompt(null)).not.toThrow();
    expect(() => parseShotPrompt(undefined)).not.toThrow();
  });

  it("stays finite after bunker, ocean drop, and green putt lie changes", () => {
    const seven = holeByNumber(course, 7);
    const bunker = seven.bunkers.find((b) => coverAt(b.center[0], b.center[1]) === "bunker") ?? seven.bunkers[0];
    const fromSand = ballAt(bunker.center[0], bunker.center[1], seven, coverAt);
    expect(fromSand.lie).toBe("bunker");
    let play = { ...createHolePlay(seven, "blue", coverAt), ball: fromSand };
    for (const prompt of ["asdf", "sw 35", "lw 20", "into 12 mph", "9999"]) {
      const { result } = expectFiniteShot(prompt, play);
      expect(result.start.lie).toBe("bunker");
    }

    const wet = applyShotResult(
      createHolePlay(seven, "blue", coverAt),
      simulateShot(seven, parseShotPrompt("driver 265"), heightAt, coverAt, createHolePlay(seven, "blue", coverAt).ball),
      seven,
      coverAt,
    );
    expect(wet.ball.lie).toBe("ocean");
    const drop = resolveOrigin(wet, seven, coverAt);
    expect(drop.dropped).toBe(true);
    expect(drop.origin.lie).not.toBe("ocean");
    for (const prompt of ["asdf", "7i", "pw 80", "hit it hard"]) {
      const req = parseShotPrompt(prompt, suggestShot(drop.origin.lie, drop.origin.remainingYards, drop.origin.pinYards));
      const result = simulateShot(seven, req, heightAt, coverAt, drop.origin, true);
      expect(Number.isFinite(result.carryYards)).toBe(true);
      expect(Number.isFinite(result.remainingYards)).toBe(true);
      expect(result.landLie).toBeTruthy();
    }

    const eight = holeByNumber(course, 8);
    const onGreen = createHolePlay(eight, "blue", coverAt);
    onGreen.ball.x = eight.pin[0];
    onGreen.ball.z = eight.pin[1] - 6;
    onGreen.ball.lie = "green";
    onGreen.ball.cover = "green";
    onGreen.ball.pinYards = 6;
    onGreen.ball.remainingYards = 6;
    expect(onGreen.ball.lie).toBe("green" satisfies Lie);
    for (const prompt of ["putt 24 ft", "putt 8", "asdf", "lag it", "putt 0 ft"]) {
      const { result } = expectFiniteShot(prompt, onGreen);
      expect(Number.isFinite(result.totalYards)).toBe(true);
    }
  });
});
