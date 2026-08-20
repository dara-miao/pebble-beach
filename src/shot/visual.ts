import * as THREE from "three";
import type { ShotResult } from "./simulate";

export interface ShotVisual {
  group: THREE.Group;
  update: (dt: number) => boolean;
  trailPoints: THREE.Vector3[];
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

  // Remove previous shot visuals.
  const old = scene.getObjectByName("shot-visual");
  if (old) old.parent?.remove(old);

  scene.add(group);

  let t = 0;
  const update = (dt: number) => {
    t += dt / duration;
    const u = Math.min(1, t);
    const eased = 1 - Math.pow(1 - u, 1.6);
    const pos = curve.getPoint(eased);
    ball.position.copy(pos);
    if (u >= 0.98) ring.visible = true;
    tube.material instanceof THREE.MeshBasicMaterial && (tube.material.opacity = 0.35 + (1 - u) * 0.5);
    return u >= 1;
  };

  ball.position.copy(trailPts[0]);
  return { group, update, trailPoints: trailPts };
}
