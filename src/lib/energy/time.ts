/**
 * Timnycklar i lokal svensk tid: "YYYY-MM-DDTHH".
 *
 * Varje kalenderdygn behandlas som 24 timmar (00–23). Vid sommartid saknas
 * timme 02 i verkligheten och vid vintertid finns den två gånger; Sigen-data
 * för dubbla timmar summeras och priser medelvärdesbildas under samma nyckel.
 */
export type HourKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function hourKey(y: number, m: number, d: number, h: number): HourKey {
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}`;
}

export function dateOf(key: HourKey): string {
  return key.slice(0, 10);
}

export function hourOf(key: HourKey): number {
  return Number(key.slice(11, 13));
}

export function monthOf(key: HourKey): number {
  return Number(key.slice(5, 7));
}

/** Alla datum (YYYY-MM-DD) från och med `from` till och med `to`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Alla timnycklar för datumintervallet, 24 per dygn. */
export function hoursBetween(from: string, to: string): HourKey[] {
  const out: HourKey[] = [];
  for (const date of datesBetween(from, to)) {
    for (let h = 0; h < 24; h++) out.push(`${date}T${pad(h)}`);
  }
  return out;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
