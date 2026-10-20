import { describe, expect, it } from "vitest";
import {
  applyHour,
  knownUntil,
  makeBattery,
  persistenceForecast,
  simulateMpc,
  simulatePerfect,
  simulateSelfConsumption,
  simulateTou,
  usableKwh,
  type BatteryConfig,
  type SimInput,
  type SimResult,
} from "../src/lib/energy/battery";
import { energyCost, extraCapacityUse, payback, powerFee } from "../src/lib/energy/economics";
import { estimateEv, solarToEv } from "../src/lib/energy/ev";
import { alignPrices, hourlyFromApi } from "../src/lib/energy/prices";
import { netDemand, parseSigenRows, parseTimestamp } from "../src/lib/energy/sigen";
import { buyPrice, priceSeries, sellPrice, type ContractPeriod } from "../src/lib/energy/tariff";
import { hoursBetween } from "../src/lib/energy/time";

const p2025: ContractPeriod = {
  fran: "2024-01-01",
  till: "2025-12-31",
  paslagOre: 5,
  natOverforingOre: 25,
  energiskattOre: 43.9,
  natnyttaOre: 4,
  saljTillaggOre: -2,
  skattereduktionOre: 60,
  effektavgiftKrPerKw: 0,
  manadsavgiftKr: 0,
};
const p2026: ContractPeriod = { ...p2025, fran: "2026-01-01", till: "2099-12-31", energiskattOre: 36, skattereduktionOre: 0 };
const tariff = { momsPct: 25, perioder: [p2025, p2026] };

const bcfg: BatteryConfig = {
  socMinPct: 0,
  socMaxPct: 100,
  roundTripEfficiency: 0.9025, // 0,95 per riktning
  cycleCostSekPerKwh: 0,
  gridMaxKw: 17,
  inverterMaxKw: 10,
  allowExport: true,
};

function input(d: number[], buy: number[], sell: number[]): SimInput {
  return {
    d: Float64Array.from(d),
    forecast: Float64Array.from(d),
    buy: Float64Array.from(buy),
    sell: Float64Array.from(sell),
    hour: Uint8Array.from(d, (_, i) => i % 24),
  };
}

function checkBalance(inp: SimInput, r: SimResult, b: ReturnType<typeof makeBattery>) {
  let soc = b.socMinKwh + usableKwh(b) / 2;
  for (let t = 0; t < inp.d.length; t++) {
    expect(r.gridBuy[t] - r.gridSell[t]).toBeCloseTo(inp.d[t] + r.cIn[t] - r.dOut[t], 9);
    expect(r.cIn[t] * r.dOut[t]).toBe(0);
    expect(r.cIn[t]).toBeLessThanOrEqual(b.maxChargeKw + 1e-9);
    expect(r.dOut[t]).toBeLessThanOrEqual(b.maxDischargeKw + 1e-9);
    soc += r.cIn[t] * b.etaC - r.dOut[t] / b.etaD;
    expect(r.soc[t]).toBeCloseTo(soc, 9);
    expect(soc).toBeGreaterThanOrEqual(b.socMinKwh - 1e-9);
    expect(soc).toBeLessThanOrEqual(b.socMaxKwh + 1e-9);
  }
}

describe("tariff", () => {
  it("köppris = (spot + påslag + nät + skatt) × 1,25", () => {
    expect(buyPrice(1.0, p2025, 25)).toBeCloseTo((1.0 + 0.05 + 0.25 + 0.439) * 1.25, 10);
  });
  it("säljpris inkluderar skattereduktion t.o.m. 2025 men inte därefter", () => {
    expect(sellPrice(1.0, p2025)).toBeCloseTo(1.0 + 0.04 - 0.02 + 0.6, 10);
    expect(sellPrice(1.0, p2026)).toBeCloseTo(1.0 + 0.04 - 0.02, 10);
  });
  it("historisk använder periodens avtal, framåt det senaste", () => {
    const keys = ["2025-12-31T23", "2026-01-01T00"];
    const spot = Float64Array.from([1, 1]);
    const h = priceSeries(keys, spot, tariff, "historisk");
    const f = priceSeries(keys, spot, tariff, "framat");
    expect(h.sell[0]).toBeCloseTo(1.62, 10);
    expect(h.sell[1]).toBeCloseTo(1.02, 10);
    expect(f.sell[0]).toBeCloseTo(1.02, 10);
    expect(f.buy[0]).toBeCloseTo((1 + 0.05 + 0.25 + 0.36) * 1.25, 10);
  });
  it("skalar bara spotpriset i känslighetsanalysen", () => {
    const s = priceSeries(["2026-05-01T12"], Float64Array.from([1]), tariff, "framat", 1.3);
    expect(s.buy[0]).toBeCloseTo((1.3 + 0.05 + 0.25 + 0.36) * 1.25, 10);
  });
  it("saknat avtal ger tydligt fel", () => {
    expect(() => priceSeries(["2023-01-01T00"], Float64Array.from([1]), tariff, "historisk")).toThrow(/Inget avtal/);
  });
});

describe("sigen-import", () => {
  const header = ["time", "solarEnergy", "loadConsumption", "batteryCharge", "batteryDischarge", "gridBuy", "gridSell", "profit"];
  it("tolkar rader, hoppar över total och '--'", () => {
    const r = parseSigenRows([
      ["Station X"],
      header,
      ["2025-06-01 12:00", 5, 2, 1, 0, 0, 2, "--"],
      ["2025-06-01 13:00", "4,5", "--", 0, 0.5, 0, 3, "--"],
      ["total", 9.5, 2, 1, 0.5, 0, 5, "--"],
    ]);
    expect(r.readings).toHaveLength(2);
    expect(r.skippedTotal).toBe(1);
    expect(r.readings[1]).toMatchObject({ key: "2025-06-01T13", pv: 4.5, load: 0, discharge: 0.5, sell: 3 });
  });
  it("hanterar MySigens rubrikrad utan tidskolumn", () => {
    const r = parseSigenRows([
      header.slice(1, 8),
      ["2025-10-20 07:00:00", "0.0", "2.79", "0.0", "2.12", "1.47", "0.82", "--"],
      ["total", "9445.7", "18164.81", "3327.18", "3151.03", "16380.39", "7485.13", "--"],
    ]);
    expect(r.readings).toHaveLength(1);
    expect(r.readings[0]).toMatchObject({ key: "2025-10-20T07", pv: 0, load: 2.79, charge: 0, discharge: 2.12, buy: 1.47, sell: 0.82 });
    expect(r.skippedTotal).toBe(1);
  });
  it("summerar dubbla timmar (vintertid)", () => {
    const r = parseSigenRows([header, ["2025-10-26 02:00", 0, 1, 0, 0, 1, 0, "--"], ["2025-10-26 02:00", 0, 1, 0, 0, 1.5, 0, "--"]]);
    expect(r.readings).toHaveLength(1);
    expect(r.readings[0].buy).toBeCloseTo(2.5);
    expect(r.mergedDuplicates).toBe(1);
  });
  it("tolkar olika tidsformat", () => {
    expect(parseTimestamp("2025/04/01 07:00:00")).toBe("2025-04-01T07");
    expect(parseTimestamp("01/04/2025 07:00")).toBe("2025-04-01T07");
    expect(parseTimestamp("2025-04-01 07:00-08:00")).toBe("2025-04-01T07");
    expect(parseTimestamp(new Date(Date.UTC(2025, 3, 1, 7)))).toBe("2025-04-01T07");
    expect(parseTimestamp("total")).toBeNull();
  });
  it("nettobehov ur energibalansen", () => {
    expect(netDemand({ key: "x", pv: 0, load: 0, buy: 1, sell: 2, charge: 0.5, discharge: 3 })).toBeCloseTo(1.5);
  });
});

describe("priser", () => {
  it("medelvärdesbildar kvartspriser till timme", () => {
    const m = hourlyFromApi([
      { SEK_per_kWh: 1, time_start: "2025-10-21T00:00:00+02:00" },
      { SEK_per_kWh: 2, time_start: "2025-10-21T00:15:00+02:00" },
      { SEK_per_kWh: 3, time_start: "2025-10-21T00:30:00+02:00" },
      { SEK_per_kWh: 4, time_start: "2025-10-21T00:45:00+02:00" },
      { SEK_per_kWh: 5, time_start: "2025-10-21T01:00:00+02:00" },
    ]);
    expect(m.get("2025-10-21T00")).toBeCloseTo(2.5);
    expect(m.get("2025-10-21T01")).toBe(5);
  });
  it("fyller saknade timmar med föregående pris", () => {
    const keys = hoursBetween("2026-03-29", "2026-03-29");
    const hourly = new Map(keys.filter((k) => k !== "2026-03-29T02").map((k, i) => [k, i]));
    const { spot, filled } = alignPrices(keys, hourly);
    expect(filled).toBe(1);
    expect(spot[2]).toBe(spot[1]);
  });
});

describe("batteri", () => {
  const b = makeBattery([{ kwh: 10, maxKw: 5 }], bcfg);

  it("makeBattery begränsar effekt till växelriktaren", () => {
    const big = makeBattery([{ kwh: 9, maxKw: 4.5 }, { kwh: 9, maxKw: 4.5 }, { kwh: 8, maxKw: 4 }], bcfg);
    expect(big.capacityKwh).toBe(26);
    expect(big.maxChargeKw).toBe(10);
    expect(big.etaC * big.etaD).toBeCloseTo(0.9025);
  });

  it("egenanvändning: energibalans, SOC-gränser och verkningsgrad", () => {
    const d = Array.from({ length: 48 }, (_, i) => (i % 24 >= 10 && i % 24 < 15 ? -4 : 1));
    const inp = input(d, d.map(() => 2), d.map(() => 0.5));
    const r = simulateSelfConsumption(inp, b);
    checkBalance(inp, r, b);
    expect(r.gridSell.reduce((s, x) => s + x, 0)).toBeGreaterThan(0); // batteriet blir fullt
  });

  it("perfekt optimering laddar billigt och laddar ur dyrt", () => {
    // Dygn: billigt kl. 0–3, dyrt kl. 18–21, jämn last 1 kWh.
    const d = Array.from({ length: 24 }, () => 1);
    const buy = d.map((_, h) => (h < 4 ? 0.5 : h >= 18 && h < 22 ? 3 : 1.5));
    const inp = input(d, buy, buy.map((x) => x - 0.8));
    const r = simulatePerfect(inp, b, 0.1);
    checkBalance(inp, r, b);
    const charged = r.cIn.slice(0, 4).reduce((s, x) => s + x, 0);
    const discharged = r.dOut.slice(18, 22).reduce((s, x) => s + x, 0);
    expect(charged).toBeGreaterThan(4);
    expect(discharged).toBeGreaterThan(3.9);
  });

  it("perfekt ≤ MPC och prisoptimering slår egenanvändning när priset varierar", () => {
    const days = 14;
    const d: number[] = [];
    const buy: number[] = [];
    for (let i = 0; i < days * 24; i++) {
      const h = i % 24;
      d.push(h >= 9 && h < 16 ? -3 + (i % 7) * 0.2 : 1.5 + ((i * 7) % 5) * 0.1);
      buy.push(h < 5 ? 0.8 : h >= 17 && h < 21 ? 3.2 : 1.8);
    }
    const sell = buy.map((x) => x * 0.6 - 0.3);
    const inp = { ...input(d, buy, sell), forecast: persistenceForecast(Float64Array.from(d)) };
    const p = { buy: inp.buy, sell: inp.sell, period: [] };
    const cost = (r: SimResult) => energyCost(r.gridBuy, r.gridSell, p);
    const perfect = simulatePerfect(inp, b, 0.1);
    const mpc = simulateMpc(inp, b, 0.2);
    const self = simulateSelfConsumption(inp, b);
    const tou = simulateTou(inp, b, { chargeWindow: [0, 6] });
    for (const r of [perfect, mpc, self, tou]) checkBalance(inp, r, b);
    expect(cost(perfect)).toBeLessThanOrEqual(cost(mpc) + 1e-6);
    expect(cost(perfect)).toBeLessThanOrEqual(cost(self) + 1e-6);
    expect(cost(mpc)).toBeLessThan(cost(self));
  });

  it("utan export laddar batteriet aldrig ur mer än husets underskott", () => {
    const noExp = makeBattery([{ kwh: 10, maxKw: 5 }], { ...bcfg, allowExport: false });
    const d = Array.from({ length: 24 }, (_, h) => (h < 12 ? 0.5 : 0.2));
    const buy = d.map((_, h) => (h < 6 ? 0.2 : 4));
    const inp = input(d, buy, buy);
    for (const r of [simulatePerfect(inp, noExp, 0.1), simulateMpc(inp, noExp, 0.2), simulateTou(inp, noExp, { chargeWindow: [0, 6] })]) {
      for (let t = 0; t < 24; t++) expect(r.dOut[t]).toBeLessThanOrEqual(Math.max(d[t], 0) + 1e-9);
    }
  });

  it("huvudsäkringen begränsar nätladdning", () => {
    const small = makeBattery([{ kwh: 10, maxKw: 10 }], { ...bcfg, gridMaxKw: 5 });
    const inp = input([4], [1], [0]);
    const r: SimResult = { cIn: new Float64Array(1), dOut: new Float64Array(1), soc: new Float64Array(1), gridBuy: new Float64Array(1), gridSell: new Float64Array(1) };
    applyHour(inp, small, r, 0, 0, 10, 0);
    expect(r.cIn[0]).toBeCloseTo(1);
    expect(r.gridBuy[0]).toBeCloseTo(5);
  });

  it("per-timme-tak (delad växelriktare) respekteras", () => {
    const d = Array.from({ length: 24 }, () => -5);
    const inp = { ...input(d, d.map(() => 1), d.map(() => 0.5)), chargeCap: Float64Array.from(d, () => 1), dischargeCap: Float64Array.from(d, () => 1) };
    const r = simulateSelfConsumption(inp, b);
    expect(Math.max(...r.cIn)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("kända priser: dygnets slut före 13, morgondagens slut därefter", () => {
    expect(knownUntil(10, 10, 1000)).toBe(23);
    expect(knownUntil(13, 13, 1000)).toBe(47);
    expect(knownUntil(37, 13, 40)).toBe(39);
  });
});

describe("ekonomi", () => {
  it("återbetalning utan och med kapacitetsförlust", () => {
    const p = payback(20000, 2000, 0, 15);
    expect(p.simpleYears).toBe(10);
    expect(p.withDegradationYears).toBeCloseTo(10);
    expect(p.netAfterHorizonKr).toBeCloseTo(10000);
    const q = payback(20000, 2000, 0.02, 15);
    expect(q.withDegradationYears!).toBeGreaterThan(10);
    expect(payback(20000, 500, 0.02, 15).withDegradationYears).toBeNull();
    expect(payback(20000, 0, 0, 15).simpleYears).toBe(Infinity);
  });
  it("effektavgift på tre högsta timmarna per månad", () => {
    const keys = ["2026-01-01T00", "2026-01-01T01", "2026-01-01T02", "2026-01-01T03"];
    const per = { ...p2026, effektavgiftKrPerKw: 10 };
    const fee = powerFee([1, 5, 3, 4], keys, { buy: new Float64Array(4), sell: new Float64Array(4), period: [per, per, per, per] });
    expect(fee).toBeCloseTo(40);
  });
  it("andel dygn då extra kapacitet används", () => {
    const m = extraCapacityUse(new Map([["2026-01-01", 9], ["2026-01-02", 5], ["2026-02-01", 7]]), 7.6);
    expect(m.get("2026-01")).toBe(0.5);
    expect(m.get("2026-02")).toBe(0);
  });
});

describe("elbil", () => {
  it("hittar laddblock ovanpå grundlast", () => {
    const load = Float64Array.from({ length: 24 }, (_, h) => (h >= 1 && h < 5 ? 1.2 + 7 : 1.2 + (h % 3) * 0.1));
    const ev = estimateEv(load, { thresholdKw: 3, minHours: 2, windowHours: 4, chargerMaxKw: 11 });
    expect(ev.slice(1, 5).reduce((s, x) => s + x, 0)).toBeCloseTo(28, 0);
    expect(ev[10]).toBe(0);
  });
  it("korta toppar räknas inte som elbil", () => {
    const load = Float64Array.from({ length: 24 }, (_, h) => (h === 7 ? 6 : 1));
    expect(estimateEv(load, { thresholdKw: 3, minHours: 2, windowHours: 4, chargerMaxKw: 11 }).every((x) => x === 0)).toBe(true);
  });
  it("flyttar nattladdning till sålt solöverskott", () => {
    const n = 48;
    const hour = Uint8Array.from({ length: n }, (_, i) => i % 24);
    const pv = Float64Array.from(hour, (h) => (h >= 9 && h < 17 ? 5 : 0));
    const sell = Float64Array.from(hour, (h) => (h >= 9 && h < 17 ? 3 : 0));
    const ev = new Float64Array(n);
    ev[24 + 1] = 6; // natten efter dag 1
    ev[24 + 2] = 6;
    const buyP = new Float64Array(n).fill(2);
    const sellP = new Float64Array(n).fill(0.5);
    const days = solarToEv(["2026-06-01", "2026-06-02"], hour, pv, sell, ev, buyP, sellP, { dayWindow: [9, 17], months: [6], chargerMaxKw: 11, chargerMinKw: 1.4 });
    expect(days[0].shiftableKwh).toBeCloseTo(12);
    expect(days[0].savingKr).toBeCloseTo(12 * 1.5);
  });
});
