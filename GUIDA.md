# MyNbaPrediction: guida (tutto gratis)

## Come funziona
```
ESPN (gratis, senza chiave) ──────┐
                                  ├─► scripts/update-data.mjs ─► data.json ─► index.html (l'app)
The Odds API (linee bookmaker) ───┘        ogni giorno con GitHub Actions
```
- **ESPN** fornisce partite, rose, infortunati, partite giocate (stagione attuale e precedente)
  e i box score di tutta la lega degli ultimi 45 giorni, usati per il matchup.
- **The Odds API** fornisce le linee vere dei bookmaker. Senza chiave l'app funziona lo stesso,
  ma le linee sono **stimate**.

## Funzioni
| Funzione | Cosa fa |
|---|---|
| Hit rate L5/L10/L20 | % di partite sopra o sotto la linea |
| 👥 **Con / Senza** | scegli più giocatori (con o senza) e tutto viene ricalcolato solo sulle partite che rispettano i filtri. "Senza gli assenti di stasera" li seleziona in automatico |
| **Matchup 0-100** | quanto l'avversario concede in quella statistica al ruolo del giocatore (guardie, ali, centri), confrontato con le altre 29 squadre |
| Fiducia 0-100 | combinazione degli hit rate |
| Linee bookmaker | linea più comune tra i bookmaker e quota migliore. Interruttore "Solo linee dei bookmaker" |

## File
| File | A cosa serve |
|---|---|
| `index.html` | l'app |
| `data.json` | i dati del giorno (creato dallo script) |
| `defense-cache.json` | box score già scaricati (così ogni giorno scarica solo quelli nuovi) |
| `scripts/update-data.mjs` | scarica i dati veri |
| `.github/workflows/update-data.yml` | aggiornamento automatico giornaliero |
| `.env.example` | modello per la chiave della Odds API |
| `manifest.json`, `sw.js`, `icon.svg` | servono a installarla sul telefono |
| `serve.js` | per provarla sul PC: `node serve.js` → http://localhost:8080 |

---

## Inserire le linee a mano (modo attuale)
1. Tocca un giocatore per aprire la sua scheda e scegli la statistica (Punti, Rimbalzi, …).
2. Nel riquadro **✏️ Inserisci la linea del tuo bookmaker** scrivi la linea
   (o usa **−** e **+** per spostarla di 0,5) e, se vuoi, le quote over e under.
3. Premi **Salva linea** (o Invio). Hit rate, Fiducia e grafico si ricalcolano subito
   e la card mostra **MIA LINEA**.
4. **Torna alla stimata** cancella la tua linea.

- L'interruttore **"Solo le linee che ho inserito"** mostra solo le props che hai compilato.
- Le linee sono salvate **sul dispositivo** (telefono o PC) dove le scrivi e si cancellano da sole
  quando la partita è passata. Se le inserisci sul PC non le vedi sul telefono.

---

## (Facoltativo, in futuro) Linee automatiche dei bookmaker
1. Vai su https://the-odds-api.com, scegli il piano **Starter (gratis)** e inserisci la tua email.
   Ti arriva una **chiave** (una lunga serie di lettere e numeri).
2. **Sul PC:** copia `.env.example`, chiama la copia `.env`, apri con Blocco note
   e incolla la chiave dopo `ODDS_API_KEY=`. Salva.
   Poi esegui `node scripts/update-data.mjs`.
3. **Su GitHub (per l'aggiornamento automatico):** Settings → Secrets and variables → Actions →
   **New repository secret**, nome `ODDS_API_KEY`, valore la tua chiave.

⚠️ Non mettere la chiave dentro `index.html` o altri file pubblici e non condividerla:
chiunque la veda può consumare i tuoi crediti. Il file `.env` è escluso da GitHub (`.gitignore`).

### Crediti gratuiti (500 al mese)
Ogni mercato costa 1 credito per partita. Con `ODDS_MARKETS=auto` (predefinito) lo script divide
i crediti rimasti per i giorni che mancano a fine mese e sceglie quanti mercati scaricare, in questo ordine:
**punti → punti+rimbalzi+assist → rimbalzi → assist → punti+rimbalzi → punti+assist → rimbalzi+assist → triple**.
Nei giorni con poche partite avrai più mercati, nei giorni pieni meno.
Le statistiche senza linea del bookmaker restano "stimate".

Esegui l'aggiornamento **una sola volta al giorno** (sera italiana), altrimenti consumi crediti due volte.

---

## Pubblicarla online con aggiornamento automatico (GitHub, gratis)
1. Registrati su https://github.com → **+ → New repository** → nome `mynbaprediction`, **Public** → Create.
2. **uploading an existing file**: trascina tutti i file e le cartelle **tranne `.env`**, poi Commit.
   > Se `.github` non viene caricata: **Add file → Create new file**, nome
   > `.github/workflows/update-data.yml` e incolla il contenuto.
3. **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.**
   L'app sarà su `https://TUONOME.github.io/mynbaprediction/`.
4. **Actions** → abilita → **Aggiorna dati NBA → Run workflow**. Da ora gira ogni sera alle 22:00.

## Installarla sul telefono
- **Android (Chrome)**: menu ⋮ → *Installa app*
- **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*

## Note
- I dati ESPN sono pubblici ma non ufficiali: possono cambiare senza avviso.
  Se un giorno non si aggiorna, guarda gli errori in **Actions**.
- Con/Senza con poche partite (meno di 5) è poco affidabile: guarda il numero 👥 sulla card.
- L'app fa solo analisi statistica, non raccoglie scommesse né denaro. 18+, gioca responsabilmente.
