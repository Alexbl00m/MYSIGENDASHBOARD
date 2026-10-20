/**
 * Timvis batterisimulering.
 *
 * Konvention: `d[t]` är husets nettobehov före batteri i kWh (förbrukning − sol).
 * Positivt = underskott, negativt = överskott. Batteriet laddar `cIn` (kWh från
 * AC-sidan) och laddar ur `dOut` (kWh till AC-sidan). Nätflödet blir
 * d + cIn − dOut; positivt köps, negativt säljs.
 */

export interface BatteryParams {
  capacityKwh: number; // nominell kapacitet
  socMinKwh: number;
  socMaxKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  etaC: number; // laddverkningsgrad
  etaD: number; // urladdningsverkningsgrad
  cycleCostSekPerKwh: number; // slitagekostnad per urladdad kWh (styr optimeraren)
  gridMaxKw: number; // huvudsäkring, tak för köp och sälj
  allowExport: boolean; // får batteriet ladda ur till nätet?
}

export interface BatteryConfig {
  socMinPct: number;
  socMaxPct: number;
  roundTripEfficiency: number;
  cycleCostSekPerKwh: number;
  gridMaxKw: number;
  inverterMaxKw: number;
  allowExport: boolean;
}

export interface Module {
  kwh: number;
  maxKw: number;
}

export function makeBattery(modules: Module[], cfg: BatteryConfig): BatteryParams {
  const capacityKwh = modules.reduce((s, m) => s + m.kwh, 0);
  const kw = Math.min(
    modules.reduce((s, m) => s + m.maxKw, 0),
    cfg.inverterMaxKw,
  );
  const eta = Math.sqrt(cfg.roundTripEfficiency);
  return {
    capacityKwh,
    socMinKwh: (capacityKwh * cfg.socMinPct) / 100,
    socMaxKwh: (capacityKwh * cfg.socMaxPct) / 100,
    maxChargeKw: kw,
    maxDischargeKw: kw,
    etaC: eta,
    etaD: eta,
    cycleCostSekPerKwh: cfg.cycleCostSekPerKwh,
    gridMaxKw: cfg.gridMaxKw,
    allowExport: cfg.allowExport,
  };
}

export const usableKwh = (b: BatteryParams) => b.socMaxKwh - b.socMinKwh;

export interface SimInput {
  d: Float64Array; // verkligt nettobehov
  forecast: Float64Array; // prognos av nettobehov (används av prisstrategierna)
  buy: Float64Array; // kr/kWh
  sell: Float64Array; // kr/kWh
  hour: Uint8Array; // timme på dygnet; serien börjar kl. 00 och har 24 timmar per dygn
  chargeCap?: Float64Array; // valfritt tak per timme (kWh), t.ex. delad växelriktare
  dischargeCap?: Float64Array;
}

export interface SimResult {
  cIn: Float64Array;
  dOut: Float64Array;
  soc: Float64Array; // vid timmens slut
  gridBuy: Float64Array;
  gridSell: Float64Array;
}

export type Strategy = "egen" | "pris" | "kombi" | "perfekt";

export const STRATEGY_LABEL: Record<Strategy, string> = {
  egen: "(a) Egenanvändning",
  pris: "(b) Prisstyrt schema",
  kombi: "(c) Kombination",
  perfekt: "(c*) Kombination, perfekt framförhållning",
};

function newResult(n: number): SimResult {
  return {
    cIn: new Float64Array(n),
    dOut: new Float64Array(n),
    soc: new Float64Array(n),
    gridBuy: new Float64Array(n),
    gridSell: new Float64Array(n),
  };
}

const capC = (inp: SimInput, b: BatteryParams, t: number) =>
  Math.min(b.maxChargeKw, inp.chargeCap ? inp.chargeCap[t] : Infinity);
const capD = (inp: SimInput, b: BatteryParams, t: number) =>
  Math.min(b.maxDischargeKw, inp.dischargeCap ? inp.dischargeCap[t] : Infinity);

/**
 * Utför en önskad laddning/urladdning för timme t och respekterar SOC,
 * effekt, huvudsäkring och exportregel. Returnerar ny SOC.
 */
export function applyHour(
  inp: SimInput,
  b: BatteryParams,
  res: SimResult,
  t: number,
  soc: number,
  wantC: number,
  wantD: number,
): number {
  const d = inp.d[t];
  let c = Math.max(0, Math.min(wantC, capC(inp, b, t), (b.socMaxKwh - soc) / b.etaC));
  let x = c > 0 ? 0 : Math.max(0, Math.min(wantD, capD(inp, b, t), (soc - b.socMinKwh) * b.etaD));
  if (!b.allowExport) x = Math.min(x, Math.max(d, 0));
  if (d + c - x > b.gridMaxKw) c = Math.max(0, b.gridMaxKw - d + x);
  if (d + c - x < -b.gridMaxKw) x = Math.max(0, d + c + b.gridMaxKw);
  const net = d + c - x;
  res.cIn[t] = c;
  res.dOut[t] = x;
  res.gridBuy[t] = Math.max(net, 0);
  res.gridSell[t] = Math.max(-net, 0);
  const next = soc + c * b.etaC - x / b.etaD;
  res.soc[t] = next;
  return next;
}

const startSoc = (b: BatteryParams) => b.socMinKwh + usableKwh(b) / 2;

/** (a) Ladda med solöverskott, ladda ur vid underskott. Ingen nätladdning. */
export function simulateSelfConsumption(inp: SimInput, b: BatteryParams): SimResult {
  const n = inp.d.length;
  const res = newResult(n);
  let soc = startSoc(b);
  for (let t = 0; t < n; t++) {
    const d = inp.d[t];
    soc = d < 0 ? applyHour(inp, b, res, t, soc, -d, 0) : applyHour(inp, b, res, t, soc, 0, d);
  }
  return res;
}

export interface TouOptions {
  chargeWindow: [number, number]; // [från, till) timme, t.ex. [0, 6]
}

/**
 * (b) Enkelt prisstyrt schema, som TOU-läget i en växelriktare: varje dygn
 * laddas batteriet från nätet under nattfönstrets billigaste timmar och laddas
 * ur under dygnets dyraste timmar (till huset, och till nätet om export är
 * tillåten och lönsam). Övrig tid står batteriet still, så solöverskott säljs.
 */
export function simulateTou(inp: SimInput, b: BatteryParams, opt: TouOptions): SimResult {
  const n = inp.d.length;
  const res = newResult(n);
  let soc = startSoc(b);
  const [w0, w1] = opt.chargeWindow;
  for (let day = 0; day < n; day += 24) {
    const idx = Array.from({ length: Math.min(24, n - day) }, (_, h) => day + h);
    const win = idx.filter((t) => inp.hour[t] >= w0 && inp.hour[t] < w1).sort((a, c) => inp.buy[a] - inp.buy[c]);
    const rest = idx.filter((t) => inp.hour[t] < w0 || inp.hour[t] >= w1);

    // Ungefärlig kostnad per urladdad kWh om vi fyller på i de billigaste fönstertimmarna.
    const hoursToFill = Math.max(1, Math.ceil((usableKwh(b) / b.etaC) / b.maxChargeKw));
    const cheapest = win.slice(0, hoursToFill);
    const avgChargePrice = cheapest.length ? cheapest.reduce((s, t) => s + inp.buy[t], 0) / cheapest.length : Infinity;
    const costPerOut = avgChargePrice / (b.etaC * b.etaD) + b.cycleCostSekPerKwh;

    // Fördela förväntad urladdning på de mest värdefulla timmarna.
    type Item = { t: number; kwh: number; value: number; export: boolean };
    const items: Item[] = [];
    for (const t of rest) {
      const load = Math.min(Math.max(inp.forecast[t], 0), b.maxDischargeKw);
      if (load > 0) items.push({ t, kwh: load, value: inp.buy[t], export: false });
      if (b.allowExport && b.maxDischargeKw - load > 0) items.push({ t, kwh: b.maxDischargeKw - load, value: inp.sell[t], export: true });
    }
    items.sort((a, c) => c.value - a.value);
    let budget = usableKwh(b) * b.etaD;
    const plan = new Map<number, { load: boolean; export: boolean }>();
    for (const it of items) {
      if (budget <= 0 || it.value <= costPerOut) break;
      const p = plan.get(it.t) ?? { load: false, export: false };
      if (it.export) p.export = true;
      else p.load = true;
      plan.set(it.t, p);
      budget -= it.kwh;
    }
    const plannedOut = usableKwh(b) * b.etaD - Math.max(budget, 0);
    let toCharge = Math.max(0, plannedOut / b.etaD - (soc - b.socMinKwh)) / b.etaC;
    const chargeHours = new Set<number>();
    for (const t of win) {
      if (toCharge <= 0) break;
      chargeHours.add(t);
      toCharge -= b.maxChargeKw;
    }

    for (const t of idx) {
      const p = plan.get(t);
      if (chargeHours.has(t)) soc = applyHour(inp, b, res, t, soc, b.maxChargeKw, 0);
      else if (p?.export) soc = applyHour(inp, b, res, t, soc, 0, b.maxDischargeKw);
      else if (p?.load) soc = applyHour(inp, b, res, t, soc, 0, Math.max(inp.d[t], 0));
      else soc = applyHour(inp, b, res, t, soc, 0, 0);
    }
  }
  return res;
}

/* ---------- Dynamisk programmering (kombinerad strategi) ---------- */

interface Grid {
  step: number;
  n: number; // antal SOC-nivåer
}

function makeGrid(b: BatteryParams, step: number): Grid {
  return { step, n: Math.max(1, Math.round(usableKwh(b) / step)) + 1 };
}

/**
 * Kostnad för att gå k steg i SOC under timme t givet nettobehov f.
 * Returnerar Infinity om det inte går (effekt, säkring, exportregel).
 */
function stageCost(k: number, f: number, buy: number, sell: number, b: BatteryParams, g: Grid, maxC: number, maxD: number): number {
  const delta = k * g.step;
  let c = 0;
  let x = 0;
  if (delta > 0) {
    c = delta / b.etaC;
    if (c > maxC + 1e-9) return Infinity;
  } else if (delta < 0) {
    x = -delta * b.etaD;
    if (x > maxD + 1e-9) return Infinity;
    if (!b.allowExport && x > Math.max(f, 0) + 1e-9) return Infinity;
  }
  const net = f + c - x;
  if (k !== 0 && (net > b.gridMaxKw + 1e-9 || net < -b.gridMaxKw - 1e-9)) return Infinity;
  return (net > 0 ? buy * net : sell * net) + b.cycleCostSekPerKwh * x;
}

function stepBounds(b: BatteryParams, g: Grid, maxC: number, maxD: number) {
  return {
    up: Math.floor((maxC * b.etaC) / g.step + 1e-9),
    down: Math.floor(maxD / b.etaD / g.step + 1e-9),
  };
}

/** Ett bakåtsteg: V[i] = min_k cost(k) + Vnext[i+k]. Skriver bästa k till `best` om given. */
function backwardStep(
  f: number,
  buy: number,
  sell: number,
  b: BatteryParams,
  g: Grid,
  maxC: number,
  maxD: number,
  Vnext: Float64Array,
  V: Float64Array,
  best?: Int16Array,
  bestOffset = 0,
) {
  const { up, down } = stepBounds(b, g, maxC, maxD);
  const costs = new Float64Array(up + down + 1);
  for (let k = -down; k <= up; k++) costs[k + down] = stageCost(k, f, buy, sell, b, g, maxC, maxD);
  for (let i = 0; i < g.n; i++) {
    let m = Infinity;
    let mk = 0;
    const kLo = Math.max(-down, -i);
    const kHi = Math.min(up, g.n - 1 - i);
    for (let k = kLo; k <= kHi; k++) {
      const v = costs[k + down] + Vnext[i + k];
      if (v < m) {
        m = v;
        mk = k;
      }
    }
    V[i] = m;
    if (best) best[bestOffset + i] = mk;
  }
}

function terminalValue(b: BatteryParams, g: Grid, perKwh: number): Float64Array {
  const V = new Float64Array(g.n);
  for (let i = 0; i < g.n; i++) V[i] = -perKwh * i * g.step;
  return V;
}

/** Värde på kvarvarande energi vid horisontens slut: 20:e percentilen av köppriset × verkningsgrad. */
function horizonTerminalPrice(buy: Float64Array, from: number, to: number, b: BatteryParams): number {
  const xs = Array.from(buy.subarray(from, to + 1)).sort((a, c) => a - c);
  return b.etaD * xs[Math.floor(xs.length * 0.2)];
}

const socIndex = (soc: number, b: BatteryParams, g: Grid) =>
  Math.min(g.n - 1, Math.max(0, Math.round((soc - b.socMinKwh) / g.step)));

/**
 * (c*) Global optimering över hela perioden med perfekt kännedom om både
 * priser och förbrukning. Ingen verklig styrning når hit; används som tak.
 */
export function simulatePerfect(inp: SimInput, b: BatteryParams, step = 0.1): SimResult {
  const n = inp.d.length;
  const g = makeGrid(b, step);
  const policy = new Int16Array(n * g.n);
  let Vnext: Float64Array = terminalValue(b, g, horizonTerminalPrice(inp.buy, Math.max(0, n - 24), n - 1, b));
  let V: Float64Array = new Float64Array(g.n);
  for (let t = n - 1; t >= 0; t--) {
    backwardStep(inp.d[t], inp.buy[t], inp.sell[t], b, g, capC(inp, b, t), capD(inp, b, t), Vnext, V, policy, t * g.n);
    [Vnext, V] = [V, Vnext];
  }
  const res = newResult(n);
  let soc = startSoc(b);
  for (let t = 0; t < n; t++) {
    const i = socIndex(soc, b, g);
    const k = policy[t * g.n + i];
    const target = b.socMinKwh + (i + k) * g.step;
    soc = target > soc ? applyHour(inp, b, res, t, soc, (target - soc) / b.etaC, 0) : applyHour(inp, b, res, t, soc, 0, (soc - target) * b.etaD);
  }
  return res;
}

/** Sista index med kända priser vid timme t: dygnets slut, eller morgondagens efter kl. 13. */
export function knownUntil(t: number, hour: number, n: number): number {
  const dayStart = t - hour;
  return Math.min(n - 1, hour >= 13 ? dayStart + 47 : dayStart + 23);
}

/**
 * (c) Kombinerad strategi med modellprediktiv styrning: varje timme planeras
 * batteriet optimalt fram till slutet av de kända priserna (som i verkligheten:
 * morgondagens priser publiceras ca 13:00), med prognos för förbrukning och sol
 * (medel för samma timme senaste 7 dygnen). Första timmens plan översätts till
 * ett läge (nätladda till mål-SOC / sälja / spara / egenanvändning) som körs
 * mot verkliga värden.
 */
export function simulateMpc(inp: SimInput, b: BatteryParams, step = 0.2): SimResult {
  const n = inp.d.length;
  const g = makeGrid(b, step);
  const res = newResult(n);
  let V: Float64Array = new Float64Array(g.n);
  let Vnext: Float64Array = new Float64Array(g.n);
  let soc = startSoc(b);
  for (let t = 0; t < n; t++) {
    const end = knownUntil(t, inp.hour[t], n);
    Vnext = terminalValue(b, g, horizonTerminalPrice(inp.buy, t, end, b));
    for (let u = end; u > t; u--) {
      backwardStep(inp.forecast[u], inp.buy[u], inp.sell[u], b, g, capC(inp, b, u), capD(inp, b, u), Vnext, V);
      [Vnext, V] = [V, Vnext];
    }
    // Välj första timmens steg från aktuell SOC.
    const i0 = socIndex(soc, b, g);
    const maxC = capC(inp, b, t);
    const maxD = capD(inp, b, t);
    const { up, down } = stepBounds(b, g, maxC, maxD);
    const f0 = inp.forecast[t];
    let bestK = 0;
    let bestV = Infinity;
    for (let k = Math.max(-down, -i0); k <= Math.min(up, g.n - 1 - i0); k++) {
      const v = stageCost(k, f0, inp.buy[t], inp.sell[t], b, g, maxC, maxD) + Vnext[i0 + k];
      if (v < bestV) {
        bestV = v;
        bestK = k;
      }
    }
    const delta = bestK * g.step;
    const planC = delta > 0 ? delta / b.etaC : 0;
    const planD = delta < 0 ? -delta * b.etaD : 0;
    const d = inp.d[t];
    if (planC > Math.max(-f0, 0) + 1e-6) {
      // Nätladdning planerad: ladda mot mål-SOC (och ta allt solöverskott).
      const target = b.socMinKwh + (i0 + bestK) * g.step;
      soc = applyHour(inp, b, res, t, soc, Math.max((target - soc) / b.etaC, -d), 0);
    } else if (planD > Math.max(f0, 0) + 1e-6) {
      // Försäljning från batteriet planerad.
      soc = applyHour(inp, b, res, t, soc, 0, Math.max(planD, d));
    } else if (d < 0) {
      soc = applyHour(inp, b, res, t, soc, -d, 0);
    } else {
      // Egenanvändning, men med planens tak om optimeraren vill spara energi.
      const cap = f0 > 1e-6 ? d * Math.min(1, planD / f0) : d;
      soc = applyHour(inp, b, res, t, soc, 0, Math.min(d, cap));
    }
  }
  return res;
}

export function simulate(strategy: Strategy, inp: SimInput, b: BatteryParams, opts: { tou: TouOptions; mpcStep: number; dpStep: number }): SimResult {
  switch (strategy) {
    case "egen":
      return simulateSelfConsumption(inp, b);
    case "pris":
      return simulateTou(inp, b, opts.tou);
    case "kombi":
      return simulateMpc(inp, b, opts.mpcStep);
    case "perfekt":
      return simulatePerfect(inp, b, opts.dpStep);
  }
}

/** Prognos: medel av samma timme de senaste `days` dygnen (endast historik). */
export function persistenceForecast(d: Float64Array, days = 7): Float64Array {
  const out = new Float64Array(d.length);
  for (let t = 0; t < d.length; t++) {
    let s = 0;
    let c = 0;
    for (let k = 1; k <= days; k++) {
      const u = t - 24 * k;
      if (u >= 0) {
        s += d[u];
        c++;
      }
    }
    out[t] = c > 0 ? s / c : d[t];
  }
  return out;
}
