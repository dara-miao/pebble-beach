/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { loadCourse } from "../course/load";
import { buildCoverIndex, heightAt as sampleHeight } from "../scene/cover";
import { createPlaySession } from "../shot/session";
import { holeOutBeatFrom, shotStingFrom } from "../shot/juice";
import { renderHud, shotChips, type HudHandlers } from "./hud";
import { renderJuice } from "./juice";

const course = loadCourse();
const index = buildCoverIndex(course);
const heightAt = (x: number, z: number) => sampleHeight(course, index, x, z).y;
const coverAt = (x: number, z: number) => sampleHeight(course, index, x, z).cover;

function mount(handlers: HudHandlers, hole = 1) {
  const s = createPlaySession(course, coverAt, heightAt);
  if (hole !== 1) s.applyChange({ hole });
  const el = document.createElement("div");
  document.body.appendChild(el);
  renderHud(el, course, s.holeData, s.state, s.playView(), handlers, s.shotInfo, s.draftPrompt);
  return { el, s };
}

describe("HUD control wiring", () => {
  it("exposes every control and each one fires a handler", () => {
    const onChange = vi.fn();
    const onShot = vi.fn();
    const onPreview = vi.fn();
    const onReset = vi.fn();
    const onWind = vi.fn();
    const onNewRound = vi.fn();
    const { el, s } = mount({ onChange, onShot, onPreview, onReset, onWind, onNewRound });

    const holeBtns = el.querySelectorAll<HTMLButtonElement>("nav.holes [data-hole]");
    expect(holeBtns).toHaveLength(18);
    holeBtns[6].click();
    expect(onChange).toHaveBeenCalledWith({ hole: 7 });

    const scoreIds = el.querySelectorAll<HTMLButtonElement>(".scorecard [data-hole]");
    expect(scoreIds).toHaveLength(18);
    scoreIds[17].click();
    expect(onChange).toHaveBeenCalledWith({ hole: 18 });

    for (const tee of ["championship", "blue", "gold", "white"] as const) {
      el.querySelector<HTMLButtonElement>(`[data-tee="${tee}"]`)!.click();
      expect(onChange).toHaveBeenCalledWith({ tee });
    }

    for (const cam of ["address", "tee", "flyover", "green", "overview"] as const) {
      el.querySelector<HTMLButtonElement>(`[data-cam="${cam}"]`)!.click();
      expect(onChange).toHaveBeenCalledWith({ camera: cam });
    }

    el.querySelector<HTMLButtonElement>('[data-wind-from="N"]')!.click();
    expect(onWind).toHaveBeenCalledWith({ from: "N" });
    el.querySelector<HTMLButtonElement>('[data-wind-mph="14"]')!.click();
    expect(onWind).toHaveBeenCalledWith({ mph: 14 });
    const minus = el.querySelector<HTMLButtonElement>('[data-wind-mph-delta="-2"]')!;
    expect(minus.disabled).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-wind-mph-delta="2"]')!.click();
    expect(onWind).toHaveBeenCalledWith({ mph: 2 });

    el.querySelector<HTMLButtonElement>("[data-reset]")!.click();
    expect(onReset).toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>("[data-new-round]")!.click();
    expect(onNewRound).toHaveBeenCalled();

    const chips = el.querySelectorAll<HTMLButtonElement>("[data-ex]");
    expect(chips.length).toBe(shotChips(s.playView()).length);
    expect(chips.length).toBeGreaterThan(0);
    chips[0].click();
    const filled = chips[0].dataset.ex ?? "";
    expect(onPreview).toHaveBeenCalledWith(filled);
    const input = el.querySelector<HTMLInputElement>("input[name=prompt]")!;
    expect(input.value).toBe(filled);

    const form = el.querySelector<HTMLFormElement>(".shot-form")!;
    input.value = "";
    form.requestSubmit();
    expect(onShot).not.toHaveBeenCalled();
    input.value = filled;
    form.requestSubmit();
    expect(onShot).toHaveBeenCalledWith(filled);
  });

  it("draw/fade chips fill the prompt and Hit would receive that text", () => {
    const onShot = vi.fn();
    const onPreview = vi.fn();
    const { el } = mount(
      { onChange: vi.fn(), onShot, onPreview, onReset: vi.fn(), onWind: vi.fn(), onNewRound: vi.fn() },
      1,
    );
    const fade = [...el.querySelectorAll<HTMLButtonElement>("[data-ex]")].find((b) => /fade/i.test(b.textContent ?? ""));
    expect(fade).toBeTruthy();
    fade!.click();
    expect(onPreview).toHaveBeenCalled();
    const input = el.querySelector<HTMLInputElement>("input[name=prompt]")!;
    expect(input.value.toLowerCase()).toMatch(/fade/);
    el.querySelector<HTMLFormElement>(".shot-form")!.requestSubmit();
    expect(onShot).toHaveBeenCalledWith(input.value);
  });
});

describe("juice overlay", () => {
  it("renders a shot sting and a hole-out banner, with New round on 18", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    renderJuice(
      el,
      shotStingFrom({
        landLie: "green",
        remainingYards: 14,
        leftoverLabel: "42 ft to pin",
        penaltyStrokes: 0,
        trouble: { ocean: false, bunker: false, woods: false },
      }),
    );
    expect(el.hidden).toBe(false);
    expect(el.textContent).toMatch(/Nice/i);
    expect(el.querySelector(".juice-toast")).toBeTruthy();

    const onSkip = vi.fn();
    renderJuice(el, holeOutBeatFrom({ holeNumber: 7, strokes: 2 }, 3, "E"), { onSkip });
    expect(el.textContent).toMatch(/Birdie/i);
    expect(el.textContent).toMatch(/Hole 7/);
    expect(el.textContent).toMatch(/hole 8/i);
    el.querySelector<HTMLElement>(".juice-banner")!.click();
    expect(onSkip).toHaveBeenCalled();

    const onNewRound = vi.fn();
    renderJuice(el, holeOutBeatFrom({ holeNumber: 18, strokes: 5 }, 5, "E"), { onNewRound });
    expect(el.textContent).toMatch(/Round complete/i);
    el.querySelector<HTMLButtonElement>("[data-juice-new-round]")!.click();
    expect(onNewRound).toHaveBeenCalled();

    renderJuice(el, null);
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe("");
  });
});
