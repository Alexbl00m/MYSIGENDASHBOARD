import type { BatteryParams, SimResult } from "./battery";
import { usableKwh } from "./battery";
import type { PriceSeries } from "./tariff";
import { dateOf, type HourKey } from "./time";

/** Energikostnad: Σ köp × köppris − Σ sälj × säljpris (kr). */
export function energyCost(gridBuy: ArrayLike<number>, gridSell: ArrayLike<number>, p: PriceSeries): number {
  let s = 0;
  for (let i = 0; i < gridBuy.length; i++) s += gridBuy[i] * p.buy[i] - gridSell[i] * p.sell[i];
  return s;
}

/** Effektavgift: medel av månadens tre högsta köptimmar × kr/kW, summerat över månader. */
export function powerFee(gridBuy: ArrayLike<number>, keys: HourKey[], p: PriceSeries): number {
  const byMonth = new Map<string, { peaks: number[]; fee: number }>();
  for (let i = 0; i < keys.length; i++) {
    const m = keys[i].slice(0, 7);
    const e = byMonth.get(m) ?? { peaks: [], fee: p.period[i].effektavgiftKrPerKw };
    e.peaks.push(gridBuy[i]);
    byMonth.set(m, e);
  }
  let total = 0;
  for (const e of byMonth.values()) {
    if (e.fee === 0) continue;
    const top = e.peaks.sort((a, b) => b - a).slice(0, 3);
    total += (top.reduce((s, x) => s + x, 0) / top.length) * e.fee;
  }
  return total;
}

/** Kostnad utan sol och batteri: Σ förbrukning × köppris. */
export function costWithoutSystem(load: ArrayLike<number>, p: PriceSeries): number {
  let s = 0;
  for (let i = 0; i < load.length; i++) s += load[i] * p.buy[i];
  return s;
}

export interface Metrics {
  costKr: number; // energikostnad
  powerFeeKr: number;
  buyKwh: number;
  sellKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  gridChargeKwh: number; // laddning från nätet: Σ min(laddning, köp) per timme
  dischargeWhileSellingKwh: number; // export från batteriet: Σ min(urladdning, sälj) per timme
  cycles: number; // ekvivalenta fulla cykler på användbar kapacitet
  monthly: Map<string, { costKr: number; buyKwh: number; sellKwh: number }>;
  dailySwingKwh: Map<string, number>; // största SOC-spann per dygn
}

export function metrics(
  res: Pick<SimResult, "gridBuy" | "gridSell" | "cIn" | "dOut"> & { soc?: Float64Array },
  d: Float64Array,
  keys: HourKey[],
  p: PriceSeries,
  b?: BatteryParams,
): Metrics {
  const m: Metrics = {
    costKr: energyCost(res.gridBuy, res.gridSell, p),
    powerFeeKr: powerFee(res.gridBuy, keys, p),
    buyKwh: 0,
    sellKwh: 0,
    chargeKwh: 0,
    dischargeKwh: 0,
    gridChargeKwh: 0,
    dischargeWhileSellingKwh: 0,
    cycles: 0,
    monthly: new Map(),
    dailySwingKwh: new Map(),
  };
  const dayMin = new Map<string, number>();
  const dayMax = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    m.buyKwh += res.gridBuy[i];
    m.sellKwh += res.gridSell[i];
    m.chargeKwh += res.cIn[i];
    m.dischargeKwh += res.dOut[i];
    m.gridChargeKwh += Math.min(res.cIn[i], res.gridBuy[i]);
    m.dischargeWhileSellingKwh += Math.min(res.dOut[i], res.gridSell[i]);
    const mk = keys[i].slice(0, 7);
    const e = m.monthly.get(mk) ?? { costKr: 0, buyKwh: 0, sellKwh: 0 };
    e.costKr += res.gridBuy[i] * p.buy[i] - res.gridSell[i] * p.sell[i];
    e.buyKwh += res.gridBuy[i];
    e.sellKwh += res.gridSell[i];
    m.monthly.set(mk, e);
    if (res.soc) {
      const day = dateOf(keys[i]);
      dayMin.set(day, Math.min(dayMin.get(day) ?? Infinity, res.soc[i]));
      dayMax.set(day, Math.max(dayMax.get(day) ?? -Infinity, res.soc[i]));
    }
  }
  if (b) m.cycles = m.dischargeKwh / b.etaD / usableKwh(b);
  for (const [day, lo] of dayMin) m.dailySwingKwh.set(day, dayMax.get(day)! - lo);
  return m;
}

/**
 * Andel dygn per månad då batteriet använde mer SOC-spann än `baseUsableKwh`,
 * dvs. då den extra kapaciteten faktiskt behövdes.
 */
export function extraCapacityUse(dailySwing: Map<string, number>, baseUsableKwh: number): Map<string, number> {
  const acc = new Map<string, { used: number; n: number }>();
  for (const [day, swing] of dailySwing) {
    const mk = day.slice(0, 7);
    const e = acc.get(mk) ?? { used: 0, n: 0 };
    e.n++;
    if (swing > baseUsableKwh + 0.05) e.used++;
    acc.set(mk, e);
  }
  return new Map([...acc].map(([k, e]) => [k, e.used / e.n]));
}

export interface Payback {
  simpleYears: number; // pris / årlig besparing
  withDegradationYears: number | null; // med årlig kapacitetsförlust, null om aldrig inom horisonten
  netAfterHorizonKr: number;
}

/**
 * Återbetalningstid. `priceKr` är pris efter grönt avdrag. Med kapacitetsförlust
 * antas besparingen år y vara besparing × (1 − förlust)^(y−1). Ingen diskontering.
 */
export function payback(priceKr: number, annualSavingKr: number, degradationPerYear: number, horizonYears: number): Payback {
  const simpleYears = annualSavingKr > 0 ? priceKr / annualSavingKr : Infinity;
  let cum = 0;
  let withDeg: number | null = null;
  for (let y = 1; y <= horizonYears; y++) {
    const s = annualSavingKr * (1 - degradationPerYear) ** (y - 1);
    if (withDeg === null && cum + s >= priceKr) withDeg = y - 1 + (priceKr - cum) / s;
    cum += s;
  }
  return { simpleYears, withDegradationYears: annualSavingKr > 0 ? withDeg : null, netAfterHorizonKr: cum - priceKr };
}

/** Skalar ett belopp för en period som inte är exakt 365 dagar till helår. */
export const annualize = (value: number, hours: number) => (value * 8760) / hours;
