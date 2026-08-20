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
import { describeShot, parseShotPrompt } from "./shot/parse";
import { simulateShot } from "./shot/simulate";
import { applyShotResult, createHolePlay, leftoverCopy, lieCopy, resolveOrigin, type HolePlay } from "./shot/play";
import { lieLabel } from "./shot/lie";
import { clearPreviewVisual, playShotVisual, showPreviewVisual, upsertLieMarker, type ShotVisual } from "./shot/visual";

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

const cam = createCourseCamera(canvas);
let markers = new THREE.Group();
let activeShot: ShotVisual | null = null;
let shotInfo: ShotHudInfo | undefined;
let draftPrompt = "";
let previewTimer = 0;

const state: HudState = { hole: 7, tee: "blue", camera: "tee" };
let play = createPlay();

function activeHole(): HoleData {
  return holeByNumber(course, state.hole);
}

function createPlay(): HolePlay {
  return createHolePlay(activeHole(), state.tee, terrain.coverAt);
}

function playView(): PlayHudView {
  return {
    strokes: play.strokes,
    penalties: play.penalties,
    lie: play.ball.lie,
    lieLabel: lieCopy(play),
    remainingYards: play.ball.remainingYards,
    pinYards: play.ball.pinYards,
    holed: play.ball.holed,
    onTee: play.strokes === 0 && play.ball.lie === "tee",
    ball: [play.ball.x, play.ball.z],
  };
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
  draftPrompt = "";
  clearPreviewVisual(scene);
  const old = scene.getObjectByName("shot-visual");
  old?.parent?.remove(old);
  placeLieMarker(true);
  cam.setMode(state.camera, activeHole(), terrain.heightAt, ballSample());
  refreshHud();
}

function applyHole(next: Partial<HudState>) {
  const holeChanged = next.hole != null && next.hole !== state.hole;
  const teeChanged = next.tee != null && next.tee !== state.tee;
  Object.assign(state, next);
  if (holeChanged || teeChanged) {
    play = createPlay();
    shotInfo = undefined;
    draftPrompt = "";
    clearPreviewVisual(scene);
    const old = scene.getObjectByName("shot-visual");
    old?.parent?.remove(old);
  }
  const hole = activeHole();
  markers.removeFromParent();
  markers = addYardageMarkers(scene, hole, terrain.heightAt);
  placeLieMarker(true);
  cam.setMode(state.camera, hole, terrain.heightAt, ballSample());
  fitShadow(hole);
  refreshHud();
}

function simulateFromPrompt(prompt: string) {
  const hole = activeHole();
  const req = parseShotPrompt(prompt);
  const { origin, dropped } = resolveOrigin(play, hole, terrain.coverAt);
  const result = simulateShot(hole, req, terrain.heightAt, terrain.coverAt, origin, dropped);
  const info: ShotHudInfo = {
    summary: describeShot(req, lieLabel(origin.lie).toLowerCase()),
    outcome: result.outcome,
    carry: result.carryYards,
    total: result.totalYards,
    peak: result.peakYards,
    leftover: Math.round(result.remainingYards),
    landLie: lieLabel(result.landLie),
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
    landLie: lieLabel(last.landLie),
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
    }
  }
  const waterUniforms = (ocean.material as THREE.ShaderMaterial).uniforms;
  if (waterUniforms?.["time"]) waterUniforms["time"].value += dt;
  renderer.render(scene, cam.camera);
  requestAnimationFrame(tick);
}

applyHole({});
tick();

window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "ArrowRight") applyHole({ hole: (state.hole % 18) + 1 });
  if (e.key === "ArrowLeft") applyHole({ hole: state.hole === 1 ? 18 : state.hole - 1 });
  if (e.key === "t") applyHole({ camera: "tee" });
  if (e.key === "f") applyHole({ camera: "flyover" });
  if (e.key === "g") applyHole({ camera: "green" });
  if (e.key === "c") applyHole({ camera: "overview" });
  if (e.key === "r") resetHole();
});
