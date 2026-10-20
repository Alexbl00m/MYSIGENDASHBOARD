import { dateOf, type HourKey } from "./time";

/** Ett avtalsperiod. Alla öre-belopp är exklusive moms. */
export interface ContractPeriod {
  fran: string; // YYYY-MM-DD, inklusive
  till: string; // YYYY-MM-DD, inklusive
  paslagOre: number; // elhandlarens påslag
  natOverforingOre: number; // nätägarens rörliga överföringsavgift
  energiskattOre: number;
  natnyttaOre: number; // ersättning från nätägaren för inmatad el
  saljTillaggOre: number; // elhandlarens tillägg (+) eller avgift (−) på såld el
  skattereduktionOre: number; // 60 t.o.m. 2025-12-31, därefter 0
  effektavgiftKrPerKw: number; // kr per kW och månad, 0 om ingen
  manadsavgiftKr: number; // fasta avgifter per månad (påverkar inte marginalkalkylen)
}

export interface Tariff {
  momsPct: number;
  perioder: ContractPeriod[];
}

/** Köppris kr/kWh = (spot + påslag + nätavgift + energiskatt) × (1 + moms). */
export function buyPrice(spotSek: number, p: ContractPeriod, momsPct: number): number {
  return (spotSek + (p.paslagOre + p.natOverforingOre + p.energiskattOre) / 100) * (1 + momsPct / 100);
}

/** Säljpris kr/kWh = spot + nätnytta ± elhandlarens tillägg + skattereduktion. */
export function sellPrice(spotSek: number, p: ContractPeriod): number {
  return spotSek + (p.natnyttaOre + p.saljTillaggOre + p.skattereduktionOre) / 100;
}

export function periodFor(date: string, perioder: ContractPeriod[]): ContractPeriod {
  const p = perioder.find((x) => x.fran <= date && date <= x.till);
  if (!p) throw new Error(`Inget avtal täcker ${date}. Lägg till en period i konfigurationen.`);
  return p;
}

/** Den senaste perioden, som används för framåtblickande kalkyler. */
export function latestPeriod(perioder: ContractPeriod[]): ContractPeriod {
  return [...perioder].sort((a, b) => a.fran.localeCompare(b.fran)).at(-1)!;
}

/**
 * "historisk": varje timme prissätts med det avtal och de regler som gällde då
 * (inkl. skattereduktion före 2026).
 * "framat": alla timmar prissätts med senaste avtalet, dvs. dagens regler.
 * Det är rätt underlag för återbetalningstid på en investering som görs nu.
 */
export type PriceMode = "historisk" | "framat";

export interface PriceSeries {
  buy: Float64Array;
  sell: Float64Array;
  period: ContractPeriod[];
}

export function priceSeries(
  keys: HourKey[],
  spot: Float64Array,
  tariff: Tariff,
  mode: PriceMode,
  spotScale = 1,
): PriceSeries {
  const buy = new Float64Array(keys.length);
  const sell = new Float64Array(keys.length);
  const period: ContractPeriod[] = [];
  const latest = latestPeriod(tariff.perioder);
  for (let i = 0; i < keys.length; i++) {
    const p = mode === "framat" ? latest : periodFor(dateOf(keys[i]), tariff.perioder);
    const s = spot[i] * spotScale;
    buy[i] = buyPrice(s, p, tariff.momsPct);
    sell[i] = sellPrice(s, p);
    period.push(p);
  }
  return { buy, sell, period };
}
