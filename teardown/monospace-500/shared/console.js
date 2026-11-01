// The console at 1600 × 900: the car, the MX10, the ropes and traction on the left; calls, views, display and the
// model's numbers (each tagged source / derived / guess) on the right; the trip chart along the bottom; labels with
// leaders into the 3D. update(u) redraws every live part from one stateAt() result. Nothing here computes physics.
import {L, PERSONS, RPM_RATED, S, SPEC_NOTES, TAU_RATED, TRACTION_LIMIT, TRAVEL, W, tripCurves} from './lift.js';

export const C = {ink: '#22272b', mute: '#87908f', faint: '#d3d8d6', line: '#e1e5e3', panel: 'rgba(250,251,250,.95)', ac: '#e3562a', green: '#2f9a52', blue: '#4b7fa3', track: '#e8ecea'};
export const VIEWS = ['hero', 'machine', 'car', 'roping', 'pit', 'plan'];
export const VIEW_LABEL = {hero: 'SHAFT', machine: 'MX10', car: 'CAR', roping: '2:1 ROPING', pit: 'PIT', plan: 'PLAN'};
export const DISPLAY = ['labels', 'xray', 'section', 'exploded', 'nowalls', 'orbit'];
export const DISPLAY_LABEL = {labels: 'LABELS', xray: 'X-RAY', section: 'SECTION', exploded: 'TAKE APART', nowalls: 'HIDE WALLS', orbit: 'ORBIT'};
export const FLOORS = Array.from({length: S.stops}, (_, i) => i);
const fname = (i) => (i === 0 ? 'G' : String(i));

const CSS = `
#app{font-family:Inter,system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.ui{position:absolute;inset:0;pointer-events:none}
.mo{font-family:'JetBrains Mono',ui-monospace,monospace}
.cp{position:absolute;background:${C.panel};border:1px solid ${C.line};border-radius:6px;box-shadow:0 2px 10px rgba(40,60,60,.07)}
.ph{position:absolute;display:flex;align-items:center;gap:9px;font:700 10.5px 'JetBrains Mono',monospace;letter-spacing:1.8px}
.ph i{display:block;width:3px;height:13px;background:${C.ac}}
.pn{position:absolute;font:500 9.5px 'JetBrains Mono',monospace;color:${C.mute};letter-spacing:1px}
.sm{font:500 9px 'JetBrains Mono',monospace;letter-spacing:1.5px;color:${C.mute};text-transform:uppercase;white-space:nowrap}
.v{position:absolute;font:600 12px 'JetBrains Mono',monospace;text-align:right;white-space:nowrap}
.bt{position:absolute;height:23px;padding:0 9px;display:flex;align-items:center;justify-content:center;border:1px solid ${C.faint};border-radius:4px;background:#fff;font:700 9.4px 'JetBrains Mono',monospace;letter-spacing:1.2px;color:${C.ink};white-space:nowrap;box-sizing:border-box}
.fl{position:absolute;width:56px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid ${C.faint};border-radius:17px;background:#fff;font:700 15px 'JetBrains Mono',monospace;box-sizing:border-box}
.call{position:absolute;white-space:nowrap}
.call b{display:flex;align-items:center;gap:6px;font:700 9.4px 'JetBrains Mono',monospace;letter-spacing:1.2px;color:${C.ink};background:rgba(250,251,250,.86);padding:1px 3px}
.call b i{display:block;width:6px;height:6px;background:${C.ac}}
.call span{display:block;font:500 7.8px 'JetBrains Mono',monospace;letter-spacing:1.1px;color:${C.mute};margin-top:1px;padding:0 3px}
.tag{display:inline-block;width:13px;height:13px;line-height:13px;text-align:center;border-radius:2px;font:700 8px 'JetBrains Mono',monospace;color:#fff;margin-left:6px}
.cur{position:absolute;left:0;top:0;z-index:50;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.ring{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.5px solid ${C.ac};opacity:0;z-index:49}
`;
const el = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h.trim();
  return d.firstElementChild;
};
const TAGC = {source: C.blue, derived: C.green, guess: '#c08a2a'};
const TAGL = {source: 'S', derived: 'D', guess: 'G'};

export function createConsole(app, {live = false} = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const ui = el(`<div class="ui"></div>`);
  app.appendChild(ui);
  const add = (h) => {
    const n = el(h);
    ui.appendChild(n);
    return n;
  };
  const panel = (x, y, w, h, title, n) => {
    add(`<div class="cp" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
    add(`<div class="ph" style="left:${x + 14}px;top:${y + 13}px"><i></i>${title}</div>`);
    add(`<div class="pn" style="right:${1600 - x - w + 14}px;top:${y + 15}px">${n}</div>`);
  };
  const rowsAt = (x, y0, w, names, dy = 22) =>
    names.map((nm, i) => {
      add(`<div class="sm" style="position:absolute;left:${x}px;top:${y0 + i * dy}px">${nm}</div>`);
      return add(`<div class="v" style="right:${1600 - x - w}px;top:${y0 + i * dy - 2}px"></div>`);
    });

  // ------------------------------------------------------------ header
  add(`<div style="position:absolute;left:0;top:0;width:150px;height:84px;background:${C.ac}"></div>`);
  add(`<div class="mo" style="position:absolute;left:0;top:22px;width:150px;text-align:center;color:#fff;font-size:30px;font-weight:700;letter-spacing:1px">2:1</div>`);
  add(`<div class="mo" style="position:absolute;left:0;top:58px;width:150px;text-align:center;color:#fff;font-size:8.5px;letter-spacing:2.4px;opacity:.9">ROPING</div>`);
  add(`<div class="sm" style="position:absolute;left:172px;top:18px;letter-spacing:2.4px">MACHINE-ROOM-LESS TRACTION ELEVATOR</div>`);
  add(`<div style="position:absolute;left:171px;top:33px;font-size:31px;font-weight:700;letter-spacing:-.6px;line-height:1">MonoSpace 500 <span style="color:${C.ac};font-weight:400">/</span> MX10</div>`);
  add(`<div class="mo" style="position:absolute;left:172px;top:70px;font-size:10.6px;letter-spacing:2px;color:#5d6664">${S.Q} KG · ${PERSONS} PERSONS · ${S.v.toFixed(1)} M/S · ${S.stops} STOPS · ${TRAVEL} M TRAVEL</div>`);
  add(`<div class="sm" style="position:absolute;right:28px;top:24px;text-align:right;line-height:15px;letter-spacing:1.8px">INDEPENDENT STUDY MODEL<br>FROM PUBLISHED FIGURES + TAGGED GUESSES<br><span style="color:${C.ac}">NOT MANUFACTURER DATA</span></div>`);

  // ------------------------------------------------------------ 01 car
  panel(28, 104, 292, 262, 'CAR', '01');
  const floorBig = add(`<div class="mo" style="position:absolute;left:42px;top:136px;font-size:58px;font-weight:700;line-height:1;width:70px">G</div>`);
  const arrow = add(`<svg style="position:absolute;left:112px;top:146px" width="26" height="40"></svg>`);
  const phase = add(`<div class="mo" style="position:absolute;left:44px;top:202px;width:180px;font-size:9.4px;font-weight:700;letter-spacing:1.4px;color:${C.ac}"></div>`);
  const carRows = rowsAt(44, 228, 170, ['POSITION', 'SPEED', 'ACCEL', 'JERK', 'LOAD', 'DOORS']);
  const shaftSvg = add(`<svg style="position:absolute;left:236px;top:134px" width="72" height="222"></svg>`);

  // ------------------------------------------------------------ 02 MX10
  panel(28, 378, 292, 240, 'MX10 MACHINE', '02');
  add(`<div class="sm" style="position:absolute;left:44px;top:414px">MOTOR TORQUE</div>`);
  const tauVal = add(`<div class="v" style="right:${1600 - 304}px;top:410px;font-size:15px"></div>`);
  const tauBar = add(`<svg style="position:absolute;left:44px;top:434px" width="260" height="26"></svg>`);
  const mxRows = rowsAt(44, 470, 260, ['SHEAVE SPEED', 'SHAFT POWER', 'FROM GRID', 'BRAKE', 'TRIP ENERGY', 'ROPE AT SHEAVE']);

  // ------------------------------------------------------------ 03 ropes and traction
  panel(28, 630, 292, 152, 'ROPES & TRACTION', '03');
  const ropeRows = rowsAt(44, 664, 260, ['CAR SIDE T1', 'COUNTERWEIGHT T2', 'SAFETY FACTOR']);
  add(`<div class="sm" style="position:absolute;left:44px;top:734px">TRACTION T1/T2 vs e<sup>fα</sup></div>`);
  const tracBar = add(`<svg style="position:absolute;left:44px;top:750px" width="260" height="22"></svg>`);

  // ------------------------------------------------------------ 04 calls
  const btn = {};
  panel(1280, 104, 292, 204, live ? 'CALL THE CAR' : 'CALLS', '04');
  FLOORS.forEach((f) => {
    const col = f % 2;
    const row = 2 - Math.floor(f / 2);
    btn['f' + f] = add(`<div class="fl" style="left:${1296 + col * 64}px;top:${140 + row * 42}px">${fname(f)}</div>`);
  });
  add(`<div class="sm" style="position:absolute;left:1432px;top:142px">NEXT TRIP LOAD</div>`);
  const loadVal = add(`<div class="mo" style="position:absolute;left:1432px;top:158px;font-size:18px;font-weight:700"></div>`);
  const loadSub = add(`<div class="sm" style="position:absolute;left:1432px;top:182px"></div>`);
  const LD = {x: 1434, w: 120, y: 214};
  add(`<div style="position:absolute;left:${LD.x}px;top:${LD.y}px;width:${LD.w}px;height:3px;background:${C.track};border-radius:2px"></div>`);
  const ldFill = add(`<div style="position:absolute;left:${LD.x}px;top:${LD.y}px;height:3px;background:${C.ac};border-radius:2px"></div>`);
  const ldKnob = add(`<div style="position:absolute;top:${LD.y - 6}px;width:15px;height:15px;margin-left:-7.5px;border-radius:50%;background:#fff;border:2px solid ${C.ac};box-sizing:border-box"></div>`);
  const queue = add(`<div class="sm" style="position:absolute;left:1432px;top:236px;width:126px;white-space:normal;line-height:13px"></div>`);
  add(`<div class="sm" style="position:absolute;left:1296px;top:280px;color:${C.mute}">${live ? 'PRESS A FLOOR · KEYS 0–5' : 'THE TOUR PRESSES THESE'}</div>`);

  // ------------------------------------------------------------ 05 views, 06 display
  const btnRow = (keys, labels, x0, y, wmax = 262) => {
    let x = x0;
    let yy = y;
    for (const k of keys) {
      const w = Math.round(labels[k].length * 7 + 20);
      if (x + w > x0 + wmax) {
        x = x0;
        yy += 30;
      }
      btn[k] = add(`<div class="bt" style="left:${x}px;top:${yy}px;width:${w}px">${labels[k]}</div>`);
      x += w + 6;
    }
  };
  panel(1280, 320, 292, 104, 'VIEWS', '05');
  btnRow(VIEWS, VIEW_LABEL, 1294, 356);
  panel(1280, 436, 292, 104, 'DISPLAY', '06');
  btnRow(DISPLAY, DISPLAY_LABEL, 1294, 472);

  // ------------------------------------------------------------ 07 the model's numbers
  panel(1280, 552, 292, 230, 'MODEL NUMBERS', '07');
  {
    const rows = [
      ['RATED LOAD', `${S.Q} kg`, 'Q'],
      ['RATED SPEED', `${S.v.toFixed(1)} m/s`, 'v'],
      ['ROPING', '2:1', 'roping'],
      ['SHEAVE', `Ø${S.D * 1000} mm`, 'D'],
      ['RATED OUTPUT', `${(S.Prated / 1000).toFixed(1)} kW`, 'Prated'],
      ['RATED TORQUE', `${TAU_RATED.toFixed(0)} N·m @ ${RPM_RATED.toFixed(1)} rpm`, null],
      ['ROPES', `${S.n} × Ø${S.d * 1000} mm`, 'n'],
      ['EMPTY CAR', `${S.P} kg`, 'P'],
      ['COUNTERWEIGHT', `${W} kg (${Math.round(S.k * 100)} %)`, 'k'],
      ['ACCEL / JERK', `${S.a} m/s² · ${S.j} m/s³`, 'a'],
    ];
    rows.forEach(([n, v, key], i) => {
      const y = 588 + i * 17.5;
      const kind = key ? SPEC_NOTES[key][0] : 'derived';
      add(`<div class="sm" style="position:absolute;left:1294px;top:${y}px;font-size:8.4px">${n}</div>`);
      add(`<div class="mo" style="position:absolute;right:${1600 - 1538}px;top:${y - 1}px;font-size:9.6px;font-weight:600">${v}</div>`);
      add(`<div class="tag" style="position:absolute;left:1542px;top:${y - 2}px;margin:0;background:${TAGC[kind]}">${TAGL[kind]}</div>`);
    });
    add(`<div class="sm" style="position:absolute;left:1294px;top:766px;font-size:7.8px;letter-spacing:1.2px"><span style="color:${C.blue}">■</span> SOURCE &nbsp;<span style="color:${C.green}">■</span> DERIVED &nbsp;<span style="color:#c08a2a">■</span> GUESS · SEE MODEL.MD</div>`);
  }

  // ------------------------------------------------------------ 08 trip chart
  panel(338, 794, 924, 92, 'TRIP', '08');
  btn.play = add(`<div class="bt" style="left:352px;top:826px;width:44px;height:44px;border-radius:50%;border:none;background:${C.ac};color:#fff;font-size:15px;display:${live ? 'flex' : 'none'}"></div>`);
  const cx0 = 410;
  const tripFrom = add(`<div class="mo" style="position:absolute;left:${cx0}px;top:808px;font-size:10px;font-weight:700;letter-spacing:1.2px"></div>`);
  const tripTime = add(`<div class="mo" style="position:absolute;right:${1600 - 1110}px;top:808px;font-size:9.6px;color:${C.mute};letter-spacing:1px"></div>`);
  const CH = {x: cx0, y: 826, w: 1100 - cx0, h: 52};
  const chart = add(`<svg style="position:absolute;left:${CH.x}px;top:${CH.y}px" width="${CH.w}" height="${CH.h}"></svg>`);
  add(`<div class="sm" style="position:absolute;left:1122px;top:812px;font-size:8px;line-height:13px"><span style="color:${C.ac}">━</span> SPEED v<br><span style="color:${C.ink}">━</span> TORQUE τ<br><span style="color:${C.blue}">┄</span> GRID POWER</div>`);
  const SP = {x: 1124, w: 100, y: 868};
  let spFill = null;
  let spKnob = null;
  let spVal = null;
  if (live) {
    add(`<div style="position:absolute;left:${SP.x}px;top:${SP.y}px;width:${SP.w}px;height:3px;background:${C.track};border-radius:2px"></div>`);
    spFill = add(`<div style="position:absolute;left:${SP.x}px;top:${SP.y}px;height:3px;background:${C.ac};border-radius:2px"></div>`);
    spKnob = add(`<div style="position:absolute;top:${SP.y - 6}px;width:15px;height:15px;margin-left:-7.5px;border-radius:50%;background:#fff;border:2px solid ${C.ac};box-sizing:border-box"></div>`);
    spVal = add(`<div class="mo" style="position:absolute;left:${SP.x + SP.w + 8}px;top:${SP.y - 5}px;font-size:10px;font-weight:700"></div>`);
  }

  // ------------------------------------------------------------ labels, the pointer
  const callSvg = add(`<svg style="position:absolute;inset:0;overflow:visible" width="1600" height="900"></svg>`);
  const callG = add(`<div style="position:absolute;inset:0"></div>`);
  const ring = add(`<div class="ring"></div>`);
  const cur = add(`<div class="cur"><svg width="22" height="22" viewBox="0 0 34 34"><path d="M4 3 L30 13.5 L17.5 17.5 L13.5 30 Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg></div>`);
  const centre = (n) => {
    const r = n.getBoundingClientRect();
    const a = app.getBoundingClientRect();
    const k = a.width / 1600 || 1;
    return [(r.left - a.left + r.width / 2) / k, (r.top - a.top + r.height / 2) / k];
  };
  const spots = Object.fromEntries(Object.entries(btn).map(([k, n]) => [k, centre(n)]));
  const pointer = (c) => {
    if (!c) return;
    cur.style.display = c.x < 0 ? 'none' : 'block';
    cur.style.transform = `translate(${(c.x - 3).toFixed(2)}px, ${(c.y - 2).toFixed(2)}px) scale(${c.press ? 0.88 : 1})`;
    ring.style.left = `${c.ringX}px`;
    ring.style.top = `${c.ringY}px`;
    ring.style.opacity = String((c.ring || 0) * 0.85);
    ring.style.transform = `scale(${(0.35 + 0.9 * (1 - (c.ring || 0))).toFixed(3)})`;
  };
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const onBtn = (k, on) => {
    btn[k].style.background = on ? C.ac : '#fff';
    btn[k].style.color = on ? '#fff' : C.ink;
    btn[k].style.borderColor = on ? C.ac : C.faint;
  };
  let curvesFor = null;
  let curves = null;
  const sign = (x, d = 0) => (x > 0.5 * 10 ** -d ? '+' : x < -0.5 * 10 ** -d ? '−' : ' ') + Math.abs(x).toFixed(d);

  return {
    spots,
    btn,
    root: ui,
    LD,
    SP,
    /** u: {st, view, display, callouts, cursor, paused, speed, speedK, load, calls: [floors queued]} */
    update(u) {
      const s = u.st;
      // ---- 01 car
      floorBig.textContent = fname(s.floor);
      const dir = Math.sign(s.v) || (s.trip && s.tt < s.trip.tS && s.tt >= s.trip.Td ? s.trip.dir : 0);
      arrow.innerHTML = dir
        ? `<path d="${dir > 0 ? 'M13 4L24 20H2z' : 'M13 36L24 20H2z'}" fill="${Math.abs(s.v) > 0.01 ? C.ac : C.faint}"/>`
        : `<rect x="4" y="16" width="18" height="6" rx="1" fill="${C.faint}"/>`;
      phase.textContent = s.phaseLabel;
      const vals = [
        `${s.y.toFixed(3)} m`,
        `${sign(s.v, 2)} m/s`,
        `${sign(s.a, 2)} m/s²`,
        `${sign(s.jerk, 1)} m/s³`,
        `${s.load} kg · ${s.persons} P`,
        s.door > 0.999 ? 'OPEN' : s.door < 0.001 ? 'CLOSED' : `${Math.round(s.door * 100)} % · ${s.doorKE.toFixed(1)} J`,
      ];
      carRows.forEach((n, i) => (n.textContent = vals[i]));
      {
        // the shaft schematic: landings, car, counterweight to scale
        const H = 222;
        const y0 = -S.pit;
        const y1 = L.hitchY + 0.3;
        const Y = (y) => H - 4 - ((y - y0) / (y1 - y0)) * (H - 8);
        let h = `<rect x="6" y="${Y(y1)}" width="60" height="${Y(y0) - Y(y1)}" fill="none" stroke="${C.faint}"/>`;
        for (const f of FLOORS) h += `<line x1="0" x2="6" y1="${Y(f * S.floorH)}" y2="${Y(f * S.floorH)}" stroke="${C.mute}"/><text x="0" y="${Y(f * S.floorH) - 2}" font-size="7" fill="${C.mute}" font-family="JetBrains Mono">${fname(f)}</text>`;
        const cy = Y(s.y + S.carH + 0.15);
        const ch = Y(s.y - 0.12) - cy;
        h += `<rect x="10" y="${cy.toFixed(1)}" width="34" height="${ch.toFixed(1)}" fill="${Math.abs(s.v) > 0.01 ? C.ac : C.ink}" rx="1"/>`;
        const dw = 34 * (1 - s.door);
        h += `<rect x="10" y="${(cy + ch - 3).toFixed(1)}" width="${dw.toFixed(1)}" height="3" fill="#fff" opacity=".8"/>`;
        const wy = Y(s.cwBottom + L.cwFrameH);
        const wh = Y(s.cwBottom) - wy;
        h += `<rect x="50" y="${wy.toFixed(1)}" width="10" height="${wh.toFixed(1)}" fill="${C.mute}"/>`;
        h += `<circle cx="55" cy="${Y(L.sheaveY)}" r="5" fill="${C.green}"/>`;
        h += `<text x="40" y="${H}" font-size="7" fill="${C.mute}" font-family="JetBrains Mono">CW</text>`;
        shaftSvg.innerHTML = h;
      }
      // ---- 02 MX10
      tauVal.textContent = s.energised ? `${sign(s.tau)} N·m` : `${sign(s.brakeTau)} N·m`;
      tauVal.style.color = s.energised ? C.ink : C.mute;
      {
        const Wb = 260;
        const mid = Wb / 2;
        const sc = mid / (TAU_RATED * 1.6);
        const val = s.energised ? s.tau : s.brakeTau;
        const x = mid + val * sc;
        let h = `<rect x="0" y="6" width="${Wb}" height="8" rx="2" fill="${C.track}"/>`;
        h += `<rect x="${Math.min(mid, x).toFixed(1)}" y="6" width="${Math.abs(x - mid).toFixed(1)}" height="8" fill="${s.energised ? C.ac : C.mute}"/>`;
        for (const r of [-1, 1]) h += `<line x1="${mid + r * TAU_RATED * sc}" x2="${mid + r * TAU_RATED * sc}" y1="2" y2="18" stroke="${C.ink}" stroke-width="1" stroke-dasharray="2 2"/>`;
        h += `<line x1="${mid}" x2="${mid}" y1="2" y2="18" stroke="${C.ink}"/>`;
        h += `<text x="0" y="25" font-size="7.4" fill="${C.mute}" font-family="JetBrains Mono" letter-spacing=".8">${s.energised ? `${Math.round(s.tauRatio * 100)} % OF RATED ${TAU_RATED.toFixed(0)}` : 'HELD BY THE BRAKE'}</text>`;
        h += `<text x="${Wb}" y="25" font-size="7.4" fill="${C.mute}" font-family="JetBrains Mono" text-anchor="end" letter-spacing=".8">± RATED</text>`;
        tauBar.innerHTML = h;
      }
      const grid = s.Pel / 1000;
      const mx = [
        `${sign(s.rpm, 1)} rpm`,
        `${sign(s.Pm / 1000, 2)} kW`,
        `${sign(grid, 2)} kW ${grid > 0.02 ? 'MOTORING' : grid < -0.02 ? 'REGEN' : ''}`,
        s.energised ? 'LIFTED' : 'SET',
        `${sign(s.energy / 3600, 1)} Wh`,
        `${sign(Math.abs(s.v) * S.roping, 2).trim()} m/s`,
      ];
      mxRows.forEach((n, i) => (n.textContent = mx[i]));
      mxRows[2].style.color = grid < -0.02 ? C.green : C.ink;
      mxRows[3].style.color = s.energised ? C.ac : C.ink;
      // ---- 03 ropes
      ropeRows[0].textContent = `${(s.T1 / 1000).toFixed(2)} kN`;
      ropeRows[1].textContent = `${(s.T2 / 1000).toFixed(2)} kN`;
      ropeRows[2].textContent = `${s.Sf.toFixed(1)} (≥ 12)`;
      {
        const Wb = 260;
        const X = (r) => ((r - 1) / (TRACTION_LIMIT * 1.12 - 1)) * Wb;
        let h = `<rect x="0" y="4" width="${Wb}" height="8" rx="2" fill="${C.track}"/>`;
        h += `<rect x="0" y="4" width="${X(s.ratio).toFixed(1)}" height="8" fill="${s.ratio > TRACTION_LIMIT * 0.9 ? C.ac : C.green}"/>`;
        h += `<line x1="${X(TRACTION_LIMIT)}" x2="${X(TRACTION_LIMIT)}" y1="0" y2="16" stroke="${C.ink}" stroke-width="1.4"/>`;
        h += `<text x="${X(TRACTION_LIMIT) - 4}" y="21" font-size="7.4" fill="${C.ink}" font-family="JetBrains Mono" text-anchor="end">LIMIT ${TRACTION_LIMIT.toFixed(2)}</text>`;
        h += `<text x="0" y="21" font-size="7.4" fill="${C.mute}" font-family="JetBrains Mono">${s.ratio.toFixed(3)}</text>`;
        tracBar.innerHTML = h;
      }
      // ---- 04 calls
      const target = s.trip && s.tt < s.trip.dur && s.phase !== 'idle' ? s.trip.to : -1;
      for (const f of FLOORS) {
        const k = 'f' + f;
        const lit = f === target || (u.calls || []).includes(f);
        btn[k].style.background = lit ? C.ac : f === s.floor && Math.abs(s.v) < 1e-3 ? '#f1f4f2' : '#fff';
        btn[k].style.color = lit ? '#fff' : C.ink;
        btn[k].style.borderColor = lit ? C.ac : C.faint;
      }
      const ld = u.load ?? s.load;
      loadVal.textContent = `${ld} kg`;
      loadSub.textContent = `${Math.round(ld / 75)} PERSONS · MAX ${S.Q}`;
      const lk = ld / S.Q;
      ldFill.style.width = `${(lk * LD.w).toFixed(1)}px`;
      ldKnob.style.left = `${(LD.x + lk * LD.w).toFixed(1)}px`;
      queue.textContent = u.calls && u.calls.length ? `QUEUED → ${u.calls.map(fname).join(' → ')}` : '';
      // ---- 05, 06
      for (const k of VIEWS) onBtn(k, u.view === k);
      for (const k of DISPLAY) onBtn(k, !!u.display[k]);
      // ---- 08 trip chart
      if (s.trip) {
        if (curvesFor !== s.trip) {
          curvesFor = s.trip;
          curves = tripCurves(s.trip);
        }
        const tr = s.trip;
        tripFrom.innerHTML = `${fname(tr.from)} → ${fname(tr.to)} &nbsp;·&nbsp; ${tr.dist.toFixed(1)} m &nbsp;·&nbsp; ${tr.load} kg &nbsp;·&nbsp; <span style="color:${C.ac}">${s.phaseLabel}</span>`;
        tripTime.textContent = `${fmt(Math.min(s.tt, tr.dur))} / ${fmt(tr.dur)}`;
        const X = (t) => (t / tr.dur) * CH.w;
        const mid = CH.h / 2;
        const tmax = TAU_RATED * 1.6;
        const pmax = 9000;
        const line = (arr, k) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(curves.t[i]).toFixed(1)} ${(mid - v * k).toFixed(1)}`).join('');
        let h = `<line x1="0" x2="${CH.w}" y1="${mid}" y2="${mid}" stroke="${C.faint}"/>`;
        for (const [t, lab] of [[tr.Td, 'CLOSED'], [tr.tM, 'GO'], [tr.tS, 'LEVEL'], [tr.tO + tr.Td, 'OPEN']]) h += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="0" y2="${CH.h}" stroke="${C.line}"/><text x="${(X(t) + 3).toFixed(1)}" y="8" font-size="6.8" fill="${C.mute}" font-family="JetBrains Mono" letter-spacing=".6">${lab}</text>`;
        h += `<path d="${line(curves.P, (mid - 2) / pmax)}" fill="none" stroke="${C.blue}" stroke-width="1" stroke-dasharray="3 2"/>`;
        h += `<path d="${line(curves.tau, (mid - 2) / tmax)}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`;
        h += `<path d="${line(curves.v, (mid - 2) / 1.0)}" fill="none" stroke="${C.ac}" stroke-width="1.8"/>`;
        const xc = X(Math.min(s.tt, tr.dur));
        h += `<line x1="${xc.toFixed(1)}" x2="${xc.toFixed(1)}" y1="0" y2="${CH.h}" stroke="${C.ac}" stroke-width="1.2"/><circle cx="${xc.toFixed(1)}" cy="${(mid - s.v * (mid - 2)).toFixed(1)}" r="3.2" fill="${C.ac}"/>`;
        chart.innerHTML = h;
      } else {
        tripFrom.textContent = 'PARKED · PRESS A FLOOR';
        tripTime.textContent = '';
        chart.innerHTML = `<line x1="0" x2="${CH.w}" y1="${CH.h / 2}" y2="${CH.h / 2}" stroke="${C.faint}"/>`;
      }
      if (live) {
        btn.play.innerHTML = u.paused ? '▶' : '❚❚';
        const sk = u.speedK ?? 0.5;
        spFill.style.width = `${(sk * SP.w).toFixed(1)}px`;
        spKnob.style.left = `${(SP.x + sk * SP.w).toFixed(1)}px`;
        spVal.textContent = `${(u.speed ?? 1).toFixed(2)}×`;
      }
      // ---- labels
      let lh = '';
      let ch = '';
      for (const c of u.callouts || []) {
        if (c.o < 0.02 || !c.at) continue;
        const [ax, ay] = c.at;
        const [lx, ly] = c.label;
        const right = lx > ax;
        const ex = right ? lx - 4 : lx + c.w + 4;
        lh += `<polyline points="${ax.toFixed(1)},${ay.toFixed(1)} ${ex.toFixed(1)},${(ly + 6).toFixed(1)}" fill="none" stroke="${C.ac}" stroke-width=".9" opacity="${c.o.toFixed(2)}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.4" fill="${C.ac}" opacity="${c.o.toFixed(2)}"/>`;
        ch += `<div class="call" style="left:${lx.toFixed(1)}px;top:${(ly - 1).toFixed(1)}px;opacity:${c.o.toFixed(2)}"><b><i></i>${c.name}</b><span>${c.sub}</span></div>`;
      }
      callSvg.innerHTML = lh;
      callG.innerHTML = ch;
      pointer(u.cursor);
    },
    pointer,
  };
}
