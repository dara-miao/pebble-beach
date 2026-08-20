import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { Sky } from "three/addons/objects/Sky.js";

export function createOcean(sunPosition: THREE.Vector3): Water {
  const geo = new THREE.PlaneGeometry(9000, 9000);
  const water = new Water(geo, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load("/textures/waternormals.jpg", (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    }),
    sunDirection: sunPosition.clone().normalize(),
    sunColor: 0xffe2b0,
    waterColor: 0x155a78,
    distortionScale: 3.2,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.2;
  water.name = "pacific";
  return water;
}

export function createSky(sunPosition: THREE.Vector3): Sky {
  const sky = new Sky();
  sky.scale.setScalar(9000);
  const uniforms = sky.material.uniforms;
  uniforms["turbidity"].value = 6.5;
  uniforms["rayleigh"].value = 2.1;
  uniforms["mieCoefficient"].value = 0.006;
  uniforms["mieDirectionalG"].value = 0.86;
  uniforms["sunPosition"].value.copy(sunPosition);
  return sky;
}

export function sunFromTime(hour: number): THREE.Vector3 {
  // Late-afternoon golden light over Carmel Bay.
  const t = (hour - 6) / 12;
  const elevation = Math.sin(Math.max(0.05, Math.min(0.95, t)) * Math.PI) * 0.62;
  const azimuth = Math.PI * 0.78 + (hour - 12) * 0.16;
  const phi = Math.PI / 2 - elevation;
  return new THREE.Vector3().setFromSphericalCoords(1, phi, azimuth);
}
