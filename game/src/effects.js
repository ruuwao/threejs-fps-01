// Effects: tracers, muzzle flash, impact sparks and decals, smoke, dust and
// explosions. All pools are pre-allocated and reused; nothing is created per
// frame in a hot loop, so the frame rate stays flat when a firefight starts.
// A hit leaves a mark: bullet holes stay on the walls, dust hangs where a
// grenade went off, and a bot that takes a round shows it.
import * as THREE from 'three';

const TRACER_MAX = 24;
const SPARK_MAX = 320;
const SMOKE_MAX = 10;
const DECAL_MAX = 40;
const PUFF_MAX = 48;

export function createEffects(scene) {
  // Tracers: one thin box per shot, stretched between muzzle and hit.
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACER_MAX; i += 1) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27d'), transparent: true, opacity: 0.9 }));
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0 });
  }
  let tracerNext = 0;

  // Sparks: a single Points cloud, positions updated in place.
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_MAX * 3);
  const sparkVel = new Float32Array(SPARK_MAX * 3);
  const sparkLife = new Float32Array(SPARK_MAX);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: new THREE.Color('#ffb347'), size: 0.09, transparent: true, opacity: 0.95 }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkNext = 0;

  // A soft radial texture, shared by smoke, dust and the muzzle flash.
  const softTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  // Smoke: soft sprites that drift and grow, then fade.
  const smokes = [];
  for (let i = 0; i < SMOKE_MAX; i += 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: new THREE.Color('#c8c8c8'), transparent: true, opacity: 0, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    smokes.push({ sprite: s, life: 0, max: 1, x: 0, z: 0 });
  }

  // Dust puffs: small tan sprites for footsteps, landings and explosions.
  const puffs = [];
  for (let i = 0; i < PUFF_MAX; i += 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: new THREE.Color('#c9a06a'), transparent: true, opacity: 0, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    puffs.push({ sprite: s, life: 0, max: 1, grow: 1 });
  }
  let puffNext = 0;
  function puffAt(p, size, life, color = '#c9a06a') {
    const u = puffs[puffNext];
    puffNext = (puffNext + 1) % PUFF_MAX;
    u.sprite.material.color.set(color);
    u.sprite.position.copy(p);
    u.sprite.scale.set(size, size, 1);
    u.sprite.material.opacity = 0.55;
    u.sprite.visible = true;
    u.life = life; u.max = life; u.grow = size;
  }

  // Impact decals: dark scorch discs that stay on the wall where a bullet
  // landed, oldest recycled first. A firefight leaves its mark on the map.
  const decals = [];
  const decalGeo = new THREE.CircleGeometry(0.09, 10);
  const decalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a1512'), transparent: true, opacity: 0.75, depthWrite: false });
  for (let i = 0; i < DECAL_MAX; i += 1) {
    const m = new THREE.Mesh(decalGeo, decalMat);
    m.visible = false;
    scene.add(m);
    decals.push({ mesh: m, life: 0 });
  }
  let decalNext = 0;

  // Muzzle flash: one light + one sprite, repositioned per shot.
  const flashLight = new THREE.PointLight(new THREE.Color('#ffb347'), 0, 9, 2);
  scene.add(flashLight);
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: new THREE.Color('#ffd27d'), transparent: true, opacity: 0, depthWrite: false }));
  flashSprite.scale.set(0.6, 0.6, 1);
  scene.add(flashSprite);
  let flashLife = 0;

  // Explosion flash light.
  const boomLight = new THREE.PointLight(new THREE.Color('#ff8c42'), 0, 26, 1.6);
  scene.add(boomLight);
  let boomLife = 0;

  const tmpV = new THREE.Vector3();
  const tmpU = new THREE.Vector3();

  return {
    smokes,
    tracer(from, to, color = '#ffd27d') {
      const t = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % TRACER_MAX;
      tmpV.subVectors(to, from);
      const len = tmpV.length();
      t.mesh.position.copy(from).addScaledVector(tmpV, 0.5);
      t.mesh.lookAt(to);
      t.mesh.scale.set(1, 1, len);
      t.mesh.material.color.set(color);
      t.mesh.material.opacity = 0.9;
      t.mesh.visible = true;
      t.life = 0.09;
    },
    sparksAt(p, n = 10) {
      for (let k = 0; k < n; k += 1) {
        const i = sparkNext;
        sparkNext = (sparkNext + 1) % SPARK_MAX;
        sparkPos[i * 3] = p.x; sparkPos[i * 3 + 1] = p.y; sparkPos[i * 3 + 2] = p.z;
        sparkVel[i * 3] = (Math.random() - 0.5) * 5;
        sparkVel[i * 3 + 1] = Math.random() * 4 + 1;
        sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 5;
        sparkLife[i] = 0.35 + Math.random() * 0.25;
      }
    },
    // A round that hits a body: a short red puff and a few dark flecks, so a
    // hit reads even at long range.
    hitPuff(p, head = false) {
      puffAt(p, head ? 0.55 : 0.4, 0.4, '#a03a34');
      this.sparksAt(p, head ? 8 : 4);
    },
    // A round that hits the world: sparks plus a scorch mark that stays.
    impact(p, normal) {
      this.sparksAt(p, 8);
      const d = decals[decalNext];
      decalNext = (decalNext + 1) % DECAL_MAX;
      d.mesh.position.copy(p);
      if (normal) d.mesh.lookAt(tmpU.copy(p).add(normal));
      d.mesh.position.addScaledVector(normal ?? tmpV.set(0, 0, 1), 0.02);
      d.mesh.visible = true;
      d.life = 14;
    },
    dustPuff(p, size = 0.5) { puffAt(p, size, 0.7); },
    muzzle(at, scale = 1) {
      flashLight.position.copy(at);
      flashLight.intensity = 14 * scale;
      flashSprite.position.copy(at);
      flashSprite.scale.set(0.6 * scale, 0.6 * scale, 1);
      flashSprite.material.opacity = 0.95;
      flashLife = 0.05;
    },
    explosion(at) {
      boomLight.position.copy(at);
      boomLight.position.y = at.y + 1;
      boomLight.intensity = 60;
      boomLife = 0.5;
      this.sparksAt(at, 60);
      puffAt(tmpV.copy(at).setY(at.y + 0.6), 3.2, 1.1, '#8a7a66');
      puffAt(tmpU.copy(at).setY(at.y + 1.4), 2.2, 0.9, '#6b5a48');
    },
    smokeAt(x, z, duration) {
      for (const s of smokes) {
        if (s.life <= 0) {
          s.life = duration; s.max = duration; s.x = x; s.z = z;
          s.sprite.visible = true;
          s.sprite.position.set(x, 1.6, z);
          s.sprite.scale.set(6, 6, 1);
          s.sprite.material.opacity = 0.75;
          return s;
        }
      }
      return null;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
          if (t.life <= 0) t.mesh.visible = false;
        }
      }
      let anySpark = false;
      for (let i = 0; i < SPARK_MAX; i += 1) {
        if (sparkLife[i] > 0) {
          anySpark = true;
          sparkLife[i] -= dt;
          sparkPos[i * 3] += sparkVel[i * 3] * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
          sparkVel[i * 3 + 1] -= 12 * dt;
          if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -100; }
        }
      }
      if (anySpark) sparkGeo.attributes.position.needsUpdate = true;
      for (const s of smokes) {
        if (s.life > 0) {
          s.life -= dt;
          const f = s.life / s.max;
          s.sprite.material.opacity = 0.75 * Math.min(1, f * 3);
          const sc = 6 + (1 - f) * 7;
          s.sprite.scale.set(sc, sc, 1);
          if (s.life <= 0) s.sprite.visible = false;
        }
      }
      for (const u of puffs) {
        if (u.life > 0) {
          u.life -= dt;
          const f = Math.max(0, u.life / u.max);
          u.sprite.material.opacity = 0.55 * f;
          const sc = u.grow * (1 + (1 - f) * 1.6);
          u.sprite.scale.set(sc, sc, 1);
          if (u.life <= 0) u.sprite.visible = false;
        }
      }
      for (const d of decals) {
        if (d.life > 0) {
          d.life -= dt;
          if (d.life <= 0) d.mesh.visible = false;
        }
      }
      if (flashLife > 0) {
        flashLife -= dt;
        flashLight.intensity = Math.max(0, flashLife / 0.05) * 14;
        flashSprite.material.opacity = Math.max(0, flashLife / 0.05) * 0.95;
      }
      if (boomLife > 0) {
        boomLife -= dt;
        boomLight.intensity = Math.max(0, boomLife / 0.5) * 60;
      }
    },
  };
}
