/* Strumenti — utility quotidiane, tutte offline:
   convertitore di unità, sconti e prezzi, cronometro / conto alla rovescia, appunti al volo.
   La logica pura (conversioni, calcoli, formati) è separata dall'interfaccia, così si può testare da sola. */
(function (N) {
  'use strict';

  /* =====================================================================
     1) LOGICA PURA
     ===================================================================== */

  // Ogni categoria: unità con fattore verso l'unità base (la temperatura ha formule a parte).
  const UNITS = {
    length: {
      label: 'Lunghezza', def: ['m', 'ft'],
      u: { m: ['metri (m)', 1], km: ['chilometri (km)', 1000], cm: ['centimetri (cm)', 0.01], mm: ['millimetri (mm)', 0.001], mi: ['miglia (mi)', 1609.344], yd: ['iarde (yd)', 0.9144], ft: ['piedi (ft)', 0.3048], in: ['pollici (in)', 0.0254], nmi: ['miglia nautiche (nmi)', 1852] }
    },
    mass: {
      label: 'Peso', def: ['kg', 'lb'],
      u: { kg: ['chilogrammi (kg)', 1], g: ['grammi (g)', 0.001], mg: ['milligrammi (mg)', 1e-6], t: ['tonnellate (t)', 1000], lb: ['libbre (lb)', 0.45359237], oz: ['once (oz)', 0.028349523125], st: ['stone (st)', 6.35029318] }
    },
    temp: {
      label: 'Temperatura', def: ['C', 'F'],
      u: { C: ['gradi Celsius (°C)'], F: ['gradi Fahrenheit (°F)'], K: ['Kelvin (K)'] }
    },
    volume: {
      label: 'Volume', def: ['l', 'gal'],
      u: { l: ['litri (l)', 1], ml: ['millilitri (ml)', 0.001], m3: ['metri cubi (m³)', 1000], gal: ['galloni USA (gal)', 3.785411784], qt: ['quarti USA (qt)', 0.946352946], cup: ['tazze USA (cup)', 0.2365882365], floz: ['once liquide USA (fl oz)', 0.0295735295625], tbsp: ['cucchiai (tbsp)', 0.01478676478125], tsp: ['cucchiaini (tsp)', 0.00492892159375] }
    },
    area: {
      label: 'Area', def: ['m2', 'ft2'],
      u: { m2: ['metri quadri (m²)', 1], km2: ['chilometri quadri (km²)', 1e6], ha: ['ettari (ha)', 1e4], cm2: ['centimetri quadri (cm²)', 1e-4], ft2: ['piedi quadri (ft²)', 0.09290304], in2: ['pollici quadri (in²)', 0.00064516], ac: ['acri (ac)', 4046.8564224], mi2: ['miglia quadre (mi²)', 2589988.110336] }
    },
    speed: {
      label: 'Velocità', def: ['kmh', 'mph'],
      u: { ms: ['metri al secondo (m/s)', 1], kmh: ['chilometri orari (km/h)', 1 / 3.6], mph: ['miglia orarie (mph)', 0.44704], kn: ['nodi (kn)', 1852 / 3600] }
    },
    time: {
      label: 'Tempo', def: ['h', 'min'],
      u: { s: ['secondi (s)', 1], min: ['minuti (min)', 60], h: ['ore (h)', 3600], d: ['giorni', 86400], w: ['settimane', 604800] }
    },
    data: {
      label: 'Dati', def: ['MB', 'KB'],
      u: { B: ['byte (B)', 1], KB: ['kilobyte (KB)', 1e3], MB: ['megabyte (MB)', 1e6], GB: ['gigabyte (GB)', 1e9], TB: ['terabyte (TB)', 1e12], KiB: ['kibibyte (KiB)', 1024], MiB: ['mebibyte (MiB)', 1048576], GiB: ['gibibyte (GiB)', 1073741824] }
    },
    pressure: {
      label: 'Pressione', def: ['bar', 'psi'],
      u: { Pa: ['pascal (Pa)', 1], kPa: ['kilopascal (kPa)', 1e3], bar: ['bar', 1e5], atm: ['atmosfere (atm)', 101325], psi: ['psi', 6894.757293168], mmHg: ['mmHg', 133.322387415] }
    }
  };

  /** Converte `value` da `from` a `to` nella categoria `cat`. Restituisce NaN se i dati non sono validi. */
  function convert(cat, value, from, to) {
    const c = UNITS[cat];
    if (!c || typeof value !== 'number' || !isFinite(value) || !c.u[from] || !c.u[to]) return NaN;
    if (cat === 'temp') {
      const k = from === 'C' ? value + 273.15 : from === 'F' ? (value - 32) * 5 / 9 + 273.15 : value;
      if (k < -1e-9) return NaN; // sotto lo zero assoluto
      return to === 'C' ? k - 273.15 : to === 'F' ? (k - 273.15) * 9 / 5 + 32 : k;
    }
    return value * c.u[from][1] / c.u[to][1];
  }

  /** Interpreta un numero scritto all'italiana ("1.234,5") o all'inglese ("1234.5"). null se vuoto/non valido. */
  function parseNum(s) {
    s = String(s == null ? '' : s).trim().replace(/\s+/g, '').replace(/[−–]/g, '-');
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) {
      // l'ultimo separatore è quello decimale
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) s = s.replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  /** Formatta un numero in modo leggibile (italiano), senza rumore da virgola mobile. */
  function fmtNum(x, maxDec) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    if (x === 0 || Object.is(x, -0)) return '0';
    const a = Math.abs(x);
    if (a >= 1e15 || a < 1e-9) return x.toExponential(4).replace('.', ',').replace(/,?0+e/, 'e');
    const r = Number(x.toPrecision(10));
    return r.toLocaleString('it-IT', { maximumFractionDigits: maxDec == null ? 10 : maxDec, useGrouping: a >= 10000 });
  }

  /** Sconto: prezzo in euro, sconto % ed eventuale secondo sconto % (a cascata). Lavora in centesimi. */
  function discount(price, pct1, pct2) {
    pct2 = pct2 == null ? 0 : pct2;
    if (typeof price !== 'number' || !isFinite(price) || price < 0) return { error: 'Inserisci un prezzo valido (zero o più).' };
    for (const p of [pct1, pct2]) {
      if (typeof p !== 'number' || !isFinite(p)) return { error: 'Inserisci una percentuale valida.' };
      if (p < 0) return { error: 'Lo sconto non può essere negativo.' };
      if (p > 100) return { error: 'Lo sconto non può superare il 100%.' };
    }
    const priceC = Math.round(price * 100);
    const finalC = Math.round(priceC * (1 - pct1 / 100) * (1 - pct2 / 100));
    const saveC = priceC - finalC;
    return { price: priceC / 100, final: finalC / 100, saved: saveC / 100, effective: priceC ? (saveC / priceC) * 100 : 0 };
  }

  /** Converte un numero scritto in base `from` (2–36) nella base `to` (2–36). Gestisce segno, parte
      frazionaria e numeri enormi (BigInt). Restituisce { text, truncated } oppure { empty } o { error }. */
  function convertBase(str, from, to, maxFrac) {
    maxFrac = maxFrac == null ? 12 : maxFrac;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2 || from > 36 || to < 2 || to > 36) return { error: 'La base deve essere tra 2 e 36.' };
    let s = String(str == null ? '' : str).trim().replace(/[\s_']/g, '');
    if (!s) return { empty: true };
    if (s.length > 2000) return { error: 'Numero troppo lungo.' };
    let neg = false;
    if (s[0] === '-' || s[0] === '−') { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    const pre = { 2: /^0b/i, 8: /^0o/i, 16: /^0x/i }[from];
    if (pre) s = s.replace(pre, '');
    s = s.replace(',', '.');
    const parts = s.split('.');
    if (parts.length > 2) return { error: 'Troppi separatori decimali.' };
    const ip = parts[0], fp = parts[1] || '';
    if (!ip && !fp) return { error: 'Scrivi un numero.' };
    const B = BigInt(from);
    const dig = (c) => { const v = parseInt(c, 36); return /^[0-9a-z]$/i.test(c) ? v : -1; };
    let ival = 0n, fnum = 0n, fden = 1n;
    for (const c of ip) { const d = dig(c); if (d < 0 || d >= from) return { error: 'La cifra «' + c.toUpperCase() + '» non esiste in base ' + from + '.' }; ival = ival * B + BigInt(d); }
    for (const c of fp) { const d = dig(c); if (d < 0 || d >= from) return { error: 'La cifra «' + c.toUpperCase() + '» non esiste in base ' + from + '.' }; fnum = fnum * B + BigInt(d); fden *= B; }
    let out = ival.toString(to).toUpperCase(), truncated = false, digits = '';
    const T = BigInt(to);
    while (fnum !== 0n && digits.length < maxFrac) { fnum *= T; digits += (fnum / fden).toString(to); fnum %= fden; }
    if (fnum !== 0n) truncated = true;
    digits = digits.toUpperCase();
    if (digits) out += ',' + digits;
    if (neg && (ival !== 0n || digits)) out = '-' + out;
    return { text: out, truncated };
  }

  const eur = (x) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(x);

  /** Millisecondi → "mm:ss,cc" (o "h:mm:ss,cc"). Con cs=false niente centesimi. */
  function fmtClock(ms, cs) {
    ms = Math.max(0, Math.floor(ms));
    const tot = Math.floor(ms / 1000), h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
    const p = (v) => String(v).padStart(2, '0');
    let out = (h ? h + ':' + p(m) : p(m)) + ':' + p(s);
    if (cs) out += ',' + p(Math.floor((ms % 1000) / 10));
    return out;
  }

  /** Minuti + secondi (anche oltre 59) → secondi totali; null se non validi o zero. */
  function toSeconds(min, sec) {
    const m = min == null ? 0 : min, s = sec == null ? 0 : sec;
    if (!isFinite(m) || !isFinite(s) || m < 0 || s < 0) return null;
    const t = Math.round(m * 60 + s);
    return t > 0 && t <= 359999 ? t : null;
  }

  /* =====================================================================
     2) PERSISTENZA LEGGERA (localStorage, con ripiego in memoria)
     ===================================================================== */
  const mem = {};
  const store = {
    get(k, def) {
      try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) { /* non disponibile */ }
      return k in mem ? mem[k] : def;
    },
    set(k, v) {
      mem[k] = v;
      try { localStorage.setItem(k, v); } catch (e) { /* pieno o bloccato: resta in memoria */ }
    },
    getJSON(k, def) { try { const v = JSON.parse(store.get(k, 'null')); return v == null ? def : v; } catch (e) { return def; } },
    setJSON(k, v) { store.set(k, JSON.stringify(v)); }
  };
  const K = { tab: 'lmn.tools.tab', unit: 'lmn.tools.unit', disc: 'lmn.tools.disc', sw: 'lmn.tools.sw', cd: 'lmn.tools.cd', pad: 'lmn.tools.pad' };

  /* =====================================================================
     3) STATO DI CRONOMETRO E CONTO ALLA ROVESCIA
        Resta vivo anche a pannello chiuso: si basa su orari assoluti,
        quindi non perde tempo in background né dopo un ricaricamento.
     ===================================================================== */
  const sw = Object.assign({ running: false, start: 0, acc: 0, laps: [] }, store.getJSON(K.sw, {}));
  const cd = Object.assign({ state: 'idle', total: 300, end: 0, left: 0, native: false }, store.getJSON(K.cd, {}));
  const saveSw = () => store.setJSON(K.sw, sw);
  const saveCd = () => store.setJSON(K.cd, cd);
  const swElapsed = () => sw.acc + (sw.running ? Date.now() - sw.start : 0);
  const cdLeft = () => (cd.state === 'running' ? Math.max(0, cd.end - Date.now()) : cd.state === 'paused' ? cd.left : cd.state === 'done' ? 0 : cd.total * 1000);

  let ctx = null;          // funzioni dell'app (h, I, openSheet, toast, notify, saveAsNote)
  let ui = null;           // riferimenti all'interfaccia aperta (null se il pannello è chiuso)
  let ticker = null;
  let audioCtx = null;
  let alarmEl = null;

  function ensureAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* senza audio si va avanti */ }
  }
  function beeps(n) {
    try {
      if (!audioCtx) return;
      for (let i = 0; i < n; i++) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.42;
        o.type = 'sine'; o.frequency.value = i % 3 === 2 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t); o.stop(t + 0.32);
      }
    } catch (e) { /* ignora */ }
  }

  function dismissAlarm() {
    if (alarmEl) { alarmEl.remove(); alarmEl = null; }
  }

  /* --- Background ------------------------------------------------------
     Nell'app Android (Capacitor) la fine del conto alla rovescia viene programmata come
     notifica di sistema: suona anche con schermo spento e app chiusa. Nel browser/PWA il
     tempo è calcolato su orari assoluti e il controllo gira in un Web Worker (che il browser
     rallenta molto meno delle pagine in secondo piano). */
  const NOTIF_ID = 7101;
  const nativeLN = () => { try { const C = window.Capacitor; if (C && C.isNativePlatform && C.isNativePlatform()) return (C.Plugins && C.Plugins.LocalNotifications) || null; } catch (e) { /* ignora */ } return null; };
  async function nativeSchedule(endTs) {
    const LN = nativeLN();
    if (!LN) return false;
    try {
      let p = await LN.checkPermissions();
      if (p.display !== 'granted') p = await LN.requestPermissions();
      if (p.display !== 'granted') return false;
      try { await LN.createChannel({ id: 'lmn-timer', name: 'Timer', description: 'Avviso di fine conto alla rovescia', importance: 5, visibility: 1, vibration: true }); } catch (e) { /* canale già esistente */ }
      await LN.cancel({ notifications: [{ id: NOTIF_ID }] });
      await LN.schedule({ notifications: [{ id: NOTIF_ID, title: 'Tempo scaduto', body: 'Il conto alla rovescia di ' + fmtClock(cd.total * 1000) + ' è terminato.', channelId: 'lmn-timer', schedule: { at: new Date(endTs), allowWhileIdle: true }, extra: { tool: 'countdown' } }] });
      return true;
    } catch (e) { console.warn('Notifica programmata non riuscita', e); return false; }
  }
  async function nativeCancel() {
    cd.native = false;
    const LN = nativeLN();
    if (!LN) return;
    try { await LN.cancel({ notifications: [{ id: NOTIF_ID }] }); } catch (e) { /* ignora */ }
  }
  /** Da chiamare ogni volta che il conto alla rovescia parte o riprende. */
  function armBackground() {
    nativeSchedule(cd.end).then((ok) => { if (cd.state === 'running') { cd.native = ok; saveCd(); } else if (ok) nativeCancel(); });
    try { if ('Notification' in window && Notification.permission === 'default' && !nativeLN()) Notification.requestPermission().catch(() => {}); } catch (e) { /* ignora */ }
  }

  function finishCountdown() {
    if (cd.state !== 'running') return;
    const handledByOS = !!cd.native;
    cd.state = 'done'; cd.left = 0; cd.native = false; saveCd();
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch (e) { /* ignora */ }
    beeps(9);
    if (!handledByOS && ctx && ctx.notify) { try { ctx.notify('Tempo scaduto', 'Il conto alla rovescia è terminato', 'tools-countdown'); } catch (e) { /* ignora */ } }
    if (ctx && (!ui || ui.cur !== 'time')) showAlarmOverlay();
    paint();
  }

  function showAlarmOverlay() {
    if (alarmEl) return;
    const h = ctx.h;
    alarmEl = h('div', { class: 'tools-alarm', role: 'alertdialog', 'aria-label': 'Tempo scaduto' },
      h('div', { class: 'tools-alarm-box' },
        h('div', { class: 'tools-alarm-ic', html: ctx.I('bell', 44) }),
        h('strong', null, 'Tempo scaduto!'),
        h('span', null, 'Il conto alla rovescia di ' + fmtClock(cd.total * 1000) + ' è terminato.'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn', onclick: () => { dismissAlarm(); } }, 'Chiudi'),
          h('button', { class: 'btn pri', onclick: () => { dismissAlarm(); open('time', 'cd'); } }, 'Apri il timer'))));
    document.body.append(alarmEl);
  }

  function tick() {
    if (cd.state === 'running' && cdLeft() <= 0) finishCountdown();
    paint();
    if (!ui && !sw.running && cd.state !== 'running') stopTicker();
  }
  let worker = null;
  function ensureTicker() {
    if (!ticker) ticker = setInterval(tick, 50);
    if (!worker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try {
        const src = 'let t=null;onmessage=function(e){if(e.data==="start"){if(!t)t=setInterval(function(){postMessage(1)},250)}else{clearInterval(t);t=null}}';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = tick;
        worker.onerror = () => { try { worker.terminate(); } catch (e) { /* ignora */ } worker = null; };
      } catch (e) { worker = null; }
    }
    if (worker) worker.postMessage('start');
  }
  function stopTicker() {
    clearInterval(ticker); ticker = null;
    if (worker) { try { worker.postMessage('stop'); } catch (e) { /* ignora */ } }
  }

  /* =====================================================================
     4) INTERFACCIA
     ===================================================================== */
  function open(tab, mode) {
    if (!ctx) return;
    if (mode) store.set('lmn.tools.mode', mode);
    if (ui) { // già aperto: porta in primo piano la scheda richiesta
      if (tab) ui.select(tab);
      if (mode && ui.refs.time) ui.refs.time.setMode(mode);
      return;
    }
    dismissAlarm();
    const { h, I } = ctx;
    const root = h('div', { class: 'tools' });
    const tabs = [
      ['unit', 'Unità', 'ruler', buildUnits],
      ['disc', 'Sconti', 'percent', buildDiscount],
      ['time', 'Timer', 'timer', buildTime],
      ['pad', 'Appunti', 'pad', buildPad]
    ];
    const body = h('div', { class: 'tools-body' });
    const tabBar = h('div', { class: 'tools-tabs', role: 'tablist' });
    const panes = {};
    let cur = null;
    const select = (id) => {
      cur = id; if (ui) ui.cur = id;
      store.set(K.tab, id);
      tabs.forEach(([tid]) => {
        const b = tabBar.querySelector('[data-tab="' + tid + '"]');
        b.classList.toggle('on', tid === id);
        b.setAttribute('aria-selected', tid === id ? 'true' : 'false');
        panes[tid].classList.toggle('hidden', tid !== id);
      });
      paint();
    };
    tabs.forEach(([id, label, icon, builder]) => {
      tabBar.append(h('button', { class: 'tools-tab', role: 'tab', 'data-tab': id, onclick: () => select(id) }, h('span', { html: I(icon, 22) }), h('span', null, label)));
      panes[id] = h('section', { class: 'tools-pane hidden', role: 'tabpanel', 'data-pane': id });
      body.append(panes[id]);
    });
    root.append(tabBar, body);

    ui = { root, panes, select, refs: {}, flushPad: null };
    tabs.forEach(([id, , , builder]) => builder(panes[id], ui));

    const sheet = ctx.openSheet('Strumenti', root, {
      onClose: () => {
        if (ui && ui.flushPad) ui.flushPad();
        if (ui && ui.cleanup) ui.cleanup();
        ui = null;
        tick();
      }
    });
    sheet.el.classList.add('tools-sheet');
    ui.sheet = sheet;
    const saved = store.get(K.tab, 'unit');
    select(tab || (tabs.some((t) => t[0] === saved) ? saved : 'unit'));
    ensureTicker();
  }

  // ---------- 4.1 Convertitore ----------
  function buildUnits(pane, U) {
    const { h } = ctx;
    const st = Object.assign({ cat: 'length', val: '1', from: {}, to: {} }, store.getJSON(K.unit, {}));
    st.base = Object.assign({ val: '255', from: 10, to: 2 }, st.base || {});
    if (!UNITS[st.cat] && st.cat !== 'base') st.cat = 'length';
    const defs = () => {
      const c = UNITS[st.cat];
      if (!c.u[st.from[st.cat]]) st.from[st.cat] = c.def[0];
      if (!c.u[st.to[st.cat]]) st.to[st.cat] = c.def[1];
    };

    const chips = h('div', { class: 'tools-chips', role: 'group', 'aria-label': 'Categoria' });
    const input = h('input', { class: 'field tools-num', id: 'tools-unit-in', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Valore', 'aria-label': 'Valore da convertire', value: st.val });
    const out = h('input', { class: 'field tools-num tools-res', id: 'tools-unit-out', type: 'text', readonly: true, 'aria-label': 'Risultato' });
    const selFrom = h('select', { class: 'field', id: 'tools-unit-from', 'aria-label': 'Converti da' });
    const selTo = h('select', { class: 'field', id: 'tools-unit-to', 'aria-label': 'Converti in' });
    const note = h('p', { class: 'hint tools-note', id: 'tools-unit-note' });
    const copyBtn = h('button', { class: 'btn', id: 'tools-unit-copy', onclick: async () => {
      if (!out.value || out.value === '—') return;
      try { await navigator.clipboard.writeText(out.value); ctx.toast('Risultato copiato'); } catch (e) { out.select(); ctx.toast('Selezionato: copialo manualmente'); }
    } }, 'Copia risultato');
    const swap = h('button', { class: 'ibtn tools-swap', id: 'tools-unit-swap', 'aria-label': 'Inverti unità', title: 'Inverti unità', html: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M7 4v15M7 19l-3-3M7 19l3-3M17 20V5M17 5l-3 3M17 5l3 3"/></svg>', onclick: () => {
      const f = st.from[st.cat], t = st.to[st.cat];
      const r = parseNum(input.value);
      const res = r == null ? NaN : convert(st.cat, r, f, t);
      st.from[st.cat] = t; st.to[st.cat] = f;
      if (isFinite(res)) input.value = fmtForInput(res);
      fill(); calc();
    } });

    const fmtForInput = (x) => String(Number(x.toPrecision(10))).replace('.', ',');

    function fill() {
      defs();
      const c = UNITS[st.cat];
      [selFrom, selTo].forEach((s) => (s.innerHTML = ''));
      Object.entries(c.u).forEach(([k, v]) => {
        selFrom.append(h('option', { value: k }, v[0]));
        selTo.append(h('option', { value: k }, v[0]));
      });
      selFrom.value = st.from[st.cat]; selTo.value = st.to[st.cat];
      chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.cat === st.cat));
    }
    function calc() {
      st.val = input.value;
      const f = selFrom.value, t = selTo.value;
      st.from[st.cat] = f; st.to[st.cat] = t;
      store.setJSON(K.unit, st);
      const v = parseNum(input.value);
      if (input.value.trim() === '') { out.value = ''; note.textContent = 'Scrivi un numero per convertirlo.'; return; }
      if (v == null) { out.value = '—'; note.textContent = 'Valore non valido.'; return; }
      const r = convert(st.cat, v, f, t);
      if (!isFinite(r)) { out.value = '—'; note.textContent = st.cat === 'temp' ? 'Temperatura sotto lo zero assoluto: non valida.' : 'Conversione non possibile.'; return; }
      out.value = fmtNum(r);
      const one = convert(st.cat, 1, f, t);
      const short = (k) => UNITS[st.cat].u[k][0].replace(/^.*\(([^)]+)\)$/, '$1').replace(/^gradi\s+/, '');
      note.textContent = '1 ' + short(f) + ' = ' + fmtNum(one, 8) + ' ' + short(t);
    }

    const setCat = (k) => {
      st.cat = k;
      convBox.classList.toggle('hidden', k === 'base');
      baseBox.classList.toggle('hidden', k !== 'base');
      if (k === 'base') { chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.cat === k)); calcBase(); }
      else { fill(); calc(); }
    };
    Object.entries(UNITS).forEach(([k, c]) => chips.append(h('button', { class: 'chip', 'data-cat': k, onclick: () => setCat(k) }, c.label)));
    chips.append(h('button', { class: 'chip', 'data-cat': 'base', onclick: () => setCat('base') }, 'Basi numeriche'));

    /* --- basi numeriche (binario, ottale, decimale, esadecimale e ogni base da 2 a 36) --- */
    const baseName = (n) => ({ 2: 'Binario (base 2)', 8: 'Ottale (base 8)', 10: 'Decimale (base 10)', 16: 'Esadecimale (base 16)' }[n] || 'Base ' + n);
    const baseSel = (id, label, val) => { const e = h('select', { class: 'field', id, 'aria-label': label }); for (let b = 2; b <= 36; b++) e.append(h('option', { value: b }, baseName(b))); e.value = String(val); return e; };
    const bIn = h('input', { class: 'field tools-num tools-mono', id: 'tools-base-in', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Numero', 'aria-label': 'Numero da convertire', value: st.base.val });
    const bOut = h('input', { class: 'field tools-num tools-mono tools-res', id: 'tools-base-out', type: 'text', readonly: true, 'aria-label': 'Risultato' });
    const bFrom = baseSel('tools-base-from', 'Dalla base', st.base.from), bTo = baseSel('tools-base-to', 'Alla base', st.base.to);
    const bNote = h('p', { class: 'hint tools-note', id: 'tools-base-note' });
    const bTable = h('div', { class: 'tools-basetable', id: 'tools-base-table' });
    const bSwap = h('button', { class: 'ibtn tools-swap', id: 'tools-base-swap', 'aria-label': 'Inverti basi', title: 'Inverti basi', html: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M7 4v15M7 19l-3-3M7 19l3-3M17 20V5M17 5l-3 3M17 5l3 3"/></svg>', onclick: () => {
      const r = convertBase(bIn.value, Number(bFrom.value), Number(bTo.value), 40);
      const f = bFrom.value; bFrom.value = bTo.value; bTo.value = f;
      if (r.text && !r.truncated) bIn.value = r.text;
      calcBase();
    } });
    function calcBase() {
      const f = Number(bFrom.value), t = Number(bTo.value);
      st.base = { val: bIn.value, from: f, to: t }; store.setJSON(K.unit, st);
      bNote.classList.remove('bad'); bTable.innerHTML = '';
      const r = convertBase(bIn.value, f, t);
      if (r.empty) { bOut.value = ''; bNote.textContent = 'Scrivi un numero (anche negativo o con la virgola).'; return; }
      if (r.error) { bOut.value = '—'; bNote.textContent = r.error; bNote.classList.add('bad'); return; }
      bOut.value = r.text;
      bNote.textContent = r.truncated ? 'Risultato approssimato (prime 12 cifre dopo la virgola).' : baseName(f).replace(/ \(.*/, '') + ' → ' + baseName(t).replace(/ \(.*/, '');
      [[2, 'BIN'], [8, 'OCT'], [10, 'DEC'], [16, 'HEX']].forEach(([b, l]) => {
        const v = convertBase(bIn.value, f, b);
        bTable.append(h('button', { class: 'tools-baserow', 'data-base': b, 'aria-label': 'Copia ' + l, onclick: async () => { try { await navigator.clipboard.writeText(v.text); ctx.toast(l + ' copiato'); } catch (e) { ctx.toast('Copia non disponibile'); } } },
          h('b', null, l), h('span', null, v.text + (v.truncated ? '…' : ''))));
      });
    }
    bIn.addEventListener('input', calcBase); bFrom.addEventListener('change', calcBase); bTo.addEventListener('change', calcBase);
    const baseBox = h('div', { class: 'tools-basebox hidden' },
      h('div', { class: 'tools-conv' },
        h('div', { class: 'tools-line' }, h('label', { class: 'tools-lbl', for: 'tools-base-in' }, 'Da'), bIn, bFrom),
        h('div', { class: 'tools-swaprow' }, bSwap),
        h('div', { class: 'tools-line' }, h('label', { class: 'tools-lbl', for: 'tools-base-out' }, 'A'), bOut, bTo)),
      bNote, bTable);
    input.addEventListener('input', calc);
    selFrom.addEventListener('change', calc);
    selTo.addEventListener('change', calc);

    const convBox = h('div', { class: 'tools-convbox' },
      h('div', { class: 'tools-conv' },
        h('div', { class: 'tools-line' }, h('label', { class: 'tools-lbl', for: 'tools-unit-in' }, 'Da'), input, selFrom),
        h('div', { class: 'tools-swaprow' }, swap),
        h('div', { class: 'tools-line' }, h('label', { class: 'tools-lbl', for: 'tools-unit-out' }, 'A'), out, selTo)),
      note,
      h('div', { class: 'btns' }, copyBtn));
    pane.append(chips, convBox, baseBox);
    setCat(st.cat);
  }

  // ---------- 4.2 Sconti ----------
  function buildDiscount(pane) {
    const { h } = ctx;
    const st = Object.assign({ price: '', p1: '', p2: '' }, store.getJSON(K.disc, {}));
    const price = h('input', { class: 'field tools-num', id: 'tools-price', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Prezzo iniziale in euro', value: st.price });
    const p1 = h('input', { class: 'field tools-num', id: 'tools-pct1', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': 'Percentuale di sconto', value: st.p1 });
    const p2 = h('input', { class: 'field tools-num', id: 'tools-pct2', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': 'Ulteriore sconto in percentuale (facoltativo)', value: st.p2 });
    const err = h('div', { class: 'err tools-err', id: 'tools-disc-err', role: 'alert' });
    const final = h('strong', { class: 'tools-big', id: 'tools-final' }, '—');
    const saved = h('strong', { class: 'tools-save', id: 'tools-saved' }, '—');
    const eff = h('small', { id: 'tools-eff' }, '');
    const orig = h('span', { id: 'tools-orig' }, '—');

    function calc() {
      st.price = price.value; st.p1 = p1.value; st.p2 = p2.value;
      store.setJSON(K.disc, st);
      err.textContent = '';
      const pr = parseNum(price.value);
      if (pr == null || (p1.value.trim() === '' && p2.value.trim() === '' )) {
        if (price.value.trim() !== '' && pr == null) err.textContent = 'Inserisci un prezzo valido (zero o più).';
        // senza percentuale: prezzo invariato
        if (pr != null && pr >= 0) { final.textContent = eur(pr); saved.textContent = eur(0); orig.textContent = eur(pr); eff.textContent = 'Inserisci una percentuale di sconto.'; return; }
        final.textContent = '—'; saved.textContent = '—'; orig.textContent = '—'; eff.textContent = ''; return;
      }
      const a = p1.value.trim() === '' ? 0 : parseNum(p1.value);
      const b = p2.value.trim() === '' ? 0 : parseNum(p2.value);
      const r = discount(pr, a == null ? NaN : a, b == null ? NaN : b);
      if (r.error) { err.textContent = r.error; final.textContent = '—'; saved.textContent = '—'; orig.textContent = '—'; eff.textContent = ''; return; }
      final.textContent = eur(r.final);
      saved.textContent = eur(r.saved);
      orig.textContent = eur(r.price);
      eff.textContent = 'Sconto effettivo: ' + fmtNum(r.effective, 2) + '%' + (b ? ' (due sconti a cascata)' : '');
    }
    [price, p1, p2].forEach((e) => e.addEventListener('input', calc));

    const quick = h('div', { class: 'tools-chips', role: 'group', 'aria-label': 'Sconti rapidi' },
      [5, 10, 15, 20, 25, 30, 40, 50, 70].map((v) => h('button', { class: 'chip', 'data-pct': v, onclick: () => { p1.value = String(v); calc(); } }, v + '%')));

    pane.append(
      h('label', { class: 'tools-lbl2', for: 'tools-price' }, 'Prezzo iniziale (€)'), price,
      h('label', { class: 'tools-lbl2', for: 'tools-pct1' }, 'Sconto (%)'), p1,
      quick,
      h('label', { class: 'tools-lbl2', for: 'tools-pct2' }, 'Ulteriore sconto (%) — facoltativo'), p2,
      err,
      h('div', { class: 'tools-result' },
        h('div', { class: 'tools-rrow' }, h('span', null, 'Prezzo finale'), final),
        h('div', { class: 'tools-rrow' }, h('span', null, 'Risparmi'), saved),
        h('div', { class: 'tools-rrow sm' }, h('span', null, 'Prezzo iniziale'), orig),
        eff),
      h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'tools-disc-reset', onclick: () => { price.value = ''; p1.value = ''; p2.value = ''; calc(); price.focus(); } }, 'Azzera'))
    );
    calc();
  }

  // ---------- 4.3 Cronometro e conto alla rovescia ----------
  function buildTime(pane, U) {
    const { h } = ctx;
    const mode = h('div', { class: 'seg tools-mode', role: 'tablist' });
    const swBox = h('div', { class: 'tools-sw' });
    const cdBox = h('div', { class: 'tools-cd hidden' });
    let which = store.get('lmn.tools.mode', 'sw');
    const setMode = (m) => {
      which = m; store.set('lmn.tools.mode', m);
      swBox.classList.toggle('hidden', m !== 'sw');
      cdBox.classList.toggle('hidden', m !== 'cd');
      mode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      paint();
    };
    [['sw', 'Cronometro'], ['cd', 'Conto alla rovescia']].forEach(([m, l]) => mode.append(h('button', { 'data-m': m, id: 'tools-mode-' + m, onclick: () => setMode(m) }, l)));

    /* --- cronometro --- */
    const swDisp = h('div', { class: 'tools-disp', id: 'tools-sw-disp', role: 'timer', 'aria-label': 'Cronometro' }, '00:00,00');
    const swStart = h('button', { class: 'btn pri tools-b', id: 'tools-sw-start', onclick: () => {
      if (sw.running) { sw.acc += Date.now() - sw.start; sw.running = false; }
      else { sw.start = Date.now(); sw.running = true; ensureTicker(); }
      saveSw(); paint();
    } }, 'Avvio');
    const swLap = h('button', { class: 'btn tools-b', id: 'tools-sw-lap', onclick: () => {
      if (!sw.running) return;
      const t = swElapsed(), prev = sw.laps.length ? sw.laps[sw.laps.length - 1].t : 0;
      sw.laps.push({ t, d: t - prev });
      saveSw(); paint();
    } }, 'Parziale');
    const swReset = h('button', { class: 'btn tools-b', id: 'tools-sw-reset', onclick: () => {
      sw.running = false; sw.acc = 0; sw.start = 0; sw.laps = [];
      saveSw(); paint();
    } }, 'Reset');
    const lapList = h('ol', { class: 'tools-laps', id: 'tools-laps', reversed: true });
    swBox.append(swDisp, h('div', { class: 'tools-ctl' }, swReset, swLap, swStart), lapList);

    /* --- conto alla rovescia --- */
    const cdDisp = h('div', { class: 'tools-disp', id: 'tools-cd-disp', role: 'timer', 'aria-live': 'off', 'aria-label': 'Conto alla rovescia' }, '05:00');
    const bar = h('div', { class: 'tools-bar' }, h('i', { id: 'tools-cd-bar' }));
    const mi = h('input', { class: 'field tools-num', id: 'tools-cd-min', type: 'number', inputmode: 'numeric', min: 0, max: 5999, step: 1, placeholder: '0', 'aria-label': 'Minuti', value: String(Math.floor(cd.total / 60)) });
    const se = h('input', { class: 'field tools-num', id: 'tools-cd-sec', type: 'number', inputmode: 'numeric', min: 0, max: 59, step: 1, placeholder: '0', 'aria-label': 'Secondi', value: String(cd.total % 60) });
    const setRow = h('div', { class: 'tools-setrow', id: 'tools-cd-set' },
      h('label', null, h('span', null, 'Minuti'), mi), h('b', null, ':'), h('label', null, h('span', null, 'Secondi'), se));
    const presets = h('div', { class: 'tools-chips', id: 'tools-cd-presets', role: 'group', 'aria-label': 'Durate rapide' },
      [['30 s', 30], ['1 min', 60], ['3 min', 180], ['5 min', 300], ['10 min', 600], ['15 min', 900], ['30 min', 1800]].map(([l, s]) => h('button', { class: 'chip', 'data-s': s, onclick: () => { if (cd.state === 'running' || cd.state === 'paused') return; mi.value = String(Math.floor(s / 60)); se.value = String(s % 60); readInputs(); } }, l)));
    const cdErr = h('div', { class: 'err tools-err', id: 'tools-cd-err', role: 'alert' });
    function readInputs() {
      if (cd.state === 'running' || cd.state === 'paused') return;
      cdErr.textContent = '';
      const m = mi.value.trim() === '' ? 0 : Number(mi.value), s = se.value.trim() === '' ? 0 : Number(se.value);
      const t = toSeconds(m, s);
      if (t == null) { cdErr.textContent = (m === 0 && s === 0) ? 'Imposta almeno 1 secondo.' : 'Tempo non valido (massimo 99 ore).'; return; }
      cd.total = t; cd.state = 'idle'; saveCd(); paint();
    }
    mi.addEventListener('input', readInputs); se.addEventListener('input', readInputs);
    const cdStart = h('button', { class: 'btn pri tools-b', id: 'tools-cd-start', onclick: () => {
      ensureAudio();
      if (cd.state === 'running') { cd.left = cdLeft(); cd.state = 'paused'; nativeCancel(); saveCd(); paint(); return; }
      if (cd.state === 'paused') { cd.end = Date.now() + cd.left; cd.state = 'running'; saveCd(); ensureTicker(); armBackground(); paint(); return; }
      if (cd.state === 'done') { cd.state = 'idle'; saveCd(); paint(); return; }
      readInputs();
      if (cdErr.textContent) return;
      cd.end = Date.now() + cd.total * 1000; cd.state = 'running'; saveCd(); ensureTicker(); armBackground(); paint();
    } }, 'Avvio');
    const cdReset = h('button', { class: 'btn tools-b', id: 'tools-cd-reset', onclick: () => {
      cd.state = 'idle'; cd.left = 0; nativeCancel(); saveCd(); dismissAlarm(); paint();
    } }, 'Reset');
    cdBox.append(cdDisp, bar, setRow, presets, cdErr, h('div', { class: 'tools-ctl' }, cdReset, cdStart));

    pane.append(mode, swBox, cdBox);
    U.refs.time = { setMode, swDisp, swStart, swLap, swReset, lapList, cdDisp, bar, setRow, presets, cdStart, cdReset, cdBox, mi, se };
    setMode(which);
  }

  // ---------- 4.4 Appunti al volo ----------
  function buildPad(pane, U) {
    const { h } = ctx;
    const ta = h('textarea', { class: 'field tools-pad', id: 'tools-pad', placeholder: 'Scrivi qui un appunto al volo… si salva da solo su questo dispositivo.', 'aria-label': 'Appunti temporanei', spellcheck: 'true', value: store.get(K.pad, '') });
    ta.value = store.get(K.pad, '');
    const status = h('span', { class: 'tools-status', id: 'tools-pad-status' });
    const count = h('span', { id: 'tools-pad-count' });
    let timer = null, dirty = false;
    const stats = () => {
      const t = ta.value, w = (t.match(/\S+/g) || []).length;
      count.textContent = w + (w === 1 ? ' parola' : ' parole') + ' · ' + t.length + ' caratteri';
    };
    const save = () => { clearTimeout(timer); timer = null; if (!dirty) return; dirty = false; store.set(K.pad, ta.value); status.textContent = 'Salvato'; };
    ta.addEventListener('input', () => {
      dirty = true; status.textContent = 'Salvataggio…'; stats();
      clearTimeout(timer); timer = setTimeout(save, 350);
    });
    ta.addEventListener('blur', save);
    U.flushPad = save;
    window.addEventListener('pagehide', save);
    U.cleanup = () => window.removeEventListener('pagehide', save);
    const clear = h('button', { class: 'btn danger', id: 'tools-pad-clear', onclick: () => {
      if (!ta.value) return;
      if (!confirm('Svuotare gli appunti temporanei?')) return;
      ta.value = ''; dirty = true; save(); stats(); status.textContent = 'Svuotato'; ta.focus();
    } }, 'Svuota');
    const copy = h('button', { class: 'btn', id: 'tools-pad-copy', onclick: async () => {
      if (!ta.value) return ctx.toast('Non c’è niente da copiare');
      try { await navigator.clipboard.writeText(ta.value); ctx.toast('Appunti copiati'); } catch (e) { ta.select(); ctx.toast('Testo selezionato: copialo manualmente'); }
    } }, 'Copia');
    const toNote = h('button', { class: 'btn pri', id: 'tools-pad-tonote', onclick: () => {
      const t = ta.value.trim();
      if (!t) return ctx.toast('Scrivi qualcosa prima');
      save();
      if (ctx.saveAsNote && ctx.saveAsNote(t)) { ctx.toast('Salvato come nota'); }
    } }, 'Salva come nota');
    pane.append(ta, h('div', { class: 'tools-padinfo' }, count, status), h('div', { class: 'btns' }, clear, copy, toNote));
    stats();
    status.textContent = ta.value ? 'Salvato' : '';
  }

  /* ---------- aggiornamento della vista (chiamato dal ticker) ---------- */
  function paint() {
    if (!ui || !ui.refs.time) return;
    const R = ui.refs.time;
    if (!document.body.contains(R.swDisp)) return;
    // cronometro
    const el = swElapsed();
    R.swDisp.textContent = fmtClock(el, true);
    R.swStart.textContent = sw.running ? 'Pausa' : el > 0 ? 'Riprendi' : 'Avvio';
    R.swStart.classList.toggle('pri', !sw.running);
    R.swLap.disabled = !sw.running;
    R.swReset.disabled = !sw.running && el === 0 && !sw.laps.length;
    if (R.lapList.childElementCount !== sw.laps.length) {
      R.lapList.innerHTML = '';
      const ds = sw.laps.map((l) => l.d), best = Math.min(...ds), worst = Math.max(...ds);
      for (let i = sw.laps.length - 1; i >= 0; i--) {
        const l = sw.laps[i];
        const cls = sw.laps.length > 2 ? (l.d === best ? ' best' : l.d === worst ? ' worst' : '') : '';
        R.lapList.append(ctx.h('li', { class: 'tools-lap' + cls, value: i + 1 }, ctx.h('b', null, 'Parziale ' + (i + 1)), ctx.h('span', { class: 'd' }, '+' + fmtClock(l.d, true)), ctx.h('span', { class: 't' }, fmtClock(l.t, true))));
      }
    }
    // conto alla rovescia
    const left = cdLeft(), st = cd.state;
    R.cdDisp.textContent = st === 'done' ? '00:00' : fmtClock(Math.ceil(left / 1000) * 1000);
    R.cdDisp.classList.toggle('done', st === 'done');
    R.cdBox.classList.toggle('is-done', st === 'done');
    R.cdBox.classList.toggle('is-active', st === 'running' || st === 'paused');
    R.bar.firstChild.style.width = (cd.total ? Math.max(0, Math.min(100, (left / (cd.total * 1000)) * 100)) : 0) + '%';
    R.cdStart.textContent = st === 'running' ? 'Pausa' : st === 'paused' ? 'Riprendi' : st === 'done' ? 'Nuovo' : 'Avvio';
    R.cdStart.classList.toggle('pri', st !== 'running');
    R.cdReset.disabled = st === 'idle';
    R.setRow.classList.toggle('hidden', st === 'running' || st === 'paused');
    R.presets.classList.toggle('hidden', st === 'running' || st === 'paused');
  }

  /* =====================================================================
     5) API PUBBLICA
     ===================================================================== */
  function init(c) {
    ctx = c;
    // riprende un conto alla rovescia o un cronometro rimasti attivi (anche dopo un ricaricamento)
    if (cd.state === 'running' && cdLeft() <= 0) { finishCountdown(); }
    else if (cd.state === 'done' && !ui) { /* già segnalato in passato: nessun avviso al riavvio */ }
    if (sw.running || cd.state === 'running') ensureTicker();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    window.addEventListener('pageshow', tick); window.addEventListener('focus', tick);
  }

  N.tools = { init, open, _logic: { UNITS, convertBase, convert, parseNum, fmtNum, discount, fmtClock, toSeconds, eur }, _state: { sw, cd, store } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.tools;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
