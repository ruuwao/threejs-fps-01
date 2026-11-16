// Boot and the main loop. Fixed 60 Hz simulation, render as fast as the
// browser goes. The camera follows the player's body; when the player is dead
// it follows a living teammate. `?shot=start|play|buy|end&seed=N` stages a
// deterministic frame for screenshots and sets window.__shotReady.
import * as THREE from 'three';
import { createMap } from './map.js';
import { hasLineOfSight } from './nav.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeaponState, WEAPONS, startReload, stepReload, decayBloom, currentSpread, switchWeapon, adsFov } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEconomy } from './economy.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';
import { mulberry32 } from './rng.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') ?? 7) >>> 0;
const random = mulberry32(SEED);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2f3d');
scene.fog = new THREE.Fog(new THREE.Color('#2a2f3d'), 55, 110);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const map = createMap(scene);
const player = createPlayer(map.colliders);
const input = createInput(renderer.domElement, onLockChange);
const weapons = createWeaponState();
const economy = createEconomy();
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud(map);
const bomb = createBomb(scene, map.sites);
// Bots and the game reference each other: the bots call the game's event
// handlers, the game drives the bots. The events object is filled in after
// both exist; bots.js looks the handlers up on every call, so this works.
const botEvents = {};
const bots = createBots(scene, map, random, botEvents);
const game = createGame({ scene, camera, map, player, input, weapons, bots, bomb, economy, audio, effects, hud, random });
Object.assign(botEvents, game.botEvents);

function onLockChange(locked) {
  if (locked) {
    hud.hideOverlay();
    audio.unlock();
  } else if (game.state.phase === 'live' || game.state.phase === 'buy') {
    if (game.state.phase === 'live' && player.state.hp > 0) {
      hud.showOverlay('paused');
    }
  }
}

hud.onPlay(() => {
  audio.unlock();
  if (game.state.phase === 'menu' || game.state.phase === 'matchEnd') {
    game.startMatch();
  }
  input.requestLock();
});

// ---- discrete key actions ----
const GRENADE_ORDER = ['frag', 'smoke', 'flash'];
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const phase = game.state.phase;
  if (e.code === 'KeyB' && phase === 'buy') {
    const menu = document.getElementById('buy-menu');
    if (menu.classList.contains('hidden')) hud.showBuy(game.buyList(), economy.money);
    else hud.hideBuy();
    return;
  }
  if (phase !== 'live' && phase !== 'buy') return;
  if (e.code === 'KeyR') {
    if (startReload(weapons)) audio.reload(WEAPONS[weapons.current].kind);
    return;
  }
  if (e.code === 'KeyG') {
    game.throwGrenade(nowSec);
    return;
  }
  if (e.code === 'KeyQ') {
    const owned = GRENADE_ORDER.filter((g) => weapons.grenades[g] > 0);
    if (owned.length) {
      const i = owned.indexOf(weapons.selectedGrenade);
      weapons.selectedGrenade = owned[(i + 1) % owned.length];
    }
    return;
  }
  if (phase === 'buy' && /^Digit[2-9]$/.test(e.code)) {
    const item = game.buyList().find((b) => b.key === e.code.slice(5));
    if (item && game.tryBuy(item.id)) {
      audio.buy();
      hud.showBuy(game.buyList(), economy.money);
    } else if (item) {
      audio.denied();
    }
    return;
  }
  if (phase === 'live' && /^Digit[1-5]$/.test(e.code)) {
    const ids = ['p9', 'vk47', 'hornet', 'breacher', 'longbow'];
    const id = ids[Number(e.code.slice(5)) - 1];
    if (id && switchWeapon(weapons, id)) {
      game.buildViewmodel();
      hud.setAmmo(weapons.ammo[id].mag, weapons.ammo[id].reserve);
      hud.setWeapon(WEAPONS[id].name, weapons.grenades);
      audio.weaponDraw();
    }
  }
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- the loop ----
let nowSec = 0;
let prevFiring = false;
let acc = 0;
let last = performance.now();
let minimapAt = 0;

function simulate(dt) {
  nowSec += dt;
  const p = player.state;
  // Look.
  const look = input.takeLook();
  // Aiming down sights narrows the field of view and the sensitivity with it,
  // so a scoped shot stays steady.
  const sens = input.state.aiming ? 0.0022 * (camera.fov / 75) : 0.0022;
  if (input.locked && p.hp > 0) player.look(look.x, look.y, sens);
  // Move.
  const sprinting = (input.state.keys.has('ShiftLeft') || input.state.keys.has('ShiftRight')) && !input.state.aiming;
  if (p.hp > 0 && (game.state.phase === 'live' || game.state.phase === 'buy')) {
    player.step(dt, input.state.keys, sprinting);
  }
  // Footsteps and landing, from the distance the body actually travelled.
  if (p.stepAccum > 2.2 && p.onGround) {
    p.stepAccum = 0;
    audio.step(sprinting);
  }
  if (p.landed) {
    p.landed = false;
    audio.land();
    effects.dustPuff(new THREE.Vector3(p.position.x, 0.15, p.position.z), 0.8);
  }
  // Camera follows the body (or a teammate when dead) — synced before firing
  // so the shot goes where the player is looking this frame.
  if (p.hp > 0) {
    camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
    camera.rotation.y = p.yaw + p.recoilYaw;
    camera.rotation.x = p.pitch + p.recoilPitch;
    camera.rotation.z = 0;
  } else if (game.state.spectating) {
    const b = game.state.spectating;
    camera.position.set(b.pos.x, 1.7, b.pos.z);
    camera.rotation.y = b.yaw;
    camera.rotation.x = -0.05;
    camera.rotation.z = 0;
  }
  // Viewmodel motion: bob, sway, recoil kick, ADS, reload dip.
  game.updateViewmodel(dt, look.x, look.y);
  // Reload + bloom.
  if (stepReload(weapons, dt)) {
    hud.setAmmo(weapons.ammo[weapons.current].mag, weapons.ammo[weapons.current].reserve);
    audio.reloadDone();
  }
  decayBloom(weapons, dt);
  // Fire.
  const def = WEAPONS[weapons.current];
  const edge = input.state.firing && !prevFiring;
  prevFiring = input.state.firing;
  if (game.state.phase === 'live' && p.hp > 0 && input.locked) {
    if ((def.auto && input.state.firing) || (!def.auto && edge)) {
      game.playerShoot(nowSec);
    }
  }
  // Rules.
  game.step(dt, nowSec);
  effects.step(dt);
  map.animate(dt);
  // Aim-down-sights zoom, per weapon: the sniper scopes in hard, the carbine
  // barely, the pistol not at all. Sensitivity drops with the zoom so the aim
  // stays steady.
  const wantFov = input.state.aiming ? adsFov(def) : 75;
  if (Math.abs(camera.fov - wantFov) > 0.2) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  hud.setScope(input.state.aiming && weapons.current === 'longbow');
  // HUD.
  const spread = currentSpread(weapons, player.groundSpeed(), !p.onGround, input.state.aiming, p.crouched);
  hud.setCrosshair(4 + spread * 2600);
  if (nowSec - minimapAt > 0.25) {
    minimapAt = nowSec;
    hud.minimap(player.state, bots.bots, bomb, map.sites, game.state.smokes);
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, t - last);
  last = t;
  acc += dtMs / 1000;
  let steps = 0;
  while (acc >= 1 / 60 && steps < 5) {
    simulate(1 / 60);
    acc -= 1 / 60;
    steps += 1;
  }
  if (steps === 5) acc = 0;
  renderer.render(scene, camera);
}

// ---- shot staging for screenshots ----
function stageShot() {
  if (SHOT === 'play') {
    game.startMatch();
    // Skip the buy phase, scatter the bots into the lanes.
    game.state.phase = 'live';
    game.state.phaseT = 88;
    hud.hideBuy();
    for (let i = 0; i < 60 * 6; i += 1) simulate(1 / 60);
    // Frame the shot on the nearest living defender: stand where the lane to
    // them is clear (walls block most spots, so try around them), facing them.
    // Fall back to the mid-lane view when no clear spot exists.
    const foes = bots.bots.filter((b) => b.alive && b.team === 'defend')
      .sort((a, b) => Math.hypot(a.pos.x + 2, a.pos.z - 6) - Math.hypot(b.pos.x + 2, b.pos.z - 6));
    let framed = false;
    for (const foe of foes) {
      for (const [dx, dz] of [[0, 8], [0, -8], [8, 0], [-8, 0], [6, 6], [-6, 6], [6, -6], [-6, -6], [0, 12], [0, -12]]) {
        const px = foe.pos.x + dx, pz = foe.pos.z + dz;
        if (px < -31 || px > 31 || pz < -23 || pz > 23) continue;
        if (!hasLineOfSight(map.tallColliders, px, pz, foe.pos.x, foe.pos.z)) continue;
        const yaw = Math.atan2(-(foe.pos.x - px), -(foe.pos.z - pz));
        player.spawn(px, pz, yaw);
        player.state.hp = 100;
        camera.position.set(px, 1.62, pz);
        camera.rotation.y = yaw;
        camera.rotation.x = -0.02;
        framed = true;
        break;
      }
      if (framed) break;
    }
    if (!framed) {
      player.spawn(-2, 6, 0.05);
      player.state.hp = 100;
      camera.position.set(-2, 1.62, 6);
      camera.rotation.y = 0.05;
      camera.rotation.x = -0.02;
    }
    renderer.render(scene, camera);
  } else if (SHOT === 'buy') {
    game.startMatch();
    economy.money = 5000;
    game.tryBuy('vk47');
    game.tryBuy('frag');
    hud.setMoney(economy.money);
    hud.showBuy(game.buyList(), economy.money);
    renderer.render(scene, camera);
  } else if (SHOT === 'end') {
    game.startMatch();
    hud.hideBuy();
    game.state.scoreA = 5; game.state.scoreB = 3;
    game.state.phase = 'matchEnd';
    hud.setScore(5, 3);
    hud.showOverlay('match', { title: 'VANGUARD WINS THE MATCH', copy: 'Final score 5 — 3. The relay is yours.' });
    // A quiet backdrop: down the mid lane at dusk.
    camera.position.set(0, 5, 18);
    camera.lookAt(0, 1, -14);
    renderer.render(scene, camera);
  } else {
    // start: the menu over a wide view of the map.
    hud.showOverlay('start');
    camera.position.set(14, 7, 22);
    camera.lookAt(0, 1, -8);
    renderer.render(scene, camera);
  }
  window.__shotReady = true;
}

if (SHOT) {
  stageShot();
  // Keep rendering so the shot is live when the screenshot lands.
  requestAnimationFrame(frame);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}

// Debug handle for headless tests and the finalist review: the whole game
// state, reachable from the console as __dustfall.game / .bots / .player.
window.__dustfall = { game, bots, player, weapons, bomb, economy, map, camera };
