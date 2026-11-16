# MyNbaPrediction — note di progetto (per Claude)

App personale di props NBA in stile Props.Cash / PropsMadness, solo strumenti gratuiti.
Sito: https://avode05.github.io/mynbaprediction/ — repo pubblico `Avode05/mynbaprediction` (GitHub Pages da `main`, root, `.nojekyll`).

## Preferenze dell'utente
- Risposte brevissime, in italiano (circa -80% token).
- Solo NBA. Consigli AI **solo OVER** (i bookmaker italiani non quotano gli under).
- Vuole **5 consigli AI** (`AI_N = 5` in `index.html`), quota minima **1,70**, linea confermata da **almeno 3 bookmaker**.
- Mercati per i consigli: punti, rimbalzi, assist e combo (P+R+A, P+R, P+A, R+A), **senza ordine fisso** (scelti dai candidati migliori di ogni partita).
- Crediti Odds API da non sprecare; quando finiscono l'utente può creare lui una nuova chiave e aggiornare il secret.
- NON creare rotazione/backup automatico su più account Odds API (vietato dai termini): già rifiutato due volte.
- La chiave API la inserisce SOLO l'utente: `gh secret set ODDS_API_KEY --repo Avode05/mynbaprediction`. Mai scriverla in chat o nei file.

## File
- `index.html` — tutta l'app (JS/CSS vanilla). Schede: AI (predefinita), Home, Props, Preferiti, Info.
  - 15 statistiche: pts, reb, ast, fg3, pra, pa, pr, ra, stl, blk, stocks, tov, fant, dd, td.
  - Filtri globali `state.f` (stagione, N partite, minuti, H2H, casa/trasferta, risultato, B2B, filtro avversario `f.opp`), on/off compagni, linee manuali (localStorage `mnp-lines`).
  - `f.opp = {m, mode}`: `m` = chiave di `RANKS` oppure `'defpos'` (difesa vs ruolo, con `s` = stat). Mode `sim` = ±5 posizioni.
  - Scheda giocatore: riepilogo, grafico con dettaglio barra, proiezioni, matchup 0-100 (voti A+…F), giocatori simili, compagni, split, H2H, chip suggerite.
  - AI: `aiCandidate()` usa solo linee vere (≥3 book, quota ≥1,70), probabilità = 50% modello + 50% implicita di mercato; giudizio CONVIENE / AL LIMITE / NON CONVIENE.
- `scripts/update-data.mjs` — scarica dati ESPN (gratis, senza chiave) e quote The Odds API → `data.json`.
  - Proiezione: rate per minuto pesato su L20 × minuti attesi × correzione difesa (±12%, effetto dimezzato), distribuzione normale; `probAt` = 60% modello + 40% frequenza L20.
  - Cache difese `defense-cache.json` (45 giorni di box score). Ranks squadra: #1 = più favorevole all'OVER.
  - Quote: `getOdds(plan, used)`. Budget giornaliero = crediti rimasti / giorni a fine mese; mattina 70%, sera il resto; mercati divisi in parti uguali tra le partite; salta le partite già iniziate. Override manuale con env `ODDS_BUDGET`.
  - Linea di consenso = punto più frequente con ≥3 bookmaker; quota = mediana. Le linee vere vengono applicate a tutti i giocatori.
  - Cache quote `odds-cache.json` `{day, lines, info, at, eve}`.
- `scripts/should-update.mjs` — controllo orario: decide se aggiornare.
- `.github/workflows/update-data.yml` — cron ogni ora + `workflow_dispatch` (input `budget`). Secret `ODDS_API_KEY`.
- `serve.js` — server locale porta 8080 (`.claude/launch.json`, nome "app").

## Orari automatici (ora italiana)
- **10:00** quote del mattino (dalle 9 UTC).
- **19:00** seconda passata delle quote; se la prima partita inizia alle 19 o prima → **3 ore prima** della prima partita.
- **Statistiche**: 3 ore dopo la fine stimata dell'ultima partita (inizio + 2,5 h + 3 h).
- Avvio manuale: Actions → "Aggiorna dati NBA" → Run workflow (campo crediti, es. 20). Ogni avvio manuale riscarica le quote e consuma crediti.
- I cron di GitHub possono ritardare fino a ~1 ora.

## Crediti The Odds API
- Piano gratuito 500/mese; 1 credito per mercato per partita (lista eventi gratis).
- Situazione al 15/11/2026: 348 rimasti (circa 60 sprecati in prove manuali il 14/11).

## Note tecniche ambiente (Windows)
- git: `C:\Program Files\Git\cmd`, gh: `C:\Program Files\GitHub CLI\gh.exe` (in Bash aggiungerli al PATH).
- File con fine riga CRLF: nelle modifiche via script normalizzare `\r\n`.
- Se `git pull --rebase` dà "Filename too long": `git config core.longpaths true`, poi `git fetch` + `git rebase origin/main`.
- La rete a volte non raggiunge github.com: riprovare il push più tardi.
- Commit con firma: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Non usare l'email personale dell'utente.
