/**
 * Batterikalkyl: simulerar 8 / 14 / 17 / 26 kWh på verklig timhistorik med
 * verkliga SE3-priser och skriver ut extra besparing och återbetalningstid.
 *
 *   npm run batterikalkyl                 # hämtar priser, kör allt
 *   npm run batterikalkyl -- --offline    # bara cachade priser i data/priser
 *   npm run batterikalkyl -- --snabb      # hoppar över känslighetsanalysen
 *   npm run batterikalkyl -- --config annan.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  STRATEGY_LABEL,
  makeBattery,
  persistenceForecast,
  simulate,
  usableKwh,
  type BatteryConfig,
  type BatteryParams,
  type Module,
  type SimInput,
  type SimResult,
  type Strategy,
} from "../src/lib/energy/battery";
import { annualize, costWithoutSystem, extraCapacityUse, metrics, payback, type Metrics } from "../src/lib/energy/economics";
import { estimateEv, solarToEv } from "../src/lib/energy/ev";
import { alignPrices, loadPrices } from "../src/lib/energy/prices";
import { derivedLoad, loadSigenDir, netDemand, type HourReading } from "../src/lib/energy/sigen";
import { priceSeries, type ContractPeriod, type PriceSeries } from "../src/lib/energy/tariff";
import { dateOf, datesBetween, hourOf, hoursBetween, monthOf, type HourKey } from "../src/lib/energy/time";

/* ---------- Konfiguration ---------- */

interface Config {
  bekraftat: string[];
  dataKatalog: string;
  prisKatalog: string;
  elomrade: string;
  ofullstandigFore: string;
  simulering: { fran: string; till: string };
  kontrollsummor: { fran: string; till: string; solKwh: number; forbrukningKwh: number; kopKwh: number; saljKwh: number; laddningKwh: number; urladdningKwh: number };
  batteri: {
    befintligt: (Module & { namn: string })[];
    vaxelriktareMaxKw: number;
    huvudsakringMaxKw: number;
    socMinPct: number;
    socMaxPct: number;
    turOchReturVerkningsgrad: number;
    cykelkostnadKrPerKwh: number;
    tillatExportFranBatteri: boolean;
  };
  erbjudanden: { namn: string; moduler: Module[]; prisKr: number; giltigTill: string }[];
  strategi: { touLaddfonster: [number, number]; mpcSocStegKwh: number; dpSocStegKwh: number };
  avtal: { momsPct: number; perioder: ContractPeriod[] };
  kanslighet: { elprisAndring: number; kapacitetsforlustPerAr: number; horisontAr: number };
  elbil: { troskelKw: number; minTimmar: number; fonsterTimmar: number; laddboxMaxKw: number; laddboxMinKw: number; dagFonster: [number, number]; manader: number[]; andelHemma: number[] };
  vinter: { manader: number[]; dyraTimmar: number[]; nattTimmar: number[] };
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/* ---------- Formatering (svenska) ---------- */

const nf0 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kr = (x: number) => `${nf0.format(Math.round(x))} kr`;
const kwh = (x: number) => `${nf0.format(Math.round(x))} kWh`;
const pct = (x: number) => `${nf0.format(Math.round(x * 100))} %`;
const years = (x: number | null) => (x === null || !Number.isFinite(x) ? "aldrig" : `${nf1.format(x)} år`);

function table(head: string[], rows: (string | number)[][]): string {
  const cells = [head, ...rows.map((r) => r.map(String))];
  const w = head.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => `| ${r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join(" | ")} |`;
  return [line(head), `|${w.map((x, i) => (i === 0 ? ` ${"-".repeat(x)} ` : ` ${"-".repeat(x - 1)}: `)).join("|")}|`, ...rows.map((r) => line(r.map(String)))].join("\n");
}

const out: string[] = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};
const heading = (s: string) => say(`\n## ${s}\n`);

/* ---------- Huvudprogram ---------- */

async function main() {
  const configPath = argValue("--config") ?? "config/batterikalkyl.json";
  const cfg = JSON.parse(await readFile(configPath, "utf8")) as Config;
  const confirmed = new Set(cfg.bekraftat);
  const t0 = Date.now();

  say(`# Batterikalkyl – ${cfg.elomrade}`);
  say(`\nKörd ${new Date().toLocaleString("sv-SE")} med ${configPath}.`);

  /* 1. Läs Sigen-exporter */
  heading("1. Indata från MySigen");
  const dir = await loadSigenDir(cfg.dataKatalog).catch((e) => {
    throw new Error(`Kunde inte läsa ${cfg.dataKatalog}: ${e.message}\nLägg dina MySigen-exporter (.xlsx) i katalogen och kör igen.`);
  });
  say(
    table(
      ["Fil", "Timmar", "Status"],
      dir.files.map((f) => [
        f.file,
        nf0.format(f.rows),
        f.ignored ? `ignorerad (${f.ignored})` : [f.skippedTotal ? `total-rad överhoppad` : "", f.mergedDuplicates ? `${f.mergedDuplicates} dubbla timmar summerade` : "", ...f.warnings].filter(Boolean).join("; ") || "ok",
      ]),
    ),
  );
  if (dir.duplicatesAcrossFiles) say(`\n${dir.duplicatesAcrossFiles} timmar fanns i flera filer; första förekomsten används.`);
  if (dir.readings.length === 0) throw new Error("Inga mätvärden hittades.");

  const first = dateOf(dir.readings[0].key);
  const last = dateOf(dir.readings.at(-1)!.key);
  const allKeys = hoursBetween(first, last);
  const byKey = new Map(dir.readings.map((r) => [r.key, r]));
  const empty = (key: HourKey): HourReading => ({ key, pv: 0, load: 0, buy: 0, sell: 0, charge: 0, discharge: 0 });
  const all = allKeys.map((k) => byKey.get(k) ?? empty(k));
  const missing = allKeys.filter((k) => !byKey.has(k)).length;
  say(`\nPeriod i data: ${first} – ${last} (${nf0.format(dir.readings.length)} timmar, ${missing} saknade timmar fylls med 0).`);
  say(`Före ${cfg.ofullstandigFore} är solEnergy/loadConsumption ofullständiga; den perioden används inte i simuleringarna.`);

  /* 2. Kontrollsummor */
  heading("2. Kontrollsummor");
  const ks = cfg.kontrollsummor;
  const inRange = (r: HourReading, a: string, b: string) => dateOf(r.key) >= a && dateOf(r.key) <= b;
  const ctrl = all.filter((r) => inRange(r, ks.fran, ks.till));
  const sum = (xs: HourReading[], f: (r: HourReading) => number) => xs.reduce((s, r) => s + f(r), 0);
  const ctrlRows: [string, number, number][] = [
    ["Sol", sum(ctrl, (r) => r.pv), ks.solKwh],
    ["Förbrukning (beräknad)", sum(ctrl, derivedLoad), ks.forbrukningKwh],
    ["Köp", sum(ctrl, (r) => r.buy), ks.kopKwh],
    ["Sälj", sum(ctrl, (r) => r.sell), ks.saljKwh],
    ["Laddning", sum(ctrl, (r) => r.charge), ks.laddningKwh],
    ["Urladdning", sum(ctrl, (r) => r.discharge), ks.urladdningKwh],
  ];
  say(`${ks.fran} – ${ks.till}:\n`);
  say(table(["Storhet", "Data", "Förväntat", "Avvikelse"], ctrlRows.map(([n, a, e]) => [n, kwh(a), kwh(e), e ? pct((a - e) / e) : "–"])));
  const maxDev = Math.max(...ctrlRows.map(([, a, e]) => (e ? Math.abs(a - e) / e : 0)));
  if (maxDev > 0.02) say(`\n⚠ Någon kontrollsumma avviker mer än 2 %. Kontrollera att rätt filer ligger i ${cfg.dataKatalog}.`);

  /* 3. Simuleringsperiod och serier */
  const { fran, till } = cfg.simulering;
  if (fran < cfg.ofullstandigFore) throw new Error(`Simuleringen får inte börja före ${cfg.ofullstandigFore} (ofullständig data).`);
  const startIdx = allKeys.indexOf(`${fran}T00`);
  const endIdx = allKeys.indexOf(`${till}T23`);
  if (startIdx < 0 || endIdx < 0) throw new Error(`Simuleringsperioden ${fran} – ${till} ligger utanför data (${first} – ${last}).`);
  const keys = allKeys.slice(startIdx, endIdx + 1);
  const win = all.slice(startIdx, endIdx + 1);
  const T = keys.length;
  const dFull = Float64Array.from(all, netDemand);
  const d = dFull.slice(startIdx, endIdx + 1);
  const forecast = persistenceForecast(dFull).slice(startIdx, endIdx + 1);
  const hour = Uint8Array.from(keys, hourOf);
  const load = Float64Array.from(win, derivedLoad);
  const pv = Float64Array.from(win, (r) => r.pv);
  const actual = {
    gridBuy: Float64Array.from(win, (r) => r.buy),
    gridSell: Float64Array.from(win, (r) => r.sell),
    cIn: Float64Array.from(win, (r) => r.charge),
    dOut: Float64Array.from(win, (r) => r.discharge),
  };

  /* 4. Spotpriser */
  heading("3. Spotpriser");
  const pr = await loadPrices(fran, till, cfg.elomrade, cfg.prisKatalog, {
    offline: flag("--offline"),
    onProgress: (done, total) => process.stderr.isTTY && process.stderr.write(`\rHämtar priser ${done}/${total}`),
  });
  process.stderr.write("\n");
  if (pr.hourly.size === 0) {
    throw new Error(
      `Inga spotpriser för ${fran} – ${till}. ${flag("--offline") ? `Kör utan --offline eller lägg elprisetjustnu-filer i ${cfg.prisKatalog}/${cfg.elomrade}/.` : "Kontrollera att www.elprisetjustnu.se går att nå."}`,
    );
  }
  const { spot, filled } = alignPrices(keys, pr.hourly);
  const meanSpot = spot.reduce((s, x) => s + x, 0) / T;
  say(`elprisetjustnu.se, ${cfg.elomrade}: ${pr.cached} dygn från cache, ${pr.fetched} hämtade. Medelspot ${nf2.format(meanSpot)} kr/kWh exkl. moms.`);
  say(`Kvartspriser medelvärdesbildas till timpris eftersom Sigen-datan är timupplöst. ${filled} timmar utan pris fylldes med föregående timme.`);
  if (pr.missingDates.length) say(`⚠ Saknade prisdygn: ${pr.missingDates.slice(0, 10).join(", ")}${pr.missingDates.length > 10 ? " …" : ""}`);

  const prices: Record<string, PriceSeries> = {
    historisk: priceSeries(keys, spot, cfg.avtal, "historisk"),
    framat: priceSeries(keys, spot, cfg.avtal, "framat"),
  };
  const sens = cfg.kanslighet.elprisAndring;
  const runSens = !flag("--snabb");
  if (runSens) {
    prices.upp = priceSeries(keys, spot, cfg.avtal, "framat", 1 + sens);
    prices.ned = priceSeries(keys, spot, cfg.avtal, "framat", 1 - sens);
  }

  /* 5. Batterier */
  const bcfg: BatteryConfig = {
    socMinPct: cfg.batteri.socMinPct,
    socMaxPct: cfg.batteri.socMaxPct,
    roundTripEfficiency: cfg.batteri.turOchReturVerkningsgrad,
    cycleCostSekPerKwh: cfg.batteri.cykelkostnadKrPerKwh,
    gridMaxKw: cfg.batteri.huvudsakringMaxKw,
    inverterMaxKw: cfg.batteri.vaxelriktareMaxKw,
    allowExport: cfg.batteri.tillatExportFranBatteri,
  };
  const base = makeBattery(cfg.batteri.befintligt, bcfg);
  const options = [
    { namn: `Idag (${nf1.format(base.capacityKwh)} kWh)`, prisKr: 0, b: base },
    ...cfg.erbjudanden.map((o) => {
      const b = makeBattery([...cfg.batteri.befintligt, ...o.moduler], bcfg);
      return { namn: `${o.namn} → ${nf1.format(b.capacityKwh)} kWh`, prisKr: o.prisKr, b };
    }),
  ];
  const simOpts = { tou: { chargeWindow: cfg.strategi.touLaddfonster }, mpcStep: cfg.strategi.mpcSocStegKwh, dpStep: cfg.strategi.dpSocStegKwh };
  const strategies: Strategy[] = ["egen", "pris", "kombi", "perfekt"];

  const runs = new Map<string, { res: SimResult; m: Record<string, Metrics> }>();
  const runKey = (o: number, s: Strategy, mode: string) => `${o}|${s}|${mode}`;
  const dispatchModes = runSens ? ["historisk", "framat", "upp", "ned"] : ["historisk", "framat"];
  let n = 0;
  const total = options.length * strategies.length * dispatchModes.length;
  for (let oi = 0; oi < options.length; oi++) {
    for (const s of strategies) {
      for (const mode of dispatchModes) {
        process.stderr.isTTY && process.stderr.write(`\rSimulerar ${++n}/${total}: ${options[oi].namn}, ${STRATEGY_LABEL[s]}, ${mode}        `);
        const inp: SimInput = { d, forecast, buy: prices[mode].buy, sell: prices[mode].sell, hour };
        const res = simulate(s, inp, options[oi].b, simOpts);
        runs.set(runKey(oi, s, mode), { res, m: { [mode]: metrics(res, d, keys, prices[mode], options[oi].b) } });
      }
    }
  }
  process.stderr.write("\n");
  const M = (oi: number, s: Strategy, mode: string) => runs.get(runKey(oi, s, mode))!.m[mode];

  /* 6. Antaganden */
  heading("4. Antaganden");
  const latest = cfg.avtal.perioder.at(-1)!;
  const flagOf = (key: string, source: string) => (source === "antagande" && !confirmed.has(key) ? `${source} ⚠ ej bekräftat` : source);
  const per = (f: (p: ContractPeriod) => number, unit: string) => cfg.avtal.perioder.map((p) => `${p.fran.slice(0, 4)}–: ${nf2.format(f(p))} ${unit}`).join(", ");
  const assumptions: [string, string, string, string][] = [
    ["elomrade", "Elområde", cfg.elomrade, "användare"],
    ["simulering", "Simuleringsperiod", `${fran} – ${till}`, "användare"],
    ["avtal.paslag", "Påslag elhandel (exkl. moms)", per((p) => p.paslagOre, "öre/kWh"), "antagande"],
    ["avtal.natOverforing", "Rörlig nätavgift E.ON (exkl. moms)", per((p) => p.natOverforingOre, "öre/kWh"), "antagande"],
    ["avtal.energiskatt", "Energiskatt (exkl. moms)", per((p) => p.energiskattOre, "öre/kWh"), "antagande"],
    ["avtal.moms", "Moms på köpt el", `${cfg.avtal.momsPct} %`, "användare"],
    ["avtal.natnytta", "Nätnytta (såld el)", per((p) => p.natnyttaOre, "öre/kWh"), "antagande"],
    ["avtal.saljTillagg", "Elhandlarens tillägg/avgift såld el", per((p) => p.saljTillaggOre, "öre/kWh"), "antagande"],
    ["avtal.skattereduktion", "Skattereduktion såld el", per((p) => p.skattereduktionOre, "öre/kWh"), "användare"],
    ["avtal.effektavgift", "Effektavgift", per((p) => p.effektavgiftKrPerKw, "kr/kW/mån"), "antagande"],
    ["prismodell", "Prismodell för återbetalning", "Dagens regler för alla timmar (utan skattereduktion)", "antagande"],
    ["batteri.befintligt", "Befintligt batteri", cfg.batteri.befintligt.map((m) => `${m.namn} ${nf2.format(m.kwh)} kWh / ${nf1.format(m.maxKw)} kW`).join(", "), "antagande"],
    ["batteri.moduler", "Nya moduler", cfg.erbjudanden.map((o) => `${o.namn}: ${o.moduler.map((m) => `${nf2.format(m.kwh)} kWh / ${nf1.format(m.maxKw)} kW`).join(" + ")}`).join("; "), "antagande"],
    ["batteri.vaxelriktare", "Växelriktarens maxeffekt (batteri)", `${nf1.format(cfg.batteri.vaxelriktareMaxKw)} kW`, "antagande"],
    ["batteri.sakring", "Huvudsäkring (tak köp/sälj)", `${nf1.format(cfg.batteri.huvudsakringMaxKw)} kW`, "antagande"],
    ["batteri.soc", "SOC-gränser", `${cfg.batteri.socMinPct}–${cfg.batteri.socMaxPct} %`, "antagande"],
    ["batteri.verkningsgrad", "Verkningsgrad tur och retur", pct(cfg.batteri.turOchReturVerkningsgrad), "användare"],
    ["batteri.cykelkostnad", "Slitagekostnad i optimeraren", `${nf2.format(cfg.batteri.cykelkostnadKrPerKwh)} kr/kWh`, "antagande"],
    ["batteri.export", "Batteriet får sälja till nätet", cfg.batteri.tillatExportFranBatteri ? "ja" : "nej", "antagande"],
    ["strategi.tou", "Laddfönster prisstyrt schema (b)", `kl. ${cfg.strategi.touLaddfonster[0]}–${cfg.strategi.touLaddfonster[1]}`, "antagande"],
    ["strategi.prognos", "Prognos i (c)", "Medel samma timme senaste 7 dygnen; priser kända t.o.m. morgondagen efter 13:00", "antagande"],
    ["kanslighet", "Känslighet", `spotpris ±${pct(sens)}, kapacitetsförlust ${pct(cfg.kanslighet.kapacitetsforlustPerAr)}/år, horisont ${cfg.kanslighet.horisontAr} år, ingen diskontering`, "användare"],
  ];
  say(table(["Antagande", "Värde", "Källa"], assumptions.map(([k, label, v, src]) => [label, v, flagOf(k, src)])));
  const measuredEta = sum(win, (r) => r.discharge) / sum(win, (r) => r.charge);
  const maxCh = Math.max(...win.map((r) => r.charge));
  const maxDis = Math.max(...win.map((r) => r.discharge));
  say(`\nUppmätt i perioden: verkningsgrad ${pct(measuredEta)}, högsta laddning ${nf1.format(maxCh)} kWh/h, högsta urladdning ${nf1.format(maxDis)} kWh/h (jämför med antagen batterieffekt ${nf1.format(base.maxChargeKw)} kW).`);
  const unconfirmed = assumptions.filter(([k, , , s]) => s === "antagande" && !confirmed.has(k)).length;
  if (unconfirmed) say(`\n⚠ ${unconfirmed} antaganden är inte bekräftade. Resultaten nedan är preliminära tills de är ifyllda.`);

  /* 7. Kalibrering mot verkligheten */
  heading("5. Kalibrering: dagens batteri mot verkliga köp/sälj");
  const actualM = { historisk: metrics(actual, d, keys, prices.historisk), framat: metrics(actual, d, keys, prices.framat) };
  const noSystem = costWithoutSystem(load, prices.historisk);
  say(`Utan sol och batteri hade elen (rörlig del) kostat ${kr(noSystem)} i perioden; verklig kostnad var ${kr(actualM.historisk.costKr)}.\n`);
  const calRow = (name: string, m: Metrics, b?: BatteryParams) => [
    name,
    kr(m.costKr),
    kwh(m.buyKwh),
    kwh(m.sellKwh),
    kwh(m.gridChargeKwh),
    kwh(m.dischargeWhileSellingKwh),
    b ? nf0.format(m.cycles) : nf0.format(m.dischargeKwh / base.etaD / usableKwh(base)),
  ];
  say(
    table(
      ["Fall (8 kWh, historiska regler)", "Kostnad", "Köp", "Sälj", "Nätladdning", "Export från batteri", "Cykler"],
      [calRow("Verkligt utfall", actualM.historisk), ...strategies.map((s) => calRow(`Modell ${STRATEGY_LABEL[s]}`, M(0, s, "historisk"), base))],
    ),
  );
  say(`\nDen modell som ligger närmast verkligheten i nätladdning och urladdning vid försäljning beskriver bäst hur systemet körs idag.`);

  /* 8. Resultat */
  const savings = (oi: number, s: Strategy, mode: string) => annualize(M(0, s, mode).costKr + M(0, s, mode).powerFeeKr - (M(oi, s, mode).costKr + M(oi, s, mode).powerFeeKr), T);
  heading("6. Extra besparing per år och återbetalning (modell mot modell, dagens regler)");
  say(`Besparing = kostnad med dagens 8 kWh − kostnad med större batteri, samma strategi. Pris efter grönt avdrag.\n`);
  const { kapacitetsforlustPerAr: deg, horisontAr: H } = cfg.kanslighet;
  const resultRows: (string | number)[][] = [];
  const json: Record<string, unknown>[] = [];
  for (let oi = 1; oi < options.length; oi++) {
    for (const s of strategies) {
      const sv = savings(oi, s, "framat");
      const pb = payback(options[oi].prisKr, sv, deg, H);
      const up = runSens ? savings(oi, s, "upp") : NaN;
      const dn = runSens ? savings(oi, s, "ned") : NaN;
      resultRows.push([
        options[oi].namn,
        STRATEGY_LABEL[s],
        kr(options[oi].prisKr),
        kr(sv),
        years(pb.simpleYears),
        years(pb.withDegradationYears),
        runSens ? `${years(payback(options[oi].prisKr, dn, deg, H).withDegradationYears)} / ${years(payback(options[oi].prisKr, up, deg, H).withDegradationYears)}` : "–",
        kr(pb.netAfterHorizonKr),
        nf0.format(M(oi, s, "framat").cycles),
        kr(savings(oi, s, "historisk")),
      ]);
      json.push({ alternativ: options[oi].namn, strategi: s, prisKr: options[oi].prisKr, besparingKrPerAr: sv, besparingHistoriskKr: savings(oi, s, "historisk"), aterbetalningAr: pb.simpleYears, aterbetalningMedForlustAr: pb.withDegradationYears, elprisMinus: dn, elprisPlus: up, nettoEfterHorisontKr: pb.netAfterHorizonKr, cykler: M(oi, s, "framat").cycles });
    }
  }
  say(
    table(
      ["Alternativ", "Strategi", "Pris", "Extra besparing/år", "Återbetalning", `Med ${pct(deg)}/år förlust`, `Elpris −${pct(sens)} / +${pct(sens)}`, `Netto efter ${H} år`, "Cykler/år", "Besparing hist. regler"],
      resultRows,
    ),
  );
  say(`\n(c*) är ett teoretiskt tak med perfekt kännedom om förbrukning och sol; ingen verklig styrning når dit. Räkna med (a)–(c).`);
  say(`"Besparing hist. regler" visar samma period med skattereduktionen t.o.m. 2025 – bara som jämförelse, inte för återbetalning.`);

  /* 9. Metod 2: inkrementell */
  heading("7. Kontroll: extra modul ovanpå verklig drift");
  say(`Dagens batteri gör exakt det det gjorde (verkliga köp/sälj). Den nya kapaciteten simuleras som ett separat batteri på det som återstod mot nätet, med växelriktarens restkapacitet som effekttak. Ger ett mer konservativt, verklighetsförankrat mått.\n`);
  const residual = Float64Array.from(win, (r) => r.buy - r.sell);
  const resForecast = persistenceForecast(Float64Array.from(all, (r) => r.buy - r.sell)).slice(startIdx, endIdx + 1);
  const capLeft = Float64Array.from(win, (r) => Math.max(0, cfg.batteri.vaxelriktareMaxKw - r.charge - r.discharge));
  const incRows: (string | number)[][] = [];
  for (let oi = 0; oi < cfg.erbjudanden.length; oi++) {
    const o = cfg.erbjudanden[oi];
    const extra = makeBattery(o.moduler, bcfg);
    const row: (string | number)[] = [options[oi + 1].namn];
    for (const s of ["egen", "pris", "kombi"] as Strategy[]) {
      const inp: SimInput = { d: residual, forecast: resForecast, buy: prices.framat.buy, sell: prices.framat.sell, hour, chargeCap: capLeft, dischargeCap: capLeft };
      const res = simulate(s, inp, extra, simOpts);
      const m = metrics(res, residual, keys, prices.framat, extra);
      const sv = annualize(actualM.framat.costKr + actualM.framat.powerFeeKr - m.costKr - m.powerFeeKr, T);
      row.push(`${kr(sv)} (${years(payback(o.prisKr, sv, deg, H).withDegradationYears)})`);
      json.push({ alternativ: options[oi + 1].namn, metod: "inkrementell", strategi: s, besparingKrPerAr: sv });
    }
    incRows.push(row);
  }
  say(table(["Alternativ", STRATEGY_LABEL.egen, STRATEGY_LABEL.pris, STRATEGY_LABEL.kombi], incRows));
  say(`\nInom parentes: återbetalning med ${pct(deg)}/år kapacitetsförlust.`);

  /* 10. Hur ofta används extra kapacitet */
  heading("8. Hur ofta behövs den extra kapaciteten? (andel dygn, strategi c)");
  const months = [...new Set(keys.map((k) => k.slice(0, 7)))];
  const useRows = options.slice(1).map((o, i) => {
    const sw = runs.get(runKey(i + 1, "kombi", "framat"))!.res;
    const m = metrics(sw, d, keys, prices.framat, o.b);
    const use = extraCapacityUse(m.dailySwingKwh, usableKwh(base));
    return [o.namn, ...months.map((mk) => pct(use.get(mk) ?? 0))];
  });
  say(table(["Alternativ", ...months], useRows));

  /* 11. Elbil */
  heading("9. Elbil: uppskattad laddning och scenariot solöverskott till elbilen");
  const loadFull = Float64Array.from(all, derivedLoad);
  const evFull = estimateEv(loadFull, { thresholdKw: cfg.elbil.troskelKw, minHours: cfg.elbil.minTimmar, windowHours: cfg.elbil.fonsterTimmar, chargerMaxKw: cfg.elbil.laddboxMaxKw });
  const ev = evFull.slice(startIdx, endIdx + 1);
  const evTot = ev.reduce((s, x) => s + x, 0);
  const evNight = ev.reduce((s, x, i) => s + (hour[i] >= 22 || hour[i] < 6 ? x : 0), 0);
  say(`UPPSKATTNING (block > ${cfg.elbil.troskelKw} kW över grundlast i minst ${cfg.elbil.minTimmar} h; ersätts av Easee-data när den finns): elbilarna laddade ca ${kwh(evTot)} i perioden, varav ${pct(evNight / Math.max(evTot, 1))} kl. 22–06. Värmepump och övrig last: ca ${kwh(sum(win, derivedLoad) - evTot)}.\n`);
  const dates = datesBetween(fran, till);
  const sellKwh = actual.gridSell;
  const evDays = solarToEv(dates, hour, pv, sellKwh, ev, prices.framat.buy, prices.framat.sell, {
    dayWindow: cfg.elbil.dagFonster,
    months: cfg.elbil.manader,
    chargerMaxKw: cfg.elbil.laddboxMaxKw,
    chargerMinKw: cfg.elbil.laddboxMinKw,
  });
  const evShift = evDays.reduce((s, x) => s + x.shiftableKwh, 0);
  const evSave = annualize(evDays.reduce((s, x) => s + x.savingKr, 0), T);
  say(
    table(
      ["Andel dagar bilen står hemma", "Flyttad laddning/år", "Besparing/år"],
      cfg.elbil.andelHemma.map((p) => [pct(p), kwh(annualize(evShift * p, T)), kr(evSave * p)]),
    ),
  );
  say(`\nKl. ${cfg.elbil.dagFonster[0]}–${cfg.elbil.dagFonster[1]}, månad ${cfg.elbil.manader.join(", ")}, laddbox ${nf1.format(cfg.elbil.laddboxMinKw)}–${nf1.format(cfg.elbil.laddboxMaxKw)} kW. Sålt solöverskott (efter dagens batteri) ersätter kvälls-/nattladdning samma dygn. Kostar ingen hårdvara men kräver styrning (t.ex. Home Assistant). Konkurrerar delvis med ett större batteri om samma överskott.`);
  json.push({ scenario: "solTillElbil", flyttbarKwhPerArOmAlltidHemma: annualize(evShift, T), besparingKrPerArOmAlltidHemma: evSave });

  /* 12. Vinter */
  heading("10. Vinter: flytt av förbrukning från dyra timmar till natten (strategi c)");
  const winterIdx = keys.map((k, i) => (cfg.vinter.manader.includes(monthOf(k)) ? i : -1)).filter((i) => i >= 0);
  const evNightByDate = new Map<string, number>();
  for (let i = 0; i < T; i++) {
    // Natten efter dag D räknas till D: kl. 22–23 dag D och 00–05 dag D+1.
    if (hour[i] >= 22 || hour[i] < 6) {
      const day = hour[i] >= 22 ? dateOf(keys[i]) : dateOf(keys[Math.max(0, i - 24)]);
      evNightByDate.set(day, (evNightByDate.get(day) ?? 0) + ev[i]);
    }
  }
  const evDayOf = (i: number) => {
    const day = hour[i] >= 22 ? dateOf(keys[i]) : hour[i] < 6 ? dateOf(keys[Math.max(0, i - 24)]) : dateOf(keys[i]);
    return (evNightByDate.get(day) ?? 0) > 1;
  };
  const baseW = runs.get(runKey(0, "kombi", "framat"))!.res;
  const winterRows = options.slice(1).map((o, j) => {
    const r = runs.get(runKey(j + 1, "kombi", "framat"))!.res;
    const acc = { ev: { peak: 0, night: 0, kr: 0 }, noEv: { peak: 0, night: 0, kr: 0 } };
    for (const i of winterIdx) {
      const g = evDayOf(i) ? acc.ev : acc.noEv;
      const dBuy = r.gridBuy[i] - baseW.gridBuy[i];
      const dSell = r.gridSell[i] - baseW.gridSell[i];
      if (cfg.vinter.dyraTimmar.includes(hour[i])) g.peak -= dBuy;
      if (cfg.vinter.nattTimmar.includes(hour[i])) g.night += dBuy;
      g.kr -= dBuy * prices.framat.buy[i] - dSell * prices.framat.sell[i];
    }
    return [o.namn, kwh(acc.noEv.peak), kwh(acc.noEv.night), kr(acc.noEv.kr), kwh(acc.ev.peak), kwh(acc.ev.night), kr(acc.ev.kr)];
  });
  say(`Månader ${cfg.vinter.manader.join(", ")}. Dyra timmar: kl. ${cfg.vinter.dyraTimmar.join(", ")}. Jämfört med dagens 8 kWh.\n`);
  say(table(["Alternativ", "Mindre köp dyra h (ej elbilsnatt)", "Mer köp natt", "Kr", "Mindre köp dyra h (elbilsnatt)", "Mer köp natt", "Kr"], winterRows));

  say(`\nKörtid ${nf0.format((Date.now() - t0) / 1000)} s.`);

  await mkdir("results", { recursive: true });
  await writeFile(path.join("results", "batterikalkyl.md"), out.join("\n") + "\n");
  await writeFile(path.join("results", "batterikalkyl.json"), JSON.stringify({ kord: new Date().toISOString(), config: cfg, resultat: json }, null, 2));
  console.error(`\nSparat: results/batterikalkyl.md och results/batterikalkyl.json`);
}

main().catch((e) => {
  console.error(`\nFel: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

