// Weapons: the numbers and the state. Five guns and three grenades. Spread grows
// with movement, airtime and sustained fire and recovers when still; recoil kicks
// the aim up and drifts it sideways. A shot that lands on the head is worth four
// times a body shot. Nothing here touches the scene: the game raycasts.
//
// Every gun also carries its feel numbers, so the five weapons handle differently
// instead of only differing in damage: reload is the full reload time in seconds
// (shotgun and sniper take longest), adsZoom is the aim-down-sights magnification
// (1 = no zoom), kick is how hard the viewmodel and the aim jump per shot, draw
// is the seconds the weapon needs to come up after a switch, and handling is a
// 0..1 weight for how fast the gun settles after moving (1 = snappy).
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    mag: 12, reserveMax: 36, damage: 26, headMult: 4, rpm: 420,
    spread: 0.004, moveSpread: 0.010, bloom: 0.004, bloomMax: 0.030,
    recoil: 0.006, range: 40, zoom: 1, pellets: 1, auto: false, tracer: '#ffd27d',
    reload: 1.6, adsZoom: 1.15, kick: 0.35, draw: 0.35, handling: 0.95,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Carbine', kind: 'rifle', price: 2700,
    mag: 30, reserveMax: 90, damage: 33, headMult: 4, rpm: 600,
    spread: 0.005, moveSpread: 0.016, bloom: 0.0035, bloomMax: 0.042,
    recoil: 0.011, range: 70, zoom: 1, pellets: 1, auto: true, tracer: '#ffd27d',
    reload: 2.1, adsZoom: 1.5, kick: 0.55, draw: 0.55, handling: 0.8,
  },
  hornet: {
    id: 'hornet', name: 'Hornet-9 SMG', kind: 'smg', price: 1500,
    mag: 32, reserveMax: 96, damage: 22, headMult: 4, rpm: 900,
    spread: 0.010, moveSpread: 0.018, bloom: 0.003, bloomMax: 0.05,
    recoil: 0.007, range: 28, zoom: 1, pellets: 1, auto: true, tracer: '#ffd27d',
    reload: 1.9, adsZoom: 1.35, kick: 0.4, draw: 0.45, handling: 0.9,
  },
  longbow: {
    id: 'longbow', name: 'Longbow .50', kind: 'sniper', price: 4750,
    mag: 5, reserveMax: 15, damage: 110, headMult: 4, rpm: 55,
    spread: 0.001, moveSpread: 0.05, bloom: 0.001, bloomMax: 0.004,
    recoil: 0.05, range: 120, zoom: 3.2, pellets: 1, auto: false, tracer: '#cfe8ff',
    reload: 3.0, adsZoom: 3.2, kick: 1.0, draw: 0.9, handling: 0.45,
  },
  breacher: {
    id: 'breacher', name: 'Breacher-12', kind: 'shotgun', price: 1200,
    mag: 6, reserveMax: 24, damage: 12, headMult: 3, rpm: 75,
    spread: 0.028, moveSpread: 0.02, bloom: 0.004, bloomMax: 0.03,
    recoil: 0.03, range: 22, zoom: 1, pellets: 8, auto: false, tracer: '#ffd27d',
    reload: 2.6, adsZoom: 1.25, kick: 0.9, draw: 0.7, handling: 0.6,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, radius: 7, damage: 95, fuse: 1.4 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, radius: 5, duration: 14 },
  flash: { id: 'flash', name: 'Flash Grenade', price: 200, radius: 16, duration: 2.2 },
};

export const BUY_MENU = [
  { id: 'vk47', label: 'VK-47 Carbine — rifle', key: '2' },
  { id: 'hornet', label: 'Hornet-9 SMG', key: '3' },
  { id: 'breacher', label: 'Breacher-12 shotgun', key: '4' },
  { id: 'longbow', label: 'Longbow .50 sniper', key: '5' },
  { id: 'frag', label: 'Frag Grenade', key: '6' },
  { id: 'smoke', label: 'Smoke Grenade', key: '7' },
  { id: 'flash', label: 'Flash Grenade', key: '8' },
  { id: 'armor', label: 'Kevlar Armor (100)', key: '9' },
];

export function createWeaponState() {
  const ammo = {};
  for (const w of Object.values(WEAPONS)) ammo[w.id] = { mag: w.mag, reserve: w.reserveMax };
  return {
    current: 'p9',
    owned: new Set(['p9']),
    ammo,
    grenades: { frag: 0, smoke: 0, flash: 0 },
    armor: 0,
    bloom: 0,
    reloading: 0, // seconds left, 0 = not reloading
    reloadTotal: 0,
    lastShotAt: -10,
    selectedGrenade: 'frag',
    // Viewmodel feel, driven by game.js: kick decays to 0, draw counts down
    // after a switch, ads blends 0..1 while the right mouse button is held.
    kick: 0, drawT: 0, ads: 0,
  };
}

export function weaponDef(state) { return WEAPONS[state.current]; }

// Full reload time for a weapon definition (seconds).
export function reloadDuration(def) { return def.reload; }

// Field of view while aiming down sights with this weapon (base 75).
export function adsFov(def) { return 75 / def.adsZoom; }

export function currentSpread(state, moveSpeed, airborne, aiming, crouched) {
  const w = WEAPONS[state.current];
  let s = w.spread + state.bloom;
  // Snappy weapons settle faster after moving; heavy ones punish it more.
  s += Math.min(1, moveSpeed / 5) * w.moveSpread * (1.25 - w.handling * 0.5);
  if (airborne) s += 0.02;
  if (crouched) s *= 0.8;
  if (aiming) s *= w.kind === 'sniper' ? 0.25 : 0.6;
  return s;
}

export function readyToFire(state, now) {
  const w = WEAPONS[state.current];
  if (state.reloading > 0) return false;
  if (state.drawT > 0) return false;
  if (state.ammo[w.id].mag <= 0) return false;
  return now - state.lastShotAt >= 60 / w.rpm;
}

// Consume one round and return the shot. Null when the gun cannot fire.
export function fire(state, now) {
  if (!readyToFire(state, now)) return null;
  const w = WEAPONS[state.current];
  const a = state.ammo[w.id];
  a.mag -= 1;
  state.lastShotAt = now;
  state.bloom = Math.min(w.bloomMax, state.bloom + w.bloom);
  state.kick = Math.min(1, state.kick + w.kick);
  return { weapon: w, pellets: w.pellets };
}

export function startReload(state) {
  const w = WEAPONS[state.current];
  const a = state.ammo[w.id];
  if (state.reloading > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
  state.reloading = reloadDuration(w);
  state.reloadTotal = state.reloading;
  return true;
}

export function stepReload(state, dt) {
  if (state.reloading <= 0) return false;
  state.reloading -= dt;
  if (state.reloading > 0) return false;
  const w = WEAPONS[state.current];
  const a = state.ammo[w.id];
  const need = w.mag - a.mag;
  const take = Math.min(need, a.reserve);
  a.mag += take; a.reserve -= take;
  return true;
}

export function decayBloom(state, dt) {
  state.bloom = Math.max(0, state.bloom - dt * 0.03);
}

// Per-frame feel state: recoil kick decays, the draw timer runs out, ADS
// blends toward the aim button. Called once per simulation step.
export function stepFeel(state, dt, aiming) {
  state.kick = Math.max(0, state.kick - dt * 3.2);
  if (state.drawT > 0) state.drawT = Math.max(0, state.drawT - dt);
  const target = aiming ? 1 : 0;
  state.ads += (target - state.ads) * Math.min(1, dt * 14);
}

export function buy(state, id, money) {
  if (id === 'armor') {
    if (state.armor >= 100 || money < 650) return null;
    state.armor = 100;
    return 650;
  }
  const g = GRENADES[id];
  if (g) {
    if (state.grenades[id] >= 2 || money < g.price) return null;
    state.grenades[id] += 1;
    state.selectedGrenade = id;
    return g.price;
  }
  const w = WEAPONS[id];
  if (!w || state.owned.has(id) || money < w.price) return null;
  state.owned.add(id);
  state.ammo[id] = { mag: w.mag, reserve: w.reserveMax };
  state.current = id;
  state.drawT = w.draw;
  return w.price;
}

export function switchWeapon(state, id) {
  if (!state.owned.has(id) || state.reloading > 0) return false;
  if (state.current === id) return false;
  state.current = id;
  state.drawT = WEAPONS[id].draw;
  state.bloom = 0;
  return true;
}
