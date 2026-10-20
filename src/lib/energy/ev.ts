/**
 * Uppskattning av elbilsladdning ur husets timförbrukning (när Easee-data
 * saknas). Elbilsladdning syns som block med hög, jämn effekt ovanpå husets
 * grundlast. Grundlasten tas som näst lägsta förbrukning inom ±`windowHours`,
 * vilket följer värmepumpens långsamma variation men inte ett laddblock.
 * Resultatet är en UPPSKATTNING.
 */
export interface EvDetectOptions {
  thresholdKw: number; // effekt över grundlast som räknas som laddning, t.ex. 3
  minHours: number; // minsta blocklängd, t.ex. 2
  windowHours: number; // fönster för grundlast, t.ex. 4
  chargerMaxKw: number;
}

export function estimateEv(load: Float64Array, o: EvDetectOptions): Float64Array {
  const n = load.length;
  const excess = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, t - o.windowHours);
    const hi = Math.min(n - 1, t + o.windowHours);
    let a = Infinity;
    let b = Infinity;
    for (let u = lo; u <= hi; u++) {
      const v = load[u];
      if (v < a) {
        b = a;
        a = v;
      } else if (v < b) b = v;
    }
    excess[t] = Math.max(0, load[t] - (Number.isFinite(b) ? b : a));
  }
  const ev = new Float64Array(n);
  let t = 0;
  while (t < n) {
    if (excess[t] < o.thresholdKw) {
      t++;
      continue;
    }
    let e = t;
    while (e + 1 < n && excess[e + 1] >= o.thresholdKw) e++;
    if (e - t + 1 >= o.minHours) {
      // Ta med del-timmar i blockets kanter (laddning som startar/slutar mitt i timmen).
      const s0 = t > 0 && excess[t - 1] >= 1 ? t - 1 : t;
      const e0 = e + 1 < n && excess[e + 1] >= 1 ? e + 1 : e;
      for (let u = s0; u <= e0; u++) ev[u] = Math.min(excess[u], o.chargerMaxKw);
    }
    t = e + 1;
  }
  return ev;
}

export interface SolarEvOptions {
  dayWindow: [number, number]; // [från, till) timme då bilen kan solladda, t.ex. [9, 17]
  months: number[]; // månader då scenariot tillämpas
  chargerMaxKw: number;
  chargerMinKw: number; // lägsta laddeffekt (1-fas 6 A ≈ 1,4 kW; 3-fas 6 A ≈ 4,1 kW)
}

export interface SolarEvDay {
  date: string;
  month: number;
  shiftableKwh: number; // om bilen är hemma
  savingKr: number; // om bilen är hemma
}

/**
 * "Solöverskott till elbilen": flytta elbilsladdning från kvällen/natten
 * (17:00 dag D – 07:00 dag D+1) till dagtimmar med såld solel samma dag.
 * Resultatet gäller dagar då bilen står hemma; skala med andelen hemmadagar.
 * Värde per flyttad kWh = undvikt köppris på natten − uteblivet säljpris dagtid.
 */
export function solarToEv(
  dates: string[],
  hour: Uint8Array,
  pv: Float64Array,
  sell: Float64Array,
  ev: Float64Array,
  buyPrice: Float64Array,
  sellPrice: Float64Array,
  o: SolarEvOptions,
): SolarEvDay[] {
  const out: SolarEvDay[] = [];
  const n = pv.length;
  for (let s = 0, day = 0; s < n; s += 24, day++) {
    const month = Number(dates[day].slice(5, 7));
    if (!o.months.includes(month)) continue;
    const dayHours: { kwh: number; price: number }[] = [];
    for (let h = o.dayWindow[0]; h < o.dayWindow[1]; h++) {
      const t = s + h;
      if (t >= n || hour[t] !== h) continue;
      const avail = Math.min(sell[t], pv[t], o.chargerMaxKw);
      if (avail >= o.chargerMinKw) dayHours.push({ kwh: avail, price: sellPrice[t] });
    }
    const nightHours: { kwh: number; price: number }[] = [];
    for (let t = s + 17; t < Math.min(n, s + 31); t++) if (ev[t] > 0) nightHours.push({ kwh: ev[t], price: buyPrice[t] });

    dayHours.sort((a, b) => a.price - b.price); // sälj bort billigast först
    nightHours.sort((a, b) => b.price - a.price); // undvik dyrast först
    let shift = 0;
    let saving = 0;
    let i = 0;
    let j = 0;
    let di = dayHours[0]?.kwh ?? 0;
    let nj = nightHours[0]?.kwh ?? 0;
    while (i < dayHours.length && j < nightHours.length) {
      const gain = nightHours[j].price - dayHours[i].price;
      if (gain <= 0) break;
      const q = Math.min(di, nj);
      shift += q;
      saving += q * gain;
      di -= q;
      nj -= q;
      if (di <= 1e-9) di = dayHours[++i]?.kwh ?? 0;
      if (nj <= 1e-9) nj = nightHours[++j]?.kwh ?? 0;
    }
    out.push({ date: dates[day], month, shiftableKwh: shift, savingKr: saving });
  }
  return out;
}
