// =============================================================
// MyNbaPrediction: scarica i dati veri e crea data.json
// Uso:  node scripts/update-data.mjs
// Facoltativo (nel file .env o come variabili d'ambiente):
//   ODDS_API_KEY=la_tua_chiave      (the-odds-api.com, gratis)
//   ODDS_MARKETS=auto               (auto = quanti più mercati possibile nel limite gratuito)
// Nessuna libreria da installare: serve solo Node 18 o più recente.
// =============================================================
import { readFile, writeFile } from 'node:fs/promises';

// --- legge il file .env (se esiste) senza mostrarne il contenuto ---
try {
  const env = await readFile(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_LOG = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';
const ODDS = 'https://api.the-odds-api.com/v4/sports/basketball_nba';
const ODDS_KEY = (process.env.ODDS_API_KEY || '').trim();
const ODDS_MARKETS = (process.env.ODDS_MARKETS || 'auto').trim();
const PER_TEAM = 6;          // giocatori con props per squadra
const MAX_LOGS = 82;         // partite tenute per giocatore (stagione attuale + precedente)
const DEF_DAYS = 45;         // giorni di partite per valutare le difese
const OUT = new URL('../data.json', import.meta.url);
const CACHE = new URL('../defense-cache.json', import.meta.url);
const CACHE_V = 3;

// mercati in ordine di priorità (se i crediti sono pochi si prendono i primi)
const MARKETS = [
  ['player_points', 'pts'], ['player_points_rebounds_assists', 'pra'],
  ['player_rebounds', 'reb'], ['player_assists', 'ast'],
  ['player_points_rebounds', 'pr'], ['player_points_assists', 'pa'], ['player_rebounds_assists', 'ra'],
  ['player_threes', 'fg3'], ['player_steals', 'stl'], ['player_blocks', 'blk'],
  ['player_blocks_steals', 'stocks'], ['player_turnovers', 'tov'],
  ['player_double_double', 'dd'], ['player_triple_double', 'td']
];
const MARKET_TO_STAT = Object.fromEntries(MARKETS);
// statistiche base (dal box score) e derivate
const BASE = ['pts', 'reb', 'ast', 'fg3', 'stl', 'blk', 'tov'];
const derive = o => Object.assign(o, {
  pra: o.pts + o.reb + o.ast, pa: o.pts + o.ast, pr: o.pts + o.reb, ra: o.reb + o.ast,
  stocks: o.stl + o.blk, fant: o.pts + 1.2 * o.reb + 1.5 * o.ast + 3 * o.stl + 3 * o.blk - o.tov
});
const DEF_STATS = ['pts', 'reb', 'ast', 'fg3', 'stl', 'blk', 'tov', 'pra', 'pa', 'pr', 'ra', 'stocks', 'fant'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hide = s => String(s).replace(/apiKey=[^&]+/g, 'apiKey=***');
async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'MyNbaPrediction/1.0' } });
      if (r.ok) return { json: await r.json(), headers: r.headers };
      last = new Error(`HTTP ${r.status}`);
      if ([401, 404, 422, 429].includes(r.status)) break;
    } catch (e) { last = e; }
    await sleep(800 * (i + 1));
  }
  throw new Error(`${last?.message || 'errore'} su ${hide(url)}`);
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}
const half = v => Math.max(0.5, Math.floor(v) + 0.5);
const r1 = v => Math.round(v * 10) / 10;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');
const posGroup = p => !p ? 'F' : p.includes('C') ? 'C' : p.includes('G') ? 'G' : 'F';
const made = s => parseInt(String(s || '0').split('-')[0], 10) || 0;
const att = s => parseInt(String(s || '0-0').split('-')[1], 10) || 0;

// Data "NBA" (fuso orario di New York), offset in giorni
function usDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}

// ---------- 1. Partite del giorno ----------
async function getGames() {
  for (const off of [0, 1]) { // se oggi non si gioca, prova domani
    const { json } = await getJSON(`${ESPN}/scoreboard?dates=${usDate(off)}`);
    const games = (json.events || [])
      .filter(e => e.status?.type?.state === 'pre')
      .map(e => {
        const c = e.competitions[0].competitors;
        const t = x => ({ id: String(x.team.id), abbr: x.team.abbreviation, name: x.team.displayName, color: '#' + (x.team.color || '888888') });
        return { id: e.id, time: e.date, home: t(c.find(x => x.homeAway === 'home')), away: t(c.find(x => x.homeAway === 'away')) };
      });
    if (games.length) return games;
  }
  return [];
}

// ---------- 2. Log partite di un giocatore (stagione attuale + precedente) ----------
function parseLog(json) {
  const L = json.labels || [], idx = k => L.indexOf(k), out = [];
  for (const st of json.seasonTypes || []) {
    if (!/Regular|Postseason|Play/i.test(st.displayName)) continue;
    for (const cat of st.categories || []) for (const ev of cat.events || []) {
      const meta = json.events?.[ev.eventId]; if (!meta) continue;
      const s = ev.stats, min = +s[idx('MIN')] || 0;
      if (!min) continue;
      const away = meta.atVs === '@';
      const my = +(away ? meta.awayTeamScore : meta.homeTeamScore), op = +(away ? meta.homeTeamScore : meta.awayTeamScore);
      out.push({
        id: String(ev.eventId), tid: String(away ? meta.awayTeamId : meta.homeTeamId),
        date: meta.gameDate.slice(0, 10), opp: meta.opponent?.abbreviation, home: !away, min,
        pts: +s[idx('PTS')] || 0, reb: +s[idx('REB')] || 0, ast: +s[idx('AST')] || 0, fg3: made(s[idx('3PT')]),
        stl: +s[idx('STL')] || 0, blk: +s[idx('BLK')] || 0, tov: +s[idx('TO')] || 0,
        win: meta.gameResult === 'W' ? 1 : 0, margin: Number.isFinite(my - op) ? my - op : 0
      });
    }
  }
  return out;
}
async function allLogs(athleteId) {
  const { json } = await getJSON(`${ESPN_LOG}/${athleteId}/gamelog`);
  let logs = parseLog(json);
  const seasons = (json.filters || []).find(f => f.name === 'season')?.options?.map(o => +o.value).filter(Boolean) || [];
  const prev = seasons.sort((a, b) => b - a)[1];
  if (prev) { try { logs = logs.concat(parseLog((await getJSON(`${ESPN_LOG}/${athleteId}/gamelog?season=${prev}`)).json)); } catch {} }
  const seen = new Set();
  return logs.filter(g => !seen.has(g.id) && seen.add(g.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_LOGS);
}

// ---------- 3. Rosa completa di una squadra ----------
async function teamData(team) {
  const { json } = await getJSON(`${ESPN}/teams/${team.id}/roster`);
  const roster = await pool(json.athletes || [], 6, async a => {
    const inj = (a.injuries || []).map(i => i.status || '');
    return { name: a.displayName, pos: posGroup(a.position?.abbreviation),
      out: inj.some(s => /out/i.test(s)), doubt: inj.some(s => /day|doubt|quest/i.test(s)),
      logs: await allLogs(a.id) };
  });
  const all = roster.filter(Boolean);
  // partite giocate con questa squadra e chi era in campo
  const ids = new Set();
  all.forEach(p => p.logs.forEach(g => g.tid === team.id && ids.add(g.id)));
  const games = [...ids].sort();
  const gi = Object.fromEntries(games.map((g, i) => [g, i]));
  const mates = {};
  for (const p of all) {
    const played = p.logs.filter(g => g.tid === team.id).map(g => gi[g.id]);
    if (played.length) mates[p.name] = played;
  }
  const mpg = p => { const l = p.logs.filter(g => g.tid === team.id).slice(0, 10); return l.length >= 3 ? l.reduce((s, g) => s + g.min, 0) / l.length : 0; };
  const top = all.filter(p => !p.out && mpg(p) > 0).sort((a, b) => mpg(b) - mpg(a)).slice(0, PER_TEAM);
  return { games, mates, top, out: all.filter(p => p.out && mates[p.name]).map(p => p.name), doubt: all.filter(p => p.doubt).map(p => p.name) };
}

// ---------- 4. Difese e classifiche di squadra ----------
async function defense(teamAbbrs) {
  let cache = { v: CACHE_V, days: {}, games: {} };
  try { const c = JSON.parse(await readFile(CACHE, 'utf8')); if (c.v === CACHE_V) cache = c; } catch {}
  const days = []; for (let off = -DEF_DAYS; off <= -1; off++) days.push(usDate(off));
  const todo = days.filter(d => !cache.days[d]);
  console.log(`Difese: ${todo.length} giorni da scaricare (gli altri sono in cache)`);
  for (const d of todo) {
    let sb; try { sb = (await getJSON(`${ESPN}/scoreboard?dates=${d}`)).json; } catch { continue; }
    const evs = (sb.events || []).filter(e => [2, 3, 5].includes(e.season?.type));
    const done = evs.filter(e => e.status?.type?.completed);
    await pool(done.filter(e => !cache.games[e.id]), 6, async e => {
      const { json } = await getJSON(`${ESPN}/summary?event=${e.id}`);
      const pl = [], tm = {};
      for (const box of json.boxscore?.players || []) {
        const st = box.statistics?.[0]; if (!st) continue;
        const k = st.keys || [], ix = n => k.indexOf(n);
        let pts = 0;
        for (const a of st.athletes || []) {
          const min = +a.stats?.[ix('minutes')] || 0;
          if (a.didNotPlay || !min) continue;
          const v = [+a.stats[ix('points')] || 0, +a.stats[ix('rebounds')] || 0, +a.stats[ix('assists')] || 0,
            made(a.stats[ix('threePointFieldGoalsMade-threePointFieldGoalsAttempted')]),
            +a.stats[ix('steals')] || 0, +a.stats[ix('blocks')] || 0, +a.stats[ix('turnovers')] || 0];
          pts += v[0];
          // singolo giocatore: [nome, squadra, ruolo, minuti, pts, reb, ast, triple, rec, stop, pp]
          pl.push([a.athlete?.displayName, box.team.abbreviation, posGroup(a.athlete?.position?.abbreviation), min, ...v]);
        }
        tm[box.team.abbreviation] = { pts };
      }
      for (const t of json.boxscore?.teams || []) {
        const s = Object.fromEntries((t.statistics || []).map(x => [x.name, x.displayValue]));
        Object.assign(tm[t.team.abbreviation] ||= {}, {
          fga: att(s['fieldGoalsMade-fieldGoalsAttempted']), fta: att(s['freeThrowsMade-freeThrowsAttempted']),
          fg3a: att(s['threePointFieldGoalsMade-threePointFieldGoalsAttempted']),
          oreb: +s.offensiveRebounds || 0, dreb: +s.defensiveRebounds || 0, reb: +s.totalRebounds || 0,
          ast: +s.assists || 0, tov: +s.totalTurnovers || +s.turnovers || 0, paint: +s.pointsInPaint || 0, fb: +s.fastBreakPoints || 0
        });
      }
      if (Object.keys(tm).length === 2 && pl.length) cache.games[e.id] = { d, p: pl, tm };
    });
    if (evs.length && evs.every(e => e.status?.type?.completed) && done.every(e => cache.games[e.id])) cache.days[d] = 1;
    if (!evs.length) cache.days[d] = 1;
  }
  const oldest = days[0];
  for (const [id, g] of Object.entries(cache.games)) if (g.d < oldest) delete cache.games[id];
  for (const d of Object.keys(cache.days)) if (d < oldest) delete cache.days[d];
  await writeFile(CACHE, JSON.stringify(cache));

  // --- quanto concede ogni squadra a ogni ruolo ---
  const zero = () => Object.fromEntries(BASE.map(s => [s, 0]));
  const allowed = {}, n = {};
  for (const g of Object.values(cache.games)) {
    const [a, b] = Object.keys(g.tm);
    for (const [me, opp] of [[a, b], [b, a]]) {
      n[me] = (n[me] || 0) + 1;
      allowed[me] ||= { G: zero(), F: zero(), C: zero() };
      for (const [, team, pos, , ...v] of g.p) if (team === opp) BASE.forEach((s, i) => allowed[me][pos][s] += v[i]);
    }
  }
  const teams = Object.keys(allowed).filter(k => n[k] >= 3);
  const avg = {};
  for (const tm of teams) { avg[tm] = {}; for (const pos of ['G', 'F', 'C']) avg[tm][pos] = derive(Object.fromEntries(BASE.map(s => [s, allowed[tm][pos][s] / n[tm]]))); }
  const league = {};
  for (const pos of ['G', 'F', 'C']) { league[pos] = {}; for (const s of DEF_STATS) league[pos][s] = r1(teams.reduce((t, tm) => t + avg[tm][pos][s], 0) / (teams.length || 1)); }
  const out = {};
  for (const pos of ['G', 'F', 'C']) for (const s of DEF_STATS) {
    const sorted = [...teams].sort((x, y) => avg[x][pos][s] - avg[y][pos][s]); // dal meno al più concesso
    sorted.forEach((tm, i) => {
      if (!teamAbbrs.includes(tm)) return;
      ((out[tm] ||= {})[pos] ||= {})[s] = [r1(avg[tm][pos][s]), sorted.length - i, Math.round(100 * i / (sorted.length - 1))];
    });
  }

  // --- classifiche di squadra (tutte le 30): 1 = più favorevole all'OVER di chi la affronta ---
  const T = {};
  for (const g of Object.values(cache.games)) {
    const [a, b] = Object.keys(g.tm);
    const poss = x => x.fga + 0.44 * x.fta - x.oreb + x.tov;
    const P = (poss(g.tm[a]) + poss(g.tm[b])) / 2;
    for (const [me, op] of [[a, b], [b, a]]) {
      const t = T[me] ||= { n: 0, poss: 0, ptsA: 0, rebA: 0, astA: 0, fg3aA: 0, orebA: 0, drebA: 0, paintA: 0, fbA: 0, tovF: 0 };
      const o = g.tm[op];
      t.n++; t.poss += P; t.ptsA += o.pts; t.rebA += o.reb; t.astA += o.ast; t.fg3aA += o.fg3a;
      t.orebA += o.oreb; t.drebA += o.dreb; t.paintA += o.paint; t.fbA += o.fb; t.tovF += o.tov;
    }
  }
  const metrics = {
    pace: t => t.poss / t.n, drtg: t => 100 * t.ptsA / t.poss, pts: t => t.ptsA / t.n, reb: t => t.rebA / t.n,
    ast: t => t.astA / t.n, fg3a: t => t.fg3aA / t.n, oreb: t => t.orebA / t.n, dreb: t => t.drebA / t.n,
    paint: t => t.paintA / t.n, fb: t => t.fbA / t.n, tov: t => t.tovF / t.n
  };
  const ranks = {};
  const tl = Object.keys(T).filter(k => T[k].n >= 3);
  for (const [m, f] of Object.entries(metrics)) {
    [...tl].sort((x, y) => f(T[y]) - f(T[x])).forEach((tm, i) => { (ranks[tm] ||= {})[m] = [r1(f(T[tm])), i + 1]; });
  }

  // --- per ogni difesa di stasera: le ultime prestazioni degli avversari per ruolo (almeno 20 minuti) ---
  const vsPos = {}, used = new Set();
  const recent = Object.values(cache.games).sort((a, b) => b.d.localeCompare(a.d));
  for (const tm of teamAbbrs) {
    vsPos[tm] = { G: [], F: [], C: [] };
    for (const g of recent) {
      if (!g.tm[tm]) continue;
      for (const [name, team, pos, min, ...v] of g.p) {
        if (team === tm || min < 20 || vsPos[tm][pos].length >= 15) continue;
        vsPos[tm][pos].push([g.d, name, team, min, ...v]); used.add(name);
      }
    }
  }
  // media di riferimento di quei giocatori nelle partite in cache (serve per lo scarto %)
  const base = {};
  for (const g of Object.values(cache.games)) for (const [name, , , min, ...v] of g.p) {
    if (!used.has(name)) continue;
    const b = base[name] ||= [0, 0, ...BASE.map(() => 0)];
    b[0]++; b[1] += min; v.forEach((x, i) => b[2 + i] += x);
  }
  for (const k of Object.keys(base)) { const b = base[k]; base[k] = [b[0], ...b.slice(1).map(x => r1(x / b[0]))]; }

  console.log(`Difese calcolate su ${Object.keys(cache.games).length} partite, ${teams.length} squadre`);
  return { teams: out, n: teams.length, games: Object.keys(cache.games).length, vsPos, base, league, ranks, nTeams: tl.length };
}

// ---------- 5. Linee dei bookmaker ----------
// plan: [{ g: partita, markets: ['player_points', ...] }] solo per i candidati dei consigli AI
async function getOdds(plan, used = null) {
  const lines = {}, info = { markets: [], remaining: null, credits: 0 };
  const { json: events, headers } = await getJSON(`${ODDS}/events?apiKey=${ODDS_KEY}`); // 0 crediti
  let remaining = parseInt(headers.get('x-requests-remaining'), 10);
  const now = new Date();
  const daysLeft = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate() - now.getUTCDate() + 1;
  const daily = Number.isFinite(remaining) ? Math.floor(remaining / daysLeft) : 30;
  // mattina: 60% della quota giornaliera; sera (used = crediti del mattino): il resto
  // mattina: tutti i mercati AI di tutte le partite (più linee vere = più consigli); sera: quota giornaliera
  let budget = process.env.ODDS_BUDGET ? +process.env.ODDS_BUDGET : used === null ? Math.max(daily, 60) : Math.max(daily, 20);
  console.log(`Crediti rimasti: ${Number.isFinite(remaining) ? remaining : '?'}, giorni a fine mese: ${daysLeft} → budget di oggi ${budget}`);
  const matched = plan.map(x => [x.g, events.find(e => norm(e.home_team) === norm(x.g.home.name) && norm(e.away_team) === norm(x.g.away.name)), x.markets]).filter(x => x[1]);
  info.markets = [...new Set(plan.flatMap(x => x.markets.map(m => MARKET_TO_STAT[m])))];

  for (const [g, ev, markets0] of matched) {
    const markets = markets0.slice(0, Math.max(0, budget)); // ogni mercato costa 1 credito
    if (!markets.length) { console.log('Budget di oggi finito.'); break; }
    budget -= markets.length;
    try {
      const { json, headers: h } = await getJSON(`${ODDS}/events/${ev.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${markets.join(',')}&oddsFormat=decimal`);
      remaining = parseInt(h.get('x-requests-remaining'), 10); info.credits += markets.length;
      const acc = {};
      for (const bk of json.bookmakers || []) for (const m of bk.markets || []) {
        const stat = MARKET_TO_STAT[m.key]; if (!stat) continue;
        for (const o of m.outcomes || []) {
          let side = o.name.toLowerCase(), point = o.point;
          if (point == null && (side === 'yes' || side === 'no')) { point = 0.5; side = side === 'yes' ? 'over' : 'under'; }
          if (point == null) continue;
          (acc[norm(o.description || '') + '|' + stat] ||= []).push({ side, point, price: o.price, bk: bk.title });
        }
      }
      for (const [k, arr] of Object.entries(acc)) {
        const freq = {}; arr.forEach(x => freq[x.point] = (freq[x.point] || 0) + 1);
        const line = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
        const at = arr.filter(x => x.point === line);
        // linea valida solo se almeno 3 bookmaker diversi la quotano; quota = mediana tra loro
        const nBooks = new Set(at.map(x => x.bk)).size;
        if (nBooks < 3) continue;
        const med = s => { const v = at.filter(x => x.side === s).map(x => x.price).sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor((v.length - 1) / 2)] * 100) / 100 : null; };
        lines[k] = { line, over: med('over'), under: med('under'), books: nBooks };
      }
      console.log(`Quote ${g.away.abbr}@${g.home.abbr}: ok (crediti rimasti ${remaining})`);
    } catch (e) { console.warn(`Quote non disponibili per ${g.away.abbr}@${g.home.abbr}: ${e.message}`); }
  }
  info.remaining = Number.isFinite(remaining) ? remaining : null;
  return { lines, info };
}

// ---------- Main ----------
const games = await getGames();
console.log(`Partite trovate: ${games.length}`);
const teams = {}, players = [];

for (const [gi, g] of games.entries()) {
  for (const side of ['away', 'home']) {
    const team = g[side], opp = side === 'home' ? g.away : g.home;
    let td = { games: [], mates: {}, top: [], out: [], doubt: [] };
    try { td = await teamData(team); } catch (e) { console.warn('Rosa non disponibile:', team.abbr, e.message); }
    teams[team.abbr] = { id: team.id, name: team.name, color: team.color, games: td.games, mates: td.mates, out: td.out };
    for (const p of td.top) {
      players.push({ name: p.name, team: team.abbr, pos: p.pos, opp: opp.abbr, home: side === 'home', gameId: gi, time: g.time,
        doubt: p.doubt, rawLogs: p.logs,
        // log compatto: [id, data, avv, casa, min, pts, reb, ast, triple, idSquadra, rec, stop, pp, vittoria, scarto]
        logs: p.logs.map(x => [x.id, x.date, x.opp, x.home ? 1 : 0, x.min, x.pts, x.reb, x.ast, x.fg3, x.tid, x.stl, x.blk, x.tov, x.win, x.margin]) });
    }
    console.log(`  ${team.abbr}: ${td.top.length} giocatori con props, ${Object.keys(td.mates).length} in rosa, assenti: ${td.out.join(', ') || 'nessuno'}`);
  }
}

let def = { teams: {}, n: 0, games: 0 };
try { def = await defense(Object.keys(teams)); } catch (e) { console.warn('Difese non disponibili:', e.message); }

// 1) linee stimate per tutti
const STATS = ['pts', 'reb', 'ast', 'fg3', 'pra', 'pa', 'pr', 'ra', 'stl', 'blk', 'stocks', 'tov', 'fant', 'dd', 'td'];
const AI_STATS = ['pts', 'reb', 'ast', 'fg3', 'pra', 'pr', 'pa', 'ra'];
const STAT_TO_MARKET = Object.fromEntries(MARKETS.map(([m, s]) => [s, m]));
const cands = [];
for (const p of players) {
  p.lines = {}; p.odds = {}; p.est = {};
  const L = p.rawLogs.map(g => {
    const o = derive({ ...g });
    const ten = [o.pts, o.reb, o.ast, o.stl, o.blk].filter(v => v >= 10).length;
    o.dd = ten >= 2 ? 1 : 0; o.td = ten >= 3 ? 1 : 0;
    return o;
  });
  delete p.rawLogs;
  const recent = L.slice(0, 20), last10 = L.slice(0, 10);
  const avg = (a, s) => a.reduce((t, g) => t + g[s], 0) / (a.length || 1);
  for (const s of STATS) {
    const est = avg(last10, s) * 0.5 + avg(recent, s) * 0.5;
    if (s === 'dd') { if (avg(recent, 'dd') >= 0.15) { p.lines.dd = 0.5; p.est.dd = true; } continue; }
    if (s === 'td') { if (avg(recent, 'td') >= 0.05) { p.lines.td = 0.5; p.est.td = true; } continue; }
    if (s === 'fg3' && est < 0.8) continue;   // non è un tiratore da 3
    if (s === 'stl' && est < 0.6) continue;
    if (s === 'blk' && est < 0.6) continue;
    p.lines[s] = s === 'fant' ? Math.round(est) + 0.5 : half(est); p.est[s] = true;
  }
  // 2) candidati per i consigli AI: minuti stabili, sopra la linea stimata con continuità
  const mins = last10.map(g => g.min), mAvg = avg(last10, 'min');
  if (p.doubt || L.length < 8 || mAvg < 20) continue;
  for (const s of AI_STATS) {
    if (p.lines[s] === undefined) continue;
    const X = p.lines[s], h10 = last10.filter(g => g[s] > X).length, h20 = recent.filter(g => g[s] > X).length / recent.length;
    const vals = recent.map(g => g[s]), m = avg(recent, s), sd = Math.sqrt(vals.reduce((t, v) => t + (v - m) ** 2, 0) / vals.length) || 1;
    cands.push({ p, s, score: h10 / 10 * 0.5 + h20 * 0.3 + Math.min(1, (avg(last10, s) - X) / sd) * 0.2 });
  }
}

// 3) le chiamate alla Odds API servono solo ai consigli AI: i migliori 24 candidati (max 2 per giocatore)
const AI_POOL = 24;
cands.sort((a, b) => b.score - a.score);
const per = {}, chosen = cands.filter(c => (per[c.p.name] = (per[c.p.name] || 0) + 1) <= 2).slice(0, AI_POOL);
// ogni mercato restituisce le linee di TUTTI i giocatori della partita: chiediamo tutti i mercati AI, prima quelli dei candidati migliori
const plan = games.map((g, gi) => { const top = [...new Set(chosen.filter(c => c.p.gameId === gi).map(c => STAT_TO_MARKET[c.s]))]; return { g, markets: [...new Set([...top, ...AI_STATS.map(s => STAT_TO_MARKET[s])])].filter(Boolean) }; });
console.log(`Candidati AI: ${chosen.length}, partite da interrogare: ${plan.length}, mercati: ${plan.reduce((t, x) => t + x.markets.length, 0)}`);

// linee scaricate una sola volta al giorno (dalle 9 UTC = 10 italiane) e riusate dagli aggiornamenti successivi
const ODDS_CACHE = new URL('../odds-cache.json', import.meta.url);
let oc = null; try { oc = JSON.parse(await readFile(ODDS_CACHE, 'utf8')); } catch {}
const day = games.length ? usDate(0) : '';
let book = {}, oddsInfo = { markets: [], remaining: null };
// seconda passata alle 19 italiane (18 UTC): aggiorna le quote col resto del budget giornaliero
const retry = oc && oc.day === day && !oc.eve && new Date().getUTCHours() >= 18;
if (oc && oc.day === day && Object.keys(oc.lines || {}).length && process.env.ODDS_FORCE !== '1' && !retry) {
  book = oc.lines; oddsInfo = oc.info; console.log(`Linee dalla cache di oggi (${Object.keys(book).length}).`);
} else if (ODDS_KEY && plan.length && (new Date().getUTCHours() >= 9 || process.env.ODDS_FORCE === '1')) {
  ({ lines: book, info: oddsInfo } = await getOdds(plan, retry ? (oc.info?.credits || 0) : null));
  console.log(`Crediti usati ora: ${oddsInfo.credits}`);
  if (retry) { book = { ...oc.lines, ...book }; oddsInfo.credits += oc.info?.credits || 0; } // le linee del mattino restano dove la sera non ci sono
  const eve = new Date().getUTCHours() >= 18;
  if (Object.keys(book).length || eve) await writeFile(ODDS_CACHE, JSON.stringify({ day, lines: book, info: oddsInfo, at: new Date().toISOString(), eve }));
} else if (ODDS_KEY) console.log('Linee: troppo presto (prima delle 9 UTC), uso le stimate.');
else console.log('ODDS_API_KEY non impostata: uso linee stimate.');

// 4) linee vere applicate a tutti i giocatori dei mercati scaricati
for (const p of players) for (const s of AI_STATS) {
  const b = book[norm(p.name) + '|' + s];
  if (b) { p.lines[s] = b.line; p.odds[s] = { over: b.over, under: b.under, books: b.books }; p.est[s] = false; }
}

const real = players.reduce((n, p) => n + Object.keys(p.odds).length, 0);
const data = {
  updated: new Date().toISOString(),
  source: real ? 'ESPN + bookmaker (The Odds API)' : 'ESPN (linee stimate)',
  odds: { ...oddsInfo, realLines: real },
  games: games.map(g => ({ away: g.away.abbr, home: g.home.abbr, time: g.time })),
  defense: def,
  teams, players
};
await writeFile(OUT, JSON.stringify(data));
console.log(`Salvato data.json: ${players.length} giocatori, ${games.length} partite, ${real} linee reali.`);
