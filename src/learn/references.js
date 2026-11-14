/* Reference selection for the learning flow: generated references with metadata, or the learner's own images
   (which have no verified geometry, so measurements report themselves unavailable). */
import { OBJECTIVES, REF_SUBJECT } from '../learning/curriculum.js';
import { REF_COORDINATE_SYSTEM } from '../refs/projection.js';
import { loadImg } from '../util.js';

export const REF_SOURCE = Object.freeze({ generated: 'generated', mine: 'mine' });
export const REF_ERROR = Object.freeze({ noRefs: 'no-refs', noDistinct: 'no-distinct-ref' });
const GENERATE_TRIES = 4;
export const randomSeed = () => (Math.random() * 4294967296) >>> 0;

function uploadMeta(r, label) {
  return {
    metaVersion: 1,
    id: 'upload:' + (r.docId || r.key),
    source: 'upload',
    generator: null,
    kind: null,
    scene: null,
    seed: null,
    options: null,
    width: r.w,
    height: r.h,
    label,
    difficulty: null,
    camera: null,
    geometry: { coordinateSystem: REF_COORDINATE_SYSTEM, width: r.w, height: r.h },
  };
}

function pickUserRef(api, objective, excludeId) {
  const pool = api.S.refs.filter(
    r => r.category === objective.reference.subject && 'upload:' + (r.docId || r.key) !== excludeId,
  );
  if (!pool.length) {
    return null;
  }
  const r = pool[Math.floor(Math.random() * pool.length)];
  const label = 'Your reference image (' + r.category + ')';
  return {
    source: REF_SOURCE.mine,
    url: r.url,
    w: r.w,
    h: r.h,
    label,
    meta: uploadMeta(r, label),
    silhouetteMask: null,
    objectUrl: false,
  };
}

/* opts: { source, tier, exclude: reference meta to differ from (for the transfer test) } */
export async function makeReference(api, objectiveId, opts) {
  const o = opts || {};
  const O = OBJECTIVES[objectiveId];
  const excludeId = o.exclude ? o.exclude.id : null;
  if (o.source === REF_SOURCE.mine || !api.canGenerate()) {
    const mine = pickUserRef(api, O, excludeId);
    if (mine) {
      return mine;
    }
    if (!api.canGenerate()) {
      throw new Error(REF_ERROR.noRefs);
    }
  }
  const movement = O.reference.subject === REF_SUBJECT.movement;
  const excludePose = o.exclude && o.exclude.difficulty ? o.exclude.difficulty.pose : null;
  const tier = o.exclude && o.exclude.difficulty && o.exclude.difficulty.tier ? o.exclude.difficulty.tier : o.tier;
  for (let i = 0; i < GENERATE_TRIES; i++) {
    const g = await api.QSRefs.generate(
      O.reference.subject,
      randomSeed(),
      movement ? { tier, excludePose } : { scene: O.reference.scene },
    );
    if (g.meta.id !== excludeId) {
      return {
        source: REF_SOURCE.generated,
        url: g.url,
        w: g.w,
        h: g.h,
        label: 'Generated ' + g.label.charAt(0).toLowerCase() + g.label.slice(1),
        meta: g.meta,
        silhouetteMask: g.silhouetteMask,
        objectUrl: true,
      };
    }
    URL.revokeObjectURL(g.url);
  }
  throw new Error(REF_ERROR.noDistinct);
}

export async function loadReference(ref) {
  if (!ref.img) {
    ref.img = await loadImg(ref.url);
  }
  return ref.img;
}

export function releaseReference(ref) {
  if (ref && ref.objectUrl && !ref.revoked) {
    URL.revokeObjectURL(ref.url);
    ref.revoked = true;
  }
}
