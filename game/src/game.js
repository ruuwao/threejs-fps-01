// The game: rounds, the bomb, the economy, the shooting and the bots' orders.
// One place owns the rules; main.js owns the loop and the camera. A round is
// buy (15 s), live (100 s) or over. Attackers win by wiping the Wardens or
// detonating the device; defenders win by wiping the Vanguard, defusing, or
// running the clock out with no plant. First to 5 rounds takes the match.
//
// Teams: A = Vanguard (attack, the player's team), B = Wardens (defend).
// The player always attacks; the bomb carrier is the player on odd rounds
// and a bot on even ones, so both sides of the objective get played.
import * as THREE from 'three';
import { WEAPONS, GRENADES, BUY_MENU, fire, currentSpread, stepFeel, buy as buyItem } from './weapons.js';
import { roundEnd as payRound } from './economy.js';
import { pick } from './rng.js';

const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const ROUND_END_SECONDS = 4.5;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;

// Bot buy progression: round 1 is pistols and SMGs, later rounds the bots
// roll a rifle or a sniper out of the pool. A bot that already owns its
// weapon keeps it; the loadout only decides what it spawns with.
const BOT_BUY = [
  { weapon: 'p9', armor: false },
  { weapon: 'hornet', armor: true },
  { weapon: 'vk47', armor: true },
  { weapon: 'vk47', armor: true },
  { weapon: 'longbow', armor: true },
];

// Waypoint indices for the three attack entries: A lane, B lane, mid.
const ATTACK_ENTRIES = { A: [22, 23, 24], B: [26, 27, 28], mid: [16, 15, 17] };
const DEFEND_SPOTS = [22, 26, 16, 23, 27];

export function createGame(deps) {
  const { scene, camera, map, player, input, weapons, bots, bomb, economy, audio, effects, hud, random } = deps;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;
  // Scratch vectors: the hot loops (shooting, tracers) reuse these instead
  // of allocating a Vector3 per pellet per frame.
  const shootDir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const negDir = new THREE.Vector3();

  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 0,
    scoreA: 0, scoreB: 0, // A = Vanguard (attack), B = Wardens (defend)
    phaseT: 0,
    roundKills: 0, plantedThisRound: false,
    carrierId: -1, // -2 = the player carries, -1 = nobody, else a bot id
    noise: null, // last loud sound {x, z, at}: bots hear it and investigate
    smokes: [],
    flashes: [],
    grenades: [],
    plantProgress: 0, defuseProgress: 0,
    spectating: null,
    roundWinner: null,
    lastBombBeep: -10,
  };

  // ---- weapon viewmodel ----
  // Boxes on the camera, reshaped per weapon. Each kind has its own
  // silhouette — a long scoped tube for the sniper, a fat barrel and pump
  // for the shotgun, a short body for the SMG — plus a stock and a
  // foregrip, so the gun reads as a gun instead of a grey bar.
  const viewmodel = new THREE.Group();
  const vmParts = {};
  const vmSway = { x: 0, y: 0, bob: 0 };

  function vmMat(color, roughness = 0.55) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0.25 });
  }
  function vmBox(w, h, d, mat, x, y, z, rotX = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (rotX) mesh.rotation.x = rotX;
    return mesh;
  }

  function buildViewmodel() {
    while (viewmodel.children.length) viewmodel.remove(viewmodel.children[0]);
    const dark = vmMat('#2e333c');
    const mid = vmMat('#4a505c');
    const accent = vmMat('#2ec4b6', 0.4);
    const def = WEAPONS[weapons.current];
    const kind = def.kind;
    const len = kind === 'sniper' ? 0.95 : kind === 'shotgun' ? 0.72 : kind === 'smg' ? 0.5 : kind === 'rifle' ? 0.78 : 0.34;
    viewmodel.add(
      vmBox(0.07, 0.11, len, dark, 0.26, -0.24, -0.35 - len / 2 + 0.2), // receiver
      vmBox(0.06, 0.16, 0.09, mid, 0.26, -0.32, -0.12, 0.35), // grip
      vmBox(0.05, 0.2, 0.08, mid, 0.26, -0.33, -0.32, 0.15), // magazine
      vmBox(0.02, 0.035, 0.07, accent, 0.26, -0.165, -0.5), // sight
      vmBox(0.06, 0.09, 0.22, dark, 0.26, -0.25, -0.06), // stock
      vmBox(0.06, 0.07, 0.16, mid, 0.26, -0.29, -0.52), // foregrip
    );
    if (kind === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 12), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0.26, -0.15, -0.5);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fd8e8') }));
      lens.position.set(0.26, -0.15, -0.62);
      lens.rotation.y = Math.PI;
      viewmodel.add(scope, lens);
    }
    if (kind === 'shotgun') {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10), mid);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0.26, -0.2, -0.62);
      viewmodel.add(barrel, vmBox(0.07, 0.06, 0.18, dark, 0.26, -0.29, -0.55)); // pump
    }
    if (kind === 'smg') {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10), dark);
      can.rotation.x = Math.PI / 2;
      can.position.set(0.26, -0.21, -0.62);
      viewmodel.add(can);
    }
    vmParts.muzzleLocal = new THREE.Vector3(0.26, -0.2, -0.35 - len + 0.2);
  }
  buildViewmodel();
  camera.add(viewmodel);

  // Per-frame viewmodel motion: walk bob, look sway, recoil kick, ADS
  // centring and the reload dip. Called from the main loop with the look delta.
  function updateViewmodel(dt, lookDx, lookDy) {
    const def = WEAPONS[weapons.current];
    const speed = player.groundSpeed();
    // Bob: two steps per stride, stronger while sprinting, softer crouched.
    vmSway.bob += dt * (4 + speed * 1.6);
    const bobAmp = Math.min(1, speed / 5) * (player.state.crouched ? 0.4 : 1) * 0.011;
    const bobX = Math.sin(vmSway.bob) * bobAmp;
    const bobY = Math.abs(Math.cos(vmSway.bob)) * bobAmp * 0.8;
    // Sway lags behind the look: the gun trails the aim slightly.
    vmSway.x += ((-lookDx * 0.00035) - vmSway.x) * Math.min(1, dt * 10);
    vmSway.y += ((lookDy * 0.00035) - vmSway.y) * Math.min(1, dt * 10);
    // Recoil kick: the gun jumps back and up, then settles.
    const kick = weapons.kick;
    const kickZ = kick * 0.09;
    const kickY = kick * 0.03;
    // Reload dip: the gun tilts down and drops through the reload.
    let dipY = 0;
    let dipRot = 0;
    if (weapons.reloading > 0 && weapons.reloadTotal > 0) {
      const f = 1 - weapons.reloading / weapons.reloadTotal; // 0..1
      const dip = Math.sin(f * Math.PI);
      dipY = -dip * 0.14;
      dipRot = -dip * 0.5;
    }
    // Draw: the gun rises into place after a switch.
    const draw = weapons.drawT > 0 && def.draw > 0 ? weapons.drawT / def.draw : 0;
    const drawY = -draw * 0.18;
    // ADS: slide the gun to the centre so the sight sits on the crosshair.
    const ads = weapons.ads;
    viewmodel.position.set(
      -0.26 * ads + bobX + vmSway.x,
      0.15 * ads + bobY + kickY + dipY + drawY,
      kickZ,
    );
    viewmodel.rotation.x = dipRot + kick * 0.12;
    viewmodel.rotation.z = vmSway.x * 2;
  }

  function muzzleWorld() {
    muzzle.copy(vmParts.muzzleLocal);
    return viewmodel.localToWorld(muzzle);
  }

  // Defenders abandon their holds and rotate to a site: used both when
  // the player plants and when a bot plants, so the response is identical.
  function rotateDefendersTo(site) {
    for (const b of bots.alive('defend')) {
      b.holdNode = -1;
      b.state = 'route';
      bots.setPath(b, site === 'A' ? 22 : 26);
    }
  }

  // ---- round setup ----
  function botLoadouts(round) {
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      if (round === 1) out.push(i < 2 ? BOT_BUY[0] : BOT_BUY[1]);
      else out.push(BOT_BUY[Math.min(BOT_BUY.length - 1, 1 + Math.floor(random() * 4))]);
    }
    return out;
  }

  function assignAttackers() {
    // Most rounds push a site; sometimes the team goes mid and splits.
    const site = random() < 0.42 ? 'A' : random() < 0.82 ? 'B' : 'mid';
    const entries = ATTACK_ENTRIES[site];
    const attackers = bots.alive('attack');
    attackers.forEach((b, i) => {
      b.routeSite = site;
      b.holdNode = -1;
      bots.setPath(b, entries[i % 3]);
      b.state = 'route';
    });
    // The carrier is the first attacker; if the player carries, no bot does
    // (startRound takes it back on odd rounds).
    const carrier = attackers[0];
    if (carrier) carrier.carryingBomb = true;
    state.carrierId = carrier ? carrier.id : -1;
  }

  function assignDefenders() {
    const defenders = bots.alive('defend');
    defenders.forEach((b, i) => {
      b.holdNode = DEFEND_SPOTS[i % DEFEND_SPOTS.length];
      bots.setPath(b, b.holdNode);
      b.state = 'route';
      b.routeSite = null;
    });
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.phaseT = BUY_SECONDS;
    state.roundKills = 0;
    state.plantedThisRound = false;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.grenades.length = 0;
    state.smokes.length = 0;
    state.spectating = null;
    bomb.reset(null);
    // Player respawns; owned weapons refill to full ammo each round.
    const spawn = map.spawns.attack[(state.round - 1) % 5];
    player.spawn(spawn.x, spawn.z, spawn.yaw);
    player.state.hp = 100;
    for (const id of weapons.owned) {
      weapons.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserveMax };
    }
    bots.spawnRound(botLoadouts(state.round), botLoadouts(state.round));
    assignAttackers();
    assignDefenders();
    // The player is the bomb carrier on odd rounds; a bot carries on even ones.
    if (state.round % 2 === 1) {
      const botCarrier = bots.bots.find((b) => b.carryingBomb);
      if (botCarrier) botCarrier.carryingBomb = false;
      state.carrierId = -2; // -2 = the player carries
    }
    hud.setRound(state.round);
    hud.setScore(state.scoreA, state.scoreB);
    hud.setMoney(economy.money);
    hud.setBomb('', false);
    hud.setAmmo(weapons.ammo[weapons.current].mag, weapons.ammo[weapons.current].reserve);
    hud.setHealth(100, weapons.armor);
    hud.setWeapon(WEAPONS[weapons.current].name, weapons.grenades);
    hud.banner(`ROUND ${state.round}`, 'Buy phase — press B to buy, then the round starts', 3000);
    hud.showBuy(buyList(), economy.money);
    audio.gust();
  }

  // The buy menu with live prices: armor is a flat $650, everything else
  // takes its price from its own table.
  function buyList() {
    return BUY_MENU.map((item) => {
      const price = item.id === 'armor' ? 650 : (WEAPONS[item.id]?.price ?? GRENADES[item.id]?.price ?? 0);
      return { ...item, price };
    });
  }

  // ---- round end ----
  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.phaseT = ROUND_END_SECONDS;
    state.roundWinner = winner;
    if (winner === 'attack') state.scoreA += 1; else state.scoreB += 1;
    const earned = payRound(economy, winner === 'attack', state.roundKills, state.plantedThisRound);
    hud.setScore(state.scoreA, state.scoreB);
    hud.setMoney(economy.money);
    hud.hideBuy();
    const title = winner === 'attack' ? 'VANGUARD WINS THE ROUND' : 'WARDENS WIN THE ROUND';
    hud.banner(title, reason, 4200);
    hud.roundSummary([
      `ROUND ${state.round} — ${winner === 'attack' ? 'VANGUARD' : 'WARDENS'}  ${state.scoreA} — ${state.scoreB}`,
      reason,
      `Kills: ${state.roundKills}  •  Plant: ${state.plantedThisRound ? 'yes' : 'no'}  •  Earned $${earned}`,
      `Funds: $${economy.money}`,
    ]);
    if (winner === 'attack') audio.roundWin(); else audio.roundLose();
    hud.setBomb('', false);
    hud.setProgress(0);
  }

  function checkRoundEnd(now) {
    const atk = bots.alive('attack').length + (playerAlive() ? 1 : 0);
    const def = bots.alive('defend').length;
    if (bomb.state.status === 'detonated') { endRound('attack', 'The device detonated at the site.'); return; }
    if (bomb.state.status === 'defused') { endRound('defend', 'The device was defused.'); return; }
    if (atk === 0) { endRound('defend', 'Vanguard eliminated.'); return; }
    if (def === 0) {
      // A planted bomb still decides the round: the defenders are dead,
      // but the device can still go off — or be defused by no one.
      if (bomb.state.status === 'planted' || bomb.state.status === 'defusing') return;
      endRound('attack', 'Wardens eliminated.');
    }
  }

  function playerAlive() { return state.phase === 'live' && player.state.hp > 0; }

  function playerDie(killerName) {
    player.state.hp = 0;
    hud.setHealth(0, weapons.armor);
    hud.banner('YOU WERE ELIMINATED', `by ${killerName} — spectating a teammate`, 3000);
    if (state.carrierId === -2) {
      bomb.drop(player.state.position.x, player.state.position.z);
      state.carrierId = -1;
      hud.banner('BOMB DROPPED', 'The device is on the ground — a teammate can pick it up', 2600);
    }
    const mate = bots.alive('attack')[0];
    state.spectating = mate ?? null;
    if (document.pointerLockElement) document.exitPointerLock();
    checkRoundEnd(0);
  }

  // Damage to the player, through armor first: armor absorbs half the hit
  // (rounded) until it runs out, so 100 armor eats about 200 damage.
  function damagePlayer(amount, fromPos, killerName) {
    if (!playerAlive()) return;
    let dmg = amount;
    if (weapons.armor > 0) {
      const absorbed = Math.min(weapons.armor, Math.round(dmg * 0.5));
      weapons.armor -= absorbed;
      dmg -= absorbed;
    }
    player.state.hp -= dmg;
    audio.hurt();
    hud.damageFlash(0.6);
    // Show where the shot came from: bearing of the shooter relative to the
    // player's facing, 0 = ahead, +90 = to the right.
    if (fromPos) {
      const dx = fromPos.x - player.state.position.x;
      const dz = fromPos.z - player.state.position.z;
      const yaw = player.state.yaw;
      const fwd = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
      const rgt = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
      hud.damageDirection((Math.atan2(rgt, fwd) * 180) / Math.PI);
    }
    hud.setHealth(player.state.hp, weapons.armor);
    if (player.state.hp <= 0) playerDie(killerName);
  }

  // ---- shooting ----
  function playerShoot(now) {
    if (!playerAlive()) return;
    const shot = fire(weapons, now);
    if (!shot) {
      // Click on an empty magazine: the dry-fire click, not silence.
      if (weapons.ammo[weapons.current].mag === 0 && weapons.reloading <= 0) audio.dryFire();
      return;
    }
    const def = shot.weapon;
    const spread = currentSpread(weapons, player.groundSpeed(), !player.state.onGround, input.state.aiming, player.state.crouched);
    camera.getWorldDirection(shootDir);
    // Recoil: pitch up, slight yaw drift, a little random each shot so a
    // spray walks instead of stacking on one pixel.
    player.recoil(def.recoil * (0.8 + Math.random() * 0.4), (Math.random() * 2 - 1) * def.recoil * 0.4);
    audio.shot(def.kind);
    const from = muzzleWorld();
    effects.muzzle(from, def.kind === 'sniper' ? 1.6 : def.kind === 'shotgun' ? 1.3 : 1);
    state.noise = { x: player.state.position.x, z: player.state.position.z, at: now };
    let hitSomething = false;
    for (let p = 0; p < shot.pellets; p += 1) {
      // Each pellet gets its own jitter inside the spread cone. The spread
      // is added per axis and renormalised, so the cone stays a cone.
      const dir = shootDir.clone();
      dir.x += (Math.random() * 2 - 1) * spread;
      dir.y += (Math.random() * 2 - 1) * spread;
      dir.z += (Math.random() * 2 - 1) * spread;
      dir.normalize();
      raycaster.set(camera.position, dir);
      raycaster.far = def.range;
      const targets = [];
      for (const b of bots.bots) {
        if (!b.alive || b.team !== 'defend') continue;
        for (const m of b.body.meshes) targets.push(m);
      }
      const hits = raycaster.intersectObjects(targets.concat(map.shootables), false);
      const hit = hits[0];
      if (!hit) {
        const end = camera.position.clone().addScaledVector(dir, def.range);
        effects.tracer(from, end, def.tracer);
        continue;
      }
      hitPoint.copy(hit.point);
      effects.tracer(from, hitPoint, def.tracer);
      if (hit.object.userData.botId !== undefined) {
        const bot = bots.bots[hit.object.userData.botId];
        if (bot && bot.alive) {
          const part = hit.object.userData.part ?? 'torso';
          const dist = hit.distance;
          // Damage falls off past 30 m: a rifle still hurts at range, a
          // pistol does not.
          const falloff = dist > 30 ? 0.8 : 1;
          const dmg = Math.round(def.damage * (part === 'head' ? def.headMult : part === 'legs' ? 0.75 : 1) * falloff);
          const killed = bots.damage(bot, dmg, part);
          effects.hitPuff(hitPoint, part === 'head');
          if (part === 'head') audio.headshot(); else audio.hit();
          hud.hitMarker(killed, part === 'head');
          hud.setAmmo(weapons.ammo[weapons.current].mag, weapons.ammo[weapons.current].reserve);
          if (killed) {
            audio.kill();
            state.roundKills += 1;
            hud.killfeed(`You  [${def.name}]  ${bot.name}${part === 'head' ? ' — headshot' : ''}`, true);
            if (bot.carryingBomb) {
              bomb.drop(bot.pos.x, bot.pos.z);
              bot.carryingBomb = false;
              hud.banner('BOMB DROPPED', 'The device is on the ground — pick it up', 2600);
            }
          }
          hitSomething = true;
        }
      } else {
        negDir.copy(dir).negate();
        effects.impact(hitPoint, negDir);
        hitSomething = true;
      }
    }
    hud.setAmmo(weapons.ammo[weapons.current].mag, weapons.ammo[weapons.current].reserve);
    return hitSomething;
  }

  // ---- grenades ----
  function throwGrenade(now) {
    if (!playerAlive()) return;
    const id = weapons.selectedGrenade;
    if (weapons.grenades[id] <= 0) return;
    weapons.grenades[id] -= 1;
    hud.setWeapon(WEAPONS[weapons.current].name, weapons.grenades);
    const g = GRENADES[id];
    camera.getWorldDirection(shootDir);
    const pos = camera.position.clone().addScaledVector(shootDir, 0.6);
    pos.y -= 0.1;
    const vel = shootDir.clone().multiplyScalar(16);
    vel.y += 3.2;
    state.grenades.push({ id, pos, vel, fuse: g.fuse, bounced: 0 });
    audio.pinPull();
    state.noise = { x: pos.x, z: pos.z, at: now };
  }

  function stepGrenades(dt, now) {
    for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
      const g = state.grenades[i];
      g.vel.y -= 14 * dt;
      g.pos.addScaledVector(g.vel, dt);
      // Bounce off AABBs (cheap: clamp + reflect the dominant axis). A
      // grenade that has bounced four times is spent — it goes off where
      // it is instead of rolling forever.
      for (const b of map.colliders) {
        if (g.pos.x > b.min.x - 0.12 && g.pos.x < b.max.x + 0.12
          && g.pos.y > b.min.y - 0.12 && g.pos.y < b.max.y + 0.12
          && g.pos.z > b.min.z - 0.12 && g.pos.z < b.max.z + 0.12) {
          const dxMin = Math.abs(g.pos.x - b.min.x);
          const dxMax = Math.abs(g.pos.x - b.max.x);
          const dzMin = Math.abs(g.pos.z - b.min.z);
          const dzMax = Math.abs(g.pos.z - b.max.z);
          const dyMin = Math.abs(g.pos.y - b.min.y);
          const dyMax = Math.abs(g.pos.y - b.max.y);
          const m = Math.min(dxMin, dxMax, dzMin, dzMax, dyMin, dyMax);
          if (m === dxMin || m === dxMax) g.vel.x *= -0.45;
          else if (m === dzMin || m === dzMax) g.vel.z *= -0.45;
          else g.vel.y *= -0.45;
          g.vel.multiplyScalar(0.7);
          g.bounced += 1;
          break;
        }
      }
      if (g.pos.y < 0.12) {
        g.pos.y = 0.12;
        g.vel.y = Math.abs(g.vel.y) * 0.4;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      g.fuse -= dt;
      if (g.fuse <= 0 || g.bounced > 4) {
        state.grenades.splice(i, 1);
        detonateGrenade(g, now);
      }
    }
  }

  function detonateGrenade(g, now) {
    const def = GRENADES[g.id];
    if (g.id === 'frag') {
      effects.explosion(g.pos);
      audio.explosion();
      // Damage falls off linearly to the edge, and a wall does not help:
      // the radius is the radius. Friendly fire is off for bots, on for
      // the player — a frag at your own feet hurts.
      const hurt = (target, isPlayer) => {
        const d = Math.hypot(target.pos.x - g.pos.x, target.pos.z - g.pos.z);
        if (d > def.radius) return;
        const dmg = Math.round(def.damage * (1 - d / (def.radius * 1.4)));
        if (isPlayer) damagePlayer(dmg, g.pos, 'a frag grenade');
        else {
          const killed = bots.damage(target, dmg, 'torso');
          if (killed) {
            state.roundKills += 1;
            hud.killfeed(`You  [Frag]  ${target.name}`, true);
          }
        }
      };
      for (const b of bots.bots) if (b.alive && b.team === 'defend') hurt(b, false);
      if (playerAlive()) hurt({ pos: player.state.position }, true);
    } else if (g.id === 'smoke') {
      const s = effects.smokeAt(g.pos.x, g.pos.z, def.duration);
      if (s) state.smokes.push({ x: g.pos.x, z: g.pos.z, r: def.radius, until: now + def.duration });
    } else if (g.id === 'flash') {
      effects.explosion(g.pos);
      // Anyone looking at the flash within radius and line of sight is
      // blinded; looking away, or far off, only dims it. Bots get a
      // blind timer; the player gets a white flash on the screen.
      const blind = (target, isPlayer) => {
        const d = Math.hypot(target.pos.x - g.pos.x, target.pos.z - g.pos.z);
        if (d > def.radius) return;
        if (isPlayer) {
          const dx = g.pos.x - player.state.position.x;
          const dz = g.pos.z - player.state.position.z;
          const ang = Math.atan2(-dx, -dz);
          const diff = Math.abs(((ang - player.state.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (diff < 1.6) hud.flashBlind(Math.max(0.25, 1 - d / def.radius));
        } else {
          target.flashUntil = now + def.duration * Math.max(0.25, 1 - d / def.radius);
        }
      };
      for (const b of bots.bots) if (b.alive) blind(b, false);
      if (playerAlive()) blind({ pos: player.state.position }, true);
    }
  }

  // ---- bomb interactions ----
  function stepBomb(dt, now) {
    const bs = bomb.state;
    if (bs.status === 'planted' || bs.status === 'defusing') {
      bomb.step(dt);
      hud.setBomb(`DEVICE ${bs.status === 'defusing' ? 'DEFUSING ' : ''}${Math.ceil(bs.fuse)}s — ${bs.site}`, true);
      // The device beeps, faster as the fuse runs down — the whole map hears it.
      const interval = bs.fuse < 10 ? 0.5 : 1;
      if (now - state.lastBombBeep >= interval) {
        state.lastBombBeep = now;
        audio.beep(bs.fuse < 10);
      }
      if (bs.status === 'detonated') { checkRoundEnd(now); return; }
      if (bs.status === 'defused') { checkRoundEnd(now); return; }
    }
    // Player planting: hold E inside a site for the full plant time. Letting
    // go — or stepping out — bleeds the progress back down twice as fast.
    if (playerAlive() && state.carrierId === -2) {
      const site = bomb.inSite(player.state.position.x, player.state.position.z);
      const holding = input.state.keys.has('KeyE');
      if (site && holding && bs.status === 'carried') {
        state.plantProgress += dt;
        hud.setBomb(`PLANTING… ${Math.ceil((PLANT_SECONDS - state.plantProgress) * 10) / 10}s`, false);
        hud.setProgress(state.plantProgress / PLANT_SECONDS, `PLANTING THE DEVICE — ${site}`);
        if (state.plantProgress >= PLANT_SECONDS) {
          bomb.finishPlant(player.state.position.x, player.state.position.z, site);
          state.plantedThisRound = true;
          state.carrierId = -3;
          state.plantProgress = 0;
          hud.setProgress(0);
          audio.plant();
          hud.banner('DEVICE PLANTED', `at site ${site} — defend it until it blows`, 3200);
          hud.killfeed('You planted the device', true);
          // Defenders rotate to the planted site.
          rotateDefendersTo(site);
        }
      } else {
        state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
        hud.setProgress(state.plantProgress > 0 ? state.plantProgress / PLANT_SECONDS : 0);
        if (bs.status === 'carried' && state.plantProgress <= 0) {
          hud.setBomb(site ? 'Hold E to plant the device' : 'Carry the device to Relay or Silo', false);
        }
      }
    }
    // Player defusing (the player attacks, so this never fires in a normal
    // match; kept for symmetry if the player ever defends).
    if (playerAlive() && (bs.status === 'planted' || bs.status === 'defusing')) {
      const d = Math.hypot(bomb.state.pos.x - player.state.position.x, bomb.state.pos.z - player.state.position.z);
      if (d < 1.6 && input.state.keys.has('KeyE')) {
        state.defuseProgress += dt;
        hud.setBomb(`DEFUSING… ${Math.ceil((DEFUSE_SECONDS - state.defuseProgress) * 10) / 10}s`, true);
        hud.setProgress(state.defuseProgress / DEFUSE_SECONDS, 'DEFUSING THE DEVICE');
        if (state.defuseProgress >= DEFUSE_SECONDS) {
          bomb.finishDefuse();
          hud.setProgress(0);
          checkRoundEnd(now);
        }
      } else {
        state.defuseProgress = Math.max(0, state.defuseProgress - dt * 2);
        hud.setProgress(state.defuseProgress > 0 ? state.defuseProgress / DEFUSE_SECONDS : 0);
      }
    }
  }

  // Bot events, wired by main.js into the bots module. The bots call these;
  // the game answers with rules, sound and HUD.
  const botEvents = {
    onBotFootstep(bot) {
      // Only audible when the bot is near the player.
      const d = Math.hypot(bot.pos.x - player.state.position.x, bot.pos.z - player.state.position.z);
      if (d < 16) audio.distantStep(d);
    },

    onBotShot(bot, target, dmg, headshot, muzzlePos) {
      // Tracer + sound for every bot shot.
      const from = new THREE.Vector3(muzzlePos.x, muzzlePos.y, muzzlePos.z);
      const to = new THREE.Vector3(target.pos.x, target.isPlayer ? 1.4 : 1.3, target.pos.z);
      effects.tracer(from, to, '#ffb37d');
      const d = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
      audio.enemyShot(d);
      if (dmg > 0) {
        if (target.isPlayer) {
          damagePlayer(dmg, bot.pos, bot.name);
        } else {
          const killed = bots.damage(target, dmg, headshot ? 'head' : 'torso');
          if (killed) {
            hud.killfeed(`${bot.name}  [${WEAPONS[bot.weapon].name}]  ${target.name}`, bot.team === 'attack');
            if (target.carryingBomb) {
              bomb.drop(target.pos.x, target.pos.z);
              target.carryingBomb = false;
            }
          }
        }
      }
    },

    onDeath(bot) {
      // Drop the bomb, reassign the carrier to the next living attacker.
      if (bot.carryingBomb) {
        bomb.drop(bot.pos.x, bot.pos.z);
        bot.carryingBomb = false;
        const next = bots.alive('attack')[0];
        if (next) {
          next.carryingBomb = true;
          state.carrierId = next.id;
        } else {
          state.carrierId = -1;
        }
      }
      checkRoundEnd(0);
    },

    onBotArrived(bot) {
      if (bot.team === 'attack' && bot.routeSite) {
        const site = bot.routeSite === 'mid' ? null : bot.routeSite;
        if (site && bot.carryingBomb && bomb.state.status === 'carried') {
          const s = map.sites[site];
          const inSite = bot.pos.x >= s.minX && bot.pos.x <= s.maxX && bot.pos.z >= s.minZ && bot.pos.z <= s.maxZ;
          const enemiesNear = bots.alive('defend').some((d) => Math.hypot(d.pos.x - bot.pos.x, d.pos.z - bot.pos.z) < 14);
          if (inSite && !enemiesNear) {
            // Clear site, bomb in hand: plant it.
            bot.state = 'plant';
            bot.plantProgress = 0;
            bomb.startPlant(site, bot);
          } else if (inSite) {
            // Hold the site and wait for it to clear.
            bot.state = 'hold';
            bot.holdNode = bot.routeSite === 'A' ? 22 : 26;
          } else {
            // Walk to the site center, then the arrival handler plants.
            const c = map.sites[site].center;
            const node = bots.nearestNode(c.x, c.z);
            bots.setPath(bot, node);
            bot.state = 'route';
          }
        } else if (bot.holdNode >= 0) {
          bot.state = 'hold';
        } else {
          // Pick a new waypoint to keep moving: patrol between site and mid.
          const next = pick(random, [22, 26, 16, 15, 17]);
          bots.setPath(bot, next);
          bot.state = 'route';
        }
      } else if (bot.team === 'defend') {
        if (bot.holdNode >= 0) bot.state = 'hold';
      }
    },

    onPlantStart(bot) {
      bomb.startPlant(bot.routeSite, bot);
    },

    onPlantDone(bot) {
      bomb.finishPlant(bot.pos.x, bot.pos.z, bot.routeSite ?? bomb.state.site);
      state.plantedThisRound = true;
      state.carrierId = -3;
      bot.state = 'hold';
      audio.plant();
      hud.banner('DEVICE PLANTED', `at site ${bomb.state.site} — the Wardens are rotating`, 3200);
      rotateDefendersTo(bomb.state.site);
    },

    onDefuseDone(bot) {
      bomb.finishDefuse();
      checkRoundEnd(0);
    },
  };

  // ---- the step ----
  function step(dt, now) {
    // Prune expired smokes.
    state.smokes = state.smokes.filter((s) => now < s.until);
    if (state.phase === 'buy') {
      state.phaseT -= dt;
      hud.setTimer(state.phaseT, 'buy');
      hud.setBomb('BUY PHASE — press B', false);
      if (state.phaseT <= 0) {
        state.phase = 'live';
        state.phaseT = ROUND_SECONDS;
        hud.hideBuy();
        hud.banner(`ROUND ${state.round} — GO`, 'Eliminate the Wardens or plant the device', 2200);
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.phaseT -= dt;
      if (state.phaseT <= 0) {
        if (state.scoreA >= WIN_ROUNDS || state.scoreB >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          state.phase = 'matchEnd';
          const won = state.scoreA > state.scoreB;
          const draw = state.scoreA === state.scoreB;
          hud.showOverlay('match', {
            title: draw ? 'DRAW' : won ? 'VANGUARD WINS THE MATCH' : 'WARDENS WIN THE MATCH',
            copy: `Final score ${state.scoreA} — ${state.scoreB}. The relay is ${won ? 'yours' : 'theirs'}.`,
          });
          if (document.pointerLockElement) document.exitPointerLock();
        } else {
          startRound();
        }
      }
      return;
    }
    if (state.phase !== 'live') return;
    // Weapon feel state: recoil kick, draw timer, ADS blend.
    stepFeel(weapons, dt, input.state.aiming);
    // Round timer: stops once the bomb is planted — the fuse is the timer then.
    if (bomb.state.status !== 'planted' && bomb.state.status !== 'defusing') {
      state.phaseT -= dt;
      hud.setTimer(state.phaseT, 'live');
      if (state.phaseT <= 0) {
        endRound('defend', 'Time expired with no detonation.');
        return;
      }
    } else {
      hud.setTimer(bomb.state.fuse, 'live');
    }
    stepBomb(dt, now);
    stepGrenades(dt, now);
    // Bot context: player, both teams, smokes, noise, time. The bots read
    // this and nothing else — the game is their whole world.
    const ctx = {
      now,
      playerAlive: playerAlive(),
      player: {
        pos: player.state.position, alive: playerAlive(), team: 'attack', isPlayer: true,
        moving: player.groundSpeed() > 1.5, crouched: player.state.crouched,
        lastShotAt: weapons.lastShotAt, flashUntil: 0, y: 1.3,
      },
      attackers: bots.bots.filter((b) => b.team === 'attack'),
      defenders: bots.bots.filter((b) => b.team === 'defend'),
      smokes: state.smokes,
      noise: state.noise,
      sites: map.sites,
      bombCarried: bomb.state.status === 'carried',
      bombPlanted: bomb.state.status === 'planted' || bomb.state.status === 'defusing',
      bombSite: bomb.state.site,
    };
    bots.step(ctx, dt);
    // Noise is a one-step event: heard this step, gone the next.
    state.noise = null;
    // Bomb carrier pickup: an attacker walking over a dropped bomb takes it.
    if (bomb.state.status === 'dropped') {
      for (const b of bots.alive('attack')) {
        const d = Math.hypot(b.pos.x - bomb.state.pos.x, b.pos.z - bomb.state.pos.z);
        if (d < 1.2) {
          b.carryingBomb = true;
          state.carrierId = b.id;
          bomb.pickup();
          break;
        }
      }
      if (playerAlive() && state.carrierId !== -2) {
        const d = Math.hypot(player.state.position.x - bomb.state.pos.x, player.state.position.z - bomb.state.pos.z);
        if (d < 1.2) {
          state.carrierId = -2;
          bomb.pickup();
          hud.banner('DEVICE RECOVERED', 'Carry it to Relay or Silo', 2200);
        }
      }
    }
    // A defender that reaches a planted, clear bomb defuses it. "Clear"
    // means no living attacker nearby and the player dead or far away —
    // a defuse under fire does not happen.
    if (bomb.state.status === 'planted') {
      for (const b of bots.alive('defend')) {
        const d = Math.hypot(b.pos.x - bomb.state.pos.x, b.pos.z - bomb.state.pos.z);
        if (d < 1.8) {
          const enemiesNear = bots.alive('attack').some((a) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 12) || playerAlive();
          if (!enemiesNear) {
            b.state = 'defuse';
            b.defuseProgress = 0;
            bomb.startDefuse();
            hud.banner('DEFUSE IN PROGRESS', 'Stop the Warden at the device', 2600);
            break;
          }
        }
      }
    }
    checkRoundEnd(now);
  }

  return {
    state,
    botEvents,
    startMatch() {
      state.scoreA = 0;
      state.scoreB = 0;
      state.round = 0;
      economy.money = 800;
      economy.lossStreak = 0;
      weapons.current = 'p9';
      weapons.owned = new Set(['p9']);
      weapons.ammo.p9 = { mag: 12, reserve: 36 };
      weapons.grenades = { frag: 0, smoke: 0, flash: 0 };
      weapons.armor = 0;
      player.state.hp = 100;
      startRound();
    },
    step,
    playerShoot,
    throwGrenade,
    buildViewmodel,
    updateViewmodel,
    tryBuy(id) {
      const cost = buyItem(weapons, id, economy.money);
      if (cost === null) return false;
      economy.money -= cost;
      hud.setMoney(economy.money);
      hud.setAmmo(weapons.ammo[weapons.current].mag, weapons.ammo[weapons.current].reserve);
      hud.setHealth(player.state.hp, weapons.armor);
      hud.setWeapon(WEAPONS[weapons.current].name, weapons.grenades);
      buildViewmodel();
      return true;
    },
    buyList,
    playerAlive,
  };
}
