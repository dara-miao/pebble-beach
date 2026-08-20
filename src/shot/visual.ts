import * as THREE from "three";
import type { Lie } from "./lie";
import type { ShotResult } from "./simulate";

export interface ShotVisual {
  group: THREE.Group;
  update: (dt: number) => boolean;
  trailPoints: THREE.Vector3[];
}

const LIE_RING: Record<Lie, number> = {
  tee: 0xf6f0e4,
  fairway: 0x7ed37a,
  rough: 0x9bb86a,
  woods: 0x3d7a4a,
  bunker: 0xe2c27f,
  sand: 0xe2c27f,
  green: 0x62c46a,
  ocean: 0x4aa3c8,
  rock: 0xb0a898,
  path: 0xc4b49a,
};

function removeNamed(scene: THREE.Scene, name: string) {
  const old = scene.getObjectByName(name);
  old?.parent?.remove(old);
}

export function clearPreviewVisual(scene: THREE.Scene): void {
  removeNamed(scene, "shot-preview");
}

export function upsertLieMarker(scene: THREE.Scene, x: number, y: number, z: number, lie: Lie, visible = true): void {
  let group = scene.getObjectByName("lie-marker") as THREE.Group | undefined;
  if (!group) {
    group = new THREE.Group();
    group.name = "lie-marker";
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }),
    );
    ball.name = "lie-ball";
    ball.castShadow = true;
    ball.position.y = 0.45;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.95, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, side: THREE.DoubleSide, transparent: true, opacity: 0.88 }),
    );
    ring.name = "lie-ring";
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ball, ring);
    scene.add(group);
  }
  group.position.set(x, y, z);
  group.visible = visible;
  const ring = group.getObjectByName("lie-ring") as THREE.Mesh | undefined;
  if (ring?.material instanceof THREE.MeshBasicMaterial) {
    ring.material.color.setHex(LIE_RING[lie] ?? 0xffe08a);
  }
}

export function showPreviewVisual(scene: THREE.Scene, result: ShotResult): void {
  removeNamed(scene, "shot-preview");
  if (result.points.length < 2) return;
  const group = new THREE.Group();
  group.name = "shot-preview";
  const pts = result.points.map((p) => p.position.clone());
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(24, pts.length * 2), 0.26, 5, false),
    new THREE.MeshBasicMaterial({ color: 0x9ad4ff, transparent: true, opacity: 0.42 }),
  );
  group.add(tube);
  const land = pts[pts.length - 1];
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.85, 22),
    new THREE.MeshBasicMaterial({ color: 0x9ad4ff, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(land);
  ring.position.y += 0.22;
  group.add(ring);
  scene.add(group);
}

export function playShotVisual(scene: THREE.Scene, result: ShotResult, duration = 3.4): ShotVisual {
  const group = new THREE.Group();
  group.name = "shot-visual";

  const trailPts = result.points.map((p) => p.position.clone());
  const curve = new THREE.CatmullRomCurve3(trailPts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(32, trailPts.length * 2), 0.35, 6, false),
    new THREE.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.85 }),
  );
  group.add(tube);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }),
  );
  ball.castShadow = true;
  group.add(ball);

  const land = trailPts[trailPts.length - 1];
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 2.4, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(land);
  ring.position.y += 0.25;
  ring.visible = false;
  group.add(ring);

  removeNamed(scene, "shot-visual");
  removeNamed(scene, "shot-preview");
  scene.add(group);

  const marker = scene.getObjectByName("lie-marker");
  if (marker) marker.visible = false;

  let t = 0;
  const update = (dt: number) => {
    t += dt / duration;
    const u = Math.min(1, t);
    const eased = 1 - Math.pow(1 - u, 1.6);
    const pos = curve.getPoint(eased);
    ball.position.copy(pos);
    if (u >= 0.98) ring.visible = true;
    if (tube.material instanceof THREE.MeshBasicMaterial) tube.material.opacity = 0.35 + (1 - u) * 0.5;
    return u >= 1;
  };

  ball.position.copy(trailPts[0]);
  return { group, update, trailPoints: trailPts };
}
