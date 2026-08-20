import "./style.css";
import * as THREE from "three";
import courseJson from "./course/pebble-beach.json";
import type { CourseData, HoleData } from "./course/types";
import { holeByNumber } from "./course/geom";
import { createTerrain } from "./scene/terrain";
import { createOcean, createSky, sunFromTime } from "./scene/atmosphere";
import { addCourseFeatures, addYardageMarkers } from "./scene/features";
import { addTrees } from "./scene/trees";
import { createCourseCamera } from "./camera/courseCamera";
import { renderHud, updateShotPanel, type HudState, type PlayHudView, type ShotHudInfo } from "./ui/hud";
import { describeShot, parseShotPrompt, promptSpecifiesAim } from "./shot/parse";
import { resolveAim, simulateShot } from "./shot/simulate";
import { applyShotResult, createHolePlay, leftoverCopy, lieCopy, resolveOrigin, scoreCopy, type HolePlay } from "./shot/play";
import { lieLabel } from "./shot/lie";
import { bookFromHere, suggestShot } from "./shot/yardage";
import { clearAimVisual, clearPreviewVisual, playShotVisual, showPreviewVisual, upsertAimVisual, upsertLieMarker, type ShotVisual } from "./shot/visual";

const course = courseJson as unknown as CourseData;

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const hudEl = document.querySelector<HTMLElement>("#hud")!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x7f9aab, 0.00048);

const hour = 16.4;
const sunPos = sunFromTime(hour);
scene.add(createSky(sunPos));

const hemi = new THREE.HemisphereLight(0xb7d0e4, 0x3d4a32, 0.62);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffd7a8, 2.55);
sun.position.copy(sunPos).multiplyScalar(1200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 50;
sun.shadow.camera.far = 4000;
sun.shadow.camera.left = -900;
sun.shadow.camera.right = 900;
sun.shadow.camera.top = 900;
sun.shadow.camera.bottom = -900;
sun.shadow.bias = -0.0002;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x8eb7d4, 0.35);
fill.position.set(-400, 300, 200);
scene.add(fill);

const terrain = createTerrain(course);
scene.add(terrain.mesh);

const ocean = createOcean(sun.position);
scene.add(ocean);

addCourseFeatures(scene, course, terrain.heightAt);
addTrees(scene, course, terrain.heightAt);

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let aimDrag = false;
let pointerStart: { x: number; y: number } | null = null;

function pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, cam.camera);
  const hits = raycaster.intersectObject(terrain.mesh);
  if (!hits.length) return null;
  return { x: hits[0].point.x, z: hits[0].point.z };
}

function setAimFromGround(point: { x: number; z: number }, live: boolean) {
  if (play.ball.holed) return;
  const hole = activeHole();
  const { origin } = resolveOrigin(play, hole, terrain.coverAt);
  if (Math.hypot(point.x - origin.x, point.z - origin.z) < 4) return;
  const pinDist = Math.hypot(point.x - hole.pin[0], point.z - hole.pin[1]);
  aimTarget = pinDist < 8 ? { x: hole.pin[0], z: hole.pin[1] } : point;
  const targetYards = Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z);
  const next = suggestShot(origin.lie, origin.remainingYards, origin.pinYards, targetYards).prompt;
  if (!draftPrompt.trim() || draftPrompt === defaultPromptFrom(origin, undefined) || !promptSpecifiesAim(draftPrompt)) {
    if (!promptSpecifiesAim(draftPrompt)) draftPrompt = next;
  }
  placeAimMarker(origin);
  if (state.camera === "address") setCamera();
  if (live) {
    if (!draftPrompt.trim()) draftPrompt = next;
    previewShot(draftPrompt);
    const input = hudEl.querySelector<HTMLInputElement>("input[name=prompt]");
    if (input && document.activeElement !== input) input.value = draftPrompt;
    updateShotPanel(hudEl, playView(), hole, shotInfo);
  }
}

function defaultPromptFrom(
  origin: { lie: import("./shot/lie").Lie; remainingYards: number; pinYards: number },
  targetYards?: number,
) {
  return suggestShot(origin.lie, origin.remainingYards, origin.pinYards, targetYards).prompt;
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY };
  const hit = pickGround(event.clientX, event.clientY);
  if (hit && aimTarget && Math.hypot(hit.x - aimTarget.x, hit.z - aimTarget.z) < 12) {
    aimDrag = true;
    cam.controls.enabled = false;
  } else if (event.shiftKey && hit) {
    aimDrag = true;
    cam.controls.enabled = false;
    setAimFromGround(hit, true);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!aimDrag) return;
  const hit = pickGround(event.clientX, event.clientY);
  if (hit) setAimFromGround(hit, true);
});

canvas.addEventListener("pointerup", (event) => {
  if (event.button !== 0) return;
  const start = pointerStart;
  pointerStart = null;
  const wasDrag = aimDrag;
  if (aimDrag) {
    aimDrag = false;
    cam.controls.enabled = true;
  }
  if (wasDrag || !start) return;
  const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  if (moved > 8) return;
  const hit = pickGround(event.clientX, event.clientY);
  if (hit) setAimFromGround(hit, true);
});

const cam = createCourseCamera(canvas);
let markers = new THREE.Group();
let activeShot: ShotVisual | null = null;
let shotInfo: ShotHudInfo | undefined;
let draftPrompt = "";
let previewTimer = 0;

const state: HudState = { hole: 7, tee: "blue", camera: "address" };
let play = createPlay();
let aimTarget: { x: number; z: number } | null = null;

function activeHole(): HoleData {
  return holeByNumber(course, state.hole);
}

function createPlay(): HolePlay {
  return createHolePlay(activeHole(), state.tee, terrain.coverAt);
}

function playView(): PlayHudView {
  const hole = activeHole();
  const { origin } = resolveOrigin(play, hole, terrain.coverAt);
  const aim = currentAim(origin, hole);
  const targetYards = aimTarget ? Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z) : undefined;
  const planned = shotInfo?.carry;
  const book = bookFromHere(origin, hole, aim, terrain.coverAt, planned, targetYards);
  const suggestion = play.ball.holed
    ? { label: "holed out", prompt: "" }
    : book.suggest;
  return {
    strokes: play.strokes,
    penalties: play.penalties,
    scoreLabel: scoreCopy(play),
    lie: play.ball.lie,
    lieLabel: lieCopy(play),
    remainingYards: play.ball.remainingYards,
    pinYards: play.ball.pinYards,
    leftoverLabel: leftoverCopy(play),
    holed: play.ball.holed,
    onTee: play.strokes === 0 && play.ball.lie === "tee",
    ball: [play.ball.x, play.ball.z],
    shots: play.shots,
    book,
    suggestion,
    cardYards: hole.yards[state.tee] ?? hole.yards.blue,
  };
}

function currentAim(origin: { x: number; z: number }, hole: ReturnType<typeof activeHole>) {
  return resolveAim(hole, origin, {
    aimYardsLeft: 0,
    landYards: undefined,
    target: aimTarget ?? undefined,
  });
}

function lookAtPoint(): [number, number] {
  if (aimTarget) return [aimTarget.x, aimTarget.z];
  const hole = activeHole();
  return [hole.pin[0], hole.pin[1]];
}

function setCamera(mode = state.camera) {
  cam.setMode(mode, activeHole(), terrain.heightAt, ballSample(), lookAtPoint());
}

function ballSample(): [number, number] {
  const { origin } = resolveOrigin(play, activeHole(), terrain.coverAt);
  return [origin.x, origin.z];
}

function placeLieMarker(visible = true) {
  const hole = activeHole();
  const { origin } = resolveOrigin(play, hole, terrain.coverAt);
  const y = terrain.heightAt(origin.x, origin.z);
  upsertLieMarker(scene, origin.x, y, origin.z, origin.lie, visible);
  placeAimMarker(origin);
}

function placeAimMarker(origin?: { x: number; z: number }) {
  if (!aimTarget) {
    clearAimVisual(scene);
    return;
  }
  const from = origin ?? resolveOrigin(play, activeHole(), terrain.coverAt).origin;
  upsertAimVisual(
    scene,
    { x: from.x, y: terrain.heightAt(from.x, from.z), z: from.z },
    { x: aimTarget.x, y: terrain.heightAt(aimTarget.x, aimTarget.z), z: aimTarget.z },
    terrain.heightAt,
    true,
  );
}

function defaultPrompt(): string {
  if (play.ball.holed) return "";
  const hole = activeHole();
  const { origin } = resolveOrigin(play, hole, terrain.coverAt);
  const targetYards = aimTarget ? Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z) : undefined;
  return suggestShot(origin.lie, origin.remainingYards, origin.pinYards, targetYards).prompt;
}

function refreshHud() {
  renderHud(
    hudEl,
    course,
    activeHole(),
    state,
    playView(),
    { onChange: applyHole, onShot: fireShot, onPreview: queuePreview, onReset: resetHole },
    shotInfo,
    draftPrompt,
  );
}

function resetHole() {
  play = createPlay();
  shotInfo = undefined;
  aimTarget = null;
  draftPrompt = defaultPrompt();
  clearPreviewVisual(scene);
  clearAimVisual(scene);
  const old = scene.getObjectByName("shot-visual");
  old?.parent?.remove(old);
  placeLieMarker(true);
  setCamera();
  refreshHud();
}

function applyHole(next: Partial<HudState>) {
  const holeChanged = next.hole != null && next.hole !== state.hole;
  const teeChanged = next.tee != null && next.tee !== state.tee;
  Object.assign(state, next);
  if (holeChanged || teeChanged) {
    play = createPlay();
    shotInfo = undefined;
    aimTarget = null;
    draftPrompt = "";
    clearPreviewVisual(scene);
    clearAimVisual(scene);
    const old = scene.getObjectByName("shot-visual");
    old?.parent?.remove(old);
  }
  if (holeChanged || teeChanged) draftPrompt = defaultPrompt();
  const hole = activeHole();
  markers.removeFromParent();
  markers = addYardageMarkers(scene, hole, terrain.heightAt);
  placeLieMarker(true);
  setCamera();
  fitShadow(hole);
  refreshHud();
}

function composeRequest(prompt: string) {
  const req = parseShotPrompt(prompt);
  if (aimTarget && !promptSpecifiesAim(prompt)) {
    req.target = { x: aimTarget.x, z: aimTarget.z };
    const hole = activeHole();
    const { origin } = resolveOrigin(play, hole, terrain.coverAt);
    const aimed = resolveAim(hole, origin, { aimYardsLeft: 0, target: req.target });
    req.aimYardsLeft = Math.round(aimed.leftYards);
    req.landYards = Math.round(Math.hypot(aimTarget.x - origin.x, aimTarget.z - origin.z));
  }
  return req;
}

function simulateFromPrompt(prompt: string) {
  const hole = activeHole();
  const req = composeRequest(prompt);
  const { origin, dropped } = resolveOrigin(play, hole, terrain.coverAt);
  const result = simulateShot(hole, req, terrain.heightAt, terrain.coverAt, origin, dropped);
  const info: ShotHudInfo = {
    summary: describeShot(req, lieLabel(origin.lie).toLowerCase()),
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
  };
  return { req, result, info, origin };
}

function queuePreview(prompt: string) {
  draftPrompt = prompt;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => previewShot(prompt), 160);
}

function previewShot(prompt: string) {
  if (play.ball.holed) return;
  const trimmed = prompt.trim();
  if (!trimmed) {
    if (shotInfo?.kind === "preview") shotInfo = play.lastShot ? resultFromLast() : undefined;
    clearPreviewVisual(scene);
    updateShotPanel(hudEl, playView(), activeHole(), shotInfo);
    return;
  }
  const { result, info } = simulateFromPrompt(trimmed);
  shotInfo = { ...info, kind: "preview" };
  showPreviewVisual(scene, result);
  updateShotPanel(hudEl, playView(), activeHole(), shotInfo);
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

function fireShot(prompt: string) {
  if (play.ball.holed) return;
  const trimmed = prompt.trim();
  if (!trimmed) return;
  draftPrompt = trimmed;
  const hole = activeHole();
  const { result, info } = simulateFromPrompt(trimmed);
  play = applyShotResult(play, result, hole, terrain.coverAt);
  shotInfo = { ...info, kind: "result" };
  aimTarget = null;
  draftPrompt = defaultPrompt();
  placeLieMarker(false);
  activeShot = playShotVisual(scene, result, Math.max(2.6, Math.min(4.2, result.totalYards / 80)));
  cam.followShot(
    result.points.map((p) => p.position),
    Math.max(2.8, Math.min(4.5, result.totalYards / 75)),
  );
  refreshHud();
}

function fitShadow(hole: HoleData) {
  const cx = (hole.tee[0] + hole.greenCenter[0]) / 2;
  const cz = (hole.tee[1] + hole.greenCenter[1]) / 2;
  sun.target.position.set(cx, 0, cz);
  scene.add(sun.target);
  const span = Math.max(180, Math.hypot(hole.tee[0] - hole.greenCenter[0], hole.tee[1] - hole.greenCenter[1]) * 0.9);
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  cam.camera.aspect = window.innerWidth / window.innerHeight;
  cam.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();
  cam.update(dt);
  if (activeShot) {
    const done = activeShot.update(dt);
    if (done) {
      activeShot = null;
      placeLieMarker(true);
      if (state.camera === "address" || state.camera === "tee") setCamera();
    }
  }
  const waterUniforms = (ocean.material as THREE.ShaderMaterial).uniforms;
  if (waterUniforms?.["time"]) waterUniforms["time"].value += dt;
  renderer.render(scene, cam.camera);
  requestAnimationFrame(tick);
}

draftPrompt = defaultPrompt();
applyHole({});
tick();

window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "ArrowRight") applyHole({ hole: (state.hole % 18) + 1 });
  if (e.key === "ArrowLeft") applyHole({ hole: state.hole === 1 ? 18 : state.hole - 1 });
  if (e.key === "a") applyHole({ camera: "address" });
  if (e.key === "t") applyHole({ camera: "tee" });
  if (e.key === "f") applyHole({ camera: "flyover" });
  if (e.key === "g") applyHole({ camera: "green" });
  if (e.key === "c") applyHole({ camera: "overview" });
  if (e.key === "r") resetHole();
});
