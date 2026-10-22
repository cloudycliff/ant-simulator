import * as THREE from 'three';
import { Noise2D } from '../../../core/util/random';
import type { Nest, Chamber, NestEdge } from './nest';
import type { Terrain } from '../world/terrain';

const CHAMBER_TINT: Record<string, number> = {
  queen: 0x9c6a43,
  egg: 0x8f6a4a,
  larva: 0x8c6646,
  pupa: 0x977050,
  solar: 0xa0764c,
  food: 0x87633f,
  waste: 0x6c5a45,
  rest: 0x7f6248,
  winter: 0x6f5a48,
};

/**
 * 蚁穴网格：隧道和房间都用背面渲染，近侧墙自动剔除，从任意角度都能看进空腔。
 * 每帧调用 sync()，跟随扩建中变长的隧道、长大的房间和扩大的土壤剖面。
 */
export class NestView {
  group = new THREE.Group();
  /** 只在地表视图显示的入口洞口 */
  surfaceGroup = new THREE.Group();
  chamberMeshes: THREE.Mesh[] = [];
  private edgeMeshes = new Map<number, THREE.Mesh>();
  private nodeMeshes = new Map<number, THREE.Mesh>();
  private soil: THREE.Mesh | null = null;
  private soilKey = '';
  private builtRev = -1;
  private noise = new Noise2D(99);
  private tunnelMat: THREE.MeshStandardMaterial;
  private freshMat: THREE.MeshStandardMaterial;
  private selected: number | null = null;
  /** 入口的封土：地表上的土堆和透视时竖井口的土塞 */
  private plugMeshes: { top: THREE.Mesh; shaft: THREE.Mesh }[] = [];
  private waterMeshes = new Map<number, THREE.Mesh>();
  private plugMat = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 1, flatShading: true });
  private waterMat = new THREE.MeshStandardMaterial({ color: 0x4f86b0, roughness: 0.1, transparent: true, opacity: 0.7, depthWrite: false });

  constructor(private nest: Nest, private terrain: Terrain) {
    this.group.name = 'nest';
    this.tunnelMat = new THREE.MeshStandardMaterial({
      color: 0x8a6646,
      roughness: 1,
      side: THREE.BackSide,
      emissive: 0x2a1a0e,
      emissiveIntensity: 0.6,
    });
    // 新挖的工作面土色更浅
    this.freshMat = this.tunnelMat.clone();
    this.freshMat.color.setHex(0xa98058);
  }

  build(): void {
    this.sync();
    this.buildEntranceHoles();
  }

  sync(): void {
    const nest = this.nest;
    const faceEdges = new Set(nest.faces.map((f) => f.edge.id));
    for (const e of nest.edges) {
      const m = this.edgeMeshes.get(e.id);
      if (m && m.userData.rev === e.rev) continue;
      if (m) {
        m.geometry.dispose();
        m.geometry = this.tubeGeometry(e);
      } else {
        const mesh = new THREE.Mesh(this.tubeGeometry(e), this.tunnelMat);
        this.edgeMeshes.set(e.id, mesh);
        this.group.add(mesh);
      }
      this.edgeMeshes.get(e.id)!.userData.rev = e.rev;
    }
    for (const [id, m] of this.edgeMeshes) m.material = faceEdges.has(id) ? this.freshMat : this.tunnelMat;

    for (const n of nest.nodes) {
      const want = n.kind === 'junction' || n.kind === 'deadend';
      let m = this.nodeMeshes.get(n.id);
      if (!want) {
        if (m) {
          this.group.remove(m);
          this.nodeMeshes.delete(n.id);
        }
        continue;
      }
      if (!m) {
        const geo = new THREE.SphereGeometry(n.kind === 'junction' ? 1.75 : 1.2, 12, 9);
        this.roughen(geo, 0.15);
        m = new THREE.Mesh(geo, n.kind === 'junction' ? this.tunnelMat : this.freshMat);
        this.nodeMeshes.set(n.id, m);
        this.group.add(m);
      }
      m.position.copy(n.pos);
    }

    while (this.chamberMeshes.length < nest.chambers.length) {
      const c = nest.chambers[this.chamberMeshes.length];
      const mesh = this.buildChamber(c);
      this.chamberMeshes.push(mesh);
      this.group.add(mesh);
      this.applyHighlight();
    }
    for (const c of nest.chambers) {
      const mesh = this.chamberMeshes[c.id];
      const u = mesh.userData;
      if (u.grow === c.grow && u.rx === c.rx && u.rz === c.rz) continue;
      u.grow = c.grow;
      u.rx = c.rx;
      u.rz = c.rz;
      // 以门口为不动点缩放：未完工的房间从门口向内长大；扩大时按建模时的半径拉伸
      const door = nest.nodes[c.door].pos;
      mesh.position.copy(door).lerp(c.floor, c.grow);
      mesh.scale.set((c.grow * c.rx) / u.bx, c.grow, (c.grow * c.rz) / u.bz);
    }

    if (nest.rev !== this.builtRev) {
      this.builtRev = nest.rev;
      this.buildSoil();
    }
    this.syncWeather();
  }

  private syncWeather(): void {
    this.nest.entrances.forEach((e, i) => {
      const m = this.plugMeshes[i];
      if (!m) return;
      const on = e.plug > 0.02;
      m.top.visible = on;
      m.shaft.visible = on;
      if (!on) return;
      m.top.scale.set(0.5 + 0.7 * e.plug, 0.25 + 0.55 * e.plug, 0.5 + 0.7 * e.plug);
      m.shaft.scale.setScalar(0.4 + 0.6 * e.plug);
    });
    for (const c of this.nest.chambers) {
      let m = this.waterMeshes.get(c.id);
      if (c.wet < 0.02) {
        if (m) m.visible = false;
        continue;
      }
      if (!m) {
        const geo = new THREE.CircleGeometry(1, 28);
        geo.rotateX(-Math.PI / 2);
        m = new THREE.Mesh(geo, this.waterMat);
        m.raycast = () => {};
        m.renderOrder = 2;
        this.chamberMeshes[c.id].add(m);
        this.waterMeshes.set(c.id, m);
      }
      m.visible = true;
      const k = 0.55 + 0.4 * Math.min(1, c.wet * 2);
      const u = this.chamberMeshes[c.id].userData;
      m.scale.set(u.bx * k, 1, u.bz * k);
      m.position.y = 0.12 + c.wet * c.ry * 0.6;
    }
  }

  private tubeGeometry(e: NestEdge): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3(e.points);
    const geo = new THREE.TubeGeometry(curve, Math.max(4, Math.round(e.length / 1.2)), e.radius * 1.08, 9, false);
    this.roughen(geo, 0.12);
    return geo;
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
    mesh.userData.bx = c.rx;
    mesh.userData.bz = c.rz;
    mesh.name = `chamber-${c.id}`;
    return mesh;
  }

  /** 蚁穴区域外围的土壤剖面墙（四壁 + 底面），带土层分层着色；范围包含已规划的扩建位置 */
  private buildSoil(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    const extend = (x: number, z: number, r: number, y: number) => {
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minZ = Math.min(minZ, z - r);
      maxZ = Math.max(maxZ, z + r);
      minY = Math.min(minY, y);
    };
    for (const c of this.nest.chambers) extend(c.floor.x, c.floor.z, Math.max(c.rx, c.rz), c.floor.y);
    for (const p of this.nest.reserved) extend(p.x, p.z, p.r, p.y);
    for (const f of this.nest.faces) {
      const end = f.full.points[f.full.points.length - 1];
      extend(end.x, end.z, 2, end.y);
    }
    const pad = 8;
    minX = Math.floor(minX - pad);
    maxX = Math.ceil(maxX + pad);
    minZ = Math.floor(minZ - pad);
    maxZ = Math.ceil(maxZ + pad);
    const bottom = Math.floor(minY - 8);
    const key = `${minX},${maxX},${minZ},${maxZ},${bottom}`;
    if (key === this.soilKey) return;
    this.soilKey = key;
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
    if (this.soil) {
      this.soil.geometry.dispose();
      this.soil.geometry = geo;
      return;
    }
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

      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.plugMat);
      dome.position.copy(m.position);
      dome.userData.pick = m.userData.pick;
      dome.visible = false;
      this.surfaceGroup.add(dome);
      const shaft = new THREE.Mesh(new THREE.SphereGeometry(1.4, 9, 7), this.plugMat);
      shaft.position.copy(this.nest.nodes[e.node].pos).setY(this.nest.nodes[e.node].pos.y - 1.2);
      shaft.raycast = () => {};
      shaft.visible = false;
      this.group.add(shaft);
      this.plugMeshes.push({ top: dome, shaft });
    }
  }

  setXray(on: boolean): void {
    this.group.visible = on;
    this.surfaceGroup.visible = !on;
  }

  highlightChamber(id: number | null): void {
    this.selected = id;
    this.applyHighlight();
  }

  private applyHighlight(): void {
    this.chamberMeshes.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(i === this.selected ? 0x6a4a20 : 0x2a1a0e);
      mat.emissiveIntensity = i === this.selected ? 1.0 : 0.6;
    });
  }
}
