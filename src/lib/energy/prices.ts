import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { datesBetween, type HourKey } from "./time";

/** En post från elprisetjustnu.se. Efter 2025-10-01 är posterna per kvart. */
export interface ApiPrice {
  SEK_per_kWh: number;
  EUR_per_kWh?: number;
  EXR?: number;
  time_start: string; // t.ex. "2025-10-21T00:15:00+02:00" (lokal tid med offset)
  time_end?: string;
}

export function priceUrl(date: string, area: string): string {
  const [y, m, d] = date.split("-");
  return `https://www.elprisetjustnu.se/api/v1/prices/${y}/${m}-${d}_${area}.json`;
}

/**
 * Timmedel av spotpris (SEK/kWh exkl. moms). Kvartspriser medelvärdesbildas
 * eftersom Sigen-exporten är timupplöst. Dubbla timmar vid vintertid hamnar
 * under samma nyckel och medelvärdesbildas också.
 */
export function hourlyFromApi(entries: ApiPrice[]): Map<HourKey, number> {
  const acc = new Map<HourKey, { sum: number; n: number }>();
  for (const e of entries) {
    const key = e.time_start.slice(0, 13);
    const a = acc.get(key) ?? { sum: 0, n: 0 };
    a.sum += e.SEK_per_kWh;
    a.n++;
    acc.set(key, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.sum / a.n]));
}

async function fetchWithRetry(url: string, tries = 4): Promise<ApiPrice[]> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "mysigen-dashboard/0.1 (privat batterikalkyl)" } });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ApiPrice[];
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error(`Kunde inte hämta ${url}: ${String(lastErr)}`);
}

export interface LoadPricesResult {
  hourly: Map<HourKey, number>;
  fetched: number;
  cached: number;
  missingDates: string[];
}

/**
 * Hämtar spotpriser dag för dag och cachar råsvaren i `cacheDir/<area>/<datum>.json`.
 * Med `offline` används bara cachen (praktiskt om du laddat ned filerna på annat sätt).
 */
export async function loadPrices(
  from: string,
  to: string,
  area: string,
  cacheDir: string,
  opts: { offline?: boolean; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<LoadPricesResult> {
  const dir = path.join(cacheDir, area);
  await mkdir(dir, { recursive: true });
  const dates = datesBetween(from, to);
  const result: LoadPricesResult = { hourly: new Map(), fetched: 0, cached: 0, missingDates: [] };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < dates.length) {
      const date = dates[next++];
      const file = path.join(dir, `${date}.json`);
      let entries: ApiPrice[] | null = null;
      try {
        entries = JSON.parse(await readFile(file, "utf8")) as ApiPrice[];
        result.cached++;
      } catch {
        if (!opts.offline) {
          entries = await fetchWithRetry(priceUrl(date, area));
          if (entries.length > 0) await writeFile(file, JSON.stringify(entries));
          result.fetched++;
        }
      }
      if (!entries || entries.length === 0) result.missingDates.push(date);
      else for (const [k, v] of hourlyFromApi(entries)) result.hourly.set(k, v);
      opts.onProgress?.(++done, dates.length);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  result.missingDates.sort();
  return result;
}

/**
 * Lägger priser på timserien. Saknade timmar (t.ex. 02 vid sommartid) fylls
 * med föregående timmes pris; antalet rapporteras.
 */
export function alignPrices(keys: HourKey[], hourly: Map<HourKey, number>): { spot: Float64Array; filled: number } {
  const spot = new Float64Array(keys.length);
  let filled = 0;
  let last = NaN;
  for (let i = 0; i < keys.length; i++) {
    const v = hourly.get(keys[i]);
    if (v === undefined) {
      filled++;
      spot[i] = last;
    } else {
      spot[i] = v;
      last = v;
    }
  }
  // Om serien börjar med hål: fyll bakåt med första kända pris.
  const firstKnown = spot.findIndex((v) => !Number.isNaN(v));
  if (firstKnown < 0) throw new Error("Inga spotpriser för perioden.");
  for (let i = 0; i < firstKnown; i++) spot[i] = spot[firstKnown];
  return { spot, filled };
}
