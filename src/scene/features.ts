import * as THREE from "three";
import type { CourseData, HoleData, Vec2 } from "../course/types";
import { dist, greenPolygon, pointOnPath } from "../course/geom";

function shapeFromPoly(poly: Vec2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) s.lineTo(poly[i][0], poly[i][1]);
  return s;
}

function drapeGeometry(geo: THREE.BufferGeometry, heightAt: (x: number, z: number) => number, lift: number) {
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z) + lift);
  }
  geo.computeVertexNormals();
}

export function addCourseFeatures(
  scene: THREE.Scene,
  course: CourseData,
  heightAt: (x: number, z: number) => number,
): void {
  const bunkerMat = new THREE.MeshStandardMaterial({
    color: 0xd4b37a,
    roughness: 1,
    metalness: 0,
  });
  const greenMat = new THREE.MeshStandardMaterial({
    color: 0x4aa34a,
    roughness: 0.72,
    metalness: 0,
  });
  const teeMat = new THREE.MeshStandardMaterial({
    color: 0x3f8a3c,
    roughness: 0.8,
    metalness: 0,
  });
  const pathMat = new THREE.MeshStandardMaterial({
    color: 0x8a7b68,
    roughness: 0.95,
    metalness: 0,
  });

  const bunkers = [...course.unassignedBunkers];
  for (const hole of course.holes) bunkers.push(...hole.bunkers);

  for (const b of bunkers) {
    if (b.polygon.length < 4) continue;
    const geo = new THREE.ShapeGeometry(shapeFromPoly(b.polygon), 4);
    drapeGeometry(geo, heightAt, 0.08);
    const mesh = new THREE.Mesh(geo, bunkerMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const hole of course.holes) {
    const gpoly = greenPolygon(hole);
    const geo = new THREE.ShapeGeometry(shapeFromPoly(gpoly), 6);
    drapeGeometry(geo, heightAt, 0.12);
    const mesh = new THREE.Mesh(geo, greenMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    scene.add(makeFlag(hole, heightAt));
    for (const t of hole.tees) {
      if (t.polygon.length < 4) continue;
      const tgeo = new THREE.ShapeGeometry(shapeFromPoly(t.polygon), 2);
      drapeGeometry(tgeo, heightAt, 0.1);
      const tm = new THREE.Mesh(tgeo, teeMat);
      tm.receiveShadow = true;
      scene.add(tm);
    }
  }

  for (const path of course.cartpaths) {
    if (path.length < 2) continue;
    scene.add(makeRibbon(path, 1.6, pathMat, heightAt, 0.06));
  }

  scene.add(makeLodge(course, heightAt));
}

function makeRibbon(
  path: Vec2[],
  width: number,
  mat: THREE.Material,
  heightAt: (x: number, z: number) => number,
  lift: number,
): THREE.Mesh {
  const pts = path.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + lift, z));
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, Math.max(8, path.length * 2), width * 0.5, 5, false);
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
