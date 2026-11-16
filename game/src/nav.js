// Navigation: A* over the map's waypoint graph, plus line-of-sight tests the
// bots use to see and to hear through. All 2D (XZ); the map is flat, so the
// height of a wall is a property of its collider, not of the graph.
//
// The graph is small (tens of nodes), so the open list is a plain array
// scanned linearly — a heap would be faster on paper and slower to read, and
// the scan is never the bottleneck at this size.
import { segmentHitsBox } from './map.js';

function distance(nodes, a, b) {
  return Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
}

// The heuristic is the straight-line distance: admissible, so A* returns
// the shortest path, and the same heuristic doubles as the edge cost.
function heuristic(nodes, a, b) {
  return distance(nodes, a, b);
}

export function findPath(nodes, from, to) {
  if (from === to) return [from];
  const open = [from];
  const cameFrom = new Map();
  const costSoFar = new Map([[from, 0]]);
  const estimatedTotal = new Map([[from, heuristic(nodes, from, to)]]);
  const closed = new Set();

  while (open.length > 0) {
    // Cheapest node in the open list.
    let best = 0;
    for (let i = 1; i < open.length; i += 1) {
      const here = estimatedTotal.get(open[i]) ?? Infinity;
      const bestSoFar = estimatedTotal.get(open[best]) ?? Infinity;
      if (here < bestSoFar) best = i;
    }
    const current = open.splice(best, 1)[0];
    if (current === to) {
      // Walk the parent pointers back to the start, then reverse.
      const path = [current];
      let step = current;
      while (cameFrom.has(step)) {
        step = cameFrom.get(step);
        path.push(step);
      }
      return path.reverse();
    }
    closed.add(current);
    for (const next of nodes[current].edges) {
      if (closed.has(next)) continue;
      const tentative = (costSoFar.get(current) ?? Infinity) + distance(nodes, current, next);
      if (tentative < (costSoFar.get(next) ?? Infinity)) {
        cameFrom.set(next, current);
        costSoFar.set(next, tentative);
        estimatedTotal.set(next, tentative + heuristic(nodes, next, to));
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  // No route: the graph is connected in practice, so null means the map
  // changed under the caller. The bot falls back to standing still.
  return null;
}

// The waypoint nearest to a point on the ground. Linear scan; the graph is
// small and this runs once per order, not per frame.
export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// True when nothing tall stands between two points at eye height. Low cover
// (crates, sandbags) does not block sight: a bot can see over it, and so
// can the player — it is cover from bullets, not from eyes.
export function hasLineOfSight(tallColliders, ax, az, bx, bz) {
  for (const box of tallColliders) {
    if (segmentHitsBox(ax, az, bx, bz, box)) return false;
  }
  return true;
}

// 3D segment vs AABB (slab test), for bullet raycasts against the world.
// Returns the distance along the ray to the entry point, or -1 for a miss.
// A ray parallel to a slab and outside it misses; inside it, that slab
// contributes nothing to the interval.
export function rayHitsBox(origin, dir, maxDist, box) {
  let tmin = 0;
  let tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [box.min.x, box.min.y, box.min.z];
  const hi = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
