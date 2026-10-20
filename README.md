# MySigen energidashboard

Privat energidashboard för sol + batteri (Sigenergy SigenStor, SE3). Steg 1 är en fristående batterikalkyl inför erbjudandet som gäller t.o.m. 2026-10-31. UI:t (Next.js + Supabase) byggs efter det.

## Batterikalkyl

Simulerar dagens 8 kWh och 14 / 17 / 26 kWh timme för timme på din MySigen-historik med verkliga SE3-timpriser från elprisetjustnu.se. Skriptet skriver ut extra besparing per år och återbetalningstid per alternativ, med alla antaganden i en tabell.

```bash
npm install
mkdir -p data/sigen
# Lägg MySigen-exporterna (.xlsx) i data/sigen/. Tomma filer ignoreras.
npm run batterikalkyl              # hämtar priser (cachas i data/priser/) och kör
npm run batterikalkyl -- --snabb   # utan känslighetsanalys (±30 % elpris)
npm run batterikalkyl -- --offline # använd bara cachade priser
```

Resultatet hamnar i `results/batterikalkyl.md` och `results/batterikalkyl.json`. Mappen `data/` och `results/` committas inte.

### Fyll i antaganden

Allt som påverkar ekonomin ligger i `config/batterikalkyl.json`: påslag, nätavgift, energiskatt, nätnytta, effektavgift, batterimodulernas effekt, SOC-gränser med mera. Belopp i öre anges exkl. moms. Värden som inte är bekräftade markeras med ⚠ i resultatet. Lägg till nyckeln (t.ex. `"avtal.paslag"`) i `bekraftat` när ett värde stämmer.

### Strategier

| Strategi | Vad den gör |
|---|---|
| (a) Egenanvändning | Laddar med solöverskott, laddar ur vid underskott. Ingen nätladdning. |
| (b) Prisstyrt schema | Laddar från nätet under nattens billigaste timmar och laddar ur under dygnets dyraste (till huset och, om tillåtet, till nätet). Står still övrig tid. |
| (c) Kombination | Planerar om varje timme fram till slutet av de kända priserna (morgondagens priser kommer ca 13:00). Förbrukning och sol prognostiseras som medel för samma timme de senaste 7 dygnen. |
| (c*) Perfekt | Global optimering med facit för förbrukning och sol. Ett teoretiskt tak som ingen verklig styrning når. |

### Metod

- Husets nettobehov före batteri räknas ur energibalansen: `köp − sälj + urladdning − laddning`. Det gör simuleringen oberoende av sol- och lastkolumnerna, som är 0 före april 2025. Den perioden används ändå inte.
- **Modell mot modell:** samma strategi körs med 8 kWh och med större batteri. Skillnaden blir den extra besparingen.
- **Inkrementell kontroll:** dagens batteri får göra exakt det det gjorde. Den nya kapaciteten simuleras ovanpå verkliga köp och sälj, med växelriktarens kvarvarande effekt som tak.
- **Kalibrering:** modellens 8 kWh jämförs med verkligt utfall (kostnad, nätladdning, urladdning medan huset säljer).
- **Återbetalning** räknas med dagens regler för alla timmar, alltså utan skattereduktion på såld el. "Historiska regler" visas bara som jämförelse.
- Kvartspriser (från 2025-10-01) medelvärdesbildas till timpris, eftersom Sigen-datan är timupplöst.
- Elbilsladdning uppskattas som block med hög effekt ovanpå grundlasten. Easee-data ersätter uppskattningen när den finns.

## Utveckling

```bash
npm test          # enhetstester (vitest)
npm run typecheck
```

Beräkningskärnan ligger i `src/lib/energy/` och återanvänds av dashboardens simulatorsida.
