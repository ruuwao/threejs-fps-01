// Navigation: A* over the map's waypoint graph, plus line-of-sight tests the bots
// use to see and to hear through. All 2D (XZ); the map is flat.
import { segmentHitsBox } from './map.js';

export function findPath(nodes, from, to) {
  if (from === to) return [from];
  const open = [from];
  const came = new Map();
  const g = new Map([[from, 0]]);
  const f = new Map([[from, heuristic(nodes, from, to)]]);
  const closed = new Set();
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) {
      if ((f.get(open[i]) ?? Infinity) < (f.get(open[best]) ?? Infinity)) best = i;
    }
    const current = open.splice(best, 1)[0];
    if (current === to) {
      const path = [current];
      let c = current;
      while (came.has(c)) { c = came.get(c); path.push(c); }
      return path.reverse();
    }
    closed.add(current);
    for (const n of nodes[current].edges) {
      if (closed.has(n)) continue;
      const tentative = (g.get(current) ?? Infinity) + dist(nodes, current, n);
      if (tentative < (g.get(n) ?? Infinity)) {
        came.set(n, current);
        g.set(n, tentative);
        f.set(n, tentative + heuristic(nodes, n, to));
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  return null;
}

function heuristic(nodes, a, b) { return dist(nodes, a, b); }
function dist(nodes, a, b) {
  return Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
}

export function nearestNode(nodes, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// True when nothing tall stands between two points at eye height. Low cover
// (crates, sandbags) does not block sight: a bot can see over it.
export function hasLineOfSight(tallColliders, ax, az, bx, bz) {
  for (const b of tallColliders) {
    if (segmentHitsBox(ax, az, bx, bz, b)) return false;
  }
  return true;
}

// 3D segment vs AABB, for bullet raycasts against the world (uses the full box).
export function rayHitsBox(origin, dir, maxDist, box) {
  let tmin = 0, tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [box.min.x, box.min.y, box.min.z];
  const hi = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
