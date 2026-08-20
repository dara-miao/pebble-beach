import * as THREE from "three";
import type { CourseData, Vec2 } from "../course/types";

export function addTrees(
  scene: THREE.Scene,
  course: CourseData,
  heightAt: (x: number, z: number) => number,
): void {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.48, 8.5, 6);
  const canopyGeo = new THREE.ConeGeometry(2.2, 10, 7);
  const windGeo = new THREE.SphereGeometry(3.4, 6, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x163825, roughness: 0.9 });
  const windMat = new THREE.MeshStandardMaterial({ color: 0x1f4a2e, roughness: 0.85 });

  const positions = extraTrees(course).filter((p) => heightAt(p[0], p[1]) > 2.5);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, positions.length);
  const winds = new THREE.InstancedMesh(windGeo, windMat, positions.length);
  trunks.castShadow = true;
  canopies.castShadow = true;
  winds.castShadow = true;

  const dummy = new THREE.Object3D();
  positions.forEach((p, i) => {
    const y = heightAt(p[0], p[1]);
    const lean = ((p[0] * 13 + p[1] * 7) % 17) / 17;
    const windLean = (lean - 0.5) * 0.55;

    dummy.position.set(p[0], y + 4.2, p[1]);
    dummy.rotation.set(windLean * 0.35, lean * Math.PI, windLean);
    dummy.scale.setScalar(0.75 + lean * 0.55);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p[0] + windLean * 1.2, y + 10.5, p[1]);
    dummy.scale.set(0.7 + lean * 0.25, 1.1 + lean * 0.35, 0.55);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p[0] + windLean * 2.4, y + 12.8, p[1] - 0.4);
    dummy.scale.set(0.55, 0.85, 0.9);
    dummy.updateMatrix();
    winds.setMatrixAt(i, dummy.matrix);
  });

  scene.add(trunks, canopies, winds);
}

function extraTrees(course: CourseData): Vec2[] {
  const pts: Vec2[] = [...course.trees];
  const h18 = course.holes[17];
  for (let i = 0; i < 36; i++) {
    const t = i / 35;
    pts.push([
      h18.tee[0] + (h18.greenCenter[0] - h18.tee[0]) * t + 26 + (i % 4) * 5,
      h18.tee[1] + (h18.greenCenter[1] - h18.tee[1]) * t - 6 + (i % 3) * 7,
    ]);
  }
  const h1 = course.holes[0];
  for (let i = 0; i < 20; i++) {
    const t = i / 19;
    pts.push([
      h1.tee[0] + (h1.greenCenter[0] - h1.tee[0]) * t + 24,
      h1.tee[1] + (h1.greenCenter[1] - h1.tee[1]) * t - 14,
    ]);
    pts.push([
      h1.tee[0] + (h1.greenCenter[0] - h1.tee[0]) * t - 28,
      h1.tee[1] + (h1.greenCenter[1] - h1.tee[1]) * t + 12,
    ]);
  }
  // Cypress near 7/8 headland inland side.
  const h7 = course.holes[6];
  for (let i = 0; i < 10; i++) {
    pts.push([h7.tee[0] - 35 - (i % 3) * 8, h7.tee[1] - 10 + i * 7]);
  }
  return pts;
}
