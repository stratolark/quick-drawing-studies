/* Projection helpers that turn three.js scene geometry into reference-image pixel metadata.
   Coordinate system for every exported point: image pixels, origin top-left, x right, y down,
   in the rendered image's own width and height. */
import * as T from 'three';

export const REF_COORDINATE_SYSTEM = 'image-px-top-left';

/* Far enough that a point along a direction projects onto its vanishing point within sub-pixel error. */
const AT_INFINITY = 1e6;

export function toPx(cam, p, w, h) {
  const v = p.clone().project(cam);
  return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
}

/* True when the world point lies in front of the camera (camera space z < 0). */
export function inFront(cam, p) {
  return p.clone().applyMatrix4(cam.matrixWorldInverse).z < 0;
}

/* Vanishing point of a world direction, or null when the direction is parallel to the image plane. */
export function vanishingPoint(cam, dir, w, h) {
  const d = dir.clone().normalize();
  const camDir = d.clone().transformDirection(cam.matrixWorldInverse);
  if (Math.abs(camDir.z) < 1e-6) return null;
  const toward = camDir.z < 0 ? d : d.clone().negate();
  return toPx(cam, cam.position.clone().addScaledVector(toward, AT_INFINITY), w, h);
}

/* Horizon line for a level ground plane: the row where horizontal directions vanish.
   Returns { y, inFrame, rollDeg } or null when the camera looks straight up or down. */
export function horizon(cam, w, h) {
  const fwd = new T.Vector3();
  cam.getWorldDirection(fwd);
  const flat = new T.Vector3(fwd.x, 0, fwd.z);
  if (flat.lengthSq() < 1e-8) return null;
  flat.normalize();
  const side = new T.Vector3().crossVectors(flat, new T.Vector3(0, 1, 0)).normalize();
  const a = vanishingPoint(cam, flat.clone().addScaledVector(side, 0.25), w, h);
  const b = vanishingPoint(cam, flat.clone().addScaledVector(side, -0.25), w, h);
  if (!a || !b) return null;
  const y = (a[1] + b[1]) / 2;
  const [l, r] = a[0] <= b[0] ? [a, b] : [b, a];
  return { y, inFrame: y >= 0 && y <= h, rollDeg: Math.atan2(r[1] - l[1], r[0] - l[0]) * 180 / Math.PI };
}

/* Projected radius in pixels of a sphere of world radius r centred at p. */
export function projectedRadius(cam, p, r, w, h) {
  const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const a = toPx(cam, p, w, h);
  const b = toPx(cam, p.clone().addScaledVector(right, r), w, h);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/* Which side of the image a directional light comes from, from the camera's point of view. */
export function lightSide(cam, lightPos, targetPos) {
  const d = lightPos.clone().sub(targetPos).normalize().transformDirection(cam.matrixWorldInverse);
  return { side: d.x >= 0 ? 'right' : 'left', fromAbove: d.y > 0, cameraSpace: [d.x, d.y, d.z] };
}

export function cameraMeta(cam, w, h) {
  const fwd = new T.Vector3();
  cam.getWorldDirection(fwd);
  return {
    fovDeg: cam.fov,
    aspect: w / h,
    position: cam.position.toArray(),
    direction: fwd.toArray(),
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180 / Math.PI,
  };
}

/* Bounding box of a binary mask (1 = inside), scaled back to full image pixels. */
export function maskBBox(mask, mw, mh, sx, sy = sx) {
  let minX = mw, minY = mh, maxX = -1, maxY = -1;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (!mask[y * mw + x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX * sx, y: minY * sy, w: (maxX - minX + 1) * sx, h: (maxY - minY + 1) * sy };
}
