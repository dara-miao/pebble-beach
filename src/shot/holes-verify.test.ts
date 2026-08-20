import { describe, expect, it } from "vitest";
import courseJson from "../course/pebble-beach.json";
import type { CourseData } from "../course/types";
import { holeByNumber } from "../course/geom";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyShotResult, createHolePlay, pinDistance3d, resolveOrigin } from "./play";
import { aimFromPoint, simulateShot } from "./simulate";
import { bookFromHere, clearStatus, suggestShot } from "./yardage";

/**
 * Hole 7 / hole 8 verify script.
 * Stand on the lie, pick a landing, read leftover + hazard-clear, take the
 * suggested club, preview the real flight, hit, and see the hole story grow.
 */
const course = courseJson as unknown as CourseData;
const index = buildCoverIndex(course);
const heightAt = (x: number, z: number) => sampleHeight(course, index, x, z).y;
const coverAt = (x: number, z: number) => sampleHeight(course, index, x, z).cover;

function aimAlong(origin: { x: number; z: number }, hole: ReturnType<typeof holeByNumber>, along: number, left = 0) {
  const toPinX = hole.pin[0] - origin.x;
  const toPinZ = hole.pin[1] - origin.z;
  const pinLen = Math.hypot(toPinX, toPinZ) || 1;
  const pux = toPinX / pinLen;
  const puz = toPinZ / pinLen;
  return {
    x: origin.x + pux * along + -puz * left,
    z: origin.z + puz * along + pux * left,
  };
}

describe("hole 7 / hole 8 verify script", () => {
  it("hole 7: leftover from the ball, aim a landing, read the bunker, splash, remember the shots", () => {
    const hole = holeByNumber(course, 7);
    let play = createHolePlay(hole, "blue", coverAt);
    const teeToPin = pinDistance3d(hole.tee[0], hole.tee[1], hole);
    expect(play.ball.remainingYards).toBeCloseTo(teeToPin, 5);
    expect(Math.abs(play.ball.remainingYards - 109)).toBeLessThan(3);

    const pinDirX = (hole.pin[0] - play.ball.x) / teeToPin;
    const pinDirZ = (hole.pin[1] - play.ball.z) / teeToPin;
    const teeBook = bookFromHere(play.ball, hole, { ux: pinDirX, uz: pinDirZ }, coverAt);
    expect(teeBook.firstTrouble?.kind).toBe("bunker");
    expect(teeBook.firstTrouble!.carryYards).toBeGreaterThan(50);
    expect(suggestShot(play.ball.lie, play.ball.remainingYards, play.ball.pinYards).club).not.toBe("putter");

    const landing = aimAlong(play.ball, hole, 80, 8);
    const aimed = aimFromPoint(play.ball, hole.pin, landing);
    const req = { ...parseShotPrompt("pw 80"), target: landing, landYards: aimed.landYards, aimYardsLeft: aimed.aimYardsLeft };
    const preview = simulateShot(hole, req, heightAt, coverAt, play.ball);
    const hit = simulateShot(hole, req, heightAt, coverAt, play.ball);
    expect(hit.end.x).toBeCloseTo(preview.end.x, 8);
    expect(hit.remainingYards).toBeCloseTo(preview.remainingYards, 8);
    expect(hit.trouble).toEqual(preview.trouble);
    play = applyShotResult(play, hit, hole, coverAt);
    expect(play.shots).toHaveLength(1);
    expect(play.shots[0].club).toBe("pw");
    expect(play.ball.remainingYards).toBeCloseTo(pinDistance3d(play.ball.x, play.ball.z, hole), 5);

    if (play.ball.lie === "bunker" || play.ball.lie === "sand") {
      const splash = suggestShot(play.ball.lie, play.ball.remainingYards, play.ball.pinYards);
      expect(splash.club).toBe("sw");
      const out = simulateShot(hole, parseShotPrompt(splash.prompt), heightAt, coverAt, play.ball);
      play = applyShotResult(play, out, hole, coverAt);
      expect(play.shots).toHaveLength(2);
      expect(play.shots[1].lieIn).toMatch(/bunker|sand/);
    }

    const reset = createHolePlay(hole, "blue", coverAt);
    expect(reset.shots).toHaveLength(0);
    expect(reset.strokes).toBe(0);
  });

  it("hole 8: stand mid-hole, leftover is 3D, hazard-clear is from here, next club is the leftover iron", () => {
    const hole = holeByNumber(course, 8);
    let play = createHolePlay(hole, "blue", coverAt);
    const drive = simulateShot(hole, parseShotPrompt("driver 250"), heightAt, coverAt, play.ball);
    play = applyShotResult(play, drive, hole, coverAt);
    expect(play.shots).toHaveLength(1);
    expect(play.shots[0].lieIn).toBe("tee");
    const left = pinDistance3d(play.ball.x, play.ball.z, hole);
    expect(play.ball.remainingYards).toBeCloseTo(left, 5);
    expect(left).toBeGreaterThan(120);

    const dirX = (hole.pin[0] - play.ball.x) / left;
    const dirZ = (hole.pin[1] - play.ball.z) / left;
    const book = bookFromHere(play.ball, hole, { ux: dirX, uz: dirZ }, coverAt, undefined);
    expect(book.leftoverYards).toBe(Math.round(left));
    expect(book.firstTrouble).toBeTruthy();
    expect(clearStatus(book.firstTrouble!.carryYards - 15, book.firstTrouble!)).toBe("short");
    expect(clearStatus(book.firstTrouble!.exitYards + 8, book.firstTrouble!)).toBe("covers");

    const club = suggestShot(play.ball.lie, play.ball.remainingYards, play.ball.pinYards);
    expect(club.club).not.toBe("putter");
    expect(club.carryYards).toBeGreaterThan(100);

    const landing = aimAlong(play.ball, hole, Math.min(left - 8, club.carryYards), 6);
    const aimed = aimFromPoint(play.ball, hole.pin, landing);
    const req = { ...parseShotPrompt(club.prompt), target: landing, landYards: aimed.landYards, aimYardsLeft: aimed.aimYardsLeft };
    const preview = simulateShot(hole, req, heightAt, coverAt, play.ball);
    const approach = simulateShot(hole, req, heightAt, coverAt, play.ball);
    expect(approach.end.x).toBeCloseTo(preview.end.x, 8);
    expect(approach.remainingYards).toBeCloseTo(preview.remainingYards, 8);
    play = applyShotResult(play, approach, hole, coverAt);
    expect(play.shots).toHaveLength(2);
    expect(play.ball.remainingYards).toBeCloseTo(pinDistance3d(play.ball.x, play.ball.z, hole), 5);

    const wet = createHolePlay(holeByNumber(course, 7), "blue", coverAt);
    const ocean = simulateShot(holeByNumber(course, 7), parseShotPrompt("driver 265"), heightAt, coverAt, wet.ball);
    const after = applyShotResult(wet, ocean, holeByNumber(course, 7), coverAt);
    expect(after.ball.lie).toBe("ocean");
    expect(resolveOrigin(after, holeByNumber(course, 7), coverAt).dropped).toBe(true);
    expect(after.shots[0].penalty).toBe(1);
  });
});
