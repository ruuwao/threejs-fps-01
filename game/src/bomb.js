// The bomb: carried, dropped, planting, planted, defusing, gone. One state
// machine, no scene code except a small mesh for the planted bomb and the drop.
import * as THREE from 'three';

export function createBomb(scene, sites) {
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.5),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1e2126'), roughness: 0.5, metalness: 0.3 }),
  );
  body.castShadow = true;
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.06, 0.1),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#e5484d'), emissive: new THREE.Color('#e5484d'), emissiveIntensity: 2 }),
  );
  light.position.set(0, 0.13, 0.1);
  mesh.add(body, light);
  mesh.visible = false;
  scene.add(mesh);

  const state = {
    status: 'carried', // carried | dropped | planting | planted | defusing | detonated | defused
    site: null,
    pos: { x: 0, z: 0 },
    fuse: 40,
    plantBy: null,
  };

  return {
    state, mesh,
    reset(carrier) {
      state.status = 'carried'; state.site = null; state.fuse = 40; state.plantBy = carrier;
      mesh.visible = false;
    },
    inSite(x, z) {
      for (const s of Object.values(sites)) {
        if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s.name;
      }
      return null;
    },
    drop(x, z) {
      state.status = 'dropped';
      state.pos = { x, z };
      mesh.visible = true;
      mesh.position.set(x, 0.14, z);
    },
    pickup() {
      state.status = 'carried';
      mesh.visible = false;
    },
    startPlant(site, by) {
      state.status = 'planting'; state.site = site; state.plantBy = by;
    },
    cancelPlant() {
      if (state.status === 'planting') { state.status = 'carried'; state.site = null; }
    },
    finishPlant(x, z, site) {
      state.status = 'planted'; state.fuse = 40; state.site = site ?? state.site;
      state.pos = { x, z };
      mesh.visible = true;
      mesh.position.set(x, 0.14, z);
    },
    startDefuse() { if (state.status === 'planted') state.status = 'defusing'; },
    cancelDefuse() { if (state.status === 'defusing') state.status = 'planted'; },
    finishDefuse() { state.status = 'defused'; mesh.visible = false; },
    detonate() { state.status = 'detonated'; mesh.visible = false; },
    step(dt) {
      if (state.status === 'planted' || state.status === 'defusing') {
        state.fuse -= dt;
        // Blink faster as the fuse runs down.
        const blink = Math.sin(state.fuse * (state.fuse < 10 ? 14 : 6)) > 0;
        light.material.emissiveIntensity = blink ? 2.5 : 0.2;
        if (state.fuse <= 0) this.detonate();
      }
    },
  };
}
