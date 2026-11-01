// MonoSpace 500 with an MX10 machine, as pure maths. No three.js in this file.
//
// THE ONE INPUT is t, the mission clock in seconds. A mission is fixed data: a list of trips (from floor, to floor,
// load), the same way the Cessna example fixes its takeoff and landing. stateAt(mission, t) returns every pose and
// every reading: car and counterweight height, sheave and pulley angles, door panels, brake, rope falls, rope
// tensions, traction ratio, motor torque, rpm, shaft and grid power, energy. The 3D, the gauges, the labels and the
// charts all read that one object, so nothing on screen can disagree with the motion.
//
// Units: SI throughout (m, kg, s, N, N·m, W). y is up, y = 0 is the ground-floor sill.
// Every number is tagged in SPEC_NOTES: 'source' (a published figure), 'derived' (worked out from others here),
// 'guess' (a typical engineering value with no MX10-specific source). MODEL.md walks through the hand checks.

export const g = 9.81;

// ------------------------------------------------------------------------------------------------ the specification
export const S = {
  // duty
  v: 1.0, // rated speed, m/s
  Q: 1000, // rated load, kg (13 persons at 75 kg each, EN 81-20 Table 6)
  // building
  stops: 6, // ground + 5
  floorH: 3.0, // floor-to-floor, m
  pit: 1.05, // pit depth, m
  carH: 2.1, // car internal height, m
  headroomAdd: 1.3, // headroom = car height + 1.3 m
  // car
  carW: 1.1, // internal width, m
  carD: 2.1, // internal depth, m
  doorW: 0.9, // clear opening, m (2-panel telescopic, side opening)
  doorH: 2.1,
  P: 1100, // empty car mass (car, sling, doors, pulleys), kg
  k: 0.5, // counterweight balance: W = P + k·Q
  // suspension
  roping: 2, // 2:1
  n: 6, // ropes
  d: 0.008, // rope diameter, m
  mu: 0.22, // rope mass, kg/m each
  MBF: 40300, // minimum breaking force per rope, N
  // MX10 machine
  D: 0.48, // traction sheave pitch diameter, m
  Prated: 5700, // rated output, W
  Jm: 3.0, // rotor + sheave + brake disc inertia, kg·m²
  etaM: 0.9, // motor efficiency
  etaD: 0.96, // drive (inverter) efficiency
  // diverting pulleys: two under the car, one on the counterweight
  dp: 0.33, // pulley pitch diameter, m (EN 81-20 minimum D/d = 40 → 320 mm)
  Jp: 0.2, // inertia each, kg·m²
  // ride
  a: 0.7, // max acceleration, m/s²
  j: 1.0, // max jerk, m/s³
  Ff: 250, // guide shoes + rope bending + bearings, total, referred to the car, N
  // traction (EN 81-20 Annex D)
  muT: 0.1, // rope-groove friction, loading case
  gamma: 30, // groove seat angle, degrees
  beta: 90, // undercut angle, degrees
  wrap: 180, // wrap angle on the sheave, degrees
  // doors
  vd: 0.5, // fast panel max speed, m/s
  ad: 0.8, // m/s²
  jd: 2.0, // m/s³
  mPanel: 25, // kg each; 2 car panels + 2 landing panels move together
  dwell: 3.0, // doors-open time at a stop, s
  tLift: 0.3, // doors closed → brake lifts, s
  tPre: 0.4, // brake lifted, drive holds at zero speed (pre-torque) → motion, s
  tDrop: 0.2, // motion ends → brake drops, s
  tOpen: 0.1, // brake dropped → doors start to open, s
  // counterweight build
  cwFrame: 160, // frame mass, kg
  cwPlateX: 0.16, // filler plate section, m (across the shaft)
  cwPlateZ: 0.62, // (along the side wall)
  rhoFill: 7850, // steel fillers, kg/m³
  plateT: 0.05, // filler plate thickness, m
  govD: 0.2, // overspeed governor sheave, m
};

export const SPEC_NOTES = {
  v: ['source', 'KONE planning guides: MonoSpace 500 runs 1.0–1.75 m/s'],
  Q: ['source', 'KONE: 320–1150 kg range; 1000 kg chosen, the common 13-person car'],
  stops: ['guess', 'a 6-stop residential block, well inside KONE\'s 21 stops / 55 m at 1.0 m/s'],
  floorH: ['guess', 'typical residential floor-to-floor'],
  pit: ['source', 'KONE planning table: 1050 mm standard pit at 1.0 m/s'],
  headroomAdd: ['source', 'KONE planning table: headroom = CH + 1300 mm at 1.0 m/s'],
  carW: ['derived', 'EN 81-20 Table 6: 1000 kg allows ≤ 2.40 m²; 1.1 × 2.1 = 2.31 m²'],
  doorW: ['guess', 'standard 900 mm opening for this car; panel layout read off the brochure render'],
  P: ['guess', 'typical empty-car mass for a 1000 kg MRL car (1.0–1.2 × Q)'],
  k: ['guess', 'conventional 50 % balance'],
  roping: ['source', 'secondary: MX10 is used 2:1 in MonoSpace (user wiki); under-car pulleys visible in the reference render'],
  n: ['guess', 'six 8 mm ropes; checked against the EN 81-20 safety factor below'],
  mu: ['guess', 'catalogue mass of an 8 mm 8×19 steel-core-free lift rope'],
  MBF: ['guess', 'catalogue MBF of an 8 mm 1570/1770 dual-tensile lift rope'],
  D: ['source', 'secondary: two parts-vendor listings give Ø480 mm for the MX10; cross-checked by rpm below'],
  Prated: ['source', 'secondary: vendor listing 5.7–14.6 kW for MX10; 5.7 kW is the 1.0 m/s rating'],
  Jm: ['guess', 'disc rotor ≈ 60 kg at r ≈ 0.3 m, plus sheave and brake disc'],
  etaM: ['guess', 'gearless PM synchronous machine at this size'],
  etaD: ['guess', 'IGBT inverter'],
  dp: ['derived', 'EN 81-20 D/d ≥ 40 → ≥ 320 mm for 8 mm rope'],
  a: ['guess', 'typical comfort setting, 0.6–0.8 m/s²'],
  j: ['guess', 'typical comfort setting, 0.8–1.2 m/s³'],
  Ff: ['guess', 'a few % of the moving weight\'s imbalance; tunes nothing else'],
  muT: ['source', 'EN 81-20 Annex D: μ = 0.1 for the loading case'],
  gamma: ['guess', 'common undercut-groove geometry'],
  beta: ['guess', 'common undercut-groove geometry'],
  wrap: ['derived', 'single wrap: car fall and counterweight fall leave the sheave on opposite sides'],
  vd: ['guess', 'chosen so door kinetic energy stays under EN 81-20\'s 10 J'],
  mPanel: ['guess', 'stainless 2-panel door leaf'],
  dwell: ['guess', 'typical door dwell'],
  cwPlateX: ['guess', 'sized to fit the 160 mm counterweight gap'],
};

// ------------------------------------------------------------------------------------------------ derived constants
export const R = S.D / 2; // sheave radius
export const rp = S.dp / 2; // pulley radius
export const W = S.P + S.k * S.Q; // counterweight mass
export const TRAVEL = (S.stops - 1) * S.floorH;
export const HEADROOM = S.carH + S.headroomAdd;
export const TOP = TRAVEL + HEADROOM; // shaft ceiling height
export const OMEGA_RATED = (S.roping * S.v) / R; // sheave rad/s at rated speed
export const RPM_RATED = (OMEGA_RATED * 60) / (2 * Math.PI);
export const TAU_RATED = S.Prated / OMEGA_RATED; // N·m
const rad = Math.PI / 180;
// EN 81-20 Annex D, undercut groove: f = μ·4(cos γ/2 − sin β/2) / (π − β − γ − sin β + sin γ)
export const F_GROOVE =
  (S.muT * 4 * (Math.cos((S.gamma * rad) / 2) - Math.sin((S.beta * rad) / 2))) /
  (Math.PI - S.beta * rad - S.gamma * rad - Math.sin(S.beta * rad) + Math.sin(S.gamma * rad));
export const TRACTION_LIMIT = Math.exp(F_GROOVE * S.wrap * rad); // e^(f·α)
export const PERSONS = Math.floor(S.Q / 75);

// ------------------------------------------------------------------------------------------------ shaft layout
// Plan: x across the shaft (left wall −SW/2, right wall +SW/2), z front to back (landing doors at z = +SD/2).
// The car sits left of centre; the counterweight, the ropes and the machine share the 0.2 m gap on the right.
export const L = (() => {
  const SW = 1.75; // shaft width (estimate from car + counterweight + clearances; see MODEL.md)
  const SD = 2.4; // shaft depth
  const carOW = S.carW + 0.1; // car outside width
  const carOD = S.carD + 0.1;
  const carX = -SW / 2 + 0.125 + carOW / 2; // car centre x
  const carZ = -0.05; // car centre z
  const ropeZ = carZ + 0.2; // plane of the car-side rope falls, in front of the car rails
  const xR = carX + carOW / 2 + 0.13; // right fall (sheave groove plane)
  const xL = carX - carOW / 2 - 0.08; // left (dead-end) fall
  const sheaveY = TOP - 0.65;
  const sheaveZ = ropeZ - R; // car fall leaves the front of the sheave, counterweight fall the back
  const cwZ = sheaveZ - R - rp; // counterweight pulley centre
  const hitchY = TOP - 0.2;
  const carPulleyDrop = 0.2 + rp; // car floor → under-car pulley centre
  // counterweight: filler stack sized from its mass
  const stack = (W - S.cwFrame) / S.rhoFill / (S.cwPlateX * S.cwPlateZ);
  const cwFrameH = stack + 0.25;
  const bufferTop = -S.pit + 0.4; // counterweight buffer on its stand
  const cwRunby = 0.2;
  // the counterweight pulley height when the car is at the top landing fixes the rope length
  const cwPulleyAtTop = bufferTop + cwRunby + cwFrameH + 0.05 + rp;
  const K = TRAVEL - carPulleyDrop + cwPulleyAtTop; // carPulleyY + cwPulleyY = K, always (2:1 on both sides)
  return {
    SW, SD, carOW, carOD, carX, carZ, ropeZ, xR, xL, sheaveY, sheaveZ, cwZ, hitchY, carPulleyDrop,
    stack, cwFrameH, bufferTop, cwRunby, K,
    span: xR - rp - (xL + rp), // under-car rope span between the pulley centres
    plates: Math.round(stack / S.plateT),
    govZ: 0.85, // governor rope plane (left gap, front)
    govX: -SW / 2 + 0.05,
    tcFixY: TRAVEL / 2 + 1.0, // travelling cable fixing on the shaft wall
  };
})();

export const carPulleyY = (y) => y - L.carPulleyDrop;
export const cwPulleyY = (y) => L.K - carPulleyY(y);
export const cwBottomY = (y) => cwPulleyY(y) - rp - 0.05 - L.cwFrameH;
/** the four rope falls, metres per rope */
export const falls = (y) => {
  const c = carPulleyY(y);
  const w = cwPulleyY(y);
  return {deadEnd: L.hitchY - c, carSide: L.sheaveY - c, cwSide: L.sheaveY - w, cwHitch: L.hitchY - w};
};
/** total rope length, one rope: constant if the 2:1 kinematics are right (checked in check.mjs) */
export const ropeLength = (y) => {
  const f = falls(y);
  return f.deadEnd + f.carSide + f.cwSide + f.cwHitch + L.span + Math.PI * rp /* two quarter wraps */ + Math.PI * R + Math.PI * rp;
};
/** travelling cable: fixed on the wall, hangs in a U to the car underside; the loop bottom from constant length */
export const TC_LEN = L.tcFixY + 0.5 + 0.3; // length picked so the loop clears the pit with the car at the bottom
export const tcLoopY = (y) => (L.tcFixY + (y - 0.3) - TC_LEN + Math.PI * 0.15) / 2;

// ------------------------------------------------------------------------------------------------ jerk-limited move
/**
 * A symmetric 7-segment S-curve over distance dist with limits vmax, amax, jmax. Returns {T, vp, at(τ)} where at gives
 * {s, v, a, j}. Segments are cubic in τ; the peak speed vp is found once at setup (bisection) when the move is too
 * short to reach vmax.
 */
export function scurve(dist, vmax, amax, jmax) {
  const acc = (vp) => (vp >= (amax * amax) / jmax ? {tj: amax / jmax, ta: (vp - (amax * amax) / jmax) / amax} : {tj: Math.sqrt(vp / jmax), ta: 0});
  const dAcc = (vp) => {
    const {tj, ta} = acc(vp);
    return (vp * (2 * tj + ta)) / 2;
  };
  let vp = vmax;
  if (dist <= 0) return {T: 0, vp: 0, at: () => ({s: 0, v: 0, a: 0, j: 0}), tAcc: 0, tc: 0};
  if (2 * dAcc(vmax) > dist) {
    let lo = 0;
    let hi = vmax;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (2 * dAcc(m) > dist) hi = m;
      else lo = m;
    }
    vp = lo;
  }
  const {tj, ta} = acc(vp);
  const tc = Math.max(0, (dist - 2 * dAcc(vp)) / vp);
  const segs = [[tj, jmax], [ta, 0], [tj, -jmax], [tc, 0], [tj, -jmax], [ta, 0], [tj, jmax]];
  const starts = [];
  let s = 0;
  let v = 0;
  let a = 0;
  let t0 = 0;
  for (const [dt, jj] of segs) {
    starts.push({t0, s, v, a, jj, dt});
    s += v * dt + (a * dt * dt) / 2 + (jj * dt * dt * dt) / 6;
    v += a * dt + (jj * dt * dt) / 2;
    a += jj * dt;
    t0 += dt;
  }
  const T = t0;
  const at = (tau) => {
    if (tau <= 0) return {s: 0, v: 0, a: 0, j: 0};
    if (tau >= T) return {s: dist, v: 0, a: 0, j: 0};
    let k = 0;
    while (k < 6 && tau >= starts[k + 1].t0) k++;
    const q = starts[k];
    const d = tau - q.t0;
    return {s: q.s + q.v * d + (q.a * d * d) / 2 + (q.jj * d * d * d) / 6, v: q.v + q.a * d + (q.jj * d * d) / 2, a: q.a + q.jj * d, j: q.jj};
  };
  return {T, vp, at, tAcc: 2 * tj + ta, tc};
}

export const DOOR = scurve(S.doorW, S.vd, S.ad, S.jd);

// ------------------------------------------------------------------------------------------------ forces
const muTot = S.n * S.mu;
const mSpan = muTot * (L.span + Math.PI * rp); // rope carried by the car: the under-car span and its two wraps
const mWrapCw = muTot * Math.PI * rp; // rope wrapped under the counterweight pulley
/**
 * Everything the machine and the ropes feel at one instant. y, v, a of the car (up +), the car load, and whether the
 * drive is energised (brake lifted). When the brake is set the motor gives no torque and the brake holds the static
 * imbalance.
 */
export function forces(y, v, a, load, energised) {
  const mc = S.P + load;
  const f = falls(y);
  const cwY = cwPulleyY(y);
  const cY = carPulleyY(y);
  const sgn = Math.abs(v) > 1e-6 ? Math.sign(v) : 0;
  // equivalent mass referred to the car: car, counterweight, rotor, three pulleys, rope falls moving at 2v, the span
  const Meq = mc + W + S.Jm * (S.roping / R) ** 2 + 2 * (S.Jp / rp ** 2) + S.Jp / rp ** 2 + 4 * muTot * (f.carSide + f.cwSide) + 2 * muTot * L.span;
  // rope weight imbalance referred to the car (from d(PE)/dy of every fall; see MODEL.md)
  const Frope = muTot * g * (2 * (cwY - cY) + L.span + Math.PI * rp - Math.PI * rp);
  const Fstatic = (mc - W) * g + Frope;
  const F = Meq * a + Fstatic + S.Ff * sgn; // force the sheave must supply, referred to the car, + up
  const tau = energised ? (F * R) / S.roping : 0;
  const brakeTau = energised ? 0 : (Fstatic * R) / S.roping;
  const omega = (S.roping * v) / R;
  const Pm = tau * omega;
  const Pel = Pm >= 0 ? Pm / (S.etaM * S.etaD) : Pm * S.etaM * S.etaD;
  // tensions at the sheave, all ropes together (car side T1, counterweight side T2)
  const T1 = ((mc + mSpan) * (g + a) + (S.Ff / 2) * sgn) / 2 + muTot * f.carSide * (g + 2 * a);
  const T2 = ((W + mWrapCw) * (g - a) - (S.Ff / 2) * sgn) / 2 + muTot * f.cwSide * (g - 2 * a);
  const ratio = Math.max(T1, T2) / Math.min(T1, T2);
  const Sf = (S.n * S.MBF) / Math.max(T1, T2);
  return {mc, Meq, Frope, Fstatic, F, tau, brakeTau, omega, rpm: (omega * 60) / (2 * Math.PI), Pm, Pel, T1, T2, ratio, Sf, falls: f, cwY, cY};
}

// ------------------------------------------------------------------------------------------------ trips and the mission
/** one trip: doors close, brake lifts, pre-torque, the S-curve run, brake drops, doors open, dwell */
export function planTrip(from, to, load, t0) {
  const dist = Math.abs(to - from) * S.floorH;
  const run = scurve(dist, S.v, S.a, S.j);
  const Td = DOOR.T;
  const tB = Td + S.tLift;
  const tM = tB + S.tPre;
  const tS = tM + run.T;
  const tE = tS + S.tDrop;
  const tO = tE + S.tOpen;
  const tEnd = tO + Td + S.dwell;
  const trip = {from, to, load, t0, dir: Math.sign(to - from), dist, run, Td, tB, tM, tS, tE, tO, tEnd, dur: tEnd};
  // energy: the grid power integrated once at plan time (a table the frame only reads)
  const dt = 0.02;
  const n = Math.ceil(tEnd / dt) + 1;
  const E = new Float64Array(n);
  let prev = tripState(trip, 0).Pel;
  for (let i = 1; i < n; i++) {
    const p = tripState(trip, i * dt).Pel;
    E[i] = E[i - 1] + ((prev + p) / 2) * dt;
    prev = p;
  }
  trip.E = E;
  trip.Edt = dt;
  return trip;
}

const PHASE = {
  close: 'DOORS CLOSING',
  lift: 'BRAKE LIFTING',
  pre: 'DRIVE HOLDS · PRE-TORQUE',
  jerkUp: 'ACCELERATING',
  cruise: 'RATED SPEED',
  jerkDown: 'SLOWING TO LEVEL',
  level: 'LEVELLED · BRAKE DROPS',
  open: 'DOORS OPENING',
  dwell: 'DOORS OPEN',
};

/** the state inside one trip at τ seconds from its start (no energy) */
function tripState(trip, tau) {
  const y0 = trip.from * S.floorH;
  const {dir, run} = trip;
  let phase;
  let y = y0;
  let v = 0;
  let a = 0;
  let jk = 0;
  let door = 1;
  let doorV = 0;
  let landing = trip.from;
  if (tau < trip.Td) {
    const d = DOOR.at(tau);
    door = 1 - d.s / S.doorW;
    doorV = -d.v;
    phase = 'close';
  } else if (tau < trip.tM) {
    door = 0;
    phase = tau < trip.tB ? 'lift' : 'pre';
  } else if (tau < trip.tS) {
    const m = run.at(tau - trip.tM);
    y = y0 + dir * m.s;
    v = dir * m.v;
    a = dir * m.a;
    jk = dir * m.j;
    door = 0;
    landing = -1;
    const u = tau - trip.tM;
    phase = u < run.tAcc ? 'jerkUp' : u < run.tAcc + run.tc ? 'cruise' : 'jerkDown';
  } else {
    y = trip.to * S.floorH;
    landing = trip.to;
    if (tau < trip.tO) {
      door = 0;
      phase = 'level';
    } else if (tau < trip.tO + trip.Td) {
      const d = DOOR.at(tau - trip.tO);
      door = d.s / S.doorW;
      doorV = d.v;
      phase = 'open';
    } else phase = 'dwell';
  }
  const energised = tau >= trip.tB && tau < trip.tE;
  return {y, v, a, jerk: jk, door, doorV, landing, energised, phase, ...forces(y, v, a, trip.load, energised)};
}

/** a mission from a list of [toFloor, load] calls, starting at floor `start` */
export function planMission(calls, start = 0, t0 = 0) {
  const trips = [];
  let at = start;
  let t = t0;
  for (const [to, load] of calls) {
    if (to === at) continue;
    const tr = planTrip(at, to, load, t);
    trips.push(tr);
    t += tr.dur;
    at = to;
  }
  return {start, trips, end: t};
}

/** add one call to a live mission (returns the new trip, or null when the car is already there) */
export function addCall(mission, to, load, now) {
  const last = mission.trips[mission.trips.length - 1];
  const at = last ? last.to : mission.start;
  if (to === at) return null;
  const tr = planTrip(at, to, load, Math.max(now, last ? last.t0 + last.dur : now));
  mission.trips.push(tr);
  mission.end = tr.t0 + tr.dur;
  return tr;
}

// ------------------------------------------------------------------------------------------------ THE ONE FUNCTION
/** every pose and reading at mission time t */
export function stateAt(mission, t) {
  const {trips} = mission;
  let i = -1;
  for (let k = 0; k < trips.length; k++) if (trips[k].t0 <= t) i = k;
  let s;
  let trip = null;
  let tau = 0;
  let energy = 0;
  if (i < 0) {
    const y = mission.start * S.floorH;
    s = {y, v: 0, a: 0, jerk: 0, door: 1, doorV: 0, landing: mission.start, energised: false, phase: 'dwell', ...forces(y, 0, 0, 0, false)};
  } else {
    trip = trips[i];
    tau = Math.min(t - trip.t0, trip.dur);
    s = tripState(trip, tau);
    const u = tau / trip.Edt;
    const k = Math.min(trip.E.length - 2, Math.floor(u));
    energy = trip.E[k] + (trip.E[k + 1] - trip.E[k]) * (u - k);
    if (t - trip.t0 > trip.dur) s.phase = 'idle';
  }
  // poses read straight off y: the 2:1 kinematics
  const y = s.y;
  const sheaveAngle = (S.roping * y) / R; // rope speed is twice the car speed
  const pulleyAngle = y / rp; // each diverting pulley rolls at v / r
  const govAngle = y / (S.govD / 2); // governor rope is tied to the car, 1:1
  const floorF = y / S.floorH;
  // door panels (2-panel telescopic): fast panel moves the full opening, slow panel half
  const fast = s.door * S.doorW;
  const vFast = Math.abs(s.doorV);
  const doorKE = 2 * 0.5 * S.mPanel * vFast ** 2 + 2 * 0.5 * S.mPanel * (vFast / 2) ** 2; // car + landing panels
  return {
    t, trip, tripIndex: i, tt: tau, energy, // tt: seconds into the trip; energy: J, this trip
    ...s,
    phaseLabel: s.phase === 'idle' ? 'PARKED · DOORS OPEN' : PHASE[s.phase],
    load: trip ? trip.load : 0,
    persons: trip ? Math.round(trip.load / 75) : 0,
    floorF,
    floor: Math.round(floorF),
    cwBottom: cwBottomY(y),
    sheaveAngle, pulleyAngle, govAngle,
    doorFast: fast,
    doorSlow: fast / 2,
    doorKE,
    tcLoop: tcLoopY(y),
    tauRatio: Math.abs(s.tau) / TAU_RATED,
  };
}

/** sample a trip for the console chart: arrays of v, τ, P over its duration */
export function tripCurves(trip, n = 160) {
  const out = {t: [], v: [], tau: [], P: []};
  for (let k = 0; k <= n; k++) {
    const tau = (k / n) * trip.dur;
    const s = tripState(trip, tau);
    out.t.push(tau);
    out.v.push(s.v);
    out.tau.push(s.tau);
    out.P.push(s.Pel);
  }
  return out;
}
