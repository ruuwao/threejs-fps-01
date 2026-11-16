// The player body: position, velocity, stance. Acceleration and friction
// make movement weighty; stopping to aim pays, sprinting costs accuracy.
// Collision is per-axis against the map's AABBs, so the body slides along
// walls instead of sticking to them.
//
// The numbers are the feel of the game, tuned together:
//   walk 4.3 m/s, sprint 6.3, crouch 2.3 — sprinting is for rotations,
//   not for fights, and a crouched player is a still target that is
//   harder to hit; jump 5.6 m/s up against gravity 15, so a hop clears
//   low cover and lands in about three quarters of a second.
import * as THREE from 'three';

const RADIUS = 0.42;
const BODY_HEIGHT = 1.75; // the height the collision box checks against a wall
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
const EYE_LERP = 14; // how fast the eye height follows a stance change
const RECOIL_RECOVERY = 7;
const MAP_HALF_X = 31.4;
const MAP_HALF_Z = 23.4;
const LAND_HARD_ABOVE = 3.5; // falling faster than this thuds on landing

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 20),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    onGround: true,
    recoilPitch: 0,
    recoilYaw: 0,
    hp: 100,
    stepAccum: 0, // metres walked since the last footstep sound
    landed: false, // set for one step when the body lands from a jump/fall
  };

  // True when the body's cylinder at (px, py, pz) would touch a collider.
  // The check is a circle in XZ (the radius) against the box, plus the
  // body's height in Y — a low crate blocks the feet, a tall wall the head.
  function collides(px, py, pz) {
    for (const b of colliders) {
      if (px + RADIUS > b.min.x && px - RADIUS < b.max.x
        && py + BODY_HEIGHT > b.min.y && py < b.max.y
        && pz + RADIUS > b.min.z && pz - RADIUS < b.max.z) return true;
    }
    return false;
  }

  // Move one axis at a time: if X is blocked the body still slides in Z,
  // and the other way round. A diagonal run into a wall becomes a slide
  // along it, never a dead stop.
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
      state.yaw = yaw;
      state.pitch = 0;
      state.recoilPitch = 0;
      state.recoilYaw = 0;
      state.crouched = false;
      state.eye = EYE_STAND;
    },

    // Mouse look. Yaw wraps freely; pitch clamps just short of straight
    // up and down, so the camera never flips over.
    look(dx, dy, sens = 0.0022) {
      state.yaw -= dx * sens;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * sens));
    },

    // A shot kicks the aim: pitch up, yaw drifting either way. The game
    // passes the weapon's recoil; recovery happens in step().
    recoil(pitch, yaw) {
      state.recoilPitch += pitch;
      state.recoilYaw += yaw;
    },

    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },

    step(dt, keys, sprinting) {
      const s = state;

      // Stance: either Ctrl key crouches. The eye height eases to the new
      // stance instead of snapping, so crouching reads as a duck, not a cut.
      const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight');
      s.crouched = wantCrouch;
      const targetEye = wantCrouch ? EYE_CROUCH : EYE_STAND;
      s.eye += (targetEye - s.eye) * Math.min(1, dt * EYE_LERP);

      // Recoil recovery: the aim settles back on its own, faster than it
      // was kicked, so a burst walks up and then comes back down.
      const recoilKeep = Math.max(0, 1 - dt * RECOIL_RECOVERY);
      s.recoilPitch *= recoilKeep;
      s.recoilYaw *= recoilKeep;

      // Wish direction from the keys, in yaw space. Forward is
      // (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw); the world
      // move is right * fx + forward * (-fz), with fz negative forward.
      let fx = 0;
      let fz = 0;
      if (keys.has('KeyW')) fz -= 1;
      if (keys.has('KeyS')) fz += 1;
      if (keys.has('KeyA')) fx -= 1;
      if (keys.has('KeyD')) fx += 1;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len;
      fz /= len;
      const sin = Math.sin(s.yaw);
      const cos = Math.cos(s.yaw);
      const wx = fx * cos + fz * sin;
      const wz = -fx * sin + fz * cos;

      // Sprint only counts moving forward; strafing at sprint speed would
      // make every fight a sideways dash.
      const speed = s.crouched ? CROUCH_SPEED : (sprinting && fz < 0 ? SPRINT_SPEED : WALK_SPEED);
      const accel = s.onGround ? ACCEL : ACCEL * 0.35;
      const maxSpeed = s.onGround ? speed : AIR_SPEED;
      s.velocity.x += wx * accel * dt;
      s.velocity.z += wz * accel * dt;

      // Friction on the ground, none in the air: a jump keeps its speed.
      // Above the cap the velocity is clamped, never cut; with no input
      // the body decays to a stop instead of halting at once.
      if (s.onGround) {
        const sp = Math.hypot(s.velocity.x, s.velocity.z);
        if (sp > maxSpeed) {
          const k = maxSpeed / sp;
          s.velocity.x *= k;
          s.velocity.z *= k;
        } else if (fx === 0 && fz === 0) {
          const f = Math.max(0, 1 - FRICTION * dt);
          s.velocity.x *= f;
          s.velocity.z *= f;
        }
      }

      // Jump, from the ground only. No double jump: the key is polled, so
      // holding Space hops again the moment the feet touch down.
      if (keys.has('Space') && s.onGround) {
        s.velocity.y = JUMP_VEL;
        s.onGround = false;
      }
      s.velocity.y -= GRAVITY * dt;

      // Integrate, per axis, so walls slide instead of stopping. Landing
      // is a hard fall when the downward speed was high enough to thud.
      const p = s.position;
      const wasAirborne = !s.onGround;
      const fallSpeed = -s.velocity.y;
      moveAxis(s.velocity.x * dt, 0);
      moveAxis(0, s.velocity.z * dt);
      p.y += s.velocity.y * dt;
      if (p.y <= 0) {
        p.y = 0;
        s.velocity.y = 0;
        s.onGround = true;
        if (wasAirborne && fallSpeed > LAND_HARD_ABOVE) s.landed = true;
      }

      // Footstep distance: only while moving on the ground. In the air the
      // counter resets, so a landing does not play a step at once.
      if (s.onGround) {
        s.stepAccum += Math.hypot(s.velocity.x, s.velocity.z) * dt;
      } else {
        s.stepAccum = 0;
      }

      // Stay inside the map. The walls would stop the body anyway; the
      // clamp is the backstop for a spawn or a knock outside the fence.
      p.x = Math.max(-MAP_HALF_X, Math.min(MAP_HALF_X, p.x));
      p.z = Math.max(-MAP_HALF_Z, Math.min(MAP_HALF_Z, p.z));
    },
  };
}
