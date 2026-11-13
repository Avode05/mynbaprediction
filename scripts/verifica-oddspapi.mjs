// Verifica cosa offre OddsPapi per l'NBA (Snai, Sisal) usando la chiave nel file .env.
// Uso: node scripts/verifica-oddspapi.mjs
// Consuma poche richieste (circa 5 delle 250 mensili). Non stampa mai la chiave.
import { readFile } from 'node:fs/promises';

let KEY = process.env.ODDS_PAPI_KEY || '';
try {
  const env = await readFile(new URL('../.env', import.meta.url), 'utf8');
  const m = env.match(/^\s*ODDS_PAPI_KEY\s*=\s*(.*?)\s*$/m);
  if (m && !KEY) KEY = m[1].replace(/^["']|["']$/g, '');
} catch {}
if (!KEY) { console.log('Manca ODDS_PAPI_KEY nel file .env'); process.exit(1); }

const BASE = 'https://api.oddspapi.io/v4';
let used = 0;
async function get(path, params = {}) {
  const u = new URL(BASE + '/' + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', KEY);
  used++;
  const r = await fetch(u);
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${text.slice(0, 200).replaceAll(KEY, '***')}`);
  const lim = [...r.headers].filter(([k]) => /limit|remain|quota|usage/i.test(k));
  if (lim.length) console.log(`   (intestazioni limiti: ${lim.map(([k, v]) => k + '=' + v).join(', ')})`);
  return JSON.parse(text);
}
const short = (o, n = 400) => JSON.stringify(o).slice(0, n);

try {
  // 1. bookmaker disponibili: cerco quelli italiani
  console.log('1) Bookmaker italiani disponibili');
  let books = [];
  try { books = await get('bookmakers'); } catch (e) { console.log('   ' + e.message); }
  const list = Array.isArray(books) ? books : (books.data || books.bookmakers || []);
  const ita = list.filter(b => /\.it\b|snai|sisal|eurobet|goldbet|lottomatica|better|bet365|planetwin|william/i.test(JSON.stringify(b)));
  console.log(`   totale bookmaker: ${list.length}; italiani o con sito .it: ${ita.length}`);
  ita.slice(0, 25).forEach(b => console.log('   - ' + short(b, 160)));

  // 2. partite NBA dei prossimi giorni
  console.log('\n2) Partite NBA (sportId 11)');
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const fx = await get('fixtures', { sportId: 11, from, to });
  const fixtures = (Array.isArray(fx) ? fx : (fx.data || [])).filter(f => /nba/i.test(JSON.stringify([f.tournamentSlug, f.tournamentName, f.categoryName])));
  console.log(`   partite NBA trovate: ${fixtures.length}`);
  if (fixtures[0]) console.log('   esempio: ' + short(fixtures[0], 500));

  // 3. quote di una partita per Snai e Sisal
  const target = fixtures.find(f => f.hasOdds) || fixtures[0];
  if (!target) throw new Error('nessuna partita NBA da provare');
  const slugs = ['snai.it', 'sisal.it', 'sisal-it', ...ita.map(b => b.slug || b.bookmaker || b.id).filter(Boolean)];
  const uniq = [...new Set(slugs)].slice(0, 10).join(',');
  console.log(`\n3) Quote della partita ${target.fixtureId || target.id} per: ${uniq}`);
  const od = await get('odds', { fixtureId: target.fixtureId || target.id, bookmakers: uniq });
  const bo = od.bookmakerOdds || od.bookmakers || {};
  for (const [book, val] of Object.entries(bo)) {
    const markets = val.markets || val;
    const ids = Object.keys(markets || {});
    let playerMk = 0, sample = null;
    for (const id of ids) {
      const s = JSON.stringify(markets[id]);
      if (/playerName/.test(s)) { playerMk++; if (!sample) sample = { id, s: s.slice(0, 600) }; }
    }
    console.log(`   ${book}: ${ids.length} mercati, di cui con giocatori: ${playerMk}`);
    if (sample) console.log(`     esempio mercato ${sample.id}: ${sample.s}`);
  }
  if (!Object.keys(bo).length) console.log('   risposta: ' + short(od, 600));

  // 4. catalogo mercati NBA (per capire nomi e linee delle props)
  console.log('\n4) Catalogo mercati NBA con giocatori');
  const mk = await get('markets', { sportId: 11 });
  const mlist = Array.isArray(mk) ? mk : (mk.data || []);
  const pm = mlist.filter(m => /player|double|triple/i.test(m.marketName || ''));
  console.log(`   mercati totali: ${mlist.length}; mercati giocatore: ${pm.length}`);
  const names = [...new Set(pm.map(m => m.marketName))].slice(0, 30);
  console.log('   nomi: ' + names.join(' | '));
  if (pm[0]) console.log('   esempio: ' + short(pm[0], 400));
} catch (e) {
  console.log('ERRORE: ' + String(e.message).replaceAll(KEY, '***'));
}
console.log(`\nRichieste usate da questa verifica: ${used}`);
