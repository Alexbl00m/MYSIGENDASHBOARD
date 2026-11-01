// The tour: three trips (heavy up, heavy down with regeneration, full load short hop) while the operator walks the
// views and display modes. The calls in SCRIPT are the mission: lift.js turns them into trips, and everything on
// screen at film time t is stateAt(FILM, t). Camera and display toggles are the only things keyed here; they never
// move a part. render(t) is a pure function of t.
import * as THREE from 'three';
import {runSim} from 'teardown-kit/runtime.js';
import {createConsole, DISPLAY} from './console.js';
import {L, planTrip, S, stateAt, TOP} from './lift.js';
import {labelAnchors} from './model3d.js';
import {createStage} from './stage.js';

export const SCRIPT = [
  {t: 0, view: 'hero'},
  {t: 1.0, call: [4, 800]},
  {t: 4.2, view: 'machine'},
  {t: 6.2, display: 'labels'},
  {t: 11.0, view: 'roping'},
  {t: 17.0, view: 'car'},
  {t: 24.8, call: [0, 900]},
  {t: 25.6, display: 'xray'},
  {t: 28.6, view: 'hero'},
  {t: 32.0, display: 'xray'},
  {t: 34.5, view: 'roping'},
  {t: 38.6, view: 'pit'},
  {t: 42.8, view: 'machine'},
  {t: 43.6, display: 'exploded'},
  {t: 47.2, display: 'exploded'},
  {t: 48.6, call: [2, 1000]},
  {t: 49.2, view: 'plan'},
  {t: 53.4, view: 'car'},
  {t: 54.0, display: 'section'},
  {t: 59.0, display: 'section'},
  {t: 59.4, view: 'hero'},
  {t: 59.8, display: 'orbit'},
];
export const DURATION = 67;
export const DEFAULTS = {duration: DURATION, fps: 60, theme: 'light', hud: {enabled: false, title: 'monospace-500', subtitle: ''}, director: {enabled: false}, watermark: ''};
const D2R = Math.PI / 180;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
export const ss = (a, b, t) => smoother((t - a) / (b - a));

// ------------------------------------------------------------ the mission: the calls become trips
export const FILM = (() => {
  const trips = [];
  let at = 0;
  for (const e of SCRIPT.filter((x) => x.call)) {
    const tr = planTrip(at, e.call[0], e.call[1], e.t);
    trips.push(tr);
    at = e.call[0];
  }
  for (let i = 1; i < trips.length; i++) if (trips[i].t0 < trips[i - 1].t0 + trips[i - 1].dur) throw new Error(`call ${i} lands before trip ${i - 1} ends`);
  return {start: 0, trips, end: trips[trips.length - 1].t0 + trips[trips.length - 1].dur};
})();

// ------------------------------------------------------------ display toggles
export const displayAt = (t) => {
  const out = Object.fromEntries(DISPLAY.map((k) => [k, 0]));
  for (const e of SCRIPT) if (e.display && e.t <= t) out[e.display] = out[e.display] ? 0 : 1;
  return out;
};
const lastFlip = (key, t) => SCRIPT.filter((e) => e.display === key && e.t <= t).pop()?.t ?? -9;
export const easedDisplay = (key, t, dur = 0.7) => {
  const on = displayAt(t)[key];
  const k = ss(lastFlip(key, t), lastFlip(key, t) + dur, t);
  return on ? k : 1 - k;
};

// ------------------------------------------------------------ views; u = seconds on the view, st = the lift state
const clampY = (y) => Math.min(TOP - 1.5, Math.max(0.6, y));
export const VIEW_FN = {
  hero: (u) => ({tx: 0.1, ty: (TOP - S.pit) / 2 - 0.6, tz: 0, az: 36 + 1.2 * u, el: 21, d: 44, sx: 0, sy: -22}),
  machine: (u) => ({tx: L.xR + 0.06, ty: L.sheaveY - 0.12, tz: L.sheaveZ + 0.05, az: -52 + 1.6 * u, el: 13, d: 3.6, sx: 0, sy: -24}),
  car: (u, st) => ({tx: L.carX + 0.1, ty: st.y + 1.0, tz: L.carZ + 0.2, az: 28 + 1.5 * u, el: 12, d: 10.5, sx: 0, sy: -24}),
  roping: (u, st) => ({tx: 0.2, ty: clampY((st.y + 1.2 + st.cwBottom + L.cwFrameH / 2) / 2), tz: -0.1, az: 58 + 1.0 * u, el: 9, d: 22, sx: 0, sy: -20}),
  pit: (u) => ({tx: 0.0, ty: -0.2, tz: 0.0, az: 44 + 1.5 * u, el: 20, d: 8.5, sx: 0, sy: -24}),
  plan: (u) => ({tx: 0, ty: TOP - 1.2, tz: 0, az: 180 + 2 * u, el: 87, d: 8.5, sx: 0, sy: -20}),
};
const VIEWS = SCRIPT.filter((e) => e.view).map((e) => [e.t, e.view]);
export const blendCam = (a, b, k) => {
  const o = {};
  for (const key in b) o[key] = key === 'az' ? a.az + ((((b.az - a.az + 540) % 360) - 180) * k) : a[key] + (b[key] - a[key]) * k;
  // a long move pulls back through the middle so the cut reads as a move, not a jump; distances blend in log
  o.d = Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * k) * (1 + 0.25 * Math.sin(Math.PI * k));
  return o;
};
export const camAt = (t, st, orbit = 0) => {
  let i = 0;
  while (i < VIEWS.length - 1 && VIEWS[i + 1][0] <= t) i++;
  const cur = VIEW_FN[VIEWS[i][1]](t - VIEWS[i][0], st);
  let o = cur;
  if (i > 0) {
    const k = ss(VIEWS[i][0], VIEWS[i][0] + 1.8, t);
    if (k < 1) o = blendCam(VIEW_FN[VIEWS[i - 1][1]](t - VIEWS[i - 1][0], st), cur, k);
  }
  if (orbit > 0) o = {...o, az: o.az + 12 * Math.max(0, t - lastFlip('orbit', t)) * orbit};
  return o;
};
export const viewAt = (t) => VIEWS.filter(([a]) => a <= t).pop();

// ------------------------------------------------------------ the operator's pointer
const REST = [[860, 470], [760, 420], [940, 520], [820, 380]];
export function makeCursor(ui) {
  const EV = SCRIPT.filter((e) => e.t > 0).map((e) => ({t: e.t, spot: ui.spots[e.call ? 'f' + e.call[0] : e.view || e.display]}));
  const WP = [[0, 900, 600]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.16, ...e.spot], [e.t + 0.22, ...e.spot]);
    WP.push([e.t + 1.4, ...REST[i % REST.length]]);
  });
  WP.sort((a, b) => a[0] - b[0]);
  return (t) => {
    let i = 0;
    while (i < WP.length - 2 && t > WP[i + 1][0]) i++;
    const [t0, x0, y0] = WP[i];
    const [t1, x1, y1] = WP[i + 1];
    const k = ss(t0, t1, t);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = Math.sin(Math.PI * k) * Math.min(24, len * 0.07);
    let press = false;
    let ring = 0;
    let rx = 0;
    let ry = 0;
    for (const e of EV) {
      if (t >= e.t - 0.07 && t < e.t + 0.09) press = true;
      if (t >= e.t && t < e.t + 0.55) {
        ring = 1 - (t - e.t) / 0.55;
        [rx, ry] = e.spot;
      }
    }
    return {x: x0 + (x1 - x0) * k + (len ? (-(y1 - y0) / len) * bow : 0), y: y0 + (y1 - y0) * k + (len ? ((x1 - x0) / len) * bow : 0), press, ring, ringX: rx, ringY: ry};
  };
}

// ------------------------------------------------------------ labels: which parts each view names, stacked in two columns
const VIEW_LABELS = {
  hero: ['mx10', 'car', 'cw', 'gov', 'tc', 'hitch'],
  machine: ['mx10', 'sheave', 'brakes', 'ropes', 'rotor', 'stator'],
  car: ['car', 'door', 'pulleys', 'rail', 'tc', 'ropes'],
  roping: ['sheave', 'ropes', 'cwp', 'pulleys', 'cw', 'hitch'],
  pit: ['cw', 'pulleys', 'tc', 'car', 'rail'],
  plan: ['mx10', 'car', 'cw', 'gov', 'hitch'],
};
export function makeLabels(st3) {
  const parts = labelAnchors(st3.lift);
  return (s, view, o, ex = 0) => {
    if (o < 0.02) return [];
    const want = VIEW_LABELS[view] || [];
    const pts = parts
      .filter((p) => want.includes(p.key) && (!p.exOnly || ex > 0.5) && !(ex > 0.5 && p.key === 'ropes'))
      .map((p) => ({p, at: st3.project(p.at(s, ex))}))
      .filter((x) => x.at && x.at[0] > 345 && x.at[0] < 1255 && x.at[1] > 112 && x.at[1] < 770);
    const Lc = pts.filter((x) => x.at[0] < 800).sort((a, b) => a.at[1] - b.at[1]);
    const Rc = pts.filter((x) => x.at[0] >= 800).sort((a, b) => a.at[1] - b.at[1]);
    const out = [];
    const stack = (col, x, w) => {
      let y = 128;
      for (const c of col) {
        y = Math.max(y, Math.min(740, c.at[1] - 10));
        out.push({name: c.p.name, sub: c.p.sub, at: c.at, label: [x, y], w, o});
        y += 34;
      }
    };
    stack(Lc, 350, 176);
    stack(Rc, 1076, 176);
    return out;
  };
}

/** the display object the stage takes, from eased toggles */
export const stageDisplay = (e) => ({xray: Math.max(e.xray, e.exploded), section: e.section > 0.5, explode: e.exploded, shaft: 1 - e.nowalls});

export function makeFilm() {
  return async ({canvas, capture}) => {
    const st3 = createStage({canvas});
    const resize = () => st3.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const ui = createConsole(document.getElementById('app'));
    const cursorAt = makeCursor(ui);
    const labels = makeLabels(st3);
    window.MS = {st3, FILM, stateAt};
    return {
      resize,
      render(t) {
        const s = stateAt(FILM, t);
        const disp = displayAt(t);
        const e = Object.fromEntries(DISPLAY.map((k) => [k, easedDisplay(k, t, k === 'exploded' ? 1.0 : 0.7)]));
        const cam = camAt(t, s, disp.orbit);
        st3.frame(s, stageDisplay(e), {...cam, az: cam.az * D2R, el: cam.el * D2R});
        const [vt0, view] = viewAt(t);
        ui.update({st: s, view, display: disp, callouts: labels(s, view, easedDisplay('labels', t, 0.5) * ss(vt0 + 1.6, vt0 + 2.2, t), e.exploded), cursor: cursorAt(t), load: s.load});
        return {};
      },
    };
  };
}

export const run = () => runSim(DEFAULTS, makeFilm());
void THREE;
