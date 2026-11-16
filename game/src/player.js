// The player body: position, velocity, stance. Acceleration and friction make
// movement weighty; stopping to aim pays, sprinting costs accuracy. Collision
// is per-axis against the map's AABBs, so the body slides along walls.
import * as THREE from 'three';

const RADIUS = 0.42;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 6.3;
const CROUCH_SPEED = 2.3;
const AIR_SPEED = 3.4;
const ACCEL = 62;
const FRICTION = 11;
const GRAVITY = 15;
const JUMP_VEL = 5.6;

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 20),
    velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    eye: EYE_STAND, crouched: false, onGround: true,
    recoilPitch: 0, recoilYaw: 0, hp: 100,
    stepAccum: 0, // metres walked since the last footstep sound
    landed: false, // set for one step when the body lands from a jump/fall
  };
  const tmp = new THREE.Vector3();

  function collides(px, py, pz) {
    for (const b of colliders) {
      if (px + RADIUS > b.min.x && px - RADIUS < b.max.x &&
          py + 1.75 > b.min.y && py < b.max.y &&
          pz + RADIUS > b.min.z && pz - RADIUS < b.max.z) return true;
    }
    return false;
  }

  function moveAxis(dx, dz) {
    const p = state.position;
    if (dx !== 0 && !collides(p.x + dx, p.y, p.z)) p.x += dx;
    if (dz !== 0 && !collides(p.x, p.y, p.z + dz)) p.z += dz;
  }

  return {
    state,
    spawn(x, z, yaw) {
      state.position.set(x, 0, z);
      state.velocity.set(0, 0, 0);
      state.yaw = yaw; state.pitch = 0;
      state.recoilPitch = 0; state.recoilYaw = 0;
      state.crouched = false; state.eye = EYE_STAND;
    },
    look(dx, dy, sens = 0.0022) {
      state.yaw -= dx * sens;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * sens));
    },
    recoil(pitch, yaw) {
      state.recoilPitch += pitch;
      state.recoilYaw += yaw;
    },
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    step(dt, keys, sprinting) {
      const s = state;
      // Stance.
      const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight');
      s.crouched = wantCrouch;
      const targetEye = wantCrouch ? EYE_CROUCH : EYE_STAND;
      s.eye += (targetEye - s.eye) * Math.min(1, dt * 14);
      // Recoil recovery.
      s.recoilPitch *= Math.max(0, 1 - dt * 7);
      s.recoilYaw *= Math.max(0, 1 - dt * 7);

      // Wish direction from keys, in yaw space.
      let fx = 0, fz = 0;
      if (keys.has('KeyW')) fz -= 1;
      if (keys.has('KeyS')) fz += 1;
      if (keys.has('KeyA')) fx -= 1;
      if (keys.has('KeyD')) fx += 1;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len; fz /= len;
      const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
      // World move = right * fx + forward * (-fz), where forward is
      // (-sin yaw, -cos yaw) and right is (cos yaw, -sin yaw).
      const wx = fx * cos + fz * sin;
      const wz = -fx * sin + fz * cos;
      const speed = s.crouched ? CROUCH_SPEED : (sprinting && fz < 0 ? SPRINT_SPEED : WALK_SPEED);
      const accel = s.onGround ? ACCEL : ACCEL * 0.35;
      const maxSpeed = s.onGround ? speed : AIR_SPEED;
      s.velocity.x += wx * accel * dt;
      s.velocity.z += wz * accel * dt;
      // Friction on the ground, none in the air.
      if (s.onGround) {
        const f = Math.max(0, 1 - FRICTION * dt);
        const sp = Math.hypot(s.velocity.x, s.velocity.z);
        if (sp > maxSpeed) {
          const k = maxSpeed / sp;
          s.velocity.x *= k; s.velocity.z *= k;
        } else if (fx === 0 && fz === 0) {
          s.velocity.x *= f; s.velocity.z *= f;
        }
      }
      // Jump.
      if (keys.has('Space') && s.onGround) {
        s.velocity.y = JUMP_VEL;
        s.onGround = false;
      }
      s.velocity.y -= GRAVITY * dt;
      // Integrate, per axis, so walls slide instead of stopping.
      const p = s.position;
      const wasAirborne = !s.onGround;
      const fallSpeed = -s.velocity.y;
      moveAxis(s.velocity.x * dt, 0);
      moveAxis(0, s.velocity.z * dt);
      p.y += s.velocity.y * dt;
      if (p.y <= 0) {
        p.y = 0; s.velocity.y = 0; s.onGround = true;
        if (wasAirborne && fallSpeed > 3.5) s.landed = true;
      }
      // Footstep distance: only while moving on the ground.
      if (s.onGround) {
        s.stepAccum += Math.hypot(s.velocity.x, s.velocity.z) * dt;
      } else {
        s.stepAccum = 0;
      }
      // Stay inside the map.
      p.x = Math.max(-31.4, Math.min(31.4, p.x));
      p.z = Math.max(-23.4, Math.min(23.4, p.z));
      tmp.set(0, 0, 0);
    },
  };
}
