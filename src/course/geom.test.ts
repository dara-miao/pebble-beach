import { describe, expect, it } from "vitest";
import { dist, teeStance } from "./geom";
import type { HoleData } from "./types";

function holeStub(partial: Partial<HoleData> & Pick<HoleData, "tee" | "greenCenter" | "yards">): HoleData {
  return {
    number: 1,
    par: 4,
    handicap: 1,
    note: "",
    osmPathYards: 380,
    path: [partial.tee, partial.greenCenter],
    pin: partial.greenCenter,
    green: null,
    tees: [],
    fairways: [],
    bunkers: [],
    ...partial,
  };
}

describe("teeStance", () => {
  it("keeps blue on the official tee and moves white toward the green", () => {
    const hole = holeStub({
      tee: [0, 0],
      greenCenter: [0, 400],
      path: [
        [0, 0],
        [0, 400],
      ],
      yards: { championship: 420, blue: 400, gold: 380, white: 360 },
      tees: [
        { center: [0, 0], polygon: [] },
        { center: [0, 20], polygon: [] },
        { center: [0, 40], polygon: [] },
      ],
    });
    expect(dist(teeStance(hole, "blue"), hole.tee)).toBeLessThan(1);
    expect(teeStance(hole, "championship")[1]).toBeLessThan(-15);
    expect(teeStance(hole, "white")[1]).toBeGreaterThan(35);
  });

  it("snaps to a nearby OSM box when the ideal spot is close", () => {
    const hole = holeStub({
      tee: [0, 0],
      greenCenter: [0, 400],
      path: [
        [0, 0],
        [0, 400],
      ],
      yards: { championship: 400, blue: 400, gold: 380, white: 360 },
      tees: [
        { center: [0, 0], polygon: [] },
        { center: [0, 38], polygon: [] },
      ],
    });
    expect(dist(teeStance(hole, "white"), [0, 38])).toBeLessThan(1);
  });
});
