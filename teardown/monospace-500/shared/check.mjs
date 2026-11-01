// Hand checks against the model. Run: node teardown/monospace-500/shared/check.mjs
// Each line: what, the hand-worked number, the model's number, pass/fail. Exits non-zero on any failure.
import * as M from './lift.js';

const {S, L, R, rp, W, g} = M;
let fails = 0;
const row = (what, hand, model, tol = 1e-3, unit = '') => {
  const ok = Math.abs(hand - model) <= tol * Math.max(1, Math.abs(hand));
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(58)} hand ${String(+hand.toPrecision(6)).padStart(10)}  model ${String(+model.toPrecision(6)).padStart(10)} ${unit}`);
};
const info = (what, v, unit = '') => console.log(`      ${what.padEnd(58)} ${String(+v.toPrecision(6)).padStart(17)}  ${unit}`);

console.log('\n— machine speed');
// 2:1 → rope speed 2v. n = 2v / (π D) rev/s
row('sheave speed at 1.0 m/s, 2:1, Ø480', ((2 * 1.0) / (Math.PI * 0.48)) * 60, M.RPM_RATED, 1e-4, 'rpm');
row('sheave angular speed 2v/R', 2 / 0.24, M.OMEGA_RATED, 1e-6, 'rad/s');
row('rated torque = 5700 W / 8.333 rad/s', 5700 / (2 / 0.24), M.TAU_RATED, 1e-6, 'N·m');
row('sheave turns for the full 15 m travel: 2·15 / (π·0.48)', 30 / (Math.PI * 0.48), (2 * M.TRAVEL) / (Math.PI * S.D), 1e-6, 'rev');

console.log('\n— masses');
row('counterweight W = 1100 + 0.5·1000', 1600, W, 0, 'kg');
row('filler stack = (1600−160) / 7850 / (0.16·0.62)', 1440 / 7850 / (0.16 * 0.62), L.stack, 1e-6, 'm');

console.log('\n— static torque, full load, ropes ignored');
// imbalance at the car = 0.5·Q·g; at the sheave each side carries half (2:1) → ΔT = 0.5·1000·9.81 / 2
const dT = (0.5 * 1000 * 9.81) / 2;
row('rope pull difference at the sheave', 2452.5, dT, 1e-9, 'N');
row('torque = ΔT · R = 2452.5 · 0.24', 588.6, dT * 0.24, 1e-9, 'N·m');
row('power check τω = 588.6 · 8.333 = 0.5·Q·g·v', 0.5 * 1000 * 9.81 * 1.0, 588.6 * (2 / 0.24), 1e-9, 'W');
// the model with rope weight switched off by putting the car where the rope falls balance:
// cwY − cY = −(span)/2 makes Frope = 0 → torque must equal 588.6
{
  const yBal = ((L.K + M.L.span / 2) / 2 + L.carPulleyDrop); // carPulleyY = (K + span/2)/2
  const f = M.forces(yBal, 0, 0, 1000, true);
  row('model torque at the rope-balance height', 588.6, f.tau, 1e-6, 'N·m');
  info('  (rope-balance height, car floor)', yBal, 'm');
}
row('static full-load torque / rated torque', 588.6 / 684, (dT * R) / M.TAU_RATED, 2e-3);

console.log('\n— S-curve, a = 0.7, j = 1.0, v = 1.0');
const tj = 0.7 / 1.0;
const ta = (1.0 - 0.7 ** 2 / 1.0) / 0.7;
const tAcc = 2 * tj + ta;
const dAcc = (1.0 * tAcc) / 2;
row('jerk phase a/j', 0.7, tj, 1e-9, 's');
row('constant-accel phase (v − a²/j)/a', 0.728571, ta, 1e-5, 's');
row('distance to reach 1.0 m/s, v·T/2', 1.06429, dAcc, 1e-5, 'm');
const one = M.scurve(3.0, 1, 0.7, 1);
row('one floor (3 m): run time 2·2.1286 + (3 − 2.1286)/1', 2 * tAcc + (3 - 2 * dAcc), one.T, 1e-9, 's');
row('one floor: model ends exactly at 3 m', 3.0, one.at(one.T - 1e-9).s, 1e-6, 'm');
const five = M.scurve(15, 1, 0.7, 1);
row('five floors (15 m): D/v + v/a + a/j', 15 + 1 / 0.7 + 0.7, five.T, 1e-9, 's');
// a short move that never reaches 1 m/s: 1 m. Peak speed vp solves vp(2·a/j + (vp − a²/j)/a) = 1 if vp > a²/j
const short = M.scurve(1.0, 1, 0.7, 1);
{
  // vp² /a + vp·a/j − D = 0 → vp = (−a/j + sqrt((a/j)² + 4D/a)) · a/2
  const a = 0.7;
  const j = 1;
  const vp = ((-a / j + Math.sqrt((a / j) ** 2 + (4 * 1.0) / a)) * a) / 2;
  row('1 m move: peak speed from the quadratic', vp, short.vp, 1e-6, 'm/s');
}
{
  // max |speed| over the run never exceeds v, |a| never exceeds amax
  let vm = 0;
  let am = 0;
  for (let k = 0; k <= 2000; k++) {
    const q = five.at((k / 2000) * five.T);
    vm = Math.max(vm, q.v);
    am = Math.max(am, Math.abs(q.a));
  }
  row('15 m run: max speed', 1.0, vm, 1e-6, 'm/s');
  row('15 m run: max acceleration', 0.7, am, 1e-6, 'm/s²');
}

console.log('\n— 2:1 kinematics');
row('rope length at the bottom = at the top (inextensible)', M.ropeLength(0), M.ropeLength(M.TRAVEL), 1e-9, 'm');
info('rope length per rope', M.ropeLength(0), 'm');
row('car up 1 m → counterweight down 1 m', -1, M.cwPulleyY(4) - M.cwPulleyY(3), 1e-9, 'm');
row('car up 1 m → 2 m of rope over the sheave (R·Δθ)', 2, R * (((S.roping * 4) / R) - ((S.roping * 3) / R)), 1e-9, 'm');

console.log('\n— rope safety factor (EN 81-20: ≥ 12 for 3+ ropes; Annex N may ask more)');
{
  const f = M.forces(0, 0, 0, 1000, false); // full load, car at the bottom: the longest car-side fall
  const hand = (2100 * 9.81) / 2 + 6 * 0.22 * 9.81 * f.falls.carSide;
  info('car-side pull at the sheave, all ropes (hand, span ignored)', hand, 'N');
  row('safety factor 6·40300 / T1', (6 * 40300) / hand, f.Sf, 3e-3);
}

console.log('\n— traction (EN 81-20 Annex D, undercut groove γ 30°, β 90°, μ 0.1, α 180°)');
{
  const d = Math.PI / 180;
  const f = (0.1 * 4 * (Math.cos(15 * d) - Math.sin(45 * d))) / (Math.PI - Math.PI / 2 - Math.PI / 6 - 1 + 0.5);
  row('equivalent friction f', 0.18921, f, 1e-4);
  row('limit e^(f·π)', Math.exp(0.18921 * Math.PI), M.TRACTION_LIMIT, 1e-4);
  row('125 % static load: (1100+1250)/1600', 2350 / 1600, (S.P + 1.25 * S.Q) / W, 1e-9);
  const full = M.forces(0, 0, 0, 1000, false);
  info('model: full load at the bottom, static T1/T2', full.ratio);
  const empty = M.forces(M.TRAVEL, 0, 0, 0, false);
  info('model: empty car at the top, static T2/T1', empty.ratio);
}

console.log('\n— doors (EN 81-20: kinetic energy ≤ 10 J)');
{
  const tr = M.planTrip(0, 1, 0, 0);
  let ke = 0;
  for (let k = 0; k <= 2000; k++) ke = Math.max(ke, M.stateAt({start: 0, trips: [tr]}, (k / 2000) * tr.Td).doorKE);
  row('door KE at full speed, 4 × 25 kg: ½·50·0.5² + ½·50·0.25²', 0.5 * 50 * 0.25 + 0.5 * 50 * 0.0625, ke, 1e-6, 'J');
}
info('door open/close time (0.9 m, 0.5 m/s, 0.8 m/s², 2 m/s³)', M.DOOR.T, 's');

console.log('\n— the full-load climb from the ground floor (peak torque and power)');
{
  const tr = M.planTrip(0, 5, 1000, 0);
  let tp = 0;
  let pp = 0;
  for (let k = 0; k <= 4000; k++) {
    const tau = tr.tM + (k / 4000) * tr.run.T;
    const st = M.stateAt({start: 0, trips: [tr]}, tau);
    tp = Math.max(tp, st.tau);
    pp = Math.max(pp, st.Pm);
  }
  const f0 = M.forces(0, 0, 0.7, 1000, true);
  // hand: Meq·a + (2100−1600)·g + rope + friction, times R/2
  const hand = (f0.Meq * 0.7 + 500 * 9.81 + f0.Frope + 250) * 0.12;
  info('equivalent mass at the car (Meq)', f0.Meq, 'kg');
  row('torque at full acceleration from the bottom', hand, M.forces(0, 0.01, 0.7, 1000, true).tau, 1e-3, 'N·m');
  info('peak torque over the run', tp, 'N·m');
  info('peak torque / rated', tp / M.TAU_RATED);
  info('peak shaft power', pp, 'W');
  const E = tr.E[tr.E.length - 1];
  const handE = ((500 * 9.81 * 15 + 250 * 15) / (0.9 * 0.96));
  info('trip energy from the grid, model', E / 3600, 'Wh');
  info('hand: (ΔPE + friction·15 m) / η, ignoring rope weight and KE', handE / 3600, 'Wh');
}

console.log(fails ? `\n${fails} FAILED` : '\nall checks pass');
process.exit(fails ? 1 : 0);
