/* Lettore PDF (offline) — pagine scorrevoli, zoom, ricerca nel testo, ultima pagina ricordata.
   Usa pdf.js dalla cartella vendor/. Le pagine vengono disegnate solo quando servono (vicino allo schermo)
   e liberate quando si allontanano, così anche i PDF lunghi non saturano la memoria del telefono.
   Ogni pagina ha già un livello "sopra" per le annotazioni (si aggiungono nei passi successivi). */
(function (N) {
  'use strict';

  /* =====================================================================
     1) LOGICA PURA (testabile da sola, senza browser)
     ===================================================================== */

  // Normalizza un carattere per la ricerca (maiuscole e accenti ignorati) SENZA cambiare la lunghezza del testo,
  // così le posizioni trovate coincidono con quelle del testo originale.
  function foldChar(c) {
    if (c.length !== 1) return c;
    if (c === ' ' || c === ' ') return ' ';
    const d = c.normalize('NFD').charAt(0) || c;
    const l = d.toLowerCase();
    return l.length === 1 ? l : d;
  }
  function fold(s) {
    let o = '';
    for (const c of String(s)) o += foldChar(c);
    return o;
  }
  function normQuery(q) { return fold(q).replace(/\s+/g, ' ').trim(); }

  // Testo di una pagina a partire dalle "voci" di pdf.js: stringa unica + posizione di ogni voce.
  function buildPage(items) {
    let raw = '';
    const ranges = [];
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string') continue;
      const from = raw.length;
      raw += it.str;
      ranges.push({ it, from, to: raw.length });
      if (it.hasEOL) raw += ' ';
    }
    return { raw, str: fold(raw), ranges };
  }

  // Testo semplice per una nota: una riga per ogni "a capo" del PDF.
  function plainText(items) {
    let o = '';
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string') continue;
      o += it.str;
      if (it.hasEOL) o += '\n';
    }
    return o.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function findAll(hay, needle, max) {
    const out = [];
    if (!needle) return out;
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) {
      out.push([i, i + needle.length]);
      i += needle.length;
      if (out.length >= (max || 1e9)) break;
    }
    return out;
  }

  // Quali voci di testo copre un risultato [s, e) e quale frazione di ciascuna.
  function partsFor(ranges, s, e) {
    const out = [];
    for (const r of ranges) {
      if (r.to <= r.from || r.to <= s || r.from >= e) continue;
      out.push({ item: r.it, from: Math.max(s, r.from) - r.from, to: Math.min(e, r.to) - r.from });
    }
    return out;
  }

  // Indice della pagina che contiene la posizione y (tops = bordo superiore di ogni pagina, crescente).
  function pageAt(tops, y) {
    let lo = 0, hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  // Pagine da disegnare: quelle che toccano [y0, y1].
  function visibleRange(tops, heights, y0, y1) {
    const n = tops.length;
    if (!n) return [0, -1];
    let a = pageAt(tops, y0);
    while (a < n - 1 && tops[a] + heights[a] < y0) a++;
    let b = a;
    while (b + 1 < n && tops[b + 1] <= y1) b++;
    return [a, b];
  }

  // Tratto a mano libera: toglie i punti troppo vicini (alleggerisce) e lo trasforma in un percorso SVG.
  function thinPoints(pts, minD) {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= minD) out.push([p[0], p[1]]);
    }
    return out;
  }
  function pathOf(pts, fy) {
    if (!pts || !pts.length) return '';
    const f = fy || ((y) => y), r = (v) => Math.round(v * 100) / 100;
    const q = pts.length === 1 ? [pts[0], [pts[0][0] + 0.01, pts[0][1]]] : pts; // un tocco solo = un puntino
    return q.map((p, i) => (i ? 'L' : 'M') + r(p[0]) + ' ' + r(f(p[1]))).join(' ');
  }
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return [0, 0, 0];
    const n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  const INK_TOOLS = { pen: { w: 2.2, op: 1 }, hl: { w: 14, op: 0.4 } };
  const INK_COLORS = ['#ffeb3b', '#69f0ae', '#ff80ab', '#e53935', '#1e66f5', '#111111'];

  const ZMIN = 0.5, ZMAX = 5;
  const clampZoom = (z) => Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 100) / 100));

  /* =====================================================================
     2) LETTORE
     ===================================================================== */

  const SV = {
    search: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    plus: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M5 12h14"/></svg>',
    up: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M6 14l6-6 6 6"/></svg>',
    down: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M6 10l6 6 6-6"/></svg>',
    pen: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19l-4 1z"/></svg>',
    undo: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12"/></svg>',
    x: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  async function openPdf(d, A) {
    const h = A.h;
    await A.lib('pdfjs');
    const pdfjs = window.pdfjsLib;

    // pdf.js "consuma" i dati che riceve: gliene diamo una copia, l'originale resta intatto.
    const task = pdfjs.getDocument({
      data: new Uint8Array(d.data.slice(0)),
      cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: 'vendor/pdfjs/standard_fonts/',
      isEvalSupported: false
    });
    task.onPassword = (update, reason) => {
      const wrong = reason === (pdfjs.PasswordResponses || {}).INCORRECT_PASSWORD;
      const pw = prompt(wrong ? 'Password errata. Riprova:' : 'Questo PDF è protetto da password. Inseriscila:');
      if (pw === null) task.destroy(); else update(pw);
    };
    let pdf;
    try { pdf = await task.promise; } catch (e) {
      throw new Error(e && e.name === 'PasswordException' ? 'password non inserita' : (e && e.message) || e);
    }

    const n = pdf.numPages;
    let dead = false;

    /* ---------- schermata ---------- */
    const scr = A.screen(d.name, { onClose: () => cleanup() });
    const body = scr.body;
    body.classList.add('pdf-body');
    const inner = h('div', { class: 'pdf-pages' });
    const status = h('p', { class: 'pdf-status' }, 'Apertura del PDF…');
    body.append(status);

    const pill = h('button', { class: 'pdf-pill', 'aria-label': 'Vai a una pagina', 'data-pill': '1' }, '– / ' + n);
    scr.el.append(pill);

    // barra di ricerca
    const sInput = h('input', { type: 'search', placeholder: 'Cerca nel documento', 'aria-label': 'Cerca nel documento', 'data-pdf-q': '1', enterkeyhint: 'search' });
    const sCount = h('span', { class: 'pdf-count', 'data-pdf-count': '1' }, '');
    const sBar = h('div', { class: 'pdf-search' }, sInput, sCount,
      h('button', { class: 'ibtn', 'aria-label': 'Risultato precedente', 'data-pdf-prev': '1', html: SV.up }),
      h('button', { class: 'ibtn', 'aria-label': 'Risultato successivo', 'data-pdf-next': '1', html: SV.down }),
      h('button', { class: 'ibtn', 'aria-label': 'Chiudi la ricerca', 'data-pdf-close': '1', html: SV.x }));
    scr.el.insertBefore(sBar, body);

    const btn = (svg, fn, label, attr) => h('button', Object.assign({ class: 'ibtn', 'aria-label': label, title: label, onclick: fn, html: svg }, attr || {}));
    scr.actions.append(
      btn(SV.search, () => toggleSearch(), 'Cerca', { 'data-pdf-search': '1' }),
      btn(SV.minus, () => zoomBy(1 / 1.25), 'Riduci', { 'data-pdf-zoomout': '1' }),
      btn(SV.plus, () => zoomBy(1.25), 'Ingrandisci', { 'data-pdf-zoomin': '1' }),
      A.ibtn('more', () => moreMenu(), 'Altro', 'pdf-more'));

    /* ---------- misure delle pagine ---------- */
    const pageObjs = new Array(n), base = new Array(n);
    for (let s = 0; s < n && !dead; s += 40) {
      await Promise.all(Array.from({ length: Math.min(40, n - s) }, async (_, k) => {
        const i = s + k;
        const p = await pdf.getPage(i + 1);
        pageObjs[i] = p;
        const v = p.getViewport({ scale: 1 });
        base[i] = { w: v.width, h: v.height };
      }));
    }
    if (dead) return;
    status.remove();
    body.append(inner);

    /* ---------- struttura delle pagine ---------- */
    let zoom = 1, fitW = 300, zKey = '';
    const pages = [];
    for (let i = 0; i < n; i++) {
      const hl = h('div', { class: 'pdf-hl' });
      const ink = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ink.setAttribute('class', 'pdf-ink');
      ink.setAttribute('viewBox', '0 0 ' + base[i].w + ' ' + base[i].h);
      ink.setAttribute('preserveAspectRatio', 'none');
      ink.dataset.page = String(i);
      const el = h('div', { class: 'pdf-page', 'data-page': String(i + 1), role: 'img', 'aria-label': 'Pagina ' + (i + 1) + ' di ' + n }, hl, ink);
      pages.push({ el, hl, ink, canvas: null, key: null, busy: false, gen: 0, task: null, cs: 1, err: false });
      inner.append(el);
    }
    let tops = [], heights = [];
    const want = new Set();
    let cur = 0, active = 0;

    function layout() {
      fitW = Math.max(200, body.clientWidth - 16);
      zKey = zoom + '/' + fitW;
      for (let i = 0; i < n; i++) {
        const p = pages[i];
        p.cs = (fitW / base[i].w) * zoom;
        p.el.style.width = Math.round(base[i].w * p.cs) + 'px';
        p.el.style.height = Math.round(base[i].h * p.cs) + 'px';
        p.hl.replaceChildren();
      }
      tops = pages.map((p) => p.el.offsetTop);
      heights = pages.map((p) => p.el.offsetHeight);
    }

    /* ---------- disegno delle pagine ---------- */
    async function renderPage(i) {
      const p = pages[i];
      p.busy = true;
      const my = ++p.gen;
      const key = zKey;
      try {
        const page = pageObjs[i];
        let out = Math.min(window.devicePixelRatio || 1, 2);
        let vp = page.getViewport({ scale: p.cs * out });
        while (vp.width * vp.height > 12e6 && out > 0.3) { out *= 0.85; vp = page.getViewport({ scale: p.cs * out }); }
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.floor(vp.width));
        c.height = Math.max(1, Math.floor(vp.height));
        const rt = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, background: 'rgb(255,255,255)' });
        p.task = rt;
        await rt.promise;
        if (dead || p.gen !== my) return;
        if (p.canvas) p.canvas.remove();
        p.canvas = c;
        p.el.insertBefore(c, p.hl);
        p.key = key;
        p.err = false;
        drawHighlights(i);
      } catch (e) {
        if (!e || e.name !== 'RenderingCancelledException') {
          console.error(e);
          if (!dead && p.gen === my) { p.err = true; p.key = key; p.el.dataset.err = '1'; }
        }
      } finally {
        p.busy = false;
        p.task = null;
      }
    }

    function pump() {
      while (!dead && active < 2) {
        let best = -1, bd = 1e9;
        for (const i of want) {
          const p = pages[i];
          if (p.busy || p.key === zKey) continue;
          const dist = Math.abs(i - cur);
          if (dist < bd) { bd = dist; best = i; }
        }
        if (best < 0) return;
        active++;
        renderPage(best).finally(() => { active--; pump(); });
      }
    }

    function release(i) {
      const p = pages[i];
      p.gen++;
      if (p.task) { try { p.task.cancel(); } catch (e) { /* già finito */ } }
      if (p.canvas) { p.canvas.width = p.canvas.height = 0; p.canvas.remove(); p.canvas = null; }
      p.key = null;
      delete p.el.dataset.err;
    }

    function refresh() {
      if (dead || !tops.length) return;
      const y = body.scrollTop, ch = body.clientHeight;
      const [a, b] = visibleRange(tops, heights, y - ch, y + ch * 2);
      want.clear();
      for (let i = a; i <= b; i++) want.add(i);
      // libera le pagine lontane (oltre ~3 schermi dal punto in cui si legge)
      const [ka, kb] = visibleRange(tops, heights, y - ch * 3, y + ch * 4);
      for (let i = 0; i < n; i++) if ((i < ka || i > kb) && (pages[i].canvas || pages[i].task)) release(i);
      cur = pageAt(tops, y + ch * 0.4);
      lastPos = calcPos() || lastPos;
      pill.textContent = (cur + 1) + ' / ' + n;
      pump();
      savePosSoon();
    }
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(); }); };
    body.addEventListener('scroll', onScroll, { passive: true });

    /* ---------- zoom ---------- */
    function setZoom(z) {
      z = clampZoom(z);
      if (z === zoom && zKey === zoom + '/' + Math.max(200, body.clientWidth - 16)) return;
      const fy = (body.scrollTop + body.clientHeight / 2) / Math.max(1, body.scrollHeight);
      const fx = (body.scrollLeft + body.clientWidth / 2) / Math.max(1, body.scrollWidth);
      zoom = z;
      layout();
      body.scrollTop = fy * body.scrollHeight - body.clientHeight / 2;
      body.scrollLeft = fx * body.scrollWidth - body.clientWidth / 2;
      refresh();
      redrawAllHighlights();
    }
    function zoomBy(f) { setZoom(zoom * f); }

    // pizzico con due dita + doppio tocco
    let pinch = null, lastTap = 0, tapPos = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    body.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) { pinch = { d0: dist(e.touches), z0: zoom, r: 1 }; tapPos = null; }
      else if (e.touches.length === 1) tapPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    body.addEventListener('touchmove', (e) => {
      if (tapPos && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - tapPos.x, e.touches[0].clientY - tapPos.y) > 10) tapPos = null;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      pinch.r = Math.min(ZMAX / pinch.z0, Math.max(ZMIN / pinch.z0, dist(e.touches) / pinch.d0));
      inner.style.transformOrigin = (body.scrollLeft + body.clientWidth / 2) + 'px ' + (body.scrollTop + body.clientHeight / 2) + 'px';
      inner.style.transform = 'scale(' + pinch.r + ')';
    }, { passive: false });
    body.addEventListener('touchend', (e) => {
      if (pinch) {
        if (e.touches.length < 2) {
          const r = pinch.r, z0 = pinch.z0;
          pinch = null;
          inner.style.transform = ''; inner.style.transformOrigin = '';
          setZoom(z0 * r);
        }
        return;
      }
      if (tapPos && e.touches.length === 0) {
        const now = Date.now();
        if (now - lastTap < 320) { lastTap = 0; setZoom(zoom < 1.5 ? 2.5 : 1); }
        else lastTap = now;
      }
    }, { passive: true });
    const onResize = () => { clearTimeout(onResize.t); onResize.t = setTimeout(() => { if (!dead) { zKey = ''; setZoom(zoom); } }, 200); };
    window.addEventListener('resize', onResize);

    /* ---------- ricerca ---------- */
    const S = { q: '', matches: [], byPage: new Map(), idx: -1, token: 0, texts: new Map(), hasText: null };

    async function getText(i) {
      if (S.texts.has(i)) return S.texts.get(i);
      const tc = await pageObjs[i].getTextContent();
      const t = { items: tc.items, page: buildPage(tc.items) };
      S.texts.set(i, t);
      return t;
    }

    function rectsFor(i, part) {
      const p = pages[i];
      const vp = pageObjs[i].getViewport({ scale: p.cs });
      const it = part.item;
      const tx = pdfjs.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]) || 10;
      const ang = Math.atan2(tx[1], tx[0]);
      const len = Math.max(1, it.str.length);
      const wpx = it.width * p.cs;
      const off = wpx * part.from / len;
      const w = Math.max(2, wpx * (part.to - part.from) / len);
      return { x: tx[4] + off * Math.cos(ang), y: tx[5] + off * Math.sin(ang) - fh, w, h: fh, ang };
    }

    function drawHighlights(i) {
      const p = pages[i];
      p.hl.replaceChildren();
      const list = S.byPage.get(i);
      if (!list) return;
      for (const m of list) for (const part of m.parts) {
        const r = rectsFor(i, part);
        const e = document.createElement('i');
        if (m.k === S.idx) e.className = 'cur';
        e.style.cssText = 'left:' + r.x.toFixed(1) + 'px;top:' + r.y.toFixed(1) + 'px;width:' + r.w.toFixed(1) + 'px;height:' + r.h.toFixed(1) + 'px;' + (r.ang ? 'transform:rotate(' + r.ang.toFixed(4) + 'rad);' : '');
        p.hl.append(e);
      }
    }
    function redrawAllHighlights() { for (let i = 0; i < n; i++) { if (pages[i].canvas) drawHighlights(i); else pages[i].hl.replaceChildren(); } }

    function setCount() {
      if (!S.q) sCount.textContent = '';
      else if (S.searching) sCount.textContent = S.searching;
      else if (!S.matches.length) sCount.textContent = S.hasText === false ? 'Nessun testo' : '0';
      else sCount.textContent = (S.idx + 1) + '/' + S.matches.length;
    }

    async function doSearch(raw) {
      const token = ++S.token;
      const q = normQuery(raw);
      S.q = q; S.matches = []; S.byPage = new Map(); S.idx = -1; S.searching = '';
      if (!q) { setCount(); redrawAllHighlights(); return; }
      let anyText = false;
      for (let i = 0; i < n; i++) {
        if (S.token !== token || dead) return;
        const t = await getText(i);
        if (S.token !== token || dead) return; // la ricerca è cambiata o chiusa mentre leggevo la pagina
        if (t.page.raw.trim()) anyText = true;
        for (const [s, e] of findAll(t.page.str, q, 500)) {
          if (S.matches.length >= 2000) break;
          const m = { page: i, k: S.matches.length, parts: partsFor(t.page.ranges, s, e) };
          if (!m.parts.length) continue;
          S.matches.push(m);
          if (!S.byPage.has(i)) S.byPage.set(i, []);
          S.byPage.get(i).push(m);
        }
        if (i % 8 === 7) {
          S.searching = 'Cerco… ' + Math.round(((i + 1) / n) * 100) + '%';
          setCount();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (S.token !== token || dead) return;
      S.searching = '';
      S.hasText = anyText ? true : (S.hasText === true ? true : false);
      const first = S.matches.findIndex((m) => m.page >= cur);
      if (S.matches.length) goMatch(first < 0 ? 0 : first); else { setCount(); redrawAllHighlights(); }
    }

    function goMatch(k) {
      if (!S.matches.length) return;
      S.idx = (k + S.matches.length) % S.matches.length;
      const m = S.matches[S.idx];
      setCount();
      redrawAllHighlights();
      const r = rectsFor(m.page, m.parts[0]);
      const ty = tops[m.page] + r.y - body.clientHeight / 3;
      body.scrollTop = Math.max(0, ty);
      if (zoom > 1) body.scrollLeft = Math.max(0, r.x - body.clientWidth / 3);
      refresh();
    }

    let sTimer = 0;
    function toggleSearch(force) {
      const on = force === undefined ? !sBar.classList.contains('on') : force;
      sBar.classList.toggle('on', on);
      if (on && I.on) toggleInk(false);
      if (on) { sInput.focus(); sInput.select(); }
      else { sInput.blur(); S.token++; S.q = ''; S.matches = []; S.byPage = new Map(); S.idx = -1; S.searching = ''; setCount(); redrawAllHighlights(); }
    }
    sInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(() => doSearch(sInput.value), 280); });
    sInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(sTimer);
      if (normQuery(sInput.value) !== S.q) doSearch(sInput.value); else goMatch(S.idx + (e.shiftKey ? -1 : 1));
    });
    sBar.querySelector('[data-pdf-next]').addEventListener('click', () => goMatch(S.idx + 1));
    sBar.querySelector('[data-pdf-prev]').addEventListener('click', () => goMatch(S.idx - 1));
    sBar.querySelector('[data-pdf-close]').addEventListener('click', () => toggleSearch(false));

    /* ---------- navigazione ---------- */
    function goPage(i, frac) {
      i = Math.max(0, Math.min(n - 1, i));
      body.scrollTop = tops[i] + (frac || 0) * heights[i] - 8;
      refresh();
    }
    function askPage() {
      const v = prompt('Vai alla pagina (1–' + n + '):', String(cur + 1));
      const num = parseInt(v, 10);
      if (num >= 1 && num <= n) goPage(num - 1);
    }
    pill.addEventListener('click', askPage);

    function moreMenu() {
      A.openSheet(d.name, h('div', null,
        h('button', { class: 'item', 'data-act': 'goto', onclick: async () => { await A.back(); askPage(); } }, h('span', { html: A.I('file', 22) }), 'Vai a pagina…'),
        h('button', { class: 'item', 'data-act': 'tonote', onclick: async () => { await A.back(); toNote(); } }, h('span', { html: A.I('notes', 22) }), 'Salva il testo come nota'),
        h('button', { class: 'item', 'data-act': 'export', onclick: async () => { await A.back(); A.exportFile(d); } }, h('span', { html: A.I('share', 22) }), 'Esporta / condividi')));
    }

    async function toNote() {
      A.toast('Estraggo il testo…', 1500);
      const parts = [];
      for (let i = 0; i < n; i++) {
        if (dead) return;
        const t = await getText(i);
        const s = plainText(t.items);
        if (s) parts.push(s);
      }
      const text = parts.join('\n\n');
      if (!text.trim()) return A.toast('Questo PDF non contiene testo selezionabile (forse è una scansione)', 4200);
      A.saveAsNote(d.name, text);
      A.toast('Nota creata dal testo del PDF');
    }

    /* ---------- annotazioni a mano libera (penna ed evidenziatore) ---------- */
    const ann = pages.map(() => []);          // tratti per pagina, in coordinate della pagina a zoom 1
    const hist = [];                          // ordine di disegno, per «Annulla»
    const I = { on: false, tool: 'hl', color: INK_COLORS[0], saving: false };
    const NS = 'http://www.w3.org/2000/svg';
    const pathEl = (st) => {
      const e = document.createElementNS(NS, 'path');
      e.setAttribute('d', pathOf(st.pts));
      e.setAttribute('fill', 'none');
      e.setAttribute('stroke', st.color);
      e.setAttribute('stroke-width', st.w);
      e.setAttribute('stroke-opacity', st.op);
      e.setAttribute('stroke-linecap', 'round');
      e.setAttribute('stroke-linejoin', 'round');
      return e;
    };
    const tBtn = (attr, label, html, fn) => h('button', Object.assign({ class: 'ibtn pdf-tb', 'aria-label': label, title: label, html, onclick: fn }, attr));
    const colorBtns = INK_COLORS.map((c) => h('button', { class: 'pdf-col', 'data-ink-color': c, 'aria-label': 'Colore ' + c, style: { background: c }, onclick: () => { I.color = c; paintBar(); } }));
    const penBtn = tBtn({ 'data-ink-pen': '1' }, 'Penna', SV.pen, () => { I.tool = 'pen'; if (I.color === INK_COLORS[0]) I.color = INK_COLORS[4]; paintBar(); });
    const hlBtn = h('button', { class: 'pdf-tb pdf-hlbtn', 'data-ink-hl': '1', 'aria-label': 'Evidenziatore', onclick: () => { I.tool = 'hl'; if (I.color === INK_COLORS[4] || I.color === INK_COLORS[5]) I.color = INK_COLORS[0]; paintBar(); } }, 'Evidenzia');
    const undoBtn = tBtn({ 'data-ink-undo': '1' }, 'Annulla ultimo tratto', SV.undo, () => undoInk());
    const saveBtn = h('button', { class: 'pdf-savebtn', 'data-ink-save': '1', onclick: () => saveInk() }, 'Salva');
    const tBar = h('div', { class: 'pdf-tools' }, penBtn, hlBtn, ...colorBtns, undoBtn, saveBtn,
      h('button', { class: 'ibtn pdf-tb', 'data-ink-close': '1', 'aria-label': 'Chiudi le annotazioni', html: SV.x, onclick: () => toggleInk(false) }));
    scr.el.insertBefore(tBar, body);
    function paintBar() {
      penBtn.classList.toggle('on', I.tool === 'pen');
      hlBtn.classList.toggle('on', I.tool === 'hl');
      colorBtns.forEach((b) => b.classList.toggle('on', b.dataset.inkColor === I.color));
      undoBtn.disabled = !hist.length;
      saveBtn.disabled = !hist.length || I.saving;
    }
    function toggleInk(force) {
      I.on = force === undefined ? !I.on : force;
      tBar.classList.toggle('on', I.on);
      body.classList.toggle('inking', I.on);
      if (I.on) toggleSearch(false);
      paintBar();
    }
    function drawInk(i) {
      const svg = pages[i].ink;
      svg.replaceChildren();
      for (const st of ann[i]) svg.append(pathEl(st));
    }
    function undoInk() {
      const last = hist.pop();
      if (!last) return;
      const k = ann[last.page].indexOf(last.st);
      if (k >= 0) ann[last.page].splice(k, 1);
      drawInk(last.page);
      paintBar();
    }

    // disegno con il dito (o il mouse): un solo dito disegna, due dita = zoom (il tratto in corso viene scartato)
    const ptrs = new Set();
    let cur_ = null;
    function toBase(e, svg, i) {
      const r = svg.getBoundingClientRect();
      return [(e.clientX - r.left) / Math.max(1, r.width) * base[i].w, (e.clientY - r.top) / Math.max(1, r.height) * base[i].h];
    }
    function dropStroke() { if (cur_) { cur_.el.remove(); cur_ = null; } }
    inner.addEventListener('pointerdown', (e) => {
      const svg = e.target.closest && e.target.closest('.pdf-ink');
      if (!I.on || !svg) return;
      ptrs.add(e.pointerId);
      if (ptrs.size > 1) { dropStroke(); return; }
      const i = +svg.dataset.page, t = INK_TOOLS[I.tool];
      const st = { tool: I.tool, color: I.color, w: t.w, op: t.op, pts: [toBase(e, svg, i)] };
      cur_ = { i, st, svg, el: pathEl(st), id: e.pointerId };
      svg.append(cur_.el);
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* non fondamentale */ }
      e.preventDefault();
    });
    inner.addEventListener('pointermove', (e) => {
      if (!cur_ || e.pointerId !== cur_.id || ptrs.size > 1) return;
      const p = toBase(e, cur_.svg, cur_.i), l = cur_.st.pts[cur_.st.pts.length - 1];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.6) return;
      cur_.st.pts.push(p);
      cur_.el.setAttribute('d', pathOf(cur_.st.pts));
    });
    const endPtr = (e) => {
      ptrs.delete(e.pointerId);
      if (!cur_ || e.pointerId !== cur_.id) return;
      const c = cur_; cur_ = null;
      if (e.type === 'pointercancel') { c.el.remove(); return; }
      c.st.pts = thinPoints(c.st.pts, 0.5);
      ann[c.i].push(c.st);
      hist.push({ page: c.i, st: c.st });
      c.el.setAttribute('d', pathOf(c.st.pts));
      paintBar();
    };
    inner.addEventListener('pointerup', endPtr);
    inner.addEventListener('pointercancel', endPtr);

    // scrive i tratti dentro il PDF (restano visibili in qualsiasi lettore) e sostituisce il file nell'archivio
    async function bake() {
      await A.lib('pdflib');
      const { PDFDocument, rgb, LineCapStyle } = window.PDFLib;
      const doc = await PDFDocument.load(d.data.slice(0), { ignoreEncryption: true });
      const ps = doc.getPages();
      for (let i = 0; i < n; i++) {
        if (!ann[i].length || !ps[i]) continue;
        const vp = pageObjs[i].getViewport({ scale: 1 });
        for (const st of ann[i]) {
          const pts = st.pts.map(([x, y]) => vp.convertToPdfPoint(x, y));
          const c = hexRgb(st.color);
          ps[i].drawSvgPath(pathOf(pts, (y) => -y), { x: 0, y: 0, borderColor: rgb(c[0], c[1], c[2]), borderWidth: st.w, borderOpacity: st.op, borderLineCap: LineCapStyle.Round });
        }
      }
      const out = await doc.save();
      d.data = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      await A.save(d);
    }
    async function saveInk() {
      if (I.saving || !hist.length) return;
      I.saving = true; paintBar();
      try {
        await bake();
        hist.length = 0; ann.forEach((x) => { x.length = 0; });
        A.toast('Annotazioni salvate nel PDF');
        await A.back();       // chiude questo lettore (la posizione viene ricordata)…
        openPdf(d, A).catch((e) => A.toast('Impossibile riaprire: ' + (e.message || e), 4500)); // …e lo riapre sul file aggiornato
      } catch (e) {
        console.error(e);
        A.toast('Impossibile salvare le annotazioni: ' + (e.message || e), 5000);
        I.saving = false; paintBar();
      }
    }
    scr.actions.insertBefore(btn(SV.pen, () => toggleInk(), 'Annota', { 'data-pdf-annot': '1' }), scr.actions.lastChild);
    paintBar();

    /* ---------- ricorda dove eri arrivato ---------- */
    let saveT = 0, lastPos = null;
    // Quando la schermata si chiude è già staccata dalla pagina (scrollTop = 0): in quel caso vale l'ultima posizione letta.
    function calcPos() {
      if (!tops.length || !body.isConnected) return null;
      const i = pageAt(tops, body.scrollTop + body.clientHeight * 0.4);
      const frac = Math.max(0, Math.min(1, (body.scrollTop - tops[i]) / Math.max(1, heights[i])));
      return { page: i, frac, zoom };
    }
    function savePosNow() {
      lastPos = calcPos() || (lastPos && Object.assign({}, lastPos, { zoom }));
      if (!lastPos) return;
      return N.db.setMeta('pdfpos:' + d.id, lastPos).catch(() => {});
    }
    function savePosSoon() { clearTimeout(saveT); saveT = setTimeout(savePosNow, 700); }

    function cleanup() {
      if (dead) return;
      try { savePosNow(); } catch (e) { /* ignora */ }
      if (hist.length && !I.saving) { // uscita senza aver premuto «Salva»: le annotazioni non si perdono
        I.saving = true;
        bake().then(() => A.toast('Annotazioni salvate nel PDF')).catch((e) => { console.error(e); A.toast('Annotazioni NON salvate: ' + (e.message || e), 5000); });
      }
      dead = true;
      clearTimeout(saveT); clearTimeout(sTimer); clearTimeout(onResize.t);
      window.removeEventListener('resize', onResize);
      for (let i = 0; i < n; i++) if (pages[i] && (pages[i].task || pages[i].canvas)) release(i);
      S.texts.clear();
      try { pdf.destroy(); } catch (e) { /* già chiuso */ }
    }

    /* ---------- avvio ---------- */
    let saved = null;
    try { saved = await N.db.getMeta('pdfpos:' + d.id); } catch (e) { saved = null; }
    if (dead) return;
    if (saved && saved.zoom) zoom = clampZoom(saved.zoom);
    layout();
    if (saved && saved.page > 0) body.scrollTop = tops[Math.min(n - 1, saved.page)] + (saved.frac || 0) * heights[Math.min(n - 1, saved.page)];
    refresh();
    return { goPage, setZoom, search: doSearch };
  }

  /* =====================================================================
     3) COLLEGAMENTO ALLA SEZIONE DOCUMENTI
     ===================================================================== */

  if (N.docs && N.docs.register) {
    N.docs.register('pdf', { open: (d, A) => openPdf(d, A) });
  }

  N.pdfView = { _logic: { fold, normQuery, buildPage, plainText, findAll, partsFor, pageAt, visibleRange, clampZoom, thinPoints, pathOf, hexRgb, INK_TOOLS, INK_COLORS } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.pdfView;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
