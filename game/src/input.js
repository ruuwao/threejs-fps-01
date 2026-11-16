// Input: keyboard, mouse and pointer lock. One place owns the raw device state;
// the game reads it, never the DOM, so the simulation stays testable.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const look = { x: 0, y: 0 };
  let firing = false;
  let locked = false;
  let aiming = false;

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  }
  function onKeyUp(e) { keys.delete(e.code); }
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
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
    onLockChange(locked);
  }
  function onContext(e) { e.preventDefault(); }
  function onBlur() { keys.clear(); firing = false; aiming = false; }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('contextmenu', onContext);

  return {
    state: { keys, get firing() { return firing; }, get aiming() { return aiming; } },
    takeLook() { const l = { x: look.x, y: look.y }; look.x = 0; look.y = 0; return l; },
    requestLock() { canvas.requestPointerLock(); },
    get locked() { return locked; },
  };
}
