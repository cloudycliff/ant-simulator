import * as THREE from 'three';
import { Noise2D } from '../util/random';
import type { Nest, Chamber } from './nest';
import type { Terrain } from '../world/terrain';

const CHAMBER_TINT: Record<string, number> = {
  queen: 0x9c6a43,
  egg: 0x8f6a4a,
  larva: 0x8c6646,
  pupa: 0x977050,
  food: 0x87633f,
  waste: 0x6c5a45,
  rest: 0x7f6248,
  winter: 0x6f5a48,
};

/** 蚁穴网格：隧道和房间都用背面渲染，近侧墙自动剔除，从任意角度都能看进空腔。 */
export class NestView {
  group = new THREE.Group();
  /** 只在地表视图显示的入口洞口 */
  surfaceGroup = new THREE.Group();
  chamberMeshes: THREE.Mesh[] = [];
  private soil!: THREE.Mesh;
  private noise = new Noise2D(99);
  private tunnelMat: THREE.MeshStandardMaterial;

  constructor(private nest: Nest, private terrain: Terrain) {
    this.group.name = 'nest';
    this.tunnelMat = new THREE.MeshStandardMaterial({
      color: 0x8a6646,
      roughness: 1,
      side: THREE.BackSide,
      emissive: 0x2a1a0e,
      emissiveIntensity: 0.6,
    });
  }

  build(): void {
    for (const e of this.nest.edges) {
      const curve = new THREE.CatmullRomCurve3(e.points);
      const geo = new THREE.TubeGeometry(curve, Math.max(6, Math.round(e.length / 1.2)), e.radius * 1.08, 9, false);
      this.roughen(geo, 0.12);
      const m = new THREE.Mesh(geo, this.tunnelMat);
      m.userData.pickable = false;
      this.group.add(m);
    }
    for (const n of this.nest.nodes) {
      if (n.kind !== 'junction' && n.kind !== 'deadend') continue;
      const r = n.kind === 'junction' ? 1.75 : 1.2;
      const geo = new THREE.SphereGeometry(r, 12, 9);
      this.roughen(geo, 0.15);
      const m = new THREE.Mesh(geo, this.tunnelMat);
      m.position.copy(n.pos);
      this.group.add(m);
    }
    for (const c of this.nest.chambers) {
      const mesh = this.buildChamber(c);
      this.chamberMeshes.push(mesh);
      this.group.add(mesh);
    }
    this.buildSoil();
    this.buildEntranceHoles();
  }

  private roughen(geo: THREE.BufferGeometry, amount: number): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = this.noise.noise(x * 0.9 + z * 0.37, y * 0.9 - z * 0.21);
      pos.setXYZ(i, x + n * amount, y + n * amount, z - n * amount);
    }
    geo.computeVertexNormals();
  }

  private buildChamber(c: Chamber): THREE.Mesh {
    const geo = new THREE.SphereGeometry(1, 34, 18);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const floorK = -0.7;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(CHAMBER_TINT[c.type]);
    const dark = base.clone().multiplyScalar(0.55);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      const n = this.noise.noise(x * 2.3 + c.id * 3.1, z * 2.3 + y * 1.7);
      const bump = 1 + n * 0.16;
      x *= c.rx * bump;
      z *= c.rz * bump;
      y = Math.max(y, floorK) * c.ry;
      if (y <= floorK * c.ry + 1e-3) {
        y += n * 0.08;
        col.copy(base).lerp(dark, 0.2 + n * 0.3);
      } else {
        const h = (y - floorK * c.ry) / ((1 - floorK) * c.ry);
        col.copy(base).lerp(dark, 0.15 + h * 0.4 + n * 0.25);
      }
      pos.setXYZ(i, x, y - floorK * c.ry, z);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: THREE.BackSide,
      emissive: 0x2a1a0e,
      emissiveIntensity: 0.6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(c.floor);
    mesh.rotation.y = -c.yaw;
    mesh.userData.pick = { kind: 'chamber', id: c.id };
    mesh.name = c.name;
    return mesh;
  }

  /** 蚁穴区域外围的土壤剖面墙（四壁 + 底面），带土层分层着色 */
  private buildSoil(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    for (const c of this.nest.chambers) {
      minX = Math.min(minX, c.floor.x - c.rx);
      maxX = Math.max(maxX, c.floor.x + c.rx);
      minZ = Math.min(minZ, c.floor.z - c.rz);
      maxZ = Math.max(maxZ, c.floor.z + c.rz);
      minY = Math.min(minY, c.floor.y);
    }
    const pad = 8;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;
    const bottom = minY - 8;
    const surf = this.nest.surfaceY;

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const col = new THREE.Color();
    const strata = [
      { d: 0, c: new THREE.Color(0x3b2a1c) },
      { d: 12, c: new THREE.Color(0x5a3f28) },
      { d: 30, c: new THREE.Color(0x7a5634) },
      { d: 55, c: new THREE.Color(0x8d6b48) },
      { d: 90, c: new THREE.Color(0x8a7a62) },
    ];
    const soilColor = (x: number, y: number, z: number) => {
      const depth = surf - y + this.noise.noise(x * 0.08, z * 0.08) * 4;
      let i = 0;
      while (i < strata.length - 2 && depth > strata[i + 1].d) i++;
      const a = strata[i];
      const b = strata[i + 1];
      const t = Math.min(1, Math.max(0, (depth - a.d) / (b.d - a.d)));
      col.copy(a.c).lerp(b.c, t);
      const grain = this.noise.noise(x * 1.3 + y * 0.7, z * 1.3 - y * 0.5);
      col.multiplyScalar(0.88 + grain * 0.3);
      if (grain > 0.42) col.lerp(new THREE.Color(0x9a9286), 0.6);
      return col;
    };

    const wall = (ax: number, az: number, bx: number, bz: number) => {
      const segH = 60;
      const segV = 40;
      const start = positions.length / 3;
      for (let i = 0; i <= segH; i++) {
        const t = i / segH;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const top = this.terrain.heightAt(x, z);
        for (let j = 0; j <= segV; j++) {
          const y = top + (bottom - top) * (j / segV);
          positions.push(x, y, z);
          const c = soilColor(x, y, z);
          colors.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < segH; i++)
        for (let j = 0; j < segV; j++) {
          const a = start + i * (segV + 1) + j;
          const b = a + segV + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    };
    // 顶点顺序保证法线朝外，配合 BackSide 只显示远侧墙
    wall(minX, minZ, maxX, minZ);
    wall(maxX, minZ, maxX, maxZ);
    wall(maxX, maxZ, minX, maxZ);
    wall(minX, maxZ, minX, minZ);
    // 底面
    const start = positions.length / 3;
    const n = 30;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = minX + ((maxX - minX) * i) / n;
        const z = minZ + ((maxZ - minZ) * j) / n;
        positions.push(x, bottom, z);
        const c = soilColor(x, bottom, z);
        colors.push(c.r, c.g, c.b);
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = start + i * (n + 1) + j;
        const b = a + n + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: THREE.BackSide,
      emissive: 0x1c120a,
      emissiveIntensity: 0.8,
    });
    this.soil = new THREE.Mesh(geo, mat);
    this.soil.name = 'soil';
    this.group.add(this.soil);
  }

  private buildEntranceHoles(): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0x120a05 });
    for (const e of this.nest.entrances) {
      const geo = new THREE.CircleGeometry(1.15, 14);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(e.x, this.terrain.heightAt(e.x, e.z) + 0.05, e.z);
      m.userData.pick = { kind: 'entrance', id: this.nest.entrances.indexOf(e) };
      this.surfaceGroup.add(m);
    }
  }

  setXray(on: boolean): void {
    this.group.visible = on;
    this.surfaceGroup.visible = !on;
  }

  highlightChamber(id: number | null): void {
    this.chamberMeshes.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(i === id ? 0x6a4a20 : 0x2a1a0e);
      mat.emissiveIntensity = i === id ? 1.0 : 0.6;
    });
  }
}
