// Input: keyboard, mouse and pointer lock. One place owns the raw device
// state; the game reads it, never the DOM, so the simulation stays testable
// and a headless probe can drive the same paths with synthetic events.
//
// Bindings, fixed for the whole game:
//   WASD move, Shift sprint, Ctrl crouch, Space jump, E plant/defuse,
//   R reload, G throw grenade, Q cycle grenade, B buy menu,
//   1-5 switch weapon, 2-9 buy during the buy phase,
//   mouse look, left click fire, right click aim down sights.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const look = { x: 0, y: 0 };
  let firing = false;
  let aiming = false;
  let locked = false;

  // Held keys. Repeats are ignored so a held key registers once; the set
  // itself is the "currently down" truth the simulation polls each step.
  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }

  // Mouse deltas only count while the pointer is locked: an unlocked mouse
  // is the player clicking the menu, not aiming.
  function onMouseMove(e) {
    if (!locked) return;
    look.x += e.movementX;
    look.y += e.movementY;
  }
  function onMouseDown(e) {
    if (!locked) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  }

  // Lock changes come from the browser, not from us: Esc unlocks, and a
  // death unlocks too. Losing the lock stops firing immediately, so a
  // stray click after death cannot shoot.
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
    onLockChange(locked);
  }

  function onContext(e) {
    e.preventDefault();
  }

  // Alt-tabbing away must not leave a key stuck down: clear everything.
  function onBlur() {
    keys.clear();
    firing = false;
    aiming = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('contextmenu', onContext);

  return {
    state: {
      keys,
      get firing() { return firing; },
      get aiming() { return aiming; },
    },
    // Consume the look delta accumulated since the last call. The caller
    // owns the sensitivity; this only hands over raw pixels.
    takeLook() {
      const delta = { x: look.x, y: look.y };
      look.x = 0;
      look.y = 0;
      return delta;
    },
    requestLock() {
      canvas.requestPointerLock();
    },
    get locked() { return locked; },
  };
}
