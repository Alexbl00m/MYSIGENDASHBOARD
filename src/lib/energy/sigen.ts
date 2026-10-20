import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { hourKey, type HourKey } from "./time";

/** En timme från MySigen-exporten. Alla värden i kWh. */
export interface HourReading {
  key: HourKey;
  pv: number;
  load: number; // som exporterat (0 före april 2025)
  buy: number;
  sell: number;
  charge: number;
  discharge: number;
}

export const SIGEN_COLUMNS = [
  "solarEnergy",
  "loadConsumption",
  "batteryCharge",
  "batteryDischarge",
  "gridBuy",
  "gridSell",
] as const;

export interface ParseResult {
  readings: HourReading[];
  skippedTotal: number;
  skippedEmpty: number;
  mergedDuplicates: number; // samma timme flera gånger i en fil (t.ex. vintertid)
  warnings: string[];
}

type Cell = unknown;

function cellText(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return String(o.text);
    if ("richText" in o && Array.isArray(o.richText)) return o.richText.map((r: { text: string }) => r.text).join("");
  }
  return String(v).trim();
}

function cellNumber(v: Cell): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in (v as object)) return cellNumber((v as { result: unknown }).result);
  const t = cellText(v).replace(",", ".").replace(/\s/g, "");
  if (t === "" || t === "--" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tolkar en tidsstämpel till lokal timnyckel. Klarar Excel-datum (exceljs
 * levererar väggklockan som UTC), "2025-10-21 13:00", "2025/10/21 13:00:00",
 * "21/10/2025 13:00" och "2025-10-21 13:00-14:00".
 */
export function parseTimestamp(v: Cell): HourKey | null {
  if (v instanceof Date) {
    return hourKey(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours());
  }
  if (typeof v === "number" && v > 30000 && v < 80000) {
    // Excel-serienummer
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return parseTimestamp(new Date(ms));
  }
  const t = cellText(v);
  let m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})/);
  if (m) return hourKey(+m[1], +m[2], +m[3], +m[4]);
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T]+(\d{1,2}):(\d{2})/);
  if (m) return hourKey(+m[3], +m[2], +m[1], +m[4]);
  return null;
}

/** Tolkar en tabell (rader × celler) i MySigens format. */
export function parseSigenRows(rows: Cell[][]): ParseResult {
  const res: ParseResult = { readings: [], skippedTotal: 0, skippedEmpty: 0, mergedDuplicates: 0, warnings: [] };
  const headerIdx = rows.findIndex((r) => r.some((c) => cellText(c) === "solarEnergy"));
  if (headerIdx < 0) {
    res.warnings.push("Hittade ingen rubrikrad med 'solarEnergy'; filen ser inte ut som en MySigen-export.");
    return res;
  }
  const header = rows[headerIdx].map(cellText);
  const col: Record<string, number> = {};
  for (const name of SIGEN_COLUMNS) {
    const i = header.indexOf(name);
    if (i < 0) res.warnings.push(`Kolumnen '${name}' saknas.`);
    col[name] = i;
  }
  let timeCol = header.findIndex((h) => /time|date|tid|datum/i.test(h));
  if (timeCol < 0) timeCol = 0;

  const byKey = new Map<HourKey, HourReading>();
  for (const row of rows.slice(headerIdx + 1)) {
    const first = cellText(row[timeCol]);
    if (/^total/i.test(first) || row.some((c) => /^total$/i.test(cellText(c)))) {
      res.skippedTotal++;
      continue;
    }
    const key = parseTimestamp(row[timeCol]);
    if (!key) {
      if (row.some((c) => cellText(c) !== "")) res.warnings.push(`Kunde inte tolka tidsstämpeln '${first}'.`);
      else res.skippedEmpty++;
      continue;
    }
    const num = (name: string) => (col[name] >= 0 ? cellNumber(row[col[name]]) ?? 0 : 0);
    const r: HourReading = {
      key,
      pv: num("solarEnergy"),
      load: num("loadConsumption"),
      buy: num("gridBuy"),
      sell: num("gridSell"),
      charge: num("batteryCharge"),
      discharge: num("batteryDischarge"),
    };
    const prev = byKey.get(key);
    if (prev) {
      res.mergedDuplicates++;
      prev.pv += r.pv;
      prev.load += r.load;
      prev.buy += r.buy;
      prev.sell += r.sell;
      prev.charge += r.charge;
      prev.discharge += r.discharge;
    } else byKey.set(key, r);
  }
  res.readings = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (res.warnings.length > 20) res.warnings = [...res.warnings.slice(0, 20), `… och ${res.warnings.length - 20} till`];
  return res;
}

export async function readSigenXlsx(file: string): Promise<ParseResult> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("stationData") ?? wb.worksheets[0];
  if (!ws) return { readings: [], skippedTotal: 0, skippedEmpty: 0, mergedDuplicates: 0, warnings: ["Inga blad i filen."] };
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as Cell[]; // index 0 är tomt i exceljs
    rows.push(values.slice(1));
  });
  return parseSigenRows(rows);
}

export async function readSigenCsv(file: string): Promise<ParseResult> {
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const sep = (lines[0] ?? "").includes(";") ? ";" : ",";
  return parseSigenRows(lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, ""))));
}

export interface DirResult {
  readings: HourReading[];
  files: { file: string; rows: number; ignored?: string; warnings: string[]; skippedTotal: number; mergedDuplicates: number }[];
  duplicatesAcrossFiles: number;
}

/** Läser alla .xlsx/.csv i en katalog. Tomma filer hoppas över, dubbletter mellan filer behåller första förekomsten. */
export async function loadSigenDir(dir: string): Promise<DirResult> {
  const names = (await readdir(dir)).filter((n) => /\.(xlsx|csv)$/i.test(n) && !n.startsWith("~$")).sort();
  const out: DirResult = { readings: [], files: [], duplicatesAcrossFiles: 0 };
  const byKey = new Map<HourKey, HourReading>();
  for (const name of names) {
    const file = path.join(dir, name);
    if ((await stat(file)).size === 0) {
      out.files.push({ file: name, rows: 0, ignored: "tom fil", warnings: [], skippedTotal: 0, mergedDuplicates: 0 });
      continue;
    }
    const r = /\.csv$/i.test(name) ? await readSigenCsv(file) : await readSigenXlsx(file);
    const allZero = r.readings.every((x) => x.pv + x.buy + x.sell + x.charge + x.discharge + x.load === 0);
    if (r.readings.length === 0 || allZero) {
      out.files.push({ file: name, rows: r.readings.length, ignored: "inga mätvärden", warnings: r.warnings, skippedTotal: r.skippedTotal, mergedDuplicates: r.mergedDuplicates });
      continue;
    }
    for (const x of r.readings) {
      if (byKey.has(x.key)) out.duplicatesAcrossFiles++;
      else byKey.set(x.key, x);
    }
    out.files.push({ file: name, rows: r.readings.length, warnings: r.warnings, skippedTotal: r.skippedTotal, mergedDuplicates: r.mergedDuplicates });
  }
  out.readings = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/** Husets förbrukning ur energibalansen: pv + köp − sälj + urladdning − laddning. */
export function derivedLoad(r: HourReading): number {
  return r.pv + r.buy - r.sell + r.discharge - r.charge;
}

/** Husets nettobehov före batteri (förbrukning − sol). Kräver inte sol/last-kolumnerna. */
export function netDemand(r: HourReading): number {
  return r.buy - r.sell + r.discharge - r.charge;
}
