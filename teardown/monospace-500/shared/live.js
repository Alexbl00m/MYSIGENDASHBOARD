// The MonoSpace 500 as a page you drive. Floor buttons (or keys 0–5) call the car with the load on the slider; calls
// made while it is busy queue up as further trips. The play button pauses the mission clock, the speed slider sets its
// pace. Six views, six display modes, drag to orbit, wheel to zoom. Left alone it plays the film's tour with the
// operator's cursor; any click, drag, wheel or key hands control over, and 25 s of quiet hands it back.
//
// The live mission is the same data stateAt() reads in the film: addCall() appends a planned trip. Nothing is moved
// by hand; the clock only advances t.
import {warmComposer} from 'teardown-kit/warm.js';
import {createConsole, DISPLAY, FLOORS, VIEWS} from './console.js';
import {camAt, DURATION, FILM, makeCursor, makeLabels, SCRIPT, ss, stageDisplay, viewAt, VIEW_FN, displayAt} from './film.js';
import {addCall, S, stateAt} from './lift.js';
import {createStage} from './stage.js';

const W = 1600;
const H = 900;
const IDLE = 25;
const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const SPEED = [0.25, 4];
const speedK = (v) => Math.log(v / SPEED[0]) / Math.log(SPEED[1] / SPEED[0]);
const speedOf = (k) => SPEED[0] * Math.pow(SPEED[1] / SPEED[0], k);

const CSS = `
html,body{background:#eceeec;overflow:hidden}
#app{position:absolute!important;inset:auto!important;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#gl{touch-action:none;cursor:grab}
#gl.drag{cursor:grabbing}
.bt,.fl{pointer-events:auto;cursor:pointer}
.bt:hover,.fl:hover{filter:brightness(.96)}
.hit{position:absolute;pointer-events:auto;cursor:ew-resize}
.tourchip{position:absolute;left:800px;top:100px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;height:22px;padding:0 11px;border:1px solid #e1e5e3;border-radius:4px;background:rgba(250,251,250,.95);color:#22272b;font:700 9px 'JetBrains Mono',monospace;letter-spacing:1.3px;white-space:nowrap;cursor:pointer;pointer-events:auto}
.tourchip i{display:block;width:6px;height:6px;border-radius:50%;background:#e3562a}
.tourchip.on i{animation:blink 1.2s steps(2) infinite}
@keyframes blink{50%{opacity:.15}}
.turn{position:fixed;left:0;right:0;bottom:18px;text-align:center;font:600 12px/1.4 'JetBrains Mono',monospace;letter-spacing:1px;color:#87908f;text-transform:uppercase;display:none}
@media (orientation:portrait) and (max-width:820px){.turn{display:block}}
`;

export function runLive() {
  document.title = 'MonoSpace 500 · MX10 simulator';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);
  const st3 = createStage({canvas});
  const ui = createConsole(app, {live: true});
  const tourCursor = makeCursor(ui);
  const labels = makeLabels(st3);

  // ------------------------------------------------------------ quality tiers
  const TIERS = [
    {samples: 8, ao: true, shadow: 4096, pr: 2},
    {samples: 4, ao: false, shadow: 2048, pr: 1.5},
    {samples: 2, ao: false, shadow: 1024, pr: 1},
  ];
  const light = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  let tier = light ? 2 : 0;
  let scale = 1;
  const fit = () => {
    scale = Math.min(innerWidth / W, innerHeight / H);
    app.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
    st3.resize(W, H, clamp((devicePixelRatio || 1) * scale, 0.75, TIERS[tier].pr));
  };
  const applyTier = () => {
    const {pr, ...q} = TIERS[tier];
    st3.setQuality(q);
    fit();
  };
  applyTier();
  addEventListener('resize', fit);
  const toStage = (cx, cy) => {
    const r = app.getBoundingClientRect();
    return [(cx - r.left) / scale, (cy - r.top) / scale];
  };
  const tourChip = document.createElement('div');
  tourChip.className = 'tourchip';
  ui.root.appendChild(tourChip);
  const note = document.createElement('div');
  note.className = 'turn';
  note.textContent = 'Turn your phone sideways for the full console';
  document.body.appendChild(note);

  // ------------------------------------------------------------ state
  let T = 0; // wall clock, s
  let Tm = 0; // mission clock, s: the one input
  let mission = FILM;
  let speed = 1;
  let paused = false;
  let load = 600;
  let view = 'hero';
  let viewAt0 = 0;
  const disp = Object.fromEntries(DISPLAY.map((k) => [k, {on: 0, t: -9}]));
  const off = {az: 0, el: 0, k: 1};
  let cam = null;
  let ring = {t: -9, x: 0, y: 0};
  const eased = (k, dur = 0.7) => {
    const d = disp[k];
    const x = ss(d.t, d.t + dur, T);
    return d.on ? x : 1 - x;
  };
  const pulse = (k) => (ring = {t: T, x: ui.spots[k][0], y: ui.spots[k][1]});

  // ------------------------------------------------------------ the tour
  const AP = {on: true, t0: 0, loop: 0};
  let lastInput = 0;
  const startTour = () => {
    AP.on = true;
    AP.t0 = T;
    AP.loop = 0;
    paused = false;
    speed = 1;
    mission = FILM;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  const takeOver = () => {
    lastInput = T;
    if (!AP.on) return;
    AP.on = false;
    const cyc = (T - AP.t0) % DURATION;
    // keep what has happened (and the trip in progress); drop the tour's future calls
    const trips = FILM.trips.filter((tr) => tr.t0 <= cyc);
    mission = {start: FILM.start, trips, end: trips.length ? trips[trips.length - 1].t0 + trips[trips.length - 1].dur : 0};
    Tm = cyc;
    const [t0, v] = viewAt(cyc);
    view = v;
    viewAt0 = T - (cyc - t0);
  };
  tourChip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lastInput = T;
    if (AP.on) takeOver();
    else startTour();
  });
  addEventListener('pointerdown', (e) => {
    if (e.target !== tourChip) takeOver();
  });
  const syncDisplay = (cyc) => {
    const want = displayAt(cyc);
    for (const k of DISPLAY) {
      if (disp[k].on !== want[k]) {
        disp[k].on = want[k];
        disp[k].t = T;
      }
    }
  };

  // ------------------------------------------------------------ controls
  const call = (f) => {
    takeOver();
    pulse('f' + f);
    paused = false;
    addCall(mission, f, load, Tm);
  };
  for (const f of FLOORS) ui.btn['f' + f].addEventListener('click', () => call(f));
  for (const v of VIEWS)
    ui.btn[v].addEventListener('click', () => {
      takeOver();
      pulse(v);
      view = v;
      viewAt0 = T;
      Object.assign(off, {az: 0, el: 0, k: 1});
    });
  for (const k of DISPLAY)
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      pulse(k);
      disp[k].on = disp[k].on ? 0 : 1;
      disp[k].t = T;
    });
  ui.btn.play.addEventListener('click', () => {
    takeOver();
    pulse('play');
    paused = !paused;
  });
  const slider = (x0, w, y, apply) => {
    const d = document.createElement('div');
    d.className = 'hit';
    Object.assign(d.style, {left: `${x0 - 8}px`, top: `${y - 11}px`, width: `${w + 16}px`, height: '22px'});
    const move = (e) => {
      const [x] = toStage(e.clientX, e.clientY);
      apply(clamp((x - x0) / w, 0, 1));
      lastInput = T;
    };
    d.addEventListener('pointerdown', (e) => {
      takeOver();
      d.setPointerCapture(e.pointerId);
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      move(e);
    });
    ui.root.appendChild(d);
  };
  slider(ui.LD.x, ui.LD.w, ui.LD.y + 1, (k) => (load = Math.round((k * S.Q) / 25) * 25));
  slider(ui.SP.x, ui.SP.w, ui.SP.y + 1, (k) => (speed = speedOf(k)));
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (/^[0-5]$/.test(key)) call(+key);
    else if (key === ' ') ui.btn.play.click();
    else if (key === 'l') ui.btn.labels.click();
    else if (key === 'x') ui.btn.xray.click();
    else if (key === 's') ui.btn.section.click();
    else if (key === 'e') ui.btn.exploded.click();
    else if (key === 'w') ui.btn.nowalls.click();
    else if (key === 'arrowup') load = Math.min(S.Q, load + 75);
    else if (key === 'arrowdown') load = Math.max(0, load - 75);
    else {
      const v = {m: 'machine', c: 'car', r: 'roping', p: 'pit', h: 'hero', o: 'plan'}[key];
      if (!v) return;
      ui.btn[v].click();
    }
    takeOver();
    e.preventDefault();
  });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = {x: e.clientX, y: e.clientY};
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    off.az -= ((e.clientX - drag.x) / scale) * 0.3;
    off.el = clamp(off.el + ((e.clientY - drag.y) / scale) * 0.2, -40, 70);
    drag = {x: e.clientX, y: e.clientY};
    lastInput = T;
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      takeOver();
      off.k = clamp(off.k * Math.exp(e.deltaY * 0.0012), 0.25, 3);
    },
    {passive: false},
  );

  // ------------------------------------------------------------ the frame
  startTour();
  let last = performance.now();
  const perf = {n: 0, sum: 0, slow: 0, age: 0};
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    T += dt;
    if (tier < TIERS.length - 1) {
      perf.age += dt;
      if (perf.age > 0.6) {
        perf.sum += dt;
        perf.n++;
        if (perf.sum >= 0.5 && perf.n >= 6) {
          perf.slow = perf.sum / perf.n > 0.022 ? perf.slow + 1 : 0;
          perf.sum = 0;
          perf.n = 0;
          if (perf.slow >= (perf.age < 6 ? 1 : 2)) {
            tier++;
            applyTier();
            Object.assign(perf, {age: 0, slow: 0});
          }
        }
      }
    }

    let tgt;
    let cursor;
    let since;
    let st;
    if (AP.on) {
      const c = T - AP.t0;
      const loop = Math.floor(c / DURATION);
      const cyc = c - loop * DURATION;
      if (loop > AP.loop) AP.loop = loop;
      Tm = cyc;
      st = stateAt(FILM, cyc);
      syncDisplay(cyc);
      tgt = camAt(cyc, st, displayAt(cyc).orbit);
      const [t0, v] = viewAt(cyc);
      view = v;
      since = cyc - t0;
      cursor = tourCursor(cyc);
      if (AP.loop > 0 && cyc < 0.8) {
        const end = tourCursor(DURATION - 0.01);
        const k = ss(0, 0.8, cyc);
        cursor = {...cursor, x: end.x + (cursor.x - end.x) * k, y: end.y + (cursor.y - end.y) * k};
      }
    } else {
      if (T - lastInput > IDLE) startTour();
      if (!paused) Tm += dt * speed;
      st = stateAt(mission, Tm);
      since = T - viewAt0;
      tgt = VIEW_FN[view](since, st);
      tgt.az += off.az + (disp.orbit.on ? 12 * (T - disp.orbit.t) : 0);
      tgt.el = clamp(tgt.el + off.el, -40, 88);
      tgt.d *= off.k;
      const rk = Math.max(0, 1 - (T - ring.t) / 0.55);
      cursor = {x: -99, y: -99, press: false, ring: rk, ringX: ring.x, ringY: ring.y};
    }
    if (!cam) cam = {...tgt};
    const k = 1 - Math.exp(-dt / (AP.on ? 0.15 : 0.35));
    cam.az += wrap(tgt.az - cam.az) * k;
    for (const key of ['tx', 'ty', 'tz', 'el', 'sx', 'sy']) cam[key] += (tgt[key] - cam[key]) * k;
    cam.d = Math.exp(Math.log(cam.d) + (Math.log(tgt.d) - Math.log(cam.d)) * k);
    const e = Object.fromEntries(DISPLAY.map((x) => [x, eased(x, x === 'exploded' ? 1.0 : 0.7)]));
    st3.frame(st, stageDisplay(e), {...cam, az: cam.az * D2R, el: cam.el * D2R});
    const display = Object.fromEntries(DISPLAY.map((x) => [x, disp[x].on]));
    const queued = AP.on ? [] : mission.trips.filter((tr) => tr.t0 > Tm).map((tr) => tr.to);
    ui.update({
      st,
      view,
      display,
      callouts: labels(st, view, eased('labels', 0.5) * ss(1.6, 2.2, since), e.exploded),
      cursor,
      paused: AP.on ? false : paused,
      speed: AP.on ? 1 : speed,
      speedK: speedK(AP.on ? 1 : speed),
      load: AP.on ? st.load : load,
      calls: queued,
    });
    if (tourChip.classList.contains('on') !== AP.on || !tourChip.firstChild) {
      tourChip.classList.toggle('on', AP.on);
      tourChip.innerHTML = AP.on ? '<i></i>AUTO TOUR · CLICK TO TAKE OVER' : '▶ RESUME TOUR';
    }
    if (!window.SIM_SHOWN) {
      window.SIM_SHOWN = true;
      dispatchEvent(new Event('simframe'));
    }
    requestAnimationFrame(frame);
  };
  warmComposer(st3.renderer, st3.composer, st3.scene, st3.camera).then(() => requestAnimationFrame(frame));
  window.LIVE = {st3, startTour, takeOver, call, stateAt, get mission() {
    return mission;
  }, get Tm() {
    return Tm;
  }, get tier() {
    return tier;
  }};
  void SCRIPT;
}
