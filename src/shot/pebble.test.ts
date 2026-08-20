import { describe, expect, it } from "vitest";
import courseJson from "../course/pebble-beach.json";
import type { CourseData } from "../course/types";
import { holeByNumber } from "../course/geom";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyShotResult, ballAt, createHolePlay, pinDistance3d, resolveOrigin } from "./play";
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
    const teeToPin = pinDistance3d(hole.tee[0], hole.tee[1], hole);
    expect(play.ball.remainingYards).toBeCloseTo(teeToPin, 5);
    expect(Math.abs(play.ball.remainingYards - hole.yards.blue)).toBeLessThan(8);

    const preview = simulateShot(hole, parseShotPrompt("driver 250"), heightAt, coverAt, play.ball);
    const drive = simulateShot(hole, parseShotPrompt("driver 250"), heightAt, coverAt, play.ball);
    expect(drive.end.x).toBeCloseTo(preview.end.x, 8);
    expect(drive.remainingYards).toBeCloseTo(preview.remainingYards, 8);
    play = applyShotResult(play, drive, hole, coverAt);
    const left = pinDistance3d(play.ball.x, play.ball.z, hole);
    expect(play.ball.remainingYards).toBeCloseTo(left, 5);
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

  it("previews hole 7 bunker and ocean before the ball is hit, then plays those lies", () => {
    const hole = holeByNumber(course, 7);
    const tee = createHolePlay(hole, "blue", coverAt);

    const bunkerPrompt = "pw 80";
    const bunkerPreview = simulateShot(hole, parseShotPrompt(bunkerPrompt), heightAt, coverAt, tee.ball);
    expect(bunkerPreview.trouble.bunker).toBe(true);
    expect(bunkerPreview.landLie).toBe("bunker");
    expect(bunkerPreview.outcome.toLowerCase()).toMatch(/bunker/);
    const bunkerHit = simulateShot(hole, parseShotPrompt(bunkerPrompt), heightAt, coverAt, tee.ball);
    expect(bunkerHit.end.x).toBeCloseTo(bunkerPreview.end.x, 8);
    expect(bunkerHit.landLie).toBe(bunkerPreview.landLie);
    let fromSand = applyShotResult(tee, bunkerHit, hole, coverAt);
    expect(fromSand.ball.lie).toBe("bunker");
    expect(fromSand.ball.remainingYards).toBeCloseTo(pinDistance3d(fromSand.ball.x, fromSand.ball.z, hole), 5);
    const splash = simulateShot(hole, parseShotPrompt("sw 35"), heightAt, coverAt, fromSand.ball);
    expect(splash.start.lie).toBe("bunker");
    expect(splash.carryYards).toBeLessThan(50);
    expect(splash.outcome.toLowerCase()).toMatch(/bunker splash/);

    const oceanPreview = simulateShot(hole, parseShotPrompt("driver 265"), heightAt, coverAt, tee.ball);
    expect(oceanPreview.trouble.ocean).toBe(true);
    expect(oceanPreview.landLie).toBe("ocean");
    const oceanHit = simulateShot(hole, parseShotPrompt("driver 265"), heightAt, coverAt, tee.ball);
    expect(oceanHit.landLie).toBe(oceanPreview.landLie);
    expect(oceanHit.remainingYards).toBeCloseTo(oceanPreview.remainingYards, 8);
    const wet = applyShotResult(tee, oceanHit, hole, coverAt);
    expect(wet.ball.lie).toBe("ocean");
    expect(resolveOrigin(wet, hole, coverAt).dropped).toBe(true);
  });

  it("plays hole 7 into sand, hole 8 leftover after a driver, then putts out", () => {
    const seven = holeByNumber(course, 7);
    let play = createHolePlay(seven, "blue", coverAt);
    const bunker = simulateShot(seven, parseShotPrompt("pw 80"), heightAt, coverAt, play.ball);
    expect(bunker.trouble.bunker).toBe(true);
    play = applyShotResult(play, bunker, seven, coverAt);
    expect(play.ball.lie).toBe("bunker");
    const splash = simulateShot(seven, parseShotPrompt("sw 35"), heightAt, coverAt, play.ball);
    play = applyShotResult(play, splash, seven, coverAt);
    expect(play.ball.lie).not.toBe("ocean");

    const eight = holeByNumber(course, 8);
    play = createHolePlay(eight, "blue", coverAt);
    const drive = simulateShot(eight, parseShotPrompt("driver 250"), heightAt, coverAt, play.ball);
    play = applyShotResult(play, drive, eight, coverAt);
    expect(play.ball.remainingYards).toBeCloseTo(pinDistance3d(play.ball.x, play.ball.z, eight), 5);
    expect(play.ball.remainingYards).toBeGreaterThan(120);

    const onGreen = ballAt(eight.pin[0], eight.pin[1] - 6, eight, coverAt);
    expect(onGreen.lie).toBe("green");
    const putt = simulateShot(eight, parseShotPrompt(`putt ${Math.round(onGreen.pinYards * 3)} ft`), heightAt, coverAt, onGreen);
    play = applyShotResult({ ...play, ball: onGreen }, putt, eight, coverAt);
    expect(putt.outcome.toLowerCase()).toMatch(/holed/);
    expect(play.ball.holed).toBe(true);
    expect(play.ball.remainingYards).toBe(0);
  });
});
