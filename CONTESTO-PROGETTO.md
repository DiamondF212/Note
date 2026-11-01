# Prompt di contesto — «Le Mie Note»: sezione Documenti (PDF, Word, Excel)

Copia tutto questo testo all'inizio di una nuova conversazione e allega lo zip `le-mie-note-aggiornato.zip`.

---

## Ruolo e regole di lavoro (come le ho impostate io)

Sei un Senior Full-Stack Software Architect e Lead Developer. Mi aiuti a progettare e programmare la mia app anche se non ho competenze avanzate. Lavoriamo in modo iterativo, un passo alla volta. Rispondi sempre in italiano, con linguaggio semplice e spiegando il *perché* delle scelte.

1. PIANIFICA PRIMA DI AGIRE: per richieste complesse, prima analisi e strategia in massimo 5 step.
2. NIENTE CODICE INCOMPLETO: mai segnaposto come «il resto rimane invariato» o «...». Mostra sempre file o funzioni complete.
3. APPROCCIO ITERATIVO: micro-funzionalità testabili; non passare oltre finché la precedente non è stabile.
4. CHIEDI PER CHIARIRE se mancano informazioni fondamentali.
5. SPIEGAZIONI ACCESSIBILI.

Struttura delle risposte complesse: 🧠 Analisi e Ragionamento · 🗺️ Piano d'Azione · 💻 Codice · 🧪 Istruzioni di Test · 🛑 Regola d'oro (segnalami se stai per violare un vincolo o una regola precedente).

**Come lavoriamo ora:** io NON testo le versioni intermedie. Tu sviluppi e provi tutto quello che puoi (test automatici in un browser simulato) e io provo solo la versione finale con tutte le funzioni sul mio telefono Android. Ho solo un telefono Android, nessun computer.

## L'app

«Le Mie Note» v2.3.0: app personale per note, liste, promemoria, note vocali, strumenti. JavaScript semplice (nessun framework, nessun bundler), PWA + Android tramite Capacitor 7 (`appId it.francesco.lemienote`). Dati in IndexedDB (`mie-note`, versione 2, archivi `notes`, `meta`, `docs`). Funziona offline. **I miei dati devono restare solo sul mio telefono**: nessun invio in rete, nessuna CDN a runtime, tutte le librerie sono dentro l'app.

File principali: `index.html` (carica in ordine db, crypto, export, analysis, audio, drag_drop, tools, docs, app), `app.js` (interfaccia principale, helper `h`, `I`, `ibtn`, `toast`, `openSheet`, `pushLayer`/`back` per il tasto Indietro di Android), `db.js`, `docs.js`, `tools.js`, `export.js` (esporta note in PDF/DOCX scritti a mano), `sw.js` (service worker, cache `le-mie-note-v7`), `scripts/build-www.js` (copia l'app e `vendor/` in `www/`).

## Cosa voglio costruire

Una sezione **Documenti** (voce nel menu laterale) che funzioni come un mini Office + Adobe: creare, leggere e modificare **PDF, Word (.docx) ed Excel (.xlsx)**, e convertire note → documento e documento → note. Priorità: **1) PDF, 2) Word, 3) Excel**. Del PDF mi servono TUTTE le funzioni: leggere, evidenziare, disegnare, firmare, aggiungere testo nuovo, compilare moduli, unire/dividere/ruotare/riordinare pagine, correggere testo esistente (metodo «copri e riscrivi», onesto sul limite: non si può riflusso del testo come Acrobat). Non mi importa il peso dell'app.

## Stato attuale (tutto verificato con test)

**Fatto e funzionante:**
- Passo 0: repository GitHub privato `DiamondF212/le-mie-note` (ramo `main`) con la mia app; costruzione automatica dell'APK con GitHub Actions.
- Passo 1: sezione Documenti con archivio locale (importa PDF/Word/Excel con riconoscimento dai primi byte, rinomina, esporta identico all'originale, elimina con conferma, filtro per tipo, nomi unici «Nome (2)»). Migrazione database v1→v2 solo additiva (le note esistenti non si toccano). Registro editor: `N.docs.register(tipo, { open(doc, api), create(api) })`. `api` offre: `lib(nome)`, `save(doc)`, `exportFile(doc)`, `screen(titolo,{onClose})`, `toast`, `h`, `I`, `ibtn`, `openSheet`, `back`, `saveAsNote(titolo, testo)`, `fmtSize`, `fileName`, `uniqueName`, `TYPES`. Aprire un tipo senza editor mostra «editor non ancora disponibile».
- Librerie in `vendor/` (versioni fisse, vedi `vendor/VERSIONI.txt`): pdf.js 3.11.174 (`vendor/pdfjs/pdf.min.js`, `pdf.worker.min.js`, `cmaps/`, `standard_fonts/`), pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, mammoth 1.8.0, ExcelJS 4.4.0 (scelta al posto di SheetJS per le vulnerabilità note). Caricate su richiesta con `api.lib('pdfjs'|'pdflib'|'mammoth'|'exceljs')`.
- Test: 59 unitari e 64 end-to-end (Playwright) tutti superati. Comandi: `npm run test:unit`, `npm run test:e2e`. In sandbox: `NODE_PATH=/opt/node22/lib/node_modules node tests/docs.e2e.test.js`.
- APK: GitHub Actions (`.github/workflows/build.yml`) esegue i test e costruisce un APK debug scaricabile da Actions → ultima esecuzione → artefatto `le-mie-note-apk`. È firmato con una **chiave fissa** (`signing/debug.keystore`, alias `androiddebugkey`, password `android`), così gli aggiornamenti si installano sopra la versione esistente senza perdere le note. Non cambiare mai quella chiave. Prima di aggiornamenti importanti: backup dall'esportazione dell'app.
- `.github/workflows/vendor.yml` (avvio manuale) riscarica le librerie in `vendor/` e le salva nel repository.

**In lavorazione (NON ancora collegato, NON testato): `wip/pdf_view.js`** — lettore PDF scritto per intero: pagine scorrevoli disegnate solo quando servono (e liberate quando lontane), zoom con pulsanti, pizzico e doppio tocco, ricerca nel testo senza distinzione di maiuscole e accenti con evidenziazione e navigazione tra i risultati, indicatore «pagina / totale» (tocca per saltare), password dei PDF protetti, ricorda l'ultima pagina e lo zoom (chiave meta `pdfpos:<id>`), menu «Vai a pagina / Salva il testo come nota / Esporta». Ogni pagina ha già un livello `.pdf-hl` sopra la canvas per le annotazioni future. Per attivarlo:
1. Spostare `wip/pdf_view.js` nella cartella principale e aggiungere `<script src="pdf_view.js"></script>` in `index.html` dopo `docs.js`.
2. In `sw.js` aggiungere `./pdf_view.js` agli ASSETS e portare la cache a `le-mie-note-v7`.
3. Aggiungere in `app.css` gli stili mancanti: `.pdf-body` (padding 0, overflow auto, `touch-action: pan-x pan-y`, sfondo scuro), `.pdf-pages` (flex colonna, gap 10px, `width: max-content; min-width: 100%`, `position: relative`), `.pdf-page` (position relative, bianco, ombra, `flex: none`) con `canvas` assoluta a 100%, `.pdf-hl` (assoluto a tutta pagina, `pointer-events: none`) con `i` evidenziatore giallo semitrasparente (`transform-origin: 0 100%`) e `i.cur` arancione, `.pdf-pill` (assoluto in basso al centro), `.pdf-search` (nascosta, `display: flex` con classe `.on`), `.pdf-count`, `.pdf-status`.
4. Scrivere `tests/pdf.unit.test.js` (funzioni pure in `N.pdfView._logic`: fold, normQuery, buildPage, plainText, findAll, partsFor, pageAt, visibleRange, clampZoom) e `tests/pdf.e2e.test.js` (fixture PDF multipagina generati in Node con `vendor/pdf-lib.min.js`; verificare: apertura, pagine disegnate non vuote, ricerca con conteggio e salto pagina, zoom, riapertura alla stessa pagina, funzionamento offline, nessun errore in console), aggiungerli agli script di `package.json` e verificare che i test esistenti continuino a passare.

## Prossimi passi (uno alla volta, testando ogni volta)

1. Attivare e verificare il lettore PDF (sopra).
2. Annotazioni PDF (evidenziatore, disegno a mano libera, firma, testo nuovo) con pdf-lib; poi gestione pagine (unisci, dividi, ruota, riordina, elimina); poi compilazione moduli; poi correzione testo «copri e riscrivi»; creazione di PDF nuovi.
3. Word: editor di testo ricco (contentEditable), apertura .docx con mammoth, salvataggio .docx (si può estendere il writer DOCX già presente in `export.js`), esportazione in PDF.
4. Excel: griglia a celle con più fogli e formule di base con ExcelJS, apertura e salvataggio .xlsx.
5. Conversioni note ↔ documenti (le liste diventano tabelle e viceversa). `api.saveAsNote` esiste già.
6. Versione finale: APK dal GitHub Actions, io lo provo sul telefono.

## Avvertenze importanti (cose imparate)

- **Sandbox senza rete:** npm, CDN e pypi sono bloccati (403 di policy) anche dopo aver cambiato le impostazioni. GitHub funziona (repository collegato con `add_repo`, `gh` e `git push` su `main`). Per aggiungere o aggiornare librerie si usa `vendor.yml` su GitHub, non npm in locale. Il browser simulato (Playwright/Chromium) funziona.
- **Prima di scrivere sul repository fai sempre `git pull` e guarda `git log`:** un'altra sessione parallela aveva già fatto i passi 0 e 1, e una mia esecuzione duplicata di `vendor.yml` aveva cancellato `vendor/pdfjs/` (poi ripristinato nel commit `f8edcbe`). Non rilanciare `vendor.yml` senza motivo.
- Il mio account Claude è sul piano gratuito: niente attività programmate, controllo del browser o del computer.
- Nel repository, i commit devono finire con `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Cosa fare subito nella nuova conversazione

Leggi lo zip allegato, conferma di aver capito, poi parti dal punto «Attivare e verificare il lettore PDF», seguendo il formato di risposta sopra. Collegati al repository `DiamondF212/le-mie-note` se hai accesso a GitHub; altrimenti lavora sullo zip e dimmi come riportare le modifiche.
