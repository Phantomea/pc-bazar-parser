import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MOCK_RESPONSE = {"name":"Predám počítač pre náročných hráčov","description":"Výkonný herný počítač ideálny pre náročných hráčov a profesionálov. Zvláda všetky moderné hry na ULTRA nastaveniach v QHD/2K rozlíšení s 60-120+ FPS a je plne schopný zvládnuť aj UHD/4K s FSR technológiou.\n\nProcesor AMD Ryzen 7 5700X (8 jadier, 16 vlákien) v kombinácii s výkonnou grafikou AMD Radeon RX 7900XT od Sapphire Nitro+ série poskytuje vynikajúcu výkonnosť v hrách aj profesionálnych aplikáciách. Pamäť 32 GB DDR4 na 3600 MHz s CL18 latenciou umožňuje plynulý chod aj náročnejších úloh. Systém je osadený rýchlymi NVMe SSD diskmi pre rapídne načítavanie.\n\nPočítač je vybavený modernými vodným chladením NZXT Kraken 280 s nastaviteľným digitálnym displayom pre optimálne teploty. Pevná skrinka Montech XR poskytuje kvalitné spracovanie a dobrý vzduchový tok.\n\nVšetky komponenty sú staršieho dáta, ale s platnou gáranciou Alza. Skrinka je úplne nová. Počítač má čerstvo nainštalovaný Windows 11 Pro s aktiváciou a Steam. Benchmarky a informácie o teplotách sú dostupné na požiadavku. Ponuka je dostupná v osobnom stretnutí s možnosťou vyskúšania, dovoze v okreoch Gemer-Malohont, Trenčín a Nitra, alebo odoslaním so zaplatením plnej sumy vopred. Dohoda možná.","price":{"amount":2100,"currency":"EUR"},"components":{"cpu":{"raw_name":"AMD Ryzen 7 5700X"},"gpu":{"raw_name":"Sapphire Nitro+ RX 7900XT"},"ram":{"raw_name":"Patriot Viper 4 Blackout Series 32GB DDR4-3600 CL18"},"motherboard":{"raw_name":"GIGABYTE B550 GAMING X V2"},"psu":{"raw_name":"GIGABYTE P850GM 850W"},"case":{"raw_name":"Montech XR"},"cooler":{"raw_name":"NZXT Kraken 280"},"storage":[{"raw_name":"GIGABYTE Gen4 4000E 1TB"},{"raw_name":"SAMSUNG 870 512MB"}]},"operating_system":"Windows 11 Pro","warranty":null,"accessories":[]};


const SYSTEM_PROMPT = `Si parser PC inzerátov v slovenčine/češtine. Z textu vytiahni štruktúrované údaje a vráť IBA validný JSON, žiadny markdown, žiadne \`\`\` fences, žiadny komentár.

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
- Ak niektorá súčiastka v inzeráte nie je spomenutá, daj null (alebo prázdne pole pre storage/accessories). NIČ SI NEVYMÝŠĽAJ. Lepšie null než tipovať.`;

function extractJson(raw) {
  // 1. Direct parse
  try {
    return JSON.parse(raw);
  } catch {}

  // 2. Extract from ```json ... ``` fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  // 3. Balanced bracket extraction from first {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in output');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {}
      }
    }
  }

  throw new Error('Failed to extract valid JSON from Claude output');
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1|46\.224\.165\.139|[a-z0-9-]+\.46-224-165-139\.sslip\.io)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/parse', (req, res) => {
  const text = req.body?.text;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Chýba text inzerátu' });
  }

  // MOCK – vráti testovací výsledok namiesto volania Clauda
  return res.json(MOCK_RESPONSE);

  let stdout = '';
  let stderr = '';

  const child = spawn('claude', [
    '-p', text,
    '--append-system-prompt', SYSTEM_PROMPT,
    '--output-format', 'json',
    '--model', 'claude-haiku-4-5-20251001',
  ], {
    cwd: '/tmp',
  });

  const timer = setTimeout(() => {
    child.kill();
    res.status(504).json({ error: 'Timeout: Claude neodpovedal do 120 sekúnd' });
  }, 120_000);

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (res.headersSent) return;

    if (code !== 0) {
      console.error('Claude stderr:', stderr);
      return res.status(500).json({ error: `Claude skončil s kódom ${code}` });
    }

    try {
      const wrapper = JSON.parse(stdout);
      const rawResult = wrapper.result ?? stdout;
      const parsed = extractJson(typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult));
      res.json(parsed);
    } catch (err) {
      console.error('Parse error:', err.message);
      console.error('Raw output:', stdout);
      res.status(500).json({ error: `Nepodarilo sa parsovať odpoveď Clauda: ${err.message}` });
    }
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    if (res.headersSent) return;
    res.status(500).json({ error: `Nepodarilo sa spustiť claude: ${err.message}` });
  });
});

app.listen(3518, '127.0.0.1', () => {
  console.log('PC Parser beží na http://127.0.0.1:3518');
});
