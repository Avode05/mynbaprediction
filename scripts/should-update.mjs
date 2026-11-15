// Decide se fare l'aggiornamento completo (lanciato ogni ora da GitHub).
// Aggiorna quando: tutte le partite di una giornata sono finite e sono passate 3 ore
// dalla fine stimata dell'ultima (inizio + 2,5 ore), oppure alle 10 e alle 19 italiane per le linee.
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const STATE = new URL('../update-state.json', import.meta.url);
const GAME_LEN = 2.5 * 3600e3, DELAY = 3 * 3600e3;
const usDate = off => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + off * 864e5)).map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
};
let state = { done: [] };
try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
let oc = null; try { oc = JSON.parse(await readFile(new URL('../odds-cache.json', import.meta.url), 'utf8')); } catch {}

let run = false, why = 'nessuna condizione';
for (const d of [usDate(-1), usDate(0)]) {
  if (state.done.includes(d)) continue;
  const sb = await (await fetch(`${ESPN}/scoreboard?dates=${d}`)).json();
  const evs = (sb.events || []).filter(e => [2, 3, 5].includes(e.season?.type));
  if (!evs.length || !evs.every(e => e.status?.type?.completed)) continue;
  const lastStart = Math.max(...evs.map(e => Date.parse(e.date)));
  if (Date.now() >= lastStart + GAME_LEN + DELAY) {
    run = true; why = `giornata ${d} finita da più di 3 ore`;
    state.done = [...state.done, d].slice(-10);
  }
}
// linee dei bookmaker: una volta al giorno dalle 9 UTC (10 italiane), se non ancora scaricate
const h = new Date().getUTCHours();
if (!run && h >= 9) {
  const sb = await (await fetch(`${ESPN}/scoreboard?dates=${usDate(0)}`)).json();
  const pre = (sb.events || []).filter(e => e.status?.type?.state === 'pre');
  // seconda passata: alle 19 italiane; se la prima partita è alle 19 o prima, 3 ore prima di essa
  const n0 = new Date(), first = Math.min(...(sb.events || []).map(e => Date.parse(e.date)));
  const at19 = Date.UTC(n0.getUTCFullYear(), n0.getUTCMonth(), n0.getUTCDate(), 18);
  const eve = Date.now() >= (first <= at19 ? first - 3 * 3600e3 : at19);
  const need = !oc || oc.day !== usDate(0) || (!oc.eve && eve);
  if (need && pre.length) { run = true; why = 'linee dei bookmaker di stasera'; }
}
await writeFile(STATE, JSON.stringify(state));
console.log(`Aggiornare: ${run ? 'SÌ' : 'no'} (${why})`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run=${run}\n`);
