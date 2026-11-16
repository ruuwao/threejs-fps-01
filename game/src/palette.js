// The look plan, in one place. Dusk at a desert relay station: warm sandstone,
// deep blue shadow, one teal accent for Vanguard and one amber accent for the
// Wardens. The sky runs burnt orange at the horizon into dusk blue overhead;
// dust hangs in the air and the low sun throws long shadows. Lighting makes
// every shade the game needs; no other colour appears.
import * as THREE from 'three';

export const PALETTE = {
  sky: '#232c42',       // dusk blue, scene background + fog
  skyLow: '#c96f3a',    // horizon band, burnt orange
  skyMid: '#7a5a6e',    // mauve middle band of the dusk gradient
  skyTop: '#1c2438',    // zenith, deep blue
  sand: '#c99a5e',      // ground sand
  sandDark: '#a87c46',  // ground variation
  sandLight: '#dcb57e', // wind-blown crests
  stone: '#8a6f52',     // walls, sandstone
  stoneDark: '#6b5540', // wall shadow faces
  stoneLight: '#a5855f',// sunlit wall caps
  metal: '#4a4f57',     // containers, pipes, gunmetal
  metalDark: '#33373d',
  metalRust: '#7a4a30', // rusted barrels and pipe joints
  crate: '#9c7a4a',     // wooden crates
  crateDark: '#7d5f38',
  canvas: '#3d4a2f',    // tarps / sandbags (olive)
  canvasDark: '#2f3a24',
  hazard: '#e8b73a',    // hazard striping, site beacons
  dust: '#d8b98a',      // airborne dust motes
  lamp: '#ffd9a0',      // warm lamp glow
  ink: '#efe8d8',       // HUD text, light
  muted: '#9aa3ad',     // HUD secondary
  teal: '#2ec4b6',      // Vanguard (player team)
  amber: '#f0a830',     // Wardens (enemy team) + accents
  red: '#e5484d',       // damage, danger
  sun: '#ffb347',       // low sun colour
};

const MAT_CACHE = new Map();
export function material(name, opts = {}) {
  const key = name + JSON.stringify(opts);
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE[name] ?? name),
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0.05,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color('#000000'),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    flatShading: opts.flatShading ?? false,
  });
  MAT_CACHE.set(key, m);
  return m;
}

// A small helper for the striped hazard material used on site barriers: two
// canvas stripes, amber on dark, so the eye reads "keep out" at a glance.
export function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#1e2126'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = PALETTE.hazard;
  for (let x = -32; x < 160; x += 32) {
    g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 32); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
