import * as THREE from "three";
import type { CourseData, HoleData, Vec2 } from "../course/types";
import { dist, fairwayDirection, greenPolygon, pointInPoly, pointOnPath, polyBBox } from "../course/geom";

/** Overlay height that never drops into the ocean — that yank is what spiked 17. */
function landHeight(heightAt: (x: number, z: number) => number, x: number, z: number, fallback: number): number {
  const y = heightAt(x, z);
  return Number.isFinite(y) && y >= 0.4 ? y : fallback;
}

function polyFallbackHeight(poly: Vec2[], heightAt: (x: number, z: number) => number): number {
  const ys: number[] = [];
  for (const [x, z] of poly) {
    const y = heightAt(x, z);
    if (Number.isFinite(y) && y >= 0.4) ys.push(y);
  }
  if (!ys.length) return 2;
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length / 2)];
}

/**
 * Drape a filled polygon onto the terrain with short edges.
 * Earcut on a coastal horseshoe (hole 17 bunkers) spans the green and
 * stretches triangles from inland height down to the ocean.
 */
function drapedPolyGeometry(
  poly: Vec2[],
  heightAt: (x: number, z: number) => number,
  lift: number,
  step = 3.2,
): THREE.BufferGeometry | null {
  if (poly.length < 3) return null;
  const fallback = polyFallbackHeight(poly, heightAt);
  const box = polyBBox(poly);
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  if (width < 0.8 || depth < 0.8) return null;

  const cols = Math.max(2, Math.ceil(width / step) + 1);
  const rows = Math.max(2, Math.ceil(depth / step) + 1);
  const xs = Array.from({ length: cols }, (_, i) => box.minX + (width * i) / (cols - 1));
  const zs = Array.from({ length: rows }, (_, i) => box.minZ + (depth * i) / (rows - 1));

  const idxOf = (c: number, r: number) => r * cols + c;
  const inside: boolean[] = new Array(cols * rows);
  const positions = new Float32Array(cols * rows * 3);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = xs[c];
      const z = zs[r];
      const on = pointInPoly(x, z, poly);
      inside[idxOf(c, r)] = on;
      const i = idxOf(c, r) * 3;
      positions[i] = x;
      positions[i + 1] = landHeight(heightAt, x, z, fallback) + lift;
      positions[i + 2] = z;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = idxOf(c, r);
      const b = idxOf(c + 1, r);
      const d = idxOf(c, r + 1);
      const e = idxOf(c + 1, r + 1);
      const count = (inside[a] ? 1 : 0) + (inside[b] ? 1 : 0) + (inside[d] ? 1 : 0) + (inside[e] ? 1 : 0);
      if (count < 3) continue;
      if (inside[a] && inside[b] && inside[e]) indices.push(a, b, e);
      if (inside[a] && inside[e] && inside[d]) indices.push(a, e, d);
      if (count === 3 && !(inside[a] && inside[b] && inside[e]) && !(inside[a] && inside[e] && inside[d])) {
        const cell = [a, b, e, d].filter((i) => inside[i]);
        if (cell.length === 3) indices.push(cell[0], cell[1], cell[2]);
      }
    }
  }
  if (indices.length < 3) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function overlayMat(color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function addCourseFeatures(
  scene: THREE.Scene,
  course: CourseData,
  heightAt: (x: number, z: number) => number,
): void {
  const bunkerMat = overlayMat(0xd4b37a, 1);
  const greenMat = overlayMat(0x4aa34a, 0.72);
  const teeMat = overlayMat(0x4a9a48, 0.78);
  const teeEdgeMat = new THREE.MeshStandardMaterial({
    color: 0x2f6d32,
    roughness: 0.9,
    metalness: 0,
  });
  const markerMats = [
    new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0x3d6fb5, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0xc79a3c, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.45 }),
  ];
  const pathMat = new THREE.MeshStandardMaterial({
    color: 0x8a7b68,
    roughness: 0.95,
    metalness: 0,
  });

  const bunkers = [...course.unassignedBunkers];
  for (const hole of course.holes) bunkers.push(...hole.bunkers);

  for (const b of bunkers) {
    if (b.polygon.length < 4) continue;
    const geo = drapedPolyGeometry(b.polygon, heightAt, 0.08, 2.8);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, bunkerMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const hole of course.holes) {
    const gpoly = greenPolygon(hole);
    const geo = drapedPolyGeometry(gpoly, heightAt, 0.12, 2.6);
    if (geo) {
      const mesh = new THREE.Mesh(geo, greenMat);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    scene.add(makeFlag(hole, heightAt));
    hole.tees.forEach((t, i) => {
      if (t.polygon.length < 4) return;
      scene.add(makeTeeBox(hole, t.center, t.polygon, heightAt, teeMat, teeEdgeMat, markerMats[i % markerMats.length]));
    });
  }

  for (const path of course.cartpaths) {
    if (path.length < 2) continue;
    const ribbon = makeRibbon(path, 1.6, pathMat, heightAt, 0.06);
    if (ribbon) scene.add(ribbon);
  }

  scene.add(makeLodge(course, heightAt));
}

function makeTeeBox(
  hole: HoleData,
  center: Vec2,
  polygon: Vec2[],
  heightAt: (x: number, z: number) => number,
  surface: THREE.Material,
  edge: THREE.Material,
  marker: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const forward = fairwayDirection(hole, { x: center[0], z: center[1] });
  const yaw = Math.atan2(forward[0], forward[1]);
  const y = heightAt(center[0], center[1]);

  const topGeo = drapedPolyGeometry(polygon, heightAt, 0.18, 2.2);
  if (topGeo) {
    const top = new THREE.Mesh(topGeo, surface);
    top.receiveShadow = true;
    group.add(top);
  }

  // Raised pad so it reads as a real tee box, not a flat patch.
  const pad = new THREE.Mesh(new THREE.BoxGeometry(13, 0.35, 8), edge);
  pad.position.set(center[0], y + 0.12, center[1]);
  pad.rotation.y = yaw;
  pad.receiveShadow = true;
  pad.castShadow = true;
  group.add(pad);

  // Front tee markers (short edge facing the fairway).
  const rx = -forward[1];
  const rz = forward[0];
  const front = 3.6;
  const side = 5.2;
  for (const s of [-1, 1]) {
    const mx = center[0] + forward[0] * front + rx * side * s;
    const mz = center[1] + forward[1] * front + rz * side * s;
    const my = heightAt(mx, mz) + 0.55;
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8), marker);
    peg.position.set(mx, my, mz);
    peg.castShadow = true;
    group.add(peg);
  }

  return group;
}

function cleanCurvePoints(pts: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    if (out.length && out[out.length - 1].distanceTo(p) < 0.4) continue;
    out.push(p);
  }
  return out;
}

function makeRibbon(
  path: Vec2[],
  width: number,
  mat: THREE.Material,
  heightAt: (x: number, z: number) => number,
  lift: number,
): THREE.Mesh | null {
  const pts = cleanCurvePoints(path.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + lift, z)));
  if (pts.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), width * 0.5, 5, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function makeFlag(hole: HoleData, heightAt: (x: number, z: number) => number): THREE.Group {
  const [x, z] = hole.pin;
  const y = heightAt(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 7.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.4 }),
  );
  pole.position.y = 3.6;
  pole.castShadow = true;
  g.add(pole);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 80;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c81e1e";
  ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 42px Georgia";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(hole.number), 64, 42);
  const tex = new THREE.CanvasTexture(canvas);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2),
    new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 }),
  );
  flag.position.set(1.6, 6.2, 0);
  g.add(flag);

  const cup = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 12),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
  );
  cup.rotation.x = -Math.PI / 2;
  cup.position.y = 0.14;
  g.add(cup);
  return g;
}

function makeLodge(course: CourseData, heightAt: (x: number, z: number) => number): THREE.Group {
  const h18 = course.holes[17];
  const g = h18.greenCenter;
  const t = h18.tee;
  const dx = g[0] - t[0];
  const dz = g[1] - t[1];
  const len = Math.hypot(dx, dz) || 1;
  const x = g[0] + (dx / len) * 42;
  const z = g[1] + (dz / len) * 42;
  const y = heightAt(x, z);
  const lodge = new THREE.Group();
  lodge.position.set(x, y, z);
  lodge.rotation.y = Math.atan2(dx, dz);

  const stucco = new THREE.MeshStandardMaterial({ color: 0xf0e4d0, roughness: 0.88 });
  const tile = new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c241c, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(56, 12, 24), stucco);
  body.position.y = 6;
  body.castShadow = true;
  body.receiveShadow = true;
  lodge.add(body);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(26, 10, 30), stucco);
  wing.position.set(-20, 5, 10);
  wing.castShadow = true;
  lodge.add(wing);

  const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 18, 10), stucco);
  tower.position.set(18, 9, -2);
  tower.castShadow = true;
  lodge.add(tower);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(60, 2.2, 28), tile);
  roof.position.y = 13;
  roof.castShadow = true;
  lodge.add(roof);

  const roof2 = new THREE.Mesh(new THREE.BoxGeometry(30, 2, 34), tile);
  roof2.position.set(-20, 11, 10);
  lodge.add(roof2);

  for (let i = 0; i < 5; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.6, 0.4), dark);
    win.position.set(-18 + i * 8, 6.5, 12.2);
    lodge.add(win);
  }
  return lodge;
}

export function addYardageMarkers(
  scene: THREE.Scene,
  hole: HoleData,
  heightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "yardage-markers";
  const total = dist(hole.tee, hole.greenCenter);
  const marks = [100, 150, 200, 250].filter((y) => y < total - 30);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.5 });
  for (const yards of marks) {
    const { point } = pointOnPath(hole.path, yards);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.25, 16), mat);
    disc.position.set(point[0], heightAt(point[0], point[1]) + 0.2, point[1]);
    group.add(disc);
  }

  const aimPts = hole.path.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 1.2, z));
  const aimGeo = new THREE.BufferGeometry().setFromPoints(aimPts);
  const aim = new THREE.Line(
    aimGeo,
    new THREE.LineDashedMaterial({ color: 0xf2e6c4, dashSize: 6, gapSize: 4, transparent: true, opacity: 0.55 }),
  );
  aim.computeLineDistances();
  group.add(aim);
  scene.add(group);
  return group;
}
