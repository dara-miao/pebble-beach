import { describe, expect, it } from "vitest";
import { holeByNumber } from "../course/geom";
import { loadCourse } from "../course/load";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { shotChips } from "../ui/hud";
import { createPlaySession } from "./session";

const course = loadCourse();
const index = buildCoverIndex(course);
const heightAt = (x: number, z: number) => sampleHeight(course, index, x, z).y;
const coverAt = (x: number, z: number) => sampleHeight(course, index, x, z).cover;

function session() {
  return createPlaySession(course, coverAt, heightAt);
}

describe("button / handler smoke", () => {
  it("hole picker, scorecard-equivalent applyChange, and arrows change hole leftover", () => {
    const s = session();
    expect(s.state.hole).toBe(1);
    const startLeft = s.play.ball.remainingYards;
    s.applyChange({ hole: 7 });
    expect(s.state.hole).toBe(7);
    expect(s.play.holeNumber).toBe(7);
    expect(s.play.ball.remainingYards).not.toBeCloseTo(startLeft, 0);
    expect(s.playView().leftoverLabel).toMatch(/\d/);
    s.handleKey("ArrowRight");
    expect(s.state.hole).toBe(8);
    s.handleKey("ArrowLeft");
    expect(s.state.hole).toBe(7);
    s.applyChange({ hole: 18 });
    expect(s.state.hole).toBe(18);
    expect(s.play.ball.x).toBeCloseTo(holeByNumber(course, 18).tee[0], 5);
  });

  it("tee buttons change card yards and leftover", () => {
    const s = session();
    s.applyChange({ hole: 1, tee: "blue" });
    const blue = s.playView();
    s.applyChange({ tee: "championship" });
    const champ = s.playView();
    expect(s.state.tee).toBe("championship");
    expect(champ.cardYards).not.toBe(blue.cardYards);
    expect(champ.remainingYards).not.toBeCloseTo(blue.remainingYards, 0);
    s.applyChange({ tee: "gold" });
    expect(s.playView().cardYards).not.toBe(champ.cardYards);
    s.applyChange({ tee: "white" });
    expect(s.state.tee).toBe("white");
    expect(s.playView().cardYards).toBeLessThan(champ.cardYards);
  });

  it("camera buttons and a/t/f/g/c change the mode", () => {
    const s = session();
    expect(s.state.camera).toBe("address");
    s.applyChange({ camera: "tee" });
    expect(s.state.camera).toBe("tee");
    s.applyChange({ camera: "flyover" });
    expect(s.state.camera).toBe("flyover");
    s.applyChange({ camera: "green" });
    expect(s.state.camera).toBe("green");
    s.applyChange({ camera: "overview" });
    expect(s.state.camera).toBe("overview");
    s.handleKey("a");
    expect(s.state.camera).toBe("address");
    s.handleKey("t");
    expect(s.state.camera).toBe("tee");
    s.handleKey("f");
    expect(s.state.camera).toBe("flyover");
    s.handleKey("g");
    expect(s.state.camera).toBe("green");
    s.handleKey("c");
    expect(s.state.camera).toBe("overview");
  });

  it("wind from / mph / delta change the wind line and preview", () => {
    const s = session();
    const still = s.playView().windOnShot;
    s.applyWind({ from: "N" });
    expect(s.holeWind().from).toBe("N");
    s.applyWind({ mph: 14 });
    expect(s.holeWind().mph).toBe(14);
    const blowing = s.playView().windOnShot;
    expect(blowing).not.toBe(still);
    expect(blowing).toMatch(/14/);
    expect(s.shotInfo?.kind).toBe("preview");
    expect(Number.isFinite(s.shotInfo?.carry)).toBe(true);
    s.applyWind({ mph: s.holeWind().mph + 2 });
    expect(s.holeWind().mph).toBe(16);
    s.applyWind({ mph: 0 });
    expect(s.playView().windOnShot).toMatch(/still/i);
  });

  it("chips preview, Hit plays, empty Hit is a no-op", () => {
    const s = session();
    s.applyChange({ hole: 7 });
    const chips = shotChips(s.playView());
    expect(chips.length).toBeGreaterThan(0);
    const chip = chips[0];
    const preview = s.previewShot(chip.prompt);
    expect(preview?.kind).toBe("preview");
    expect(Number.isFinite(preview?.carry)).toBe(true);
    expect(preview?.outcome).toBeTruthy();
    expect(Number.isNaN(preview?.carry)).toBe(false);
    const before = { strokes: s.play.strokes, x: s.play.ball.x, z: s.play.ball.z };
    expect(s.fireShot("")).toBeNull();
    expect(s.play.strokes).toBe(before.strokes);
    const hit = s.fireShot(chip.prompt);
    expect(hit).toBeTruthy();
    expect(s.play.strokes).toBeGreaterThan(before.strokes);
    expect(s.shotInfo?.kind).toBe("result");
    expect(s.play.ball.x !== before.x || s.play.ball.z !== before.z).toBe(true);
    expect(s.round.holes.find((h) => h.number === 7)?.strokes).toBe(s.play.strokes);
  });

  it("reset hole and new round change visible card / ball state", () => {
    const s = session();
    s.applyChange({ hole: 8 });
    s.fireShot("driver 250");
    expect(s.play.strokes).toBeGreaterThan(0);
    s.handleKey("r");
    expect(s.play.strokes).toBe(0);
    expect(s.play.shots).toHaveLength(0);
    expect(s.play.ball.x).toBeCloseTo(holeByNumber(course, 8).tee[0], 5);
    s.fireShot("driver 220");
    s.applyChange({ hole: 2 });
    s.fireShot(s.playView().suggestion.prompt);
    expect(s.round.holes.some((h) => h.strokes != null)).toBe(true);
    s.newRound();
    expect(s.state.hole).toBe(1);
    expect(s.play.strokes).toBe(0);
    expect(s.round.holes.every((h) => h.strokes == null)).toBe(true);
    expect(s.playView().thru.label).toBe("—");
  });

  it("click-to-aim sets a target and produces a preview", () => {
    const s = session();
    s.applyChange({ hole: 8 });
    const ball = s.play.ball;
    const aimed = s.setAimFromGround({ x: ball.x + 30, z: ball.z + 90 });
    expect(aimed).toBeTruthy();
    expect(s.aimTarget).toBeTruthy();
    expect(s.draftPrompt.trim().length).toBeGreaterThan(0);
    expect(s.shotInfo?.kind).toBe("preview");
    expect(Number.isFinite(s.shotInfo?.carry)).toBe(true);
    expect(s.shotInfo?.target).toBeTruthy();
  });
});
