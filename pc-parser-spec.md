# Zadanie: PC inzerát parser

## Cieľ

Vytvor lokálnu webovú aplikáciu (osobný nástroj), ktorá pomocou Claude (cez headless `claude -p`) parsuje texty PC inzerátov do štruktúrovaného JSON.

**Matching názvov na DB ID NIE JE súčasťou tohto projektu** — to si robím samostatne v inej aplikácii, kde mám DB s desiatkami až stovkami tisíc záznamov. Tento server vracia len čistý výstup z Clauda.

Aplikácia má jediného používateľa (mňa), beží na localhose, **nesmie byť vystavená do internetu**.

## Architektúra

```
Browser (textarea s inzerátom)
        │  POST /parse  { text: "..." }
        ▼
Node/Express server (127.0.0.1:3000)
        │  spawn child_process: claude -p "<text>"
        ▼
Claude Code (headless) — vráti JSON podľa schémy nižšie
        │
        ▼
Browser dostane JSON a vyrenderuje ho
```

Žiadne SSE, žiadny streaming. Klasický request → response.

## Tech stack

- Node.js (ESM, `"type": "module"`)
- Express
- Vanilla HTML/JS frontend (žiadny framework, žiadny build step)
- Claude Code CLI (`claude` binárka v PATH, používateľ je prihlásený cez svoj Max plan)

## Štruktúra projektu

```
pc-parser/
├── package.json
├── server.js
└── public/
    └── index.html
```

## API

### `POST /parse`

**Request:**
```json
{ "text": "celý text inzerátu..." }
```

**Response (200):**
JSON presne podľa schémy v sekcii "SYSTEM_PROMPT" nižšie. Žiadne ďalšie polia, žiadne `matched_id`, žiadny postprocessing.

**Response (4xx/5xx):**
```json
{ "error": "popis chyby" }
```

## Volanie Claude Code

Spawn cez `child_process.spawn` s týmito argumentmi:

```js
spawn("claude", [
  "-p", userText,
  "--append-system-prompt", SYSTEM_PROMPT,
  "--output-format", "json",
  "--model", "claude-haiku-4-5-20251001"
], {
  timeout: 120_000,
  cwd: "/tmp"     // čistý working dir, Claude nevidí súbory projektu
});
```

`--output-format json` vracia wrapper objekt — samotná Claudova odpoveď je v poli `.result`.

### Robustný parser výstupu

Aj pri tvrdom prompte sa občas stane, že Claude pridá ```` ```json ```` fences alebo úvodnú vetu. Implementuj `extractJson(raw)` s troma fallbackmi:

1. `JSON.parse(raw)` priamo
2. Ak zlyhá, vytiahni obsah z ```` ```json ... ``` ```` fences
3. Ak aj to zlyhá, nájdi prvý `{` a cez balanced bracket counting (s rešpektovaním stringov a escape sekvencií) vytiahni celý JSON objekt

Až keby všetky tri zlyhali, hodí chybu.

## SYSTEM_PROMPT

Doslovne tento text:

```
Si parser PC inzerátov v slovenčine/češtine. Z textu vytiahni štruktúrované údaje a vráť IBA validný JSON, žiadny markdown, žiadne ``` fences, žiadny komentár.

Schéma JSON:
{
  "name": "názov inzerátu",
  "description": "popis zostavy",
  "price": { "amount": 1500, "currency": "EUR" } | null,
  "components": {
    "cpu":         { "raw_name": "..." } | null,
    "gpu":         { "raw_name": "..." } | null,
    "ram":         { "raw_name": "..." } | null,
    "motherboard": { "raw_name": "..." } | null,
    "psu":         { "raw_name": "..." } | null,
    "case":        { "raw_name": "..." } | null,
    "cooler":      { "raw_name": "..." } | null,
    "storage":     [ { "raw_name": "..." } ]
  },
  "operating_system": "..." | null,
  "warranty": 2 | null,
  "accessories": [ { "category": "monitor" | "keyboard" | "mouse" | "headset" | "speakers" | "webcam" | "other", "raw_name": "..." } ]
}

Pravidlá:
- name NESKRACUJ.
- description: marketingový popis zostavy — jej charakter, použitie, stav, silné stránky. NIE zoznam komponentov ani špecifikácií (tie sú v "components"). Môže byť viac odsekov.
- raw_name = názov výrobku tak, ako by si ho hľadal v katalógu komponentov (napr. "AMD Ryzen 7 7800X3D", "MSI RTX 4070 Ti Super Gaming X Slim", "Kingston Fury Beast 32GB DDR5-6000 CL36"). Vynechaj zbytočné qualifiers ako "boxed", "ako nový", aktuálne taktovacie hodnoty.
- storage je VŽDY pole, aj keď je len jeden disk. Každý disk samostatný prvok s raw_name (napr. "Samsung 990 Pro 2TB", "Seagate Barracuda 4TB").
- Ak je niektorá súčiastka v inzeráte viacnásobne (napr. dva GPU v SLI, hoci raritné), vyber tú primárnu a v description spomeň zvyšok. Pre ram považuj celú sadu (napr. "2x16GB") za jeden záznam.
- price.amount = číslo (bez medzier, bez symbolu meny, bez tisícových oddeľovačov). currency: ISO kód ("EUR", "USD", "CZK", "PLN"...). Ak cena chýba, null.
- operating_system: napr. "Windows 11 Pro", "Windows 10 Home OEM", "bez OS", "Linux Mint". Ak nie je spomenutý, null.
- warranty: celé číslo = počet rokov záruky, alebo null. Pravidlá: "2 roky záruky" → 2. "24 mesiacov" → 2. "12 mesiacov" → 1. "bez záruky" → 0. Záruky viazané na predajcu / eshop (napr. "záruky u Alzy", "záruka v obchode", "záručný list od predajcu") → null, lebo nie sú prenosné. Ak záručná doba nie je jasne číselne vyjadrená → null.
- accessories: všetko čo nie je súčasťou samotnej skrinky — monitory, periférie, reproduktory, atď. category z fixného zoznamu vyššie, "other" pre čokoľvek mimo. raw_name = celý názov vrátane modelu (napr. "LG 27GP850-B", "Logitech G915 TKL").
- Ak niektorá súčiastka v inzeráte nie je spomenutá, daj null (alebo prázdne pole pre storage/accessories). NIČ SI NEVYMÝŠĽAJ. Lepšie null než tipovať.
```

## Frontend (`public/index.html`)

Single-page app, žiadny build step, vanilla JS.

**Layout (2 stĺpce, na mobile pod sebou):**

- **Ľavý stĺpec:** label, `<textarea>` (min. 400px výška), tlačidlo "Rozparsovať"
- **Pravý stĺpec:** vyrenderovaný výsledok (alebo loading/error stav)

**Render výsledku:**

- `name` a `description` ako sekcie s pre-wrap textom (môžu byť dlhé)
- `price` ako "1500 EUR" (ak nie je null)
- **Komponenty:** každý ako riadok `[KATEGÓRIA] [raw_name]`
  - poradie: cpu, gpu, ram, motherboard, psu, case, cooler, potom všetky storage prvky
- `operating_system`, `warranty` ako jednoduché sekcie (ak nie sú null)
- **Príslušenstvo:** každé ako riadok `[KATEGÓRIA] [raw_name]`
- Na konci `<details>` blok s raw JSON (pre debug a copy-paste do mojej druhej aplikácie)
- Pri raw JSON pridaj malé tlačidlo "Skopírovať JSON do schránky"

**UX:**

- Tlačidlo počas requestu disabled + "Parsovanie prebieha..."
- Pri chybe červený error box
- Ctrl+Enter v textarei = odošle
- Žiadny framework, žiadne externé CSS — všetko inline

## Bezpečnosť

- Server počúva LEN na `127.0.0.1` (`app.listen(3000, "127.0.0.1")`)
- `cwd: "/tmp"` pri spawn-e Clauda — nevidí súbory projektu
- Express body limit 1 MB
- Žiadny CORS netreba (rovnaký origin)

## Závislosti

```json
{
  "type": "module",
  "dependencies": {
    "express": "^4.21.0"
  }
}
```

Žiadne ďalšie balíčky. Žiadny TypeScript, žiadny bundler.

## Spustenie

```bash
npm install
npm start
# server beží na http://127.0.0.1:3000
```

## Testovacie inzeráty (na ručnú verifikáciu)

Po dokončení skús cez UI tieto tri prípady a over, že JSON dáva zmysel:

1. **Plný inzerát:** "Predám hernú zostavu — Ryzen 7 7800X3D, RTX 4070 Ti Super, 32GB DDR5-6000, MSI B650 Tomahawk, Samsung 990 Pro 2TB + WD Blue 4TB HDD, Corsair RM850x, Lian Li O11, Noctua NH-D15. Windows 11 Pro. Záruka 2 roky. Cena 2200€. K tomu monitor LG 27GP850-B."
   → očakávaj všetky komponenty vyplnené, 2 storage prvky, monitor v accessories, OS, záruka, cena.

2. **Holá zostavka:** "Predám PC: i5-12400F, RTX 3060, 16GB RAM, SSD 500GB. 600 EUR."
   → očakávaj len cpu/gpu/ram/storage[0]/price vyplnené, zvyšok null.

3. **Bez ceny a OS:** "Stará herná zostava — Ryzen 5 3600, GTX 1660 Super, 16GB DDR4. Funkčné, bez záruky."
   → cena null, os null, warranty "bez záruky".

## Čo NEROBIŤ

- **Neimplementovať žiadny matching proti databáze.** Server vracia len výstup z Clauda. Matching si robím samostatne v inom procese, kde mám DB.
- Neimplementovať autentifikáciu — je to single-user localhost
- Neimplementovať rate limiting — single user
- Nepoužiť Anthropic SDK / API — používa sa **Claude Code CLI** (Max plan)
- Nestreamovať odpoveď — klasické request/response
- Nepridávať TypeScript, React, Vite, ani iný framework
- Nepridávať Docker (zatiaľ)
