/* Polyline geometry used by the drawing analyses. Points are {x, y} in canvas pixels, y pointing down. */

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const roundTo = (v, digits) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
export const CURVE = Object.freeze({ straight: 'straight', c: 'C', s: 'S' });
export const toXY = p => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });
export const toPair = (p, digits = 1) => {
  const k = 10 ** digits;
  return [Math.round(p.x * k) / k, Math.round(p.y * k) / k];
};

export function pathLength(P) {
  let n = 0;
  for (let i = 1; i < P.length; i++) {
    n += dist(P[i - 1], P[i]);
  }
  return n;
}

/* n points evenly spaced by arc length. */
export function resample(P, n) {
  if (!P.length) {
    return [];
  }
  if (P.length === 1 || n < 2) {
    return Array.from({ length: Math.max(1, n) }, () => ({ x: P[0].x, y: P[0].y }));
  }
  const total = pathLength(P);
  if (total === 0) {
    return Array.from({ length: n }, () => ({ x: P[0].x, y: P[0].y }));
  }
  const step = total / (n - 1);
  const out = [{ x: P[0].x, y: P[0].y }];
  let i = 1,
    prev = P[0],
    acc = 0;
  while (out.length < n - 1 && i < P.length) {
    const seg = dist(prev, P[i]);
    if (acc + seg >= step && seg > 0) {
      const t = (step - acc) / seg;
      const q = { x: prev.x + (P[i].x - prev.x) * t, y: prev.y + (P[i].y - prev.y) * t };
      out.push(q);
      prev = q;
      acc = 0;
    } else {
      acc += seg;
      prev = P[i];
      i++;
    }
  }
  const last = P[P.length - 1];
  while (out.length < n) {
    out.push({ x: last.x, y: last.y });
  }
  return out;
}

export function centroid(P) {
  let x = 0,
    y = 0;
  for (const p of P) {
    x += p.x;
    y += p.y;
  }
  return { x: x / P.length, y: y / P.length };
}

export function bbox(P) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of P) {
    if (p.x < minX) {
      minX = p.x;
    }
    if (p.x > maxX) {
      maxX = p.x;
    }
    if (p.y < minY) {
      minY = p.y;
    }
    if (p.y > maxY) {
      maxY = p.y;
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const reverse = P => P.slice().reverse();

/* Screen angle of the chord from the first to the last point, in degrees (0 = right, 90 = down). */
export function chordAngleDeg(P) {
  const a = P[0],
    b = P[P.length - 1];
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/* Signed difference a - b wrapped into (-180, 180]. Positive means a is rotated clockwise on screen. */
export function angleDelta(a, b) {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) {
    d -= 360;
  }
  return d;
}

/* Signed perpendicular deviation of every point from the chord, as a fraction of chord length.
   With the chord pointing down the screen, positive values lie to the viewer's left. */
export function chordDeviations(P) {
  const a = P[0],
    b = P[P.length - 1];
  const cx = b.x - a.x,
    cy = b.y - a.y;
  const len = Math.hypot(cx, cy) || 1;
  return P.map(p => (cx * (p.y - a.y) - cy * (p.x - a.x)) / len / len);
}

/* Bow: the largest signed deviation from the chord. 0 for a straight line. */
export function signedBow(P) {
  let best = 0;
  for (const d of chordDeviations(P)) {
    if (Math.abs(d) > Math.abs(best)) {
      best = d;
    }
  }
  return best;
}

/* 'straight', 'C' (bends one way) or 'S' (bends both ways), ignoring wobble below tol. */
export function curveType(P, tol) {
  const dev = chordDeviations(P).filter(d => Math.abs(d) >= tol);
  if (!dev.length) {
    return CURVE.straight;
  }
  let changes = 0;
  for (let i = 1; i < dev.length; i++) {
    if (Math.sign(dev[i]) !== Math.sign(dev[i - 1])) {
      changes++;
    }
  }
  return changes === 0 ? CURVE.c : CURVE.s;
}

/* Remove translation and uniform scale (RMS radius about the centroid). Rotation and mirroring are kept. */
export function normalizeTS(P) {
  const c = centroid(P);
  let r = 0;
  for (const p of P) {
    r += (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
  }
  r = Math.sqrt(r / P.length) || 1;
  return P.map(p => ({ x: (p.x - c.x) / r, y: (p.y - c.y) / r }));
}

export function meanPairDistance(A, B) {
  const n = Math.min(A.length, B.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += dist(A[i], B[i]);
  }
  return s / n;
}

/* Order a line so it starts at its top end, or its left end when it runs mostly sideways. */
export function canonicalOrder(P) {
  const a = P[0],
    b = P[P.length - 1];
  const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
  const flip = vertical ? b.y < a.y : b.x < a.x;
  return flip ? reverse(P) : P;
}
