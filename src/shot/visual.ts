import * as THREE from "three";
import type { Lie } from "./lie";
import type { MissEnvelope } from "./miss";
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

export function previewTint(result: ShotResult): number {
  if (result.trouble.ocean) return 0x3ec6e8;
  if (result.trouble.bunker) return 0xe8c56a;
  if (result.trouble.woods) return 0x4a9a58;
  if (result.trouble.shortSided) return 0xf08a4a;
  if (result.landLie === "green") return 0x7ed9ff;
  return 0x9ad4ff;
}

export function clearPreviewVisual(scene: THREE.Scene): void {
  removeNamed(scene, "shot-preview");
}

export function clearAimVisual(scene: THREE.Scene): void {
  removeNamed(scene, "aim-target");
}

export function upsertAimVisual(
  scene: THREE.Scene,
  from: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  heightAt: (x: number, z: number) => number,
  visible = true,
): void {
  removeNamed(scene, "aim-target");
  if (!visible) return;
  const group = new THREE.Group();
  group.name = "aim-target";

  const linePts: THREE.Vector3[] = [];
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(4, Math.round(len / 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    linePts.push(new THREE.Vector3(x, heightAt(x, z) + 0.35, z));
  }
  if (linePts.length >= 2) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(linePts),
      new THREE.LineDashedMaterial({ color: 0xf2e6c4, dashSize: 3.2, gapSize: 2.2, transparent: true, opacity: 0.7 }),
    );
    line.computeLineDistances();
    group.add(line);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 2.35, 22),
    new THREE.MeshBasicMaterial({ color: 0xf0d59a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(target.x, target.y + 0.2, target.z);
  group.add(ring);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(target.x, target.y + 0.22, target.z);
  group.add(disc);

  scene.add(group);
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

function cleanCurvePoints(pts: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    if (out.length && out[out.length - 1].distanceTo(p) < 0.35) continue;
    out.push(p);
  }
  return out;
}

function addTube(group: THREE.Group, pts: THREE.Vector3[], radius: number, color: number, opacity: number) {
  const clean = cleanCurvePoints(pts);
  if (clean.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(clean);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(24, clean.length * 2), radius, 5, false),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
  );
  group.add(tube);
}

function missTint(sample: MissEnvelope["samples"][number]): number {
  if (sample.trouble.ocean) return 0x3ec6e8;
  if (sample.trouble.bunker) return 0xe8c56a;
  if (sample.trouble.woods) return 0x4a9a58;
  return 0x8aa8c4;
}

function addMissEnvelope(group: THREE.Group, envelope: MissEnvelope, heightAt: (x: number, z: number) => number) {
  if (envelope.samples.length < 2) return;
  const order: Array<MissEnvelope["samples"][number]["kind"]> = ["short", "pull", "long", "push"];
  const byKind = new Map(envelope.samples.map((s) => [s.kind, s]));
  const diamond: THREE.Vector3[] = [];
  for (const kind of order) {
    const s = byKind.get(kind);
    if (!s) continue;
    diamond.push(new THREE.Vector3(s.x, heightAt(s.x, s.z) + 0.28, s.z));
  }
  if (diamond.length >= 3) {
    const loop = diamond.concat(diamond[0]);
    const danger = !envelope.safe;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(loop),
      new THREE.LineBasicMaterial({
        color: envelope.hazard.ocean ? 0x3ec6e8 : envelope.hazard.bunker ? 0xe8c56a : 0x9ab4cc,
        transparent: true,
        opacity: danger ? 0.55 : 0.28,
      }),
    );
    group.add(line);
  }

  for (const sample of envelope.samples) {
    const tint = missTint(sample);
    const danger = sample.trouble.ocean || sample.trouble.bunker || sample.trouble.woods;
    const land = new THREE.Vector3(sample.x, heightAt(sample.x, sample.z) + 0.2, sample.z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(danger ? 1.05 : 0.7, danger ? 1.85 : 1.2, 16),
      new THREE.MeshBasicMaterial({ color: tint, side: THREE.DoubleSide, transparent: true, opacity: danger ? 0.7 : 0.4 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(land);
    group.add(ring);
  }
}

export function showPreviewVisual(
  scene: THREE.Scene,
  result: ShotResult,
  envelope?: MissEnvelope | null,
  heightAt?: (x: number, z: number) => number,
): void {
  removeNamed(scene, "shot-preview");
  if (result.points.length < 2) return;
  const group = new THREE.Group();
  group.name = "shot-preview";
  const tint = previewTint(result);
  const carryPts = result.points.filter((p) => p.phase === "carry").map((p) => p.position.clone());
  const rollPts = result.points.filter((p) => p.phase === "roll").map((p) => p.position.clone());
  if (carryPts.length >= 2) addTube(group, carryPts, 0.3, tint, result.trouble.ocean || result.trouble.bunker ? 0.72 : 0.48);
  if (carryPts.length === 1 && rollPts.length) rollPts.unshift(carryPts[0]);
  if (rollPts.length >= 2) addTube(group, rollPts, 0.18, tint, 0.32);
  if (carryPts.length < 2 && rollPts.length < 2) {
    addTube(
      group,
      result.points.map((p) => p.position.clone()),
      0.26,
      tint,
      0.45,
    );
  }

  const land = result.points[result.points.length - 1].position.clone();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(result.trouble.ocean || result.trouble.bunker ? 1.4 : 1.0, result.trouble.ocean ? 3.1 : 2.05, 22),
    new THREE.MeshBasicMaterial({ color: tint, side: THREE.DoubleSide, transparent: true, opacity: 0.82 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(land);
  ring.position.y += 0.22;
  group.add(ring);

  if (result.rollYards > 3 && !result.trouble.ocean) {
    const carry = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 1.05, 18),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }),
    );
    carry.rotation.x = -Math.PI / 2;
    carry.position.set(result.carryEnd.x, land.y, result.carryEnd.z);
    carry.position.y += 0.18;
    group.add(carry);
  }

  if (result.trouble.ocean) {
    const splash = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 22),
      new THREE.MeshBasicMaterial({ color: 0x5ad4f0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    splash.rotation.x = -Math.PI / 2;
    splash.position.set(land.x, 0.4, land.z);
    group.add(splash);
  }

  if (envelope && heightAt) addMissEnvelope(group, envelope, heightAt);

  scene.add(group);
}

export function playShotVisual(scene: THREE.Scene, result: ShotResult, duration = 3.4): ShotVisual {
  const group = new THREE.Group();
  group.name = "shot-visual";

  const trailPts = cleanCurvePoints(result.points.map((p) => p.position.clone()));
  if (trailPts.length < 2) {
    return { group, update: () => true, trailPoints: trailPts };
  }
  const curve = new THREE.CatmullRomCurve3(trailPts);
  const tint = previewTint(result);
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
  const holed = result.leftoverLabel === "Holed" || result.remainingYards <= 0;
  const ringTint = holed ? 0xf0d59a : tint;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(holed ? 1.6 : 1.2, holed ? 3.2 : 2.4, 24),
    new THREE.MeshBasicMaterial({ color: ringTint, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(land);
  ring.position.y += 0.25;
  ring.visible = false;
  group.add(ring);

  const bloom = new THREE.Mesh(
    new THREE.RingGeometry(2.1, 2.45, 24),
    new THREE.MeshBasicMaterial({ color: ringTint, side: THREE.DoubleSide, transparent: true, opacity: 0 }),
  );
  bloom.rotation.x = -Math.PI / 2;
  bloom.position.copy(land);
  bloom.position.y += 0.22;
  bloom.visible = false;
  group.add(bloom);

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
    if (u >= 0.98) {
      ring.visible = true;
      bloom.visible = true;
      const age = Math.min(1, (u - 0.98) / 0.02);
      const pulse = 1 + age * (holed ? 1.35 : 0.55);
      bloom.scale.set(pulse, pulse, pulse);
      if (bloom.material instanceof THREE.MeshBasicMaterial) bloom.material.opacity = 0.42 * (1 - age);
    }
    if (tube.material instanceof THREE.MeshBasicMaterial) tube.material.opacity = 0.35 + (1 - u) * 0.5;
    return u >= 1;
  };

  ball.position.copy(trailPts[0]);
  return { group, update, trailPoints: trailPts };
}
