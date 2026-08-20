import { describe, expect, it } from "vitest";
import { holeByNumber } from "../course/geom";
import { loadCourse } from "../course/load";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { parseShotPrompt } from "./parse";
import { applyShotResult, createHolePlay, pinDistance3d, resolveOrigin } from "./play";
import { missShowsHazard, simulateMissEnvelope } from "./miss";
import { createRound, resetRound, roundThru, syncHoleScore } from "./round";
import { aimFromPoint, simulateShot } from "./simulate";
import { bookFromHere, clearStatus, suggestShot } from "./yardage";

/**
 * Hole 7 / hole 8 verify script.
 * Stand on the lie, pick a landing, read leftover + hazard-clear, take the
 * suggested club, preview the real flight, hit, and see the hole story grow.
 */
const course = loadCourse();
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
    expect(teeBook.firstTrouble).toBeTruthy();
    const bunker = teeBook.hazards.find((h) => h.kind === "bunker");
    expect(bunker).toBeTruthy();
    expect(bunker!.carryYards).toBeGreaterThan(50);
    expect(bunker!.carryYards).toBeLessThan(teeToPin + 20);
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

  it("hole 7: miss envelope shows bunker or ocean while a conservative line stays safe", () => {
    const hole = holeByNumber(course, 7);
    const play = createHolePlay(hole, "blue", coverAt);
    const atGreen = simulateMissEnvelope(hole, parseShotPrompt("8 iron 100"), heightAt, coverAt, play.ball);
    expect(atGreen.samples).toHaveLength(4);
    expect(atGreen.called.trouble.bunker).toBe(false);
    expect(atGreen.called.trouble.ocean).toBe(false);
    expect(atGreen.called.landLie).toBe("green");
    const bunker = hole.bunkers.find((b) => coverAt(b.center[0], b.center[1]) === "bunker") ?? hole.bunkers[0];
    const sand = { x: bunker.center[0], z: bunker.center[1] };
    const aimed = aimFromPoint(play.ball, hole.pin, sand);
    const towardSand = simulateMissEnvelope(
      hole,
      { ...parseShotPrompt(`pw ${Math.max(20, Math.round(aimed.landYards))}`), target: sand, landYards: aimed.landYards, aimYardsLeft: aimed.aimYardsLeft },
      heightAt,
      coverAt,
      play.ball,
    );
    expect(towardSand.called.landLie === "bunker" || missShowsHazard(towardSand, "bunker")).toBe(true);
    expect((towardSand.copy + towardSand.called.outcome).toLowerCase()).toMatch(/bunker/);

    const shortRight = simulateMissEnvelope(hole, parseShotPrompt("driver 265"), heightAt, coverAt, play.ball);
    expect(missShowsHazard(shortRight, "ocean") || shortRight.called.trouble.ocean).toBe(true);
    expect(shortRight.copy.toLowerCase()).toMatch(/ocean/);

    const safe = simulateMissEnvelope(hole, parseShotPrompt("pw 60 8 left"), heightAt, coverAt, play.ball);
    expect(safe.called.landLie).not.toBe("ocean");
    expect(safe.called.landLie).not.toBe("bunker");
    expect(safe.safe).toBe(true);
    expect(safe.copy).toBe("Miss stays safe");
    expect(missShowsHazard(safe, "bunker")).toBe(false);
    expect(missShowsHazard(safe, "ocean")).toBe(false);

    const hit = simulateShot(hole, parseShotPrompt("8 iron 100"), heightAt, coverAt, play.ball);
    expect(hit.end.x).toBeCloseTo(atGreen.called.end.x, 8);
    expect(hit.landLie).toBe(atGreen.called.landLie);
  });

  it("hole 8: wind changes carry and leftover; scorecard survives the hole change", () => {
    const eight = holeByNumber(course, 8);
    const seven = holeByNumber(course, 7);
    let play = createHolePlay(eight, "blue", coverAt);
    const req = parseShotPrompt("driver 250");
    const still = simulateShot(eight, req, heightAt, coverAt, play.ball, false, { mph: 0, from: "W" });
    const into = simulateShot(eight, req, heightAt, coverAt, play.ball, false, { mph: 16, from: "E" });
    const down = simulateShot(eight, req, heightAt, coverAt, play.ball, false, { mph: 16, from: "W" });
    expect(into.carryYards).toBeLessThan(still.carryYards);
    expect(down.carryYards).toBeGreaterThan(still.carryYards);
    expect(down.remainingYards).toBeLessThan(still.remainingYards - 8);
    expect(Math.hypot(into.end.x - still.end.x, into.end.z - still.end.z)).toBeGreaterThan(2);
    expect(Math.hypot(down.end.x - still.end.x, down.end.z - still.end.z)).toBeGreaterThan(12);
    expect(into.wind.alongMph).toBeLessThan(0);
    expect(down.wind.alongMph).toBeGreaterThan(0);

    const windEnv = simulateMissEnvelope(eight, req, heightAt, coverAt, play.ball, false, { mph: 16, from: "W" });
    expect(windEnv.called.carryYards).toBe(down.carryYards);
    expect(windEnv.samples).toHaveLength(4);

    play = applyShotResult(play, still, eight, coverAt);
    const left = pinDistance3d(play.ball.x, play.ball.z, eight);
    expect(play.ball.remainingYards).toBeCloseTo(left, 5);
    expect(left).toBeGreaterThan(120);

    let card = createRound(course, "blue");
    card = syncHoleScore(card, 8, play.strokes, play.ball.holed);
    const sevenHit = simulateShot(seven, parseShotPrompt("pw 80"), heightAt, coverAt, createHolePlay(seven, "blue", coverAt).ball);
    const sevenPlay = applyShotResult(createHolePlay(seven, "blue", coverAt), sevenHit, seven, coverAt);
    card = syncHoleScore(card, 7, sevenPlay.strokes, sevenPlay.ball.holed);
    const thru = roundThru(card);
    expect(card.holes.find((h) => h.number === 8)?.strokes).toBe(play.strokes);
    expect(card.holes.find((h) => h.number === 7)?.strokes).toBe(sevenPlay.strokes);
    expect(thru.played).toBe(2);
    expect(thru.strokes).toBe(play.strokes + sevenPlay.strokes);
    expect(thru.par).toBe(seven.par + eight.par);

    card = resetRound(card);
    expect(roundThru(card).played).toBe(0);
  });
});
