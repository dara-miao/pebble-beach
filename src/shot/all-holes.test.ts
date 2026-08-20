import { describe, expect, it } from "vitest";
import { defaultFairwayTarget, holeByNumber, OPENING_HOLE } from "../course/geom";
import { loadCourse } from "../course/load";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyShotResult, createHolePlay, pinDistance3d } from "./play";
import { createRound, resetRound, roundThru, syncHoleScore } from "./round";
import { aimFromPoint, simulateShot } from "./simulate";
import { bookFromHere, suggestShot } from "./yardage";

const course = loadCourse();
const index = buildCoverIndex(course);
const heightAt = (x: number, z: number) => sampleHeight(course, index, x, z).y;
const coverAt = (x: number, z: number) => sampleHeight(course, index, x, z).cover;

const HOLES = Array.from({ length: 18 }, (_, i) => i + 1);

function playableTeeShot(holeNumber: number) {
  const hole = holeByNumber(course, holeNumber);
  const play = createHolePlay(hole, "blue", coverAt);
  const carry = hole.par === 3 ? Math.min(play.ball.remainingYards, 200) : 230;
  const target = defaultFairwayTarget(hole, play.ball, carry);
  const aimed = aimFromPoint(play.ball, hole.pin, target);
  const club = suggestShot(play.ball.lie, play.ball.remainingYards, play.ball.pinYards, aimed.landYards);
  const req = {
    ...parseShotPrompt(club.prompt),
    target,
    landYards: aimed.landYards,
    aimYardsLeft: aimed.aimYardsLeft,
  };
  const result = simulateShot(hole, req, heightAt, coverAt, play.ball);
  return { hole, play, result, next: applyShotResult(play, result, hole, coverAt) };
}

describe("opening hole", () => {
  it("starts the round on hole 9", () => {
    expect(OPENING_HOLE).toBe(9);
    expect(course.holes[0]?.number).toBe(1);
    const hole = holeByNumber(course, OPENING_HOLE);
    const play = createHolePlay(hole, "blue", coverAt);
    expect(play.holeNumber).toBe(9);
    expect(play.ball.x).toBe(hole.tee[0]);
    expect(play.ball.z).toBe(hole.tee[1]);
    expect(play.strokes).toBe(0);
  });
});

describe("every hole 1–18 is playable", () => {
  it.each(HOLES)("hole %i: tee leftover, path, pin, and cover are sane", (n) => {
    const hole = holeByNumber(course, n);
    const play = createHolePlay(hole, "blue", coverAt);
    const leftover = pinDistance3d(hole.tee[0], hole.tee[1], hole);

    expect(play.holeNumber).toBe(n);
    expect(play.ball.x).toBe(hole.tee[0]);
    expect(play.ball.z).toBe(hole.tee[1]);
    expect(play.ball.remainingYards).toBeCloseTo(leftover, 5);
    expect(play.ball.remainingYards).toBeGreaterThan(20);
    expect(Number.isFinite(play.ball.remainingYards)).toBe(true);
    expect(Number.isNaN(play.ball.remainingYards)).toBe(false);
    expect(play.ball.lie).not.toBe("ocean");
    expect(coverAt(hole.tee[0], hole.tee[1])).not.toBe("ocean");
    expect(coverAt(hole.pin[0], hole.pin[1])).not.toBe("ocean");
    expect(coverAt(hole.greenCenter[0], hole.greenCenter[1])).not.toBe("ocean");
    expect(coverAt(hole.pin[0], hole.pin[1])).toBe("green");
    expect(hole.path.length).toBeGreaterThanOrEqual(2);
    expect(hole.green?.polygon?.length).toBeGreaterThanOrEqual(3);
    expect(hole.tees.length).toBeGreaterThan(0);
    expect(Math.hypot(hole.pin[0] - hole.greenCenter[0], hole.pin[1] - hole.greenCenter[1])).toBeLessThan(20);
    expect(Math.abs(play.ball.remainingYards - hole.yards.blue)).toBeLessThan(90);
    expect(play.ball.lie).toMatch(/tee|fairway|rough/);
  });

  it.each(HOLES)("hole %i: a tee shot lands somewhere valid and the next lie is that ball", (n) => {
    const { hole, play, result, next } = playableTeeShot(n);
    expect(Number.isFinite(result.end.x)).toBe(true);
    expect(Number.isFinite(result.end.z)).toBe(true);
    expect(Number.isFinite(result.remainingYards)).toBe(true);
    expect(Number.isNaN(result.remainingYards)).toBe(false);
    expect(result.landLie).not.toBe("ocean");
    expect(result.totalYards).toBeGreaterThan(8);
    expect(next.ball.x).toBeCloseTo(result.end.x, 5);
    expect(next.ball.z).toBeCloseTo(result.end.z, 5);
    expect(next.ball.remainingYards).toBeCloseTo(pinDistance3d(next.ball.x, next.ball.z, hole), 5);
    expect(next.shots).toHaveLength(1);
    expect(next.strokes).toBeGreaterThan(0);
    expect(play.ball.x).toBe(hole.tee[0]);
  });

  it.each(HOLES)("hole %i: hazards that exist are detected", (n) => {
    const hole = holeByNumber(course, n);
    const play = createHolePlay(hole, "blue", coverAt);
    const dirX = (hole.pin[0] - play.ball.x) / (play.ball.pinYards || 1);
    const dirZ = (hole.pin[1] - play.ball.z) / (play.ball.pinYards || 1);
    const book = bookFromHere(play.ball, hole, { ux: dirX, uz: dirZ }, coverAt);

    const bunkerHit = (b: (typeof hole.bunkers)[number]) =>
      [b.center, ...b.polygon].some(([x, z]) => coverAt(x, z) === "bunker");
    if (hole.bunkers.length) {
      expect(hole.bunkers.some(bunkerHit) || book.hazards.some((h) => h.kind === "bunker")).toBe(true);
    }

    const rx = -dirZ;
    const rz = dirX;
    let oceanAt: { x: number; z: number } | null = null;
    let woodsAt: { x: number; z: number } | null = null;
    for (let d = 6; d < Math.min(play.ball.remainingYards + 30, 280); d += 10) {
      for (const lat of [0, 16, -16, 28, -28]) {
        const x = play.ball.x + dirX * d + rx * lat;
        const z = play.ball.z + dirZ * d + rz * lat;
        const cover = coverAt(x, z);
        if (cover === "ocean" && !oceanAt) oceanAt = { x, z };
        if (cover === "woods" && !woodsAt) woodsAt = { x, z };
      }
    }

    if (oceanAt) {
      const aimed = aimFromPoint(play.ball, hole.pin, oceanAt);
      const req = {
        ...parseShotPrompt(`pw ${Math.max(20, Math.round(aimed.landYards))}`),
        target: oceanAt,
        landYards: aimed.landYards,
        aimYardsLeft: aimed.aimYardsLeft,
      };
      const toward = simulateShot(hole, req, heightAt, coverAt, play.ball);
      expect(toward.trouble.ocean || toward.landLie === "ocean" || book.hazards.some((h) => h.kind === "ocean")).toBe(true);
    }
    if (woodsAt) {
      expect(coverAt(woodsAt.x, woodsAt.z)).toBe("woods");
    }
    expect(["tee", "fairway", "rough", "green"]).toContain(play.ball.lie);
  });

  it.each(HOLES)("hole %i: can get on the green and hole out", (n) => {
    const hole = holeByNumber(course, n);
    const from = createHolePlay(hole, "blue", coverAt);
    from.ball.x = hole.pin[0];
    from.ball.z = hole.pin[1] - 4;
    from.ball.cover = coverAt(from.ball.x, from.ball.z);
    from.ball.lie = from.ball.cover === "green" ? "green" : from.ball.lie;
    from.ball.pinYards = pinDistance3d(from.ball.x, from.ball.z, hole);
    from.ball.remainingYards = from.ball.pinYards;
    expect(from.ball.cover === "green" || from.ball.pinYards < 12).toBe(true);

    const putt = simulateShot(hole, parseShotPrompt(`putt ${Math.max(6, Math.round(from.ball.pinYards * 3))} ft`), heightAt, coverAt, from.ball);
    const after = applyShotResult(from, putt, hole, coverAt);
    expect(Number.isFinite(after.ball.remainingYards)).toBe(true);
    expect(after.ball.lie).not.toBe("ocean");
    if (after.ball.holed) {
      expect(after.ball.remainingYards).toBe(0);
    } else {
      const tap = simulateShot(hole, parseShotPrompt("putt 1"), heightAt, coverAt, {
        ...after.ball,
        x: hole.pin[0],
        z: hole.pin[1],
        lie: "green",
        cover: "green",
        pinYards: 0,
        remainingYards: 0,
      });
      const holed = applyShotResult(after, tap, hole, coverAt);
      expect(holed.ball.holed || tap.leftoverLabel === "Holed").toBe(true);
    }
  });
});

describe("hole change keeps the card", () => {
  it("switching holes puts the new ball on that tee and keeps the previous score", () => {
    const first = playableTeeShot(1);
    let card = createRound(course, "blue");
    card = syncHoleScore(card, 1, first.next.strokes, first.next.ball.holed);
    expect(card.holes.find((h) => h.number === 1)?.strokes).toBe(first.next.strokes);

    const two = holeByNumber(course, 2);
    const onTwo = createHolePlay(two, "blue", coverAt);
    expect(onTwo.holeNumber).toBe(2);
    expect(onTwo.strokes).toBe(0);
    expect(onTwo.ball.x).toBe(two.tee[0]);
    expect(onTwo.ball.z).toBe(two.tee[1]);
    expect(onTwo.ball.remainingYards).toBeCloseTo(pinDistance3d(two.tee[0], two.tee[1], two), 5);

    card = syncHoleScore(card, 2, 0, false);
    expect(card.holes.find((h) => h.number === 1)?.strokes).toBe(first.next.strokes);
    expect(card.holes.find((h) => h.number === 2)?.strokes).toBeNull();

    const back = createHolePlay(holeByNumber(course, 1), "blue", coverAt);
    expect(back.ball.x).toBe(holeByNumber(course, 1).tee[0]);
    expect(card.holes.find((h) => h.number === 1)?.strokes).toBe(first.next.strokes);

    card = resetRound(card);
    expect(roundThru(card).played).toBe(0);
  });

  it("New round / reset-to-start is hole 9", () => {
    expect(OPENING_HOLE).toBe(9);
    const start = createHolePlay(holeByNumber(course, OPENING_HOLE), "blue", coverAt);
    expect(start.holeNumber).toBe(9);
    expect(start.ball.lie).not.toBe("ocean");
    expect(start.ball.remainingYards).toBeGreaterThan(300);
  });
});

describe("repaired OSM thin holes", () => {
  it("fills missing green, tee, fairway, and nearby bunkers", () => {
    const eleven = holeByNumber(course, 11);
    expect(eleven.green?.polygon?.length).toBeGreaterThanOrEqual(3);
    expect(coverAt(eleven.greenCenter[0], eleven.greenCenter[1])).toBe("green");

    const twelve = holeByNumber(course, 12);
    expect(twelve.tees.length).toBeGreaterThan(0);
    expect(coverAt(twelve.tee[0], twelve.tee[1])).toBe("tee");

    for (const n of [4, 15, 16]) {
      const hole = holeByNumber(course, n);
      expect(hole.fairways.length).toBeGreaterThan(0);
    }

    expect(holeByNumber(course, 9).bunkers.length).toBeGreaterThan(6);
    expect(holeByNumber(course, 10).bunkers.length).toBeGreaterThan(5);
    expect(holeByNumber(course, 13).bunkers.length).toBeGreaterThan(8);
  });

  it("aims hole 18 along the dogleg so a tee shot stays in play", () => {
    const hole = holeByNumber(course, 18);
    const play = createHolePlay(hole, "blue", coverAt);
    const target = defaultFairwayTarget(hole, play.ball, 240);
    const pinDist = Math.hypot(target.x - hole.pin[0], target.z - hole.pin[1]);
    expect(pinDist).toBeGreaterThan(80);
    const aimed = aimFromPoint(play.ball, hole.pin, target);
    const req = { ...parseShotPrompt("driver 250"), target, landYards: aimed.landYards, aimYardsLeft: aimed.aimYardsLeft };
    const shot = simulateShot(hole, req, heightAt, coverAt, play.ball);
    expect(shot.landLie).not.toBe("ocean");
    expect(shot.totalYards).toBeGreaterThan(150);
  });
});
