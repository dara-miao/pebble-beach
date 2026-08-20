import { describe, expect, it } from "vitest";
import courseJson from "../course/pebble-beach.json";
import type { CourseData } from "../course/types";
import { holeByNumber } from "../course/geom";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyShotResult, ballAt, createHolePlay, resolveOrigin } from "./play";
import { simulateShot } from "./simulate";

const course = courseJson as unknown as CourseData;
const index = buildCoverIndex(course);
const heightAt = (x: number, z: number) => sampleHeight(course, index, x, z).y;
const coverAt = (x: number, z: number) => sampleHeight(course, index, x, z).cover;

describe("Pebble Beach hole play", () => {
  it("treats a hole 7 greenside bunker as a splash-out lie", () => {
    const hole = holeByNumber(course, 7);
    const bunker = hole.bunkers.find((b) => coverAt(b.center[0], b.center[1]) === "bunker") ?? hole.bunkers[1];
    const lie = ballAt(bunker.center[0], bunker.center[1], hole, coverAt);
    expect(lie.lie).toBe("bunker");

    const tee = ballAt(hole.tee[0], hole.tee[1], hole, coverAt);
    const req = parseShotPrompt("7 iron 155");
    const fromTee = simulateShot(hole, req, heightAt, coverAt, tee);
    const fromSand = simulateShot(hole, req, heightAt, coverAt, lie);
    expect(fromSand.carryYards).toBeLessThan(50);
    expect(fromSand.carryYards).toBeLessThan(fromTee.carryYards * 0.35);
    expect(fromSand.outcome.toLowerCase()).toMatch(/bunker splash/);
  });

  it("leaves leftover yards after a hole 8 tee shot and plays the approach from there", () => {
    const hole = holeByNumber(course, 8);
    let play = createHolePlay(hole, "blue", coverAt);
    expect(play.ball.remainingYards).toBe(hole.yards.blue);

    const drive = simulateShot(hole, parseShotPrompt("driver 250"), heightAt, coverAt, play.ball);
    play = applyShotResult(play, drive, hole, coverAt);
    expect(play.ball.remainingYards).toBeGreaterThan(120);
    expect(play.ball.remainingYards).toBeLessThan(hole.yards.blue - 180);
    expect(play.ball.x).toBeCloseTo(drive.end.x, 5);
    expect(play.ball.z).toBeCloseTo(drive.end.z, 5);

    const approach = simulateShot(hole, parseShotPrompt("7 iron 155"), heightAt, coverAt, play.ball);
    expect(approach.start.x).toBeCloseTo(play.ball.x, 5);
    expect(approach.start.z).toBeCloseTo(play.ball.z, 5);
  });

  it("drops off hole 7 ocean and does not replay the tee", () => {
    const hole = holeByNumber(course, 7);
    let play = createHolePlay(hole, "blue", coverAt);
    const nuke = simulateShot(hole, parseShotPrompt("driver 265"), heightAt, coverAt, play.ball);
    play = applyShotResult(play, nuke, hole, coverAt);
    expect(play.ball.lie).toBe("ocean");
    const next = resolveOrigin(play, hole, coverAt);
    expect(next.dropped).toBe(true);
    expect(next.origin.lie).not.toBe("ocean");
    expect(Math.hypot(next.origin.x - hole.tee[0], next.origin.z - hole.tee[1])).toBeGreaterThan(20);
  });
});
