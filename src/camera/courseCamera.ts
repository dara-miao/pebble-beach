import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CameraMode, HoleData } from "../course/types";

export interface CourseCamera {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  setMode: (
    mode: CameraMode,
    hole: HoleData,
    heightAt: (x: number, z: number) => number,
    fromBall?: [number, number],
    lookAt?: [number, number],
  ) => void;
  update: (dt: number) => void;
  followShot: (points: THREE.Vector3[], duration?: number) => void;
}

interface Flight {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
}

interface PathFlight {
  positions: THREE.Vector3[];
  targets: THREE.Vector3[];
  t: number;
  duration: number;
}

function easeInOut(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function samplePolyline(pts: THREE.Vector3[], u: number): THREE.Vector3 {
  if (pts.length === 1) return pts[0].clone();
  const clamped = Math.max(0, Math.min(1, u));
  const f = clamped * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const local = f - i;
  return pts[i].clone().lerp(pts[i + 1], local);
}

export function createCourseCamera(canvas: HTMLCanvasElement): CourseCamera {
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 9000);
  camera.position.set(200, 380, -120);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 6;
  controls.maxDistance = 2200;
  controls.target.set(900, 8, 700);
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.85;
  controls.panSpeed = 0.65;
  controls.screenSpacePanning = true;
  controls.enablePan = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  // Capture the pointer so releasing over the HUD never leaves a stuck drag.
  const activePointers = new Set<number>();
  canvas.addEventListener("pointerdown", (event) => {
    if (!controls.enabled) return;
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    activePointers.add(event.pointerId);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });
  const release = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  window.addEventListener("blur", () => {
    for (const id of [...activePointers]) {
      activePointers.delete(id);
      if (canvas.hasPointerCapture?.(id)) {
        try {
          canvas.releasePointerCapture(id);
        } catch {
          /* ignore */
        }
      }
    }
  });

  let flight: Flight | null = null;
  let pathFlight: PathFlight | null = null;

  const setMode = (
    mode: CameraMode,
    hole: HoleData,
    heightAt: (x: number, z: number) => number,
    fromBall?: [number, number],
    lookAt?: [number, number],
  ) => {
    pathFlight = null;
    const stance = fromBall ?? hole.tee;
    const focus = lookAt ?? hole.pin;
    const green = hole.greenCenter;
    const stanceY = heightAt(stance[0], stance[1]);
    const greenY = heightAt(green[0], green[1]);
    const focusY = heightAt(focus[0], focus[1]);
    const dx = focus[0] - stance[0];
    const dz = focus[1] - stance[1];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const lx = -uz;
    const lz = ux;

    if (mode === "flyover") {
      const path = hole.path.length >= 2 ? hole.path : [hole.tee, green];
      const positions: THREE.Vector3[] = [];
      const targets: THREE.Vector3[] = [];
      const steps = Math.max(10, Math.round(len / 28));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const idx = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
        const local = t * (path.length - 1) - idx;
        const ax = path[idx][0];
        const az = path[idx][1];
        const bx = path[Math.min(path.length - 1, idx + 1)][0];
        const bz = path[Math.min(path.length - 1, idx + 1)][1];
        const px = ax + (bx - ax) * local;
        const pz = az + (bz - az) * local;
        const py = heightAt(px, pz);
        const height = 28 + Math.sin(t * Math.PI) * 42;
        const side = 22 + (1 - t) * 18;
        positions.push(new THREE.Vector3(px + lx * side - ux * 12, py + height, pz + lz * side - uz * 12));
        const lookAhead = Math.min(1, t + 0.12);
        const li = Math.min(path.length - 2, Math.floor(lookAhead * (path.length - 1)));
        const ll = lookAhead * (path.length - 1) - li;
        const tx = path[li][0] + (path[Math.min(path.length - 1, li + 1)][0] - path[li][0]) * ll;
        const tz = path[li][1] + (path[Math.min(path.length - 1, li + 1)][1] - path[li][1]) * ll;
        targets.push(new THREE.Vector3(tx, heightAt(tx, tz) + 3, tz));
      }
      positions.unshift(camera.position.clone());
      targets.unshift(controls.target.clone());
      pathFlight = {
        positions,
        targets,
        t: 0,
        duration: Math.max(4.5, Math.min(9, len / 70)),
      };
      controls.enabled = false;
      return;
    }

    controls.enabled = true;
    const toPos = new THREE.Vector3();
    const toTarget = new THREE.Vector3();

    if (mode === "address") {
      const back = len < 22 ? 7 : len < 80 ? 9 : len < 200 ? 11 : 14;
      const height = len < 22 ? 2.8 : len < 80 ? 3.6 : 4.8;
      const look = Math.min(len, len < 28 ? len : Math.max(28, Math.min(90, len * 0.55)));
      toPos.set(stance[0] - ux * back, stanceY + height, stance[1] - uz * back);
      toTarget.set(stance[0] + ux * look, focusY + 1.2, stance[1] + uz * look);
    } else if (mode === "tee") {
      toPos.set(stance[0] - ux * 32, stanceY + 11, stance[1] - uz * 32);
      toTarget.set(green[0], greenY + 3, green[1]);
    } else if (mode === "green") {
      toPos.set(green[0] + lx * 34 - ux * 10, greenY + 16, green[1] + lz * 34 - uz * 10);
      toTarget.set(green[0], greenY + 1, green[1]);
    } else {
      toPos.set(720, 920, -180);
      toTarget.set(980, 4, 720);
    }

    flight = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      t: 0,
      duration: mode === "overview" ? 2.2 : 1.35,
    };
  };

  const followShot = (points: THREE.Vector3[], duration = 3.2) => {
    if (points.length < 2) return;
    flight = null;
    const positions: THREE.Vector3[] = [];
    const targets: THREE.Vector3[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const fx = next.x - prev.x;
      const fz = next.z - prev.z;
      const fl = Math.hypot(fx, fz) || 1;
      const lx = -fz / fl;
      const lz = fx / fl;
      positions.push(new THREE.Vector3(p.x + lx * 18 - (fx / fl) * 12, p.y + 14, p.z + lz * 18 - (fz / fl) * 12));
      targets.push(p.clone());
    }
    pathFlight = { positions, targets, t: 0, duration };
    controls.enabled = false;
  };

  const update = (dt: number) => {
    if (pathFlight) {
      pathFlight.t += dt / pathFlight.duration;
      const u = easeInOut(Math.min(1, pathFlight.t));
      camera.position.copy(samplePolyline(pathFlight.positions, u));
      controls.target.copy(samplePolyline(pathFlight.targets, u));
      if (pathFlight.t >= 1) {
        pathFlight = null;
        controls.enabled = true;
      }
    } else if (flight) {
      flight.t += dt / flight.duration;
      const u = easeInOut(Math.min(1, flight.t));
      camera.position.lerpVectors(flight.fromPos, flight.toPos, u);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, u);
      if (flight.t >= 1) flight = null;
    }
    controls.update();
  };

  return { camera, controls, setMode, update, followShot };
}
