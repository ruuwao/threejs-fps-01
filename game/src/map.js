// Meridian Relay: the map. A derelict desert relay station at dusk, three lanes,
// two bomb sites, one mid. All geometry is boxes, cylinders and planes built from
// the palette; no models, no textures from disk. The ground texture is painted on
// a canvas at load. Every solid is an axis-aligned collider for players, bots
// and bullets; tall walls also bound the bot waypoint graph.
//
// The dusk look: a gradient sky dome with a burnt-orange horizon, dune ridges
// silhouetted beyond the walls, antenna masts with guy wires, cable runs between
// poles, warm lamp posts, rusted barrels and hazard-striped barriers at the site
// mouths, and dust motes drifting through the low sun. The playable geometry —
// every wall, crate and waypoint — is unchanged from the verified layout.
import * as THREE from 'three';
import { PALETTE, material, hazardTexture } from './palette.js';

const WALL_H = 4.6;
const T = 0.6; // wall thickness

// [width, height, depth, x, y, z, material, tall?]
const BOXES = [
  // Perimeter, 64 x 48 m, open sky.
  [64.6, WALL_H, T, 0, WALL_H / 2, -24, 'stone', true],
  [64.6, WALL_H, T, 0, WALL_H / 2, 24, 'stone', true],
  [T, WALL_H, 48.6, -32, WALL_H / 2, 0, 'stone', true],
  [T, WALL_H, 48.6, 32, WALL_H / 2, 0, 'stone', true],
  // Lane dividers, x = -12 and x = 12, from the north wall to the spawn yard.
  // Each has a door gap (z -18..-14) from its site into the defender yard.
  [T, WALL_H, 6, -12, WALL_H / 2, -21, 'stone', true],
  [T, WALL_H, 24, -12, WALL_H / 2, -2, 'stone', true],
  [T, WALL_H, 6, 12, WALL_H / 2, -21, 'stone', true],
  [T, WALL_H, 24, 12, WALL_H / 2, -2, 'stone', true],
  // Cross wall at z = -12: site entrances and the mid door.
  [10, WALL_H, T, -27, WALL_H / 2, -12, 'stone', true],
  [8, WALL_H, T, -8, WALL_H / 2, -12, 'stone', true],
  [8, WALL_H, T, 8, WALL_H / 2, -12, 'stone', true],
  [10, WALL_H, T, 27, WALL_H / 2, -12, 'stone', true],
  // Mid pillar: the double-door block that splits mid into two sub-lanes.
  [2.4, 3.4, 2.4, 0, 1.7, 0, 'stoneDark', true],
  // Cover: crates (1.2 m), sandbag lines (1.1 m), containers (2.4 m).
  [1.2, 1.2, 1.2, -26, 0.6, 4, 'crate', false],
  [1.2, 1.2, 1.2, -20, 0.6, -4, 'crate', false],
  [2.4, 1.1, 0.8, -28, 0.55, -8, 'canvas', false],
  [2.4, 2.4, 6, -16, 1.2, 2, 'metal', false],
  [1.2, 1.2, 1.2, 26, 0.6, 4, 'crate', false],
  [1.2, 1.2, 1.2, 20, 0.6, -4, 'crate', false],
  [2.4, 1.1, 0.8, 28, 0.55, -8, 'canvas', false],
  [2.4, 2.4, 6, 16, 1.2, 2, 'metal', false],
  [1.2, 1.2, 1.2, -6, 0.6, 4, 'crate', false],
  [1.2, 1.2, 1.2, 6, 0.6, -4, 'crate', false],
  [2.4, 1.1, 0.8, -3, 0.55, 8, 'canvas', false],
  [2.4, 1.1, 0.8, 3, 0.55, 8, 'canvas', false],
  // A site cover.
  [1.2, 1.2, 1.2, -26, 0.6, -16, 'crate', false],
  [1.2, 1.2, 1.2, -18, 0.6, -20, 'crate', false],
  [2.4, 1.1, 0.8, -22, 0.55, -14, 'canvas', false],
  [4.0, 1.0, 0.8, -28, 0.5, -21, 'stoneDark', false],
  // B site cover.
  [1.2, 1.2, 1.2, 26, 0.6, -16, 'crate', false],
  [1.2, 1.2, 1.2, 18, 0.6, -20, 'crate', false],
  [2.4, 1.1, 0.8, 22, 0.55, -14, 'canvas', false],
  [4.0, 1.0, 0.8, 28, 0.5, -21, 'stoneDark', false],
  // Spawn yards.
  [1.2, 1.2, 1.2, -8, 0.6, 14, 'crate', false],
  [1.2, 1.2, 1.2, 8, 0.6, 14, 'crate', false],
  [1.2, 1.2, 1.2, -6, 0.6, -16, 'crate', false],
  [1.2, 1.2, 1.2, 6, 0.6, -16, 'crate', false],
];

// Waypoint nodes the bots walk. Edges are built at load: two nodes link when
// they are near and no tall wall stands between them.
const WAYPOINTS = [
  [0, 20], [-8, 18], [8, 18], [-4, 14], [4, 14],
  [-20, 14], [-26, 8], [-20, 2], [-26, -4], [-20, -9],
  [-6, 8], [6, 8], [-6, 0], [6, 0], [-6, -8], [6, -8], [0, -9],
  [20, 14], [26, 8], [20, 2], [26, -4], [20, -9],
  [-22, -15], [-27, -19], [-17, -19], [-22, -21],
  [22, -15], [27, -19], [17, -19], [22, -21],
  [-6, -16], [6, -16], [0, -20], [-10, -20], [10, -20],
  [-12, -16], [12, -16],
];

export const SITES = {
  A: { name: 'A', label: 'RELAY', center: { x: -22, z: -18 }, minX: -30, maxX: -14, minZ: -23, maxZ: -13 },
  B: { name: 'B', label: 'SILO', center: { x: 22, z: -18 }, minX: 14, maxX: 30, minZ: -23, maxZ: -13 },
};

export const SPAWNS = {
  // Camera forward is (-sin yaw, -cos yaw): attackers face north (yaw 0),
  // defenders face south (yaw PI).
  attack: [
    { x: 0, z: 20, yaw: 0 }, { x: -4, z: 21, yaw: 0 }, { x: 4, z: 21, yaw: 0 },
    { x: -8, z: 19, yaw: 0 }, { x: 8, z: 19, yaw: 0 },
  ],
  defend: [
    { x: 0, z: -20, yaw: Math.PI }, { x: -4, z: -21, yaw: Math.PI }, { x: 4, z: -21, yaw: Math.PI },
    { x: -8, z: -19, yaw: Math.PI }, { x: 8, z: -19, yaw: Math.PI },
  ],
};

// Defender hold spots: waypoint indices with good sightlines.
export const HOLD_SPOTS = [22, 26, 16, 23, 27];

// Extra low props, placed clear of the waypoint lines so bots never have to
// walk through one. [kind, x, z] — barrels, crate stacks, sandbag arcs.
const PROPS = [
  ['barrel', -30.5, 12], ['barrel', -30.5, 13.4], ['barrel', 30.5, 12],
  ['barrel', -30.5, -22.5], ['barrel', 30.5, -22.5], ['barrel', 29.2, -22.5],
  ['barrel', -29.2, 22.5], ['barrel', 29.2, 22.5],
  ['stack', -30, 0], ['stack', 30, 0], ['stack', -30, -6], ['stack', 30, -6],
  ['bags', -16, -12.5], ['bags', 16, -12.5], ['bags', -24, 12.5], ['bags', 24, 12.5],
];

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.sand; g.fillRect(0, 0, 512, 384);
  // Sand mottling.
  for (let i = 0; i < 5200; i += 1) {
    const x = (i * 7919) % 512, y = (i * 104729) % 384;
    g.fillStyle = i % 3 === 0 ? PALETTE.sandDark : '#d9b380';
    g.globalAlpha = 0.12 + ((i * 13) % 10) / 60;
    g.fillRect(x, y, 2 + ((i * 7) % 4), 2 + ((i * 5) % 3));
  }
  // Wind-blown crests: pale streaks running east-west.
  g.globalAlpha = 0.1; g.fillStyle = PALETTE.sandLight;
  for (let i = 0; i < 90; i += 1) {
    const y = (i * 53) % 384, x = (i * 173) % 512;
    g.fillRect(x, y, 26 + ((i * 11) % 40), 2);
  }
  g.globalAlpha = 1;
  // Tire tracks down the three lanes, worn and dusty.
  g.strokeStyle = '#8a6a42'; g.globalAlpha = 0.3; g.lineWidth = 4;
  g.setLineDash([18, 12]);
  for (const x of [104, 112, 248, 256, 400, 408]) {
    g.beginPath(); g.moveTo(x, 384); g.lineTo(x + (x > 256 ? -14 : 14), 20); g.stroke();
  }
  g.setLineDash([]);
  // Scorch marks where old rounds ended, near both sites.
  g.globalAlpha = 0.22; g.fillStyle = '#3a2c1e';
  g.beginPath(); g.arc(100, 60, 26, 0, 7); g.fill();
  g.beginPath(); g.arc(412, 60, 26, 0, 7); g.fill();
  g.globalAlpha = 1;
  // Painted lane guides and site markings, worn.
  g.strokeStyle = '#efe8d8'; g.globalAlpha = 0.28; g.lineWidth = 3;
  g.setLineDash([14, 10]);
  g.beginPath(); g.moveTo(256, 384); g.lineTo(256, 20); g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 0.22;
  g.strokeRect(48, 24, 96, 72); // A site box
  g.strokeRect(368, 24, 96, 72); // B site box
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function letterTexture(letter) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1c2026'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = PALETTE.amber; g.lineWidth = 6; g.strokeRect(6, 6, 116, 116);
  g.fillStyle = PALETTE.amber; g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The dusk sky: a vertical gradient painted on a canvas, wrapped around a
// large sphere the camera sits inside. Orange at the horizon, mauve, then deep
// blue at the zenith — the whole palette of the scene in one backdrop.
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(0.45, PALETTE.skyMid);
  grad.addColorStop(0.62, PALETTE.skyLow);
  grad.addColorStop(0.72, '#e08a4a');
  grad.addColorStop(1, PALETTE.sandDark);
  g.fillStyle = grad; g.fillRect(0, 0, 16, 256);
  // A few faint early stars high up.
  g.fillStyle = 'rgba(239,232,216,0.8)';
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 37) % 16, y = (i * 91) % 70;
    g.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const tallColliders = [];
  const shootables = [];

  // Sky dome and distant dunes, outside the walls.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(170, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  group.add(sky);
  const duneMat = material('sandDark', { roughness: 1, flatShading: true });
  for (const [x, z, w, h, ry] of [
    [-58, -10, 70, 9, 0.4], [58, 8, 78, 11, -0.3], [0, -62, 90, 8, 0],
    [-52, 34, 60, 7, 0.9], [54, -38, 66, 10, 0.2], [0, 58, 96, 7, 0],
  ]) {
    const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), duneMat);
    dune.scale.set(w / 2, h, 14);
    dune.position.set(x, -1.5, z);
    dune.rotation.y = ry;
    group.add(dune);
  }

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 48),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-32, -0.4, -24), new THREE.Vector3(32, 0, 24)));

  function box(w, h, d, x, y, z, mat, tall) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(mat));
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    const b = new THREE.Box3().setFromObject(mesh);
    colliders.push(b);
    if (tall) tallColliders.push(b);
    shootables.push(mesh);
    return mesh;
  }
  for (const b of BOXES) box(...b);

  // Extra props: rusted barrels, stacked crates, sandbag arcs. All low, so
  // they give cover without blocking sightlines or the waypoint graph.
  for (const [kind, x, z] of PROPS) {
    if (kind === 'barrel') {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12),
        material('metalRust', { roughness: 0.75, metalness: 0.3 }),
      );
      barrel.position.set(x, 0.5, z);
      barrel.castShadow = true; barrel.receiveShadow = true;
      group.add(barrel);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 12), material('metalDark'));
      rim.position.set(x, 0.92, z);
      group.add(rim);
      colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.42), new THREE.Vector3(x + 0.42, 1, z + 0.42)));
      shootables.push(barrel);
    } else if (kind === 'stack') {
      const a = box(1.2, 1.2, 1.2, x, 0.6, z, 'crate', false);
      const b2 = box(0.9, 0.9, 0.9, x + 0.1, 1.65, z - 0.05, 'crateDark', false);
      b2.rotation.y = 0.4;
      a.rotation.y = 0.15;
    } else {
      // Sandbag arc: three low humps in a shallow curve.
      for (let i = -1; i <= 1; i += 1) {
        const bag = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), material('canvasDark', { roughness: 1 }));
        bag.scale.set(1.4, 0.55, 0.9);
        bag.position.set(x + i * 1.1, 0.28, z + Math.abs(i) * 0.25);
        bag.castShadow = true; bag.receiveShadow = true;
        group.add(bag);
      }
      colliders.push(new THREE.Box3(new THREE.Vector3(x - 1.8, 0, z - 0.5), new THREE.Vector3(x + 1.8, 0.6, z + 0.8)));
    }
  }

  // Hazard-striped barriers at the two site mouths.
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.85 });
  for (const x of [-14, 14]) {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 0.35), hazardMat);
    barrier.position.set(x, 0.5, -13.2);
    barrier.castShadow = true; barrier.receiveShadow = true;
    group.add(barrier);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 1.1, 0, -13.4), new THREE.Vector3(x + 1.1, 1, -13)));
    shootables.push(barrier);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.5), material('metalDark'));
    legL.position.set(x - 0.9, 0.5, -13.2);
    const legR = legL.clone(); legR.position.x = x + 0.9;
    group.add(legL, legR);
  }

  // B site silo: a cylinder with an AABB collider.
  const silo = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.9, 7, 18),
    material('metal', { roughness: 0.6, metalness: 0.35 }),
  );
  silo.position.set(27.5, 3.5, -20.5);
  silo.castShadow = true; silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3(new THREE.Vector3(25.2, 0, -22.8), new THREE.Vector3(29.8, 7, -18.2)));
  shootables.push(silo);
  const siloCap = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.6, 0.5, 18), material('metalDark'));
  siloCap.position.set(27.5, 7.2, -20.5); siloCap.castShadow = true;
  group.add(siloCap);
  // Pipes running from the silo into the ground.
  for (const [px, pz, ry] of [[24.6, -20.5, 0], [27.5, -17.6, Math.PI / 2]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.4, 10), material('metalRust', { roughness: 0.7, metalness: 0.3 }));
    pipe.rotation.z = Math.PI / 2; pipe.rotation.y = ry;
    pipe.position.set(px, 0.35, pz);
    pipe.castShadow = true;
    group.add(pipe);
  }

  // A site relay dish: pole + tilted panel.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 4.4, 10), material('metalDark'));
  pole.position.set(-27.5, 2.2, -20.5); pole.castShadow = true;
  group.add(pole);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.12, 20, 1, false, 0, Math.PI), material('metal', { roughness: 0.5, metalness: 0.4 }));
  dish.position.set(-27.5, 4.6, -20.5); dish.rotation.set(-0.7, 0, 0.5);
  dish.castShadow = true;
  group.add(dish);
  colliders.push(new THREE.Box3(new THREE.Vector3(-28, 0, -21), new THREE.Vector3(-27, 4.4, -20)));

  // Antenna masts with guy wires: one at each site, one by the spawn yard.
  // The masts are thin and sit in the corners, clear of the lanes.
  const wireMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#2c2f36') });
  function antenna(x, z, h) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, h, 8), material('metalDark'));
    mast.position.set(x, h / 2, z);
    mast.castShadow = true;
    group.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), material('amber', { emissive: '#f0a830', emissiveIntensity: 2 }));
    tip.position.set(x, h + 0.1, z);
    group.add(tip);
    const pts = [];
    for (const [gx, gz] of [[x + 2.2, z + 2.2], [x - 2.2, z + 2.2], [x + 2.2, z - 2.2], [x - 2.2, z - 2.2]]) {
      pts.push(new THREE.Vector3(x, h, z), new THREE.Vector3(gx, 0, gz));
    }
    const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), wireMat);
    group.add(wires);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.2, 0, z - 0.2), new THREE.Vector3(x + 0.2, h, z + 0.2)));
  }
  antenna(-29.5, -22.5, 9);
  antenna(29.5, -22.5, 8);
  antenna(14, 22.5, 7);

  // Cable runs sagging between the lamp posts, drawn as line segments.
  function cable(a, b, sag = 0.5) {
    const pts = [];
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      pts.push(new THREE.Vector3(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag,
        a.z + (b.z - a.z) * t,
      ));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
  }

  // Lamp posts with warm bulbs along the lanes.
  const lampGlow = material('lamp', { emissive: '#ffd9a0', emissiveIntensity: 1.8, roughness: 0.4 });
  function lamp(x, z) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 8), material('metalDark'));
    post.position.set(x, 1.7, z);
    post.castShadow = true;
    group.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.07), material('metalDark'));
    arm.position.set(x + (x < 0 ? 0.3 : -0.3), 3.35, z);
    group.add(arm);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lampGlow);
    bulb.position.set(x + (x < 0 ? 0.6 : -0.6), 3.25, z);
    group.add(bulb);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.12, 0, z - 0.12), new THREE.Vector3(x + 0.12, 3.4, z + 0.12)));
  }
  lamp(-28, 10); lamp(28, 10); lamp(-28, -10); lamp(28, -10);
  cable(new THREE.Vector3(-28, 3.4, 10), new THREE.Vector3(-28, 3.4, -10), 0.6);
  cable(new THREE.Vector3(28, 3.4, 10), new THREE.Vector3(28, 3.4, -10), 0.6);
  cable(new THREE.Vector3(-29.5, 9, -22.5), new THREE.Vector3(-27.5, 4.6, -20.5), 0.4);

  // Site beacons: an emissive post + a letter board at each site.
  for (const site of Object.values(SITES)) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.2, 8),
      material('amber', { emissive: '#f0a830', emissiveIntensity: 1.6, roughness: 0.4 }),
    );
    post.position.set(site.center.x, 1.6, site.center.z);
    group.add(post);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: letterTexture(site.name), transparent: true }),
    );
    board.position.set(site.center.x, 3.6, site.center.z);
    board.rotation.y = site.name === 'A' ? 0.6 : -0.6;
    group.add(board);
  }

  // Dusk light: warm low sun from the west, cool sky fill, and a faint warm
  // bounce off the sand so the shadow side is never dead black.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#7d8db0'), new THREE.Color(PALETTE.sandDark), 1.05));
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.8);
  sun.position.set(-30, 12, 16);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90; sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6b8c'), 0.5);
  fill.position.set(20, 12, -18);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(new THREE.Color('#e08a4a'), 0.35);
  bounce.position.set(24, 4, 20);
  scene.add(bounce);

  // Drifting dust motes: a points cloud that rides the wind across the map.
  const DUST_N = 220;
  const dustPos = new Float32Array(DUST_N * 3);
  const dustSeed = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i += 1) {
    dustPos[i * 3] = (Math.random() * 2 - 1) * 32;
    dustPos[i * 3 + 1] = 0.3 + Math.random() * 6;
    dustPos[i * 3 + 2] = (Math.random() * 2 - 1) * 24;
    dustSeed[i] = 0.4 + Math.random() * 0.9;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.dust), size: 0.07, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  dust.frustumCulled = false;
  group.add(dust);
  function animateDust(dt) {
    for (let i = 0; i < DUST_N; i += 1) {
      dustPos[i * 3] += dustSeed[i] * dt * 0.9; // wind from the west
      dustPos[i * 3 + 1] += Math.sin(dustSeed[i] * 3 + i) * dt * 0.06;
      if (dustPos[i * 3] > 33) dustPos[i * 3] = -33;
      if (dustPos[i * 3 + 1] > 7) dustPos[i * 3 + 1] = 0.3;
      if (dustPos[i * 3 + 1] < 0.2) dustPos[i * 3 + 1] = 0.3;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // Waypoint graph: link near nodes with no tall wall between them.
  const nodes = WAYPOINTS.map(([x, z]) => ({ x, z, edges: [] }));
  function blocked2D(ax, az, bx, bz) {
    for (const b of tallColliders) {
      if (segmentHitsBox(ax, az, bx, bz, b)) return true;
    }
    return false;
  }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 10.5) continue;
      if (blocked2D(a.x, a.z, b.x, b.z)) continue;
      a.edges.push(j); b.edges.push(i);
    }
  }

  return { colliders, tallColliders, shootables, group, nodes, sites: SITES, spawns: SPAWNS, animate: animateDust };
}

// 2D segment vs AABB test (XZ plane), used for waypoint edges and bot LOS.
export function segmentHitsBox(ax, az, bx, bz, box) {
  const dx = bx - ax, dz = bz - az;
  let tmin = 0, tmax = 1;
  for (const [p, d, lo, hi] of [[ax, dx, box.min.x, box.max.x], [az, dz, box.min.z, box.max.z]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let t1 = (lo - p) / d, t2 = (hi - p) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
