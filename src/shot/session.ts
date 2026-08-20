import type { CourseData, HoleData } from "../course/types";
import { defaultFairwayTarget, holeByNumber, OPENING_HOLE } from "../course/geom";
import type { Cover } from "../scene/cover";
import type { HudHandlers, HudState, PlayHudView, ShotHudInfo } from "../ui/hud";
import { describeShot, parseShotPrompt, promptSpecifiesAim } from "./parse";
import { simulateMissEnvelope, type MissEnvelope } from "./miss";
import { resolveAim, type ShotResult } from "./simulate";
import {
  applyShotResult,
  createHolePlay,
  leftoverCopy,
  lieCopy,
  resolveOrigin,
  scoreCopy,
  type HolePlay,
} from "./play";
import { createRound, resetRound, roundThru, syncHoleScore, type RoundCard } from "./round";
import { DEFAULT_WIND, normalizeWind, windOnShotCopy, type WindCondition } from "./wind";
import { lieLabel } from "./lie";
import { bookFromHere, suggestShot } from "./yardage";
import { holeOutBeatFrom, shotStingFrom, type JuiceBeat } from "./juice";

export interface SessionSim {
  result: ShotResult;
  envelope: MissEnvelope;
  origin: ReturnType<typeof resolveOrigin>["origin"];
  req: ReturnType<typeof parseShotPrompt>;
}

export interface SessionChange {
  holeChanged: boolean;
  teeChanged: boolean;
  cameraChanged: boolean;
}

export function createPlaySession(
  course: CourseData,
  coverAt: (x: number, z: number) => Cover,
  heightAt: (x: number, z: number) => number,
) {
  const state: HudState = { hole: OPENING_HOLE, tee: "blue", camera: "address" };
  const plays = new Map<number, HolePlay>();
  const winds = new Map<number, WindCondition>();
  let round: RoundCard = createRound(course, state.tee);
  let play = createHolePlay(holeByNumber(course, state.hole), state.tee, coverAt);
  plays.set(state.hole, play);
  let aimTarget: { x: number; z: number } | null = null;
  let draftPrompt = "";
  let shotInfo: ShotHudInfo | undefined;
  let lastSim: SessionSim | null = null;
  let juice: JuiceBeat | null = null;
  let juiceToken = 0;

  function setJuice(next: JuiceBeat | null) {
    juiceToken += 1;
    juice = next;
  }

  function hole(): HoleData {
    return holeByNumber(course, state.hole);
  }

  function holeWind(): WindCondition {
    return winds.get(state.hole) ?? DEFAULT_WIND;
  }

  function adoptPlay(next: HolePlay) {
    play = next;
    plays.set(state.hole, next);
    round = syncHoleScore(round, next.holeNumber, next.strokes, next.ball.holed);
  }

  function ensurePlay(holeNumber: number): HolePlay {
    const existing = plays.get(holeNumber);
    if (existing && existing.tee === state.tee) return existing;
    const next = createHolePlay(holeByNumber(course, holeNumber), state.tee, coverAt);
    plays.set(holeNumber, next);
    return next;
  }

  function implicitTarget(origin: { x: number; z: number }, holeData: HoleData, carryYards?: number) {
    return aimTarget ?? defaultFairwayTarget(holeData, origin, carryYards);
  }

  function currentAim(origin: { x: number; z: number }, holeData: HoleData) {
    return resolveAim(holeData, origin, {
      aimYardsLeft: 0,
      landYards: undefined,
      target: implicitTarget(origin, holeData),
    });
  }

  function suggestionFor(origin: { lie: import("./lie").Lie; remainingYards: number; pinYards: number }, targetYards?: number) {
    return suggestShot(origin.lie, origin.remainingYards, origin.pinYards, targetYards);
  }

  function defaultPromptFrom(
    origin: { lie: import("./lie").Lie; remainingYards: number; pinYards: number },
    targetYards?: number,
  ) {
    return suggestionFor(origin, targetYards).prompt;
  }

  function defaultPrompt(): string {
    if (play.ball.holed) return "";
    const holeData = hole();
    const { origin } = resolveOrigin(play, holeData, coverAt);
    const targetYards = aimTarget ? Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z) : undefined;
    return defaultPromptFrom(origin, targetYards);
  }

  function playViewWind(origin: { x: number; z: number }, holeData: HoleData, wind: WindCondition) {
    const aim = currentAim(origin, holeData);
    return windOnShotCopy(wind, aim.ux, aim.uz);
  }

  function infoFromResult(
    req: ReturnType<typeof parseShotPrompt>,
    result: ShotResult,
    origin: SessionSim["origin"],
    envelope?: MissEnvelope,
  ): ShotHudInfo {
    const wind = holeWind();
    return {
      summary: describeShot(req, lieLabel(origin.lie).toLowerCase(), wind.mph > 0 ? playViewWind(origin, hole(), wind) : undefined),
      outcome: result.outcome,
      carry: result.carryYards,
      total: result.totalYards,
      peak: result.peakYards,
      leftover: Math.round(result.remainingYards),
      leftoverLabel: result.leftoverLabel === "Holed" ? "Holed" : result.leftoverLabel.replace(" to pin", ""),
      landLie: lieLabel(result.landLie),
      roll: result.rollYards,
      trouble: result.trouble.ocean
        ? "ocean"
        : result.trouble.bunker
          ? "bunker"
          : result.trouble.woods
            ? "woods"
            : result.trouble.shortSided
              ? "short"
              : undefined,
      land: [result.end.x, result.end.z],
      target: aimTarget ? [aimTarget.x, aimTarget.z] : [result.aim.target.x, result.aim.target.z],
      plannedCarry: result.carryYards,
      miss: envelope?.copy,
      missDanger: envelope ? !envelope.safe : undefined,
      missLandings: envelope?.samples.map((s) => [s.x, s.z] as [number, number]),
    };
  }

  function composeRequest(prompt: string) {
    const holeData = hole();
    const { origin } = resolveOrigin(play, holeData, coverAt);
    const targetYards = aimTarget ? Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z) : undefined;
    const suggestion = play.ball.holed
      ? { club: "7iron" as const, carryYards: 155 }
      : suggestionFor(origin, targetYards);
    const req = parseShotPrompt(prompt, { club: suggestion.club, carryYards: suggestion.carryYards });
    if (promptSpecifiesAim(prompt) && !aimTarget) return req;
    const target = implicitTarget(origin, holeData, req.carryYards);
    req.target = { x: target.x, z: target.z };
    const aimed = resolveAim(holeData, origin, { aimYardsLeft: 0, target: req.target });
    req.aimYardsLeft = Math.round(aimed.leftYards);
    req.landYards = Math.round(Math.hypot(target.x - origin.x, target.z - origin.z));
    return req;
  }

  function simulateFromPrompt(prompt: string): SessionSim {
    const holeData = hole();
    const req = composeRequest(prompt);
    const { origin, dropped } = resolveOrigin(play, holeData, coverAt);
    const envelope = simulateMissEnvelope(holeData, req, heightAt, coverAt, origin, dropped, holeWind());
    lastSim = { result: envelope.called, envelope, origin, req };
    return lastSim;
  }

  function playView(): PlayHudView {
    const holeData = hole();
    const { origin } = resolveOrigin(play, holeData, coverAt);
    const aim = currentAim(origin, holeData);
    const targetYards = aimTarget ? Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z) : undefined;
    const planned = shotInfo?.carry;
    const book = bookFromHere(origin, holeData, aim, coverAt, planned, targetYards);
    const suggestion = play.ball.holed ? { label: "holed out", prompt: "" } : book.suggest;
    return {
      holeNumber: play.holeNumber,
      strokes: play.strokes,
      penalties: play.penalties,
      scoreLabel: scoreCopy(play),
      lie: play.ball.lie,
      lieLabel: lieCopy(play),
      remainingYards: play.ball.remainingYards,
      pinYards: play.ball.pinYards,
      leftoverLabel: leftoverCopy(play),
      holed: play.ball.holed,
      onTee: play.strokes === 0 && !play.ball.holed,
      ball: [play.ball.x, play.ball.z],
      shots: play.shots,
      book,
      suggestion,
      cardYards: holeData.yards[state.tee] ?? holeData.yards.blue,
      wind: holeWind(),
      windOnShot: windOnShotCopy(holeWind(), aim.ux, aim.uz),
      round,
      thru: roundThru(round),
    };
  }

  function resultFromLast(): ShotHudInfo | undefined {
    const last = play.lastShot;
    if (!last) return undefined;
    return {
      summary: leftoverCopy(play),
      outcome: last.outcome,
      carry: last.carryYards,
      total: last.totalYards,
      peak: last.peakYards,
      leftover: Math.round(last.remainingYards),
      leftoverLabel: last.leftoverLabel === "Holed" ? "Holed" : last.leftoverLabel.replace(" to pin", ""),
      landLie: lieLabel(last.landLie),
      roll: last.rollYards,
      trouble: last.trouble.ocean
        ? "ocean"
        : last.trouble.bunker
          ? "bunker"
          : last.trouble.woods
            ? "woods"
            : last.trouble.shortSided
              ? "short"
              : undefined,
      land: [last.end.x, last.end.z],
      target: [last.aim.target.x, last.aim.target.z],
      plannedCarry: last.carryYards,
      kind: "result",
    };
  }

  function previewShot(prompt: string): ShotHudInfo | undefined {
    if (play.ball.holed) return shotInfo;
    const trimmed = prompt.trim();
    draftPrompt = prompt;
    if (!trimmed) {
      if (shotInfo?.kind === "preview") shotInfo = play.lastShot ? resultFromLast() : undefined;
      lastSim = null;
      return shotInfo;
    }
    const sim = simulateFromPrompt(trimmed);
    shotInfo = { ...infoFromResult(sim.req, sim.result, sim.origin, sim.envelope), kind: "preview" };
    return shotInfo;
  }

  function fireShot(prompt: string): SessionSim | null {
    if (play.ball.holed) return null;
    const trimmed = prompt.trim();
    if (!trimmed) return null;
    draftPrompt = trimmed;
    const holeData = hole();
    const sim = simulateFromPrompt(trimmed);
    adoptPlay(applyShotResult(play, sim.result, holeData, coverAt));
    shotInfo = {
      ...infoFromResult(sim.req, sim.result, sim.origin),
      kind: "result",
      miss: undefined,
      missDanger: undefined,
      missLandings: undefined,
    };
    if (play.ball.holed) {
      setJuice(holeOutBeatFrom(play, holeData.par, roundThru(round).label));
    } else {
      setJuice(shotStingFrom(sim.result));
    }
    aimTarget = null;
    draftPrompt = defaultPrompt();
    return sim;
  }

  function applyChange(next: Partial<HudState>): SessionChange {
    const holeChanged = next.hole != null && next.hole !== state.hole;
    const teeChanged = next.tee != null && next.tee !== state.tee;
    const cameraChanged = next.camera != null && next.camera !== state.camera;
    Object.assign(state, next);
    if (teeChanged) {
      setJuice(null);
      plays.clear();
      round = createRound(course, state.tee);
      adoptPlay(createHolePlay(hole(), state.tee, coverAt));
      shotInfo = undefined;
      lastSim = null;
      aimTarget = null;
      draftPrompt = defaultPrompt();
    } else if (holeChanged) {
      setJuice(null);
      play = ensurePlay(state.hole);
      shotInfo = play.lastShot ? resultFromLast() : undefined;
      lastSim = null;
      aimTarget = null;
      draftPrompt = defaultPrompt();
    }
    if ((teeChanged || holeChanged) && draftPrompt.trim()) previewShot(draftPrompt);
    return { holeChanged, teeChanged, cameraChanged };
  }

  function applyWind(next: Partial<WindCondition>) {
    const wind = normalizeWind({ ...holeWind(), ...next });
    winds.set(state.hole, wind);
    const prompt = draftPrompt.trim() || defaultPrompt();
    draftPrompt = prompt;
    if (prompt) previewShot(prompt);
  }

  function resetHole() {
    setJuice(null);
    adoptPlay(createHolePlay(hole(), state.tee, coverAt));
    shotInfo = undefined;
    lastSim = null;
    aimTarget = null;
    draftPrompt = defaultPrompt();
  }

  function newRound() {
    setJuice(null);
    plays.clear();
    round = resetRound(round);
    state.hole = OPENING_HOLE;
    adoptPlay(createHolePlay(hole(), state.tee, coverAt));
    shotInfo = undefined;
    lastSim = null;
    aimTarget = null;
    draftPrompt = defaultPrompt();
  }

  function advanceAfterBeat(): SessionChange | null {
    const beat = juice;
    if (!beat || beat.kind !== "hole-out" || beat.nextHole == null) {
      if (beat?.kind === "shot") setJuice(null);
      return null;
    }
    return applyChange({ hole: beat.nextHole });
  }

  function setAimFromGround(point: { x: number; z: number }): { prompt: string; target: { x: number; z: number } } | null {
    if (play.ball.holed) return null;
    const holeData = hole();
    const { origin } = resolveOrigin(play, holeData, coverAt);
    if (Math.hypot(point.x - origin.x, point.z - origin.z) < 4) return null;
    const pinDist = Math.hypot(point.x - holeData.pin[0], point.z - holeData.pin[1]);
    aimTarget = pinDist < 8 ? { x: holeData.pin[0], z: holeData.pin[1] } : point;
    const targetYards = Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z);
    const next = suggestionFor(origin, targetYards).prompt;
    if (!draftPrompt.trim() || draftPrompt === defaultPromptFrom(origin, undefined) || !promptSpecifiesAim(draftPrompt)) {
      if (!promptSpecifiesAim(draftPrompt)) draftPrompt = next;
    }
    if (!draftPrompt.trim()) draftPrompt = next;
    previewShot(draftPrompt);
    return { prompt: draftPrompt, target: aimTarget };
  }

  function handleKey(key: string): SessionChange | "reset" | null {
    if (key === "ArrowRight") return applyChange({ hole: (state.hole % 18) + 1 });
    if (key === "ArrowLeft") return applyChange({ hole: state.hole === 1 ? 18 : state.hole - 1 });
    if (key === "a") return applyChange({ camera: "address" });
    if (key === "t") return applyChange({ camera: "tee" });
    if (key === "f") return applyChange({ camera: "flyover" });
    if (key === "g") return applyChange({ camera: "green" });
    if (key === "c") return applyChange({ camera: "overview" });
    if (key === "r") {
      resetHole();
      return "reset";
    }
    return null;
  }

  draftPrompt = defaultPrompt();

  const api = {
    get state() {
      return state;
    },
    get play() {
      return play;
    },
    get round() {
      return round;
    },
    get draftPrompt() {
      return draftPrompt;
    },
    set draftPrompt(value: string) {
      draftPrompt = value;
    },
    get shotInfo() {
      return shotInfo;
    },
    get aimTarget() {
      return aimTarget;
    },
    get lastSim() {
      return lastSim;
    },
    get juice() {
      return juice;
    },
    get juiceToken() {
      return juiceToken;
    },
    get holeData() {
      return hole();
    },
    playView,
    previewShot,
    fireShot,
    applyChange,
    applyWind,
    resetHole,
    newRound,
    advanceAfterBeat,
    setAimFromGround,
    handleKey,
    defaultPrompt,
    holeWind,
    handlers(): HudHandlers {
      return {
        onChange: applyChange,
        onShot: (prompt) => {
          fireShot(prompt);
        },
        onPreview: previewShot,
        onReset: resetHole,
        onWind: applyWind,
        onNewRound: newRound,
      };
    },
  };

  return api;
}

export type PlaySession = ReturnType<typeof createPlaySession>;
