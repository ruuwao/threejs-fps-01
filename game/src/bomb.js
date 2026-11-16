// The bomb: carried, dropped, planting, planted, defusing, gone. One state
// machine, no scene code except a small mesh for the planted bomb and the
// drop — the rules live here, the rendering is a box with a blinking light.
//
// Statuses, in the order a round can visit them:
//   carried -> planting -> planted -> defusing -> detonated | defused
//   carried -> dropped -> carried          (carrier dies, a teammate picks up)
//   planting -> carried                    (planter lets go of E / moves off)
//   defusing -> planted                    (defuser lets go of E)
//
// The fuse is 40 seconds from the moment the plant finishes. The light
// blinks faster under 10 seconds, so the whole map can hear — and see —
// how urgent the round has become.
import * as THREE from 'three';

const FUSE_SECONDS = 40;
const BLINK_FAST_BELOW = 10;

function buildMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.5),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1e2126'), roughness: 0.5, metalness: 0.3 }),
  );
  body.castShadow = true;
  // The arming light: red, emissive, the only moving part of the device.
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.06, 0.1),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#e5484d'), emissive: new THREE.Color('#e5484d'), emissiveIntensity: 2 }),
  );
  light.position.set(0, 0.13, 0.1);
  group.add(body, light);
  group.visible = false;
  return { group, light };
}

export function createBomb(scene, sites) {
  const { group: mesh, light } = buildMesh();
  scene.add(mesh);

  const state = {
    status: 'carried', // carried | dropped | planting | planted | defusing | detonated | defused
    site: null,
    pos: { x: 0, z: 0 },
    fuse: FUSE_SECONDS,
    plantBy: null,
  };

  function showAt(x, z) {
    mesh.visible = true;
    mesh.position.set(x, 0.14, z);
  }

  return {
    state,
    mesh,

    reset(carrier) {
      state.status = 'carried';
      state.site = null;
      state.fuse = FUSE_SECONDS;
      state.plantBy = carrier;
      mesh.visible = false;
    },

    // The site a point stands in ('A' or 'B'), or null. Sites are checked
    // in insertion order; they do not overlap, so the first match is the one.
    inSite(x, z) {
      for (const site of Object.values(sites)) {
        if (x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ) return site.name;
      }
      return null;
    },

    drop(x, z) {
      state.status = 'dropped';
      state.pos = { x, z };
      showAt(x, z);
    },

    pickup() {
      state.status = 'carried';
      mesh.visible = false;
    },

    startPlant(site, by) {
      state.status = 'planting';
      state.site = site;
      state.plantBy = by;
    },

    cancelPlant() {
      if (state.status === 'planting') {
        state.status = 'carried';
        state.site = null;
      }
    },

    finishPlant(x, z, site) {
      state.status = 'planted';
      state.fuse = FUSE_SECONDS;
      state.site = site ?? state.site;
      state.pos = { x, z };
      showAt(x, z);
    },

    startDefuse() {
      if (state.status === 'planted') state.status = 'defusing';
    },

    cancelDefuse() {
      if (state.status === 'defusing') state.status = 'planted';
    },

    finishDefuse() {
      state.status = 'defused';
      mesh.visible = false;
    },

    detonate() {
      state.status = 'detonated';
      mesh.visible = false;
    },

    step(dt) {
      if (state.status !== 'planted' && state.status !== 'defusing') return;
      state.fuse -= dt;
      // Blink faster as the fuse runs down: a slow pulse above 10 seconds,
      // a frantic one below it.
      const fast = state.fuse < BLINK_FAST_BELOW;
      const blinkOn = Math.sin(state.fuse * (fast ? 14 : 6)) > 0;
      light.material.emissiveIntensity = blinkOn ? 2.5 : 0.2;
      if (state.fuse <= 0) this.detonate();
    },
  };
}
