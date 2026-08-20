import * as THREE from "three";
import type { CourseData } from "../course/types";
import { buildCoverIndex, coverColor, heightAt, type Cover } from "./cover";

export interface TerrainWorld {
  mesh: THREE.Mesh;
  heightAt: (x: number, z: number) => number;
  coverAt: (x: number, z: number) => Cover;
  coverIndex: ReturnType<typeof buildCoverIndex>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const MIN_X = -280;
const MAX_X = 2140;
const MIN_Z = -420;
const MAX_Z = 1580;
const SEG_X = 300;
const SEG_Z = 240;

export function createTerrain(course: CourseData): TerrainWorld {
  const coverIndex = buildCoverIndex(course);
  const width = MAX_X - MIN_X;
  const depth = MAX_Z - MIN_Z;
  const geo = new THREE.PlaneGeometry(width, depth, SEG_X, SEG_Z);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (MIN_X + MAX_X) / 2;
    const z = pos.getZ(i) + (MIN_Z + MAX_Z) / 2;
    const sample = heightAt(course, coverIndex, x, z);
    pos.setXYZ(i, x, sample.y, z);
    const [r, g, b] = shadeCover(sample.cover, x, z, sample.y);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.04,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "terrain";

  return {
    mesh,
    heightAt: (x, z) => heightAt(course, coverIndex, x, z).y,
    coverAt: (x, z) => heightAt(course, coverIndex, x, z).cover,
    coverIndex,
    bounds: { minX: MIN_X, maxX: MAX_X, minZ: MIN_Z, maxZ: MAX_Z },
  };
}

function shadeCover(cover: Cover, x: number, z: number, y: number): [number, number, number] {
  const [r, g, b] = coverColor(cover);
  const n =
    (Math.sin(x * 0.21) * Math.cos(z * 0.17) +
      Math.sin((x + z) * 0.07) * 0.6 +
      Math.cos(x * 0.04 - z * 0.03) * 0.4) *
    0.5;
  let vary = 1 + n * 0.1;
  if (cover === "fairway") vary += 0.04;
  if (cover === "green") vary += 0.06;
  if (cover === "rock" || (cover === "rough" && y < 9)) {
    vary *= 0.82 + Math.max(0, Math.min(1, (y - 2) / 10)) * 0.15;
  }
  if (cover === "ocean") vary *= 0.9;
  return [
    Math.min(1, r * vary),
    Math.min(1, g * vary),
    Math.min(1, b * vary),
  ];
}
