// Bots: the other nine players. Each bot is a small state machine — route, hold,
// engage, investigate, plant, defuse — over the map's waypoint graph, with a
// personality on top: a rusher pushes fast in short bursts, a holder sits an
// angle and barely moves, a lurker flanks, an awper holds long sightlines and
// fires once. They see through line of sight, hear gunfire, peek angles instead
// of standing still, hold fire when they lose the target, rotate to a planted
// bomb (and sometimes rotate to the wrong site first, like a real player), and
// shoot in bursts with a reaction time and an accuracy that falls with distance
// and movement. Attackers pick a site and plant; defenders hold sites and defuse.
import * as THREE from 'three';
import { findPath, nearestNode, hasLineOfSight } from './nav.js';
import { WEAPONS } from './weapons.js';
import { pick } from './rng.js';

const NAMES_ATTACK = ['Dune', 'Vex', 'Sable', 'Rook', 'Ibis'];
const NAMES_DEFEND = ['Heron', 'Flint', 'Onyx', 'Pike', 'Wren'];
const BOT_SPEED = 4.1;
const BOT_AIM_SPEED = 2.6;
const PERCEIVE_EVERY = 0.12;
const HEAR_RADIUS = 32;
const FOOTSTEP_EVERY = 2.4; // metres between audible steps

// Roles shape everything a bot does: how fast it moves, how long its bursts
// are, how patient it is, how often it makes a mistake.
const ROLES = {
  rusher: { speed: 1.12, burst: [4, 6], pause: [0.35, 0.6], reaction: 0.85, strafe: 1.4, peek: 0.5, mistake: 0.16 },
  holder: { speed: 0.9, burst: [3, 4], pause: [0.55, 0.95], reaction: 1.0, strafe: 0.35, peek: 0.12, mistake: 0.06 },
  lurker: { speed: 1.0, burst: [3, 5], pause: [0.45, 0.8], reaction: 0.95, strafe: 0.9, peek: 0.35, mistake: 0.12 },
  awper: { speed: 0.88, burst: [1, 1], pause: [0.9, 1.4], reaction: 1.25, strafe: 0.3, peek: 0.1, mistake: 0.05 },
};
const ROLE_POOL = ['rusher', 'holder', 'lurker', 'awper', 'holder'];

function makeBody(team) {
  const group = new THREE.Group();
  const accent = team === 'attack' ? '#2ec4b6' : '#f0a830';
  const suit = team === 'attack' ? '#3a5f5b' : '#5b4a3a';
  const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: r, metalness: 0.08 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), mat(suit));
  torso.position.y = 1.12; torso.castShadow = true;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.3), mat('#c9a582', 0.7));
  head.position.y = 1.6; head.castShadow = true;
  head.userData.part = 'head';
  // Helmet brim and a backpack, so the silhouette reads at a glance.
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.36), mat('#2c2f36', 0.7));
  brim.position.y = 1.76;
  brim.userData.part = 'head';
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.16), mat('#2c2f36'));
  pack.position.set(0, 1.16, -0.23);
  pack.userData.part = 'torso';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.06), mat(accent, 0.4));
  visor.position.set(0, 1.62, 0.16);
  visor.userData.part = 'head';
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.22), mat('#2c2f36'));
  legL.position.set(-0.14, 0.39, 0); legL.castShadow = true;
  legL.userData.part = 'legs';
  const legR = legL.clone(); legR.position.x = 0.14;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), mat(suit));
  armL.position.set(-0.33, 1.18, 0.12); armL.rotation.x = -0.9;
  armL.userData.part = 'torso';
  const armR = armL.clone(); armR.position.x = 0.33;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), mat('#1e2126', 0.5));
  gun.position.set(0.1, 1.28, 0.42); gun.castShadow = true;
  gun.userData.part = 'torso';
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.32), mat(accent, 0.5));
  pad.position.y = 1.44;
  pad.userData.part = 'torso';
  group.add(torso, head, brim, pack, visor, legL, legR, armL, armR, gun, pad);
  // Health bar: a small billboard above the head, redrawn on damage.
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 8;
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }));
  bar.scale.set(0.9, 0.11, 1);
  bar.position.y = 1.95;
  group.add(bar);
  return { group, canvas, bar, meshes: [torso, head, brim, pack, visor, legL, legR, armL, armR, gun, pad] };
}

function drawBar(bot) {
  const g = bot.body.canvas.getContext('2d');
  g.clearRect(0, 0, 64, 8);
  g.fillStyle = '#101216'; g.fillRect(0, 0, 64, 8);
  const f = Math.max(0, bot.hp / 100);
  g.fillStyle = f > 0.5 ? '#2ec4b6' : f > 0.25 ? '#f0a830' : '#e5484d';
  g.fillRect(1, 1, 62 * f, 6);
  bot.body.bar.material.map.needsUpdate = true;
}

export function createBots(scene, map, random, events) {
  const bots = [];
  let botId = 0;

  function spawnOne(team, index, loadout) {
    const name = (team === 'attack' ? NAMES_ATTACK : NAMES_DEFEND)[index];
    const body = makeBody(team);
    for (const m of body.meshes) m.userData.botId = botId;
    scene.add(body.group);
    // The sniper carries the longbow; everyone else takes a role from the pool.
    const role = loadout.weapon === 'longbow' ? 'awper' : ROLE_POOL[(botId + index) % ROLE_POOL.length];
    const r = ROLES[role];
    const bot = {
      id: botId, team, name, loadout, role,
      pos: new THREE.Vector3(), yaw: 0, pitch: 0,
      hp: 100, armor: loadout.armor ? 100 : 0,
      weapon: loadout.weapon,
      alive: true, state: 'route', stateSince: 0,
      path: [], pathIndex: 0,
      target: null, lastSeen: null, lastSeenAt: -10,
      reactionAt: 0, burstLeft: 0, nextShotAt: 0, pauseUntil: 0,
      perceiveAt: random() * PERCEIVE_EVERY,
      strafeDir: 1, strafeUntil: 0,
      holdNode: -1, routeSite: null, heardAt: null,
      plantProgress: 0, defuseProgress: 0,
      carryingBomb: false, speed: BOT_SPEED * r.speed * (0.92 + random() * 0.16),
      skill: 0.75 + random() * 0.45, // reaction + accuracy multiplier
      reactionBase: (0.22 + random() * 0.3) * r.reaction,
      burstMin: r.burst[0], burstMax: r.burst[1],
      pauseMin: r.pause[0], pauseMax: r.pause[1],
      strafeAmp: r.strafe, peekChance: r.peek, mistakeChance: r.mistake,
      holdYaw: 0, peekNode: -1, peekUntil: 0, scanUntil: 0,
      mistakeDone: false, mistakeUntil: 0, retargetSite: null,
      reloadPauseUntil: 0, burstsSinceReload: 0,
      stepAccum: 0, lastStepX: 0, lastStepZ: 0,
      body, hitFlash: 0,
    };
    botId += 1;
    bots.push(bot);
    drawBar(bot);
    return bot;
  }

  function resetBot(bot, spawn, loadout) {
    bot.pos.set(spawn.x, 0, spawn.z);
    bot.yaw = spawn.yaw; bot.pitch = 0;
    bot.hp = 100; bot.armor = loadout.armor ? 100 : 0;
    bot.weapon = loadout.weapon; bot.loadout = loadout;
    bot.alive = true; bot.state = 'route'; bot.stateSince = 0;
    bot.path = []; bot.pathIndex = 0;
    bot.target = null; bot.lastSeen = null; bot.lastSeenAt = -10;
    bot.burstLeft = 0; bot.nextShotAt = 0; bot.pauseUntil = 0;
    bot.plantProgress = 0; bot.defuseProgress = 0;
    bot.carryingBomb = false; bot.heardAt = null;
    bot.holdYaw = spawn.yaw;
    bot.peekNode = -1; bot.peekUntil = 0; bot.scanUntil = 0;
    bot.mistakeDone = false; bot.mistakeUntil = 0; bot.retargetSite = null;
    bot.reloadPauseUntil = 0; bot.burstsSinceReload = 0;
    bot.stepAccum = 0; bot.lastStepX = spawn.x; bot.lastStepZ = spawn.z;
    bot.body.group.visible = true;
    bot.body.group.position.copy(bot.pos);
    bot.body.group.rotation.y = bot.yaw;
    drawBar(bot);
  }

  function visibleEnemy(bot, ctx, enemy) {
    if (!enemy.alive) return false;
    const d = Math.hypot(enemy.pos.x - bot.pos.x, enemy.pos.z - bot.pos.z);
    if (d > 48) return false;
    // Vision cone, unless the enemy just fired nearby. A bot's facing is
    // (sin yaw, cos yaw) — the model's front is its local +z. A crouched
    // enemy far away is harder to spot.
    const dx = enemy.pos.x - bot.pos.x, dz = enemy.pos.z - bot.pos.z;
    const ang = Math.atan2(dx, dz);
    let diff = Math.abs(((ang - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const recentlyFired = ctx.now - (enemy.lastShotAt ?? -10) < 0.6 && d < 26;
    const cone = enemy.crouched && d > 22 ? 0.8 : 1.15;
    if (diff > cone && !recentlyFired) return false;
    if (!hasLineOfSight(map.tallColliders, bot.pos.x, bot.pos.z, enemy.pos.x, enemy.pos.z)) return false;
    // Smoke blocks sight.
    for (const s of ctx.smokes) {
      if (segmentThroughCircle(bot.pos.x, bot.pos.z, enemy.pos.x, enemy.pos.z, s.x, s.z, s.r)) return false;
    }
    return true;
  }

  function segmentThroughCircle(ax, az, bx, bz, cx, cz, r) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((cx - ax) * dx + (cz - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t;
    return Math.hypot(px - cx, pz - cz) < r;
  }

  function perceive(bot, ctx) {
    // Find the nearest visible enemy. The player fights on the attack team,
    // so attackers only ever hunt defenders; defenders hunt everyone attacking.
    let best = null, bestD = Infinity;
    const enemies = bot.team === 'attack'
      ? ctx.defenders
      : ctx.attackers.concat(ctx.playerAlive ? [ctx.player] : []);
    for (const e of enemies) {
      if (e === bot || !e.alive) continue;
      const d = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
      if (d < bestD && visibleEnemy(bot, ctx, e)) { best = e; bestD = d; }
    }
    if (best) {
      const first = bot.target !== best;
      bot.target = best;
      bot.lastSeen = { x: best.pos.x, z: best.pos.z, y: best.pos.y ?? 1.3 };
      bot.lastSeenAt = ctx.now;
      if (first) bot.reactionAt = ctx.now + bot.reactionBase / bot.skill;
      if (bot.state !== 'engage') { bot.state = 'engage'; bot.stateSince = ctx.now; }
    } else if (bot.target && ctx.now - bot.lastSeenAt > 1.2) {
      bot.target = null;
      if (bot.state === 'engage') {
        bot.state = bot.holdNode >= 0 ? 'hold' : 'route';
        bot.stateSince = ctx.now;
      }
    }
  }

  function moveAlongPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = map.nodes[bot.path[bot.pathIndex]];
    const dx = node.x - bot.pos.x, dz = node.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) { bot.pathIndex += 1; return bot.pathIndex >= bot.path.length; }
    const vx = (dx / d) * speed, vz = (dz / d) * speed;
    bot.pos.x += vx * dt; bot.pos.z += vz * dt;
    bot.yaw = Math.atan2(vx, vz);
    return false;
  }

  function setPath(bot, toNode) {
    const from = nearestNode(map.nodes, bot.pos.x, bot.pos.z);
    const p = findPath(map.nodes, from, toNode);
    if (p) { bot.path = p; bot.pathIndex = p.length > 1 ? 1 : 0; }
    else { bot.path = [toNode]; bot.pathIndex = 0; }
  }

  function shootAt(bot, ctx, target, dt) {
    if (ctx.now < bot.reactionAt || ctx.now < bot.pauseUntil || ctx.now < bot.reloadPauseUntil) return;
    // Trigger discipline: if the target has not been seen very recently, hold
    // fire instead of spraying the last known position.
    if (ctx.now - bot.lastSeenAt > 0.35) { bot.burstLeft = 0; return; }
    if (bot.burstLeft <= 0) {
      if (ctx.now < bot.nextShotAt) return;
      bot.burstLeft = bot.burstMin + Math.floor(random() * (bot.burstMax - bot.burstMin + 1));
      bot.nextShotAt = ctx.now + 0.1;
    }
    if (ctx.now < bot.nextShotAt) return;
    bot.nextShotAt = ctx.now + 60 / WEAPONS[bot.weapon].rpm + 0.02;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) {
      bot.pauseUntil = ctx.now + bot.pauseMin + random() * (bot.pauseMax - bot.pauseMin);
      bot.burstsSinceReload += 1;
      // Every couple of bursts a bot pauses to "reload" — a real player does,
      // and it is the fairest window to push them.
      if (bot.burstsSinceReload >= 2 && random() < 0.35) {
        bot.reloadPauseUntil = ctx.now + 1.1 + random() * 0.5;
        bot.burstsSinceReload = 0;
      }
    }
    const w = WEAPONS[bot.weapon];
    const d = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    const moving = target.moving ? 0.72 : 1;
    const crouched = target.crouched ? 0.85 : 1;
    const botMoving = bot.state === 'engage' && bot.pathIndex < bot.path.length ? 0.75 : 1;
    const still = bot.state === 'hold' || bot.state === 'engage' ? 1.08 : 1;
    let p = Math.max(0.08, 0.58 - d * 0.009) * moving * crouched * botMoving * still * bot.skill;
    if (bot.weapon === 'longbow' && d < 12) p *= 0.7; // awpers hate close range
    if (target.flashUntil && ctx.now < target.flashUntil) p *= 0.15;
    const hit = random() < p;
    const headshot = hit && random() < 0.11;
    const muzzle = { x: bot.pos.x, y: 1.35, z: bot.pos.z };
    if (hit) {
      const dmg = Math.round(w.damage * (headshot ? w.headMult : 1) * (d > 30 ? 0.8 : 1));
      events.onBotShot(bot, target, dmg, headshot, muzzle);
    } else {
      events.onBotShot(bot, target, 0, false, muzzle);
    }
    target.lastShotAt = ctx.now;
  }

  function stepBot(bot, ctx, dt) {
    if (!bot.alive) return;
    bot.stateSince += dt;
    bot.hitFlash = Math.max(0, bot.hitFlash - dt * 4);
    if (ctx.now >= bot.perceiveAt) {
      bot.perceiveAt = ctx.now + PERCEIVE_EVERY;
      perceive(bot, ctx);
    }
    // Footsteps: report distance walked so the game can play them with
    // distance attenuation. A bot you can hear is a bot you can play around.
    const moved = Math.hypot(bot.pos.x - bot.lastStepX, bot.pos.z - bot.lastStepZ);
    bot.stepAccum += moved;
    bot.lastStepX = bot.pos.x; bot.lastStepZ = bot.pos.z;
    if (bot.stepAccum > FOOTSTEP_EVERY && events.onBotFootstep) {
      bot.stepAccum = 0;
      events.onBotFootstep(bot);
    }
    // Hear gunfire: investigate the sound.
    if (ctx.noise && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
      const d = Math.hypot(ctx.noise.x - bot.pos.x, ctx.noise.z - bot.pos.z);
      if (d < HEAR_RADIUS && (!bot.heardAt || ctx.now - bot.heardAt.at > 2)) {
        bot.heardAt = { x: ctx.noise.x, z: ctx.noise.z, at: ctx.now };
        bot.state = 'investigate'; bot.stateSince = 0;
        setPath(bot, nearestNode(map.nodes, ctx.noise.x, ctx.noise.z));
      }
    }
    // Rotation mistake: when the bomb goes down, a defender sometimes runs
    // to the wrong site first, then corrects. Real players do this.
    if (ctx.bombPlanted && bot.team === 'defend' && !bot.mistakeDone && bot.state === 'route') {
      bot.mistakeDone = true;
      if (random() < bot.mistakeChance) {
        const wrong = ctx.bombSite === 'A' ? 26 : 22;
        bot.retargetSite = ctx.bombSite === 'A' ? 22 : 26;
        bot.mistakeUntil = ctx.now + 2.5;
        setPath(bot, wrong);
      }
    }
    if (bot.mistakeUntil > 0 && ctx.now >= bot.mistakeUntil) {
      bot.mistakeUntil = 0;
      if (bot.retargetSite !== null) {
        setPath(bot, bot.retargetSite);
        bot.retargetSite = null;
      }
    }

    if (bot.state === 'engage' && bot.target) {
      const t = bot.target;
      const dx = t.pos.x - bot.pos.x, dz = t.pos.z - bot.pos.z;
      bot.yaw = Math.atan2(dx, dz);
      // Strafe while firing — wide for rushers, a shuffle for holders.
      if (ctx.now > bot.strafeUntil) {
        bot.strafeDir = random() < 0.5 ? -1 : 1;
        bot.strafeUntil = ctx.now + 0.5 + random() * 0.8;
      }
      const side = Math.sin(bot.yaw + Math.PI / 2) * bot.strafeDir;
      const sideZ = Math.cos(bot.yaw + Math.PI / 2) * bot.strafeDir;
      bot.pos.x += side * BOT_AIM_SPEED * 0.5 * bot.strafeAmp * dt;
      bot.pos.z += sideZ * BOT_AIM_SPEED * 0.5 * bot.strafeAmp * dt;
      shootAt(bot, ctx, t, dt);
      if (!bot.target) { bot.state = bot.holdNode >= 0 ? 'hold' : 'route'; }
    } else if (bot.state === 'hold') {
      // Hold the angle: slow scan around the assigned facing, with the odd
      // peek out to a nearby node and back — nobody holds perfectly still.
      bot.yaw = bot.holdYaw + Math.sin(ctx.now * 0.4 + bot.id * 1.7) * 0.45;
      if (bot.peekUntil > 0 && ctx.now >= bot.peekUntil) {
        bot.peekUntil = 0;
        setPath(bot, bot.holdNode);
        bot.state = 'route';
      } else if (bot.peekUntil === 0 && bot.scanUntil === 0 && random() < bot.peekChance * dt) {
        const near = map.nodes[bot.holdNode];
        if (near && near.edges.length) {
          bot.peekNode = near.edges[Math.floor(random() * near.edges.length)];
          setPath(bot, bot.peekNode);
          bot.peekUntil = ctx.now + 1.6;
          bot.state = 'peek';
        }
      }
      // Carrier holding at a site: plant the moment it is clear.
      if (bot.carryingBomb && ctx.sites && ctx.bombCarried && bot.routeSite && bot.routeSite !== 'mid') {
        const s = ctx.sites[bot.routeSite];
        const inSite = bot.pos.x >= s.minX && bot.pos.x <= s.maxX && bot.pos.z >= s.minZ && bot.pos.z <= s.maxZ;
        const enemiesNear = ctx.defenders.some((d) => d.alive && Math.hypot(d.pos.x - bot.pos.x, d.pos.z - bot.pos.z) < 14);
        if (inSite && !enemiesNear) {
          bot.state = 'plant'; bot.plantProgress = 0;
          if (events.onPlantStart) events.onPlantStart(bot);
        }
      }
    } else if (bot.state === 'peek') {
      // Walked out to look: hold the angle briefly, then fall back.
      const done = moveAlongPath(bot, dt, bot.speed * 0.9);
      if (done) {
        bot.yaw = bot.holdYaw + Math.sin(ctx.now * 0.4 + bot.id) * 0.6;
        if (ctx.now >= bot.peekUntil) {
          bot.peekUntil = 0;
          setPath(bot, bot.holdNode);
          bot.state = 'route';
        }
      }
    } else if (bot.state === 'plant') {
      bot.plantProgress += dt;
      if (bot.plantProgress >= 3) events.onPlantDone(bot);
    } else if (bot.state === 'defuse') {
      bot.defuseProgress += dt;
      if (bot.defuseProgress >= 5) events.onDefuseDone(bot);
    } else {
      // route / investigate: walk the path.
      const done = moveAlongPath(bot, dt, bot.speed);
      if (done) {
        if (bot.state === 'investigate') {
          // Arrived at the sound: scan the area before moving on.
          bot.state = 'hold'; bot.stateSince = 0;
          bot.scanUntil = ctx.now + 1.5;
          bot.holdYaw = bot.yaw;
        } else events.onBotArrived(bot);
      }
    }
    // After scanning a noise, walk back to the assigned hold or patrol on.
    if (bot.scanUntil > 0 && ctx.now >= bot.scanUntil && bot.state === 'hold' && !bot.carryingBomb) {
      bot.scanUntil = 0;
      bot.state = 'route';
      if (bot.holdNode >= 0) setPath(bot, bot.holdNode);
    }
    // Face the bomb site while planting/defusing.
    if (bot.state === 'plant' || bot.state === 'defuse') bot.yaw += dt * 0.2;
    bot.body.group.position.copy(bot.pos);
    bot.body.group.rotation.y = bot.yaw;
    bot.body.group.visible = bot.alive;
  }

  return {
    bots,
    spawnRound(attackLoadouts, defendLoadouts) {
      for (const b of bots) scene.remove(b.body.group);
      bots.length = 0;
      botId = 0;
      for (let i = 0; i < 5; i += 1) {
        const b = spawnOne('attack', i, attackLoadouts[i]);
        resetBot(b, map.spawns.attack[i], attackLoadouts[i]);
      }
      for (let i = 0; i < 5; i += 1) {
        const b = spawnOne('defend', i, defendLoadouts[i]);
        resetBot(b, map.spawns.defend[i], defendLoadouts[i]);
      }
    },
    damage(bot, amount, part) {
      if (!bot.alive) return false;
      let dmg = amount;
      if (bot.armor > 0) {
        const absorbed = Math.min(bot.armor, Math.round(dmg * 0.5));
        bot.armor -= absorbed; dmg -= absorbed;
      }
      bot.hp -= dmg;
      bot.hitFlash = 1;
      drawBar(bot);
      if (bot.hp <= 0) {
        bot.hp = 0; bot.alive = false;
        bot.body.group.visible = false;
        events.onDeath(bot);
        return true;
      }
      return false;
    },
    step(ctx, dt) {
      for (const bot of bots) stepBot(bot, ctx, dt);
    },
    setPath, nearestNode: (x, z) => nearestNode(map.nodes, x, z),
    alive(team) { return bots.filter((b) => b.alive && b.team === team); },
    carrier() { return bots.find((b) => b.carryingBomb && b.alive) ?? null; },
    pick,
  };
}
