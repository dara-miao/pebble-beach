import "./style.css";
import * as THREE from "three";
import type { HoleData } from "./course/types";
import { defaultFairwayTarget } from "./course/geom";
import { loadCourse } from "./course/load";
import { createTerrain } from "./scene/terrain";
import { createOcean, createSky, sunFromTime } from "./scene/atmosphere";
import { addCourseFeatures, addYardageMarkers } from "./scene/features";
import { addTrees } from "./scene/trees";
import { createCourseCamera } from "./camera/courseCamera";
import { renderHud, updateShotPanel } from "./ui/hud";
import { resolveOrigin } from "./shot/play";
import { createPlaySession } from "./shot/session";
import { clearAimVisual, clearPreviewVisual, playShotVisual, showPreviewVisual, upsertAimVisual, upsertLieMarker, type ShotVisual } from "./shot/visual";

const course = loadCourse();

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

const session = createPlaySession(course, terrain.coverAt, terrain.heightAt);

function setAimFromGround(point: { x: number; z: number }, live: boolean) {
  const aimed = session.setAimFromGround(point);
  if (!aimed) return;
  const { origin } = resolveOrigin(session.play, session.holeData, terrain.coverAt);
  placeAimMarker(origin);
  if (session.state.camera === "address") setCamera();
  if (live) {
    const input = hudEl.querySelector<HTMLInputElement>("input[name=prompt]");
    if (input && document.activeElement !== input) input.value = session.draftPrompt;
    if (session.lastSim) showPreviewVisual(scene, session.lastSim.result, session.lastSim.envelope, terrain.heightAt);
    updateShotPanel(hudEl, session.playView(), session.holeData, session.shotInfo);
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY };
  const hit = pickGround(event.clientX, event.clientY);
  if (hit && session.aimTarget && Math.hypot(hit.x - session.aimTarget.x, hit.z - session.aimTarget.z) < 12) {
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
let previewTimer = 0;

function lookAtPoint(): [number, number] {
  if (session.aimTarget) return [session.aimTarget.x, session.aimTarget.z];
  const hole = session.holeData;
  const { origin } = resolveOrigin(session.play, hole, terrain.coverAt);
  const target = defaultFairwayTarget(hole, origin);
  return [target.x, target.z];
}

function setCamera(mode = session.state.camera) {
  cam.setMode(mode, session.holeData, terrain.heightAt, ballSample(), lookAtPoint());
}

function ballSample(): [number, number] {
  const { origin } = resolveOrigin(session.play, session.holeData, terrain.coverAt);
  return [origin.x, origin.z];
}

function placeLieMarker(visible = true) {
  const hole = session.holeData;
  const { origin } = resolveOrigin(session.play, hole, terrain.coverAt);
  const y = terrain.heightAt(origin.x, origin.z);
  upsertLieMarker(scene, origin.x, y, origin.z, origin.lie, visible);
  placeAimMarker(origin);
}

function placeAimMarker(origin?: { x: number; z: number }) {
  if (!session.aimTarget) {
    clearAimVisual(scene);
    return;
  }
  const from = origin ?? resolveOrigin(session.play, session.holeData, terrain.coverAt).origin;
  upsertAimVisual(
    scene,
    { x: from.x, y: terrain.heightAt(from.x, from.z), z: from.z },
    { x: session.aimTarget.x, y: terrain.heightAt(session.aimTarget.x, session.aimTarget.z), z: session.aimTarget.z },
    terrain.heightAt,
    true,
  );
}

function refreshHud() {
  renderHud(
    hudEl,
    course,
    session.holeData,
    session.state,
    session.playView(),
    { onChange: applyHole, onShot: fireShot, onPreview: queuePreview, onReset: resetHole, onWind: applyWind, onNewRound: newRound },
    session.shotInfo,
    session.draftPrompt,
  );
}

function clearShotVisuals() {
  clearPreviewVisual(scene);
  clearAimVisual(scene);
  const old = scene.getObjectByName("shot-visual");
  old?.parent?.remove(old);
}

function resetHole() {
  session.resetHole();
  clearShotVisuals();
  placeLieMarker(true);
  setCamera();
  refreshHud();
}

function newRound() {
  session.newRound();
  clearShotVisuals();
  const hole = session.holeData;
  markers.removeFromParent();
  markers = addYardageMarkers(scene, hole, terrain.heightAt);
  placeLieMarker(true);
  setCamera();
  fitShadow(hole);
  refreshHud();
}

function applyWind(next: Parameters<typeof session.applyWind>[0]) {
  session.applyWind(next);
  refreshHud();
  if (session.lastSim) showPreviewVisual(scene, session.lastSim.result, session.lastSim.envelope, terrain.heightAt);
  else clearPreviewVisual(scene);
}

function applyHole(next: Parameters<typeof session.applyChange>[0]) {
  const change = session.applyChange(next);
  const cameraOnly = change.cameraChanged && !change.holeChanged && !change.teeChanged && next.hole == null && next.tee == null;
  if (change.holeChanged || change.teeChanged) clearShotVisuals();
  const hole = session.holeData;
  if (!cameraOnly) {
    markers.removeFromParent();
    markers = addYardageMarkers(scene, hole, terrain.heightAt);
    placeLieMarker(true);
    fitShadow(hole);
  }
  setCamera();
  refreshHud();
  if ((change.holeChanged || change.teeChanged) && session.lastSim) {
    showPreviewVisual(scene, session.lastSim.result, session.lastSim.envelope, terrain.heightAt);
  }
}

function queuePreview(prompt: string) {
  session.draftPrompt = prompt;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => previewShot(prompt), 160);
}

function previewShot(prompt: string) {
  session.previewShot(prompt);
  if (!prompt.trim() || !session.lastSim) {
    clearPreviewVisual(scene);
    updateShotPanel(hudEl, session.playView(), session.holeData, session.shotInfo);
    return;
  }
  showPreviewVisual(scene, session.lastSim.result, session.lastSim.envelope, terrain.heightAt);
  updateShotPanel(hudEl, session.playView(), session.holeData, session.shotInfo);
}

function fireShot(prompt: string) {
  const sim = session.fireShot(prompt);
  if (!sim) return;
  placeLieMarker(false);
  activeShot = playShotVisual(scene, sim.result, Math.max(2.6, Math.min(4.2, sim.result.totalYards / 80)));
  cam.followShot(
    sim.result.points.map((p) => p.position),
    Math.max(2.8, Math.min(4.5, sim.result.totalYards / 75)),
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
      if (session.state.camera === "address" || session.state.camera === "tee") setCamera();
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
  if (e.key === "ArrowRight") applyHole({ hole: (session.state.hole % 18) + 1 });
  if (e.key === "ArrowLeft") applyHole({ hole: session.state.hole === 1 ? 18 : session.state.hole - 1 });
  if (e.key === "a") applyHole({ camera: "address" });
  if (e.key === "t") applyHole({ camera: "tee" });
  if (e.key === "f") applyHole({ camera: "flyover" });
  if (e.key === "g") applyHole({ camera: "green" });
  if (e.key === "c") applyHole({ camera: "overview" });
  if (e.key === "r") resetHole();
});
