/* Le Mie Note — interfaccia e logica. Tutto funziona offline e i dati restano sul dispositivo. */
(function () {
  'use strict';
  const N = window.N;

  /* =============== utilità =============== */
  const $ = (s, r) => (r || document).querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (x) => String(x).padStart(2, '0');
  const FINE_POINTER = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'value') e.value = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  const IC = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    more: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
    pin: '<path d="M12 17v5M8 3h8l-1.5 6.5L18 13H6l3.5-3.5z"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
    text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    palette: '<path d="M12 3a9 9 0 100 18c1.2 0 1.8-.9 1.5-1.8-.4-1 .3-2.2 1.5-2.2H17a4 4 0 004-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11" r=".8"/><circle cx="10" cy="7" r=".8"/><circle cx="15" cy="7.5" r=".8"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>',
    spark: '<path d="M12 3l2.2 6.3L20.5 11l-6.3 1.7L12 19l-2.2-6.3L3.5 11l6.3-1.7z"/>',
    down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 017.5-2"/>',
    folder: '<path d="M3 7a1 1 0 011-1h5l2 2h8a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    rows: '<rect x="4" y="5" width="16" height="6" rx="1.5"/><rect x="4" y="13" width="16" height="6" rx="1.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
    notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7"/>',
    restore: '<path d="M4 12a8 8 0 108-8H7M7 4L4 7l3 3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    archive: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.5"/><path d="M5 8.5V19a1 1 0 001 1h12a1 1 0 001-1V8.5M10 12.5h4"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    wave: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M9 21h6"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    tools: '<path d="M14.5 6.5a4 4 0 005 5l-8.8 8.8a2.1 2.1 0 01-3-3z"/><path d="M14.5 6.5l3-3 3 3-3 3"/>',
    ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>',
    percent: '<path d="M18 5L6 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 3h5M12 3v3"/>',
    pad: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>'
  };
  const I = (n, s) => '<svg class="i" viewBox="0 0 24 24" width="' + (s || 22) + '" height="' + (s || 22) + '">' + IC[n] + '</svg>';
  const ibtn = (icon, fn, label, cls) => h('button', { class: 'ibtn' + (cls ? ' ' + cls : ''), 'aria-label': label, title: label, onclick: fn, html: I(icon) });

  function toast(msg, ms, act) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = h('div', { class: 'toast' + (act ? ' act' : ''), role: 'status' }, msg, act ? h('button', { onclick: () => { t.remove(); act.fn(); } }, act.label) : null);
    document.body.append(t);
    setTimeout(() => t.remove(), ms || 2600);
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    const o = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('it-IT', o);
  }
  const fmtFull = (ts) => new Date(ts).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const toLocalInput = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  function tagColor(t) {
    let x = 0;
    for (const c of t) x = (x * 31 + c.charCodeAt(0)) % 360;
    return 'hsl(' + x + ',52%,42%)';
  }

  /* =============== stato =============== */
  const S = {
    notes: [],
    key: null,
    vaultMeta: null,
    folders: [],
    settings: { theme: 'auto', view: 'grid', stealth: false, lockOnExit: true, accent: 'amber', fontSize: 100, sort: 'modified', versions: true, verLimit: 15, trashDays: 30 },
    filter: { type: 'all', folder: null, tag: null, q: '' },
    sel: new Set(),
    ed: null,
    fails: 0,
    installEvt: null
  };

  const FIELDS = ['kind', 'title', 'body', 'items', 'tags', 'folder', 'bg', 'pinned', 'trashed', 'reminder', 'reminded', 'audio', 'pos', 'versions', 'repeat', 'archived', 'readonly'];

  function normalize(n) {
    return Object.assign(
      { kind: 'text', title: '', body: '', items: [], tags: [], folder: '', bg: { id: 'none' }, pinned: false, trashed: 0, reminder: null, reminded: false, hidden: false },
      n
    );
  }

  /* =============== salvataggio (coda seriale) =============== */
  let chain = Promise.resolve();
  function enqueue(fn) {
    chain = chain.then(fn).catch((e) => console.error(e));
    return chain;
  }
  function persist(n) {
    return enqueue(async () => {
      if (n.hidden) {
        if (!S.key) return;
        const payload = {};
        FIELDS.forEach((f) => (payload[f] = n[f]));
        await N.db.put({ id: n.id, hidden: true, created: n.created, updated: n.updated, enc: await N.crypto.encryptJSON(S.key, payload) });
      } else {
        const rec = Object.assign({}, n);
        delete rec._locked;
        delete rec._enc;
        await N.db.put(rec);
      }
    });
  }
  function removeForever(n) {
    S.notes = S.notes.filter((x) => x.id !== n.id);
    return enqueue(() => N.db.del(n.id));
  }

  async function loadNotes() {
    const raw = await N.db.all();
    S.notes = raw.map((r) => (r.hidden ? { id: r.id, hidden: true, _locked: true, created: r.created, updated: r.updated, _enc: r.enc, tags: [], items: [] } : normalize(r)));
  }

  async function decryptAll() {
    let fails = 0;
    for (const n of S.notes) {
      if (!n.hidden || !n._locked) continue;
      try {
        const p = await N.crypto.decryptJSON(S.key, n._enc);
        Object.assign(n, normalize(p), { hidden: true });
        delete n._locked;
        delete n._enc;
      } catch (e) {
        fails++;
      }
    }
    return fails;
  }

  /* =============== sfondi =============== */
  const LINES = 'repeating-linear-gradient(to bottom,transparent 0 27px,rgba(90,110,160,.3) 27px 28px),#fffdf5';
  const GRID = 'linear-gradient(rgba(90,110,160,.22) 1px,transparent 1px) 0 0/24px 24px,linear-gradient(90deg,rgba(90,110,160,.22) 1px,transparent 1px) 0 0/24px 24px,#fffdf5';
  const DOTS = 'radial-gradient(circle,rgba(0,0,0,.2) 1.2px,transparent 1.6px) 0 0/20px 20px,#fffdf5';
  const BGS = [
    { id: 'none', name: 'Nessuno' },
    { id: 'c-cream', css: '#fff4c9', ink: 'dark' },
    { id: 'c-mint', css: '#d6f0e0', ink: 'dark' },
    { id: 'c-sky', css: '#d5e9fb', ink: 'dark' },
    { id: 'c-rose', css: '#fbdbe3', ink: 'dark' },
    { id: 'c-lav', css: '#e4dcfa', ink: 'dark' },
    { id: 'c-peach', css: '#ffe0cb', ink: 'dark' },
    { id: 'c-sand', css: '#ece3d2', ink: 'dark' },
    { id: 'c-graph', css: '#2b2d31', ink: 'light' },
    { id: 'c-night', css: '#1b2a49', ink: 'light' },
    { id: 'c-forest', css: '#1f3b30', ink: 'light' },
    { id: 'g-sunset', css: 'linear-gradient(160deg,#ffb38a,#ff7096)', ink: 'dark' },
    { id: 'g-ocean', css: 'linear-gradient(160deg,#7cc4ff,#52d6bd)', ink: 'dark' },
    { id: 'g-aurora', css: 'linear-gradient(160deg,#b9a5e8,#fbc2eb)', ink: 'dark' },
    { id: 'g-lemon', css: 'linear-gradient(160deg,#fff3a3,#ffd27a)', ink: 'dark' },
    { id: 'g-dusk', css: 'linear-gradient(160deg,#232526,#4b4f52)', ink: 'light' },
    { id: 'g-pine', css: 'linear-gradient(160deg,#134e5e,#4f9a6a)', ink: 'light' },
    { id: 'g-lava', css: 'linear-gradient(160deg,#7b1e3a,#e0832f)', ink: 'light' },
    { id: 'p-lines', name: 'Righe', css: LINES, ink: 'dark' },
    { id: 'p-grid', name: 'Quadri', css: GRID, ink: 'dark' },
    { id: 'p-dots', name: 'Puntini', css: DOTS, ink: 'dark' }
  ];

  function bgOf(n) {
    const b = n.bg || { id: 'none' };
    if (b.id === 'image' && b.img) {
      const ov = b.ink === 'light' ? 'rgba(0,0,0,.4)' : 'rgba(255,255,255,.4)';
      return { css: 'linear-gradient(' + ov + ',' + ov + '),url("' + b.img + '") center/cover no-repeat', ink: b.ink || 'dark' };
    }
    const p = BGS.find((x) => x.id === b.id);
    if (!p || p.id === 'none') return { css: '', ink: '' };
    return { css: p.css, ink: p.ink };
  }
  function styleBg(el, n) {
    const b = bgOf(n);
    el.style.background = b.css;
    el.style.color = b.ink === 'light' ? '#f5f5f7' : b.ink === 'dark' ? '#1d1b16' : '';
    el.classList.toggle('has-bg', !!b.css);
    el.classList.toggle('light-ink', b.ink === 'light');
    el.classList.toggle('dark-ink', b.ink === 'dark');
  }

  async function fileToBg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const max = 1100;
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * sc));
      c.height = Math.max(1, Math.round(img.height * sc));
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, cnt = 0;
      for (let i = 0; i < d.length; i += 4 * 41) {
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        cnt++;
      }
      return { id: 'image', img: c.toDataURL('image/jpeg', 0.72), ink: sum / cnt / 255 > 0.55 ? 'dark' : 'light' };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* =============== livelli (tasto Indietro di Android) =============== */
  const layers = [];
  let waiters = [];
  function pushLayer(close) {
    layers.push(close);
    history.pushState({ l: layers.length }, '');
  }
  function back() {
    return new Promise((r) => {
      waiters.push(r);
      history.back();
    });
  }
  window.addEventListener('popstate', () => {
    const depth = (history.state && history.state.l) || 0;
    while (layers.length > depth) {
      const c = layers.pop();
      try { c(); } catch (e) { console.error(e); }
    }
    const rs = waiters;
    waiters = [];
    rs.forEach((r) => r());
  });

  function openSheet(title, content, opts) {
    opts = opts || {};
    const scrim = h('div', { class: 'scrim s2' });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title || '' }, h('div', { class: 'grab' }), title ? h('h3', null, title) : null, content);
    document.body.append(scrim, sheet);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      scrim.remove();
      sheet.remove();
      if (opts.onClose) opts.onClose();
    };
    scrim.addEventListener('click', () => back());
    pushLayer(close);
    return { close: () => back(), el: sheet };
  }

  /* =============== filtri =============== */
  function matches(n, q) {
    const hay = ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.items || []).map((i) => i.t).join(' ') + ' ' + (n.tags || []).join(' ') + ' ' + (n.folder || '')).toLowerCase();
    return q.split(/\s+/).every((w) => {
      if (w[0] === '#' && w.length > 1) return (n.tags || []).some((t) => t.startsWith(w.slice(1)));
      const m = w.match(/^(tipo|cartella|ha|is):(.+)$/);
      if (m) {
        const k = m[1], v = m[2];
        if (k === 'tipo') return n.kind === (v.startsWith('list') ? 'list' : 'text');
        if (k === 'cartella') return (n.folder || '').toLowerCase().includes(v);
        if (k === 'is') return v.startsWith('fiss') ? !!n.pinned : true;
        return v.startsWith('prom') ? !!n.reminder : v.startsWith('aud') ? !!n.audio : v.startsWith('sfond') ? !!(n.bg && n.bg.id !== 'none') : v.startsWith('tag') ? (n.tags || []).length > 0 : true;
      }
      return hay.includes(w);
    });
  }
  function visible() {
    const f = S.filter;
    const q = f.q.trim().toLowerCase();
    const list = S.notes.filter((n) => {
      if (n._locked) return false;
      if (f.type === 'trash') return !!n.trashed;
      if (n.trashed) return false;
      if (f.type === 'archive' ? !n.archived : n.archived) return false;
      if (f.type === 'vault') { if (!n.hidden) return false; }
      else if (n.hidden) return false;
      if (f.type === 'reminders' && !n.reminder) return false;
      if (f.folder && n.folder !== f.folder) return false;
      if (f.tag && !(n.tags || []).includes(f.tag)) return false;
      if (q && !matches(n, q)) return false;
      return true;
    });
    if (f.type === 'reminders') return list.sort((a, b) => a.reminder - b.reminder);
    const mode = S.settings.sort || 'modified';
    const key = mode === 'created' ? (n) => n.created || 0 : (n) => Math.max(n.pos || 0, n.updated || 0);
    return list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (mode === 'title' ? (a.title || '~').localeCompare(b.title || '~', 'it') : key(b) - key(a)));
  }
  function allFolders() {
    const set = new Set(S.folders);
    S.notes.forEach((n) => { if (!n._locked && !n.trashed && n.folder) set.add(n.folder); });
    return [...set].sort((a, b) => a.localeCompare(b, 'it'));
  }
  function allTags() {
    return [...new Set(S.notes.filter((n) => !n._locked).flatMap((n) => n.tags || []))].sort((a, b) => a.localeCompare(b, 'it'));
  }
  function setFilter(patch) {
    Object.assign(S.filter, { type: 'all', folder: null, tag: null, q: '' }, patch);
    S.sel.clear();
    renderAll();
    const s = $('#q');
    if (s) s.value = S.filter.q;
  }
  const hasContent = (n) => !!((n.title || '').trim() || (n.body || '').trim() || (n.items || []).some((i) => i.t.trim()) || n.audio);

  /* =============== interfaccia principale =============== */
  function sectionTitle() {
    const f = S.filter;
    if (f.type === 'trash') return 'Cestino';
    if (f.type === 'archive') return 'Archivio';
    if (f.type === 'vault') return 'Note private';
    if (f.type === 'reminders') return 'Promemoria';
    if (f.folder) return f.folder;
    return 'Note';
  }

  let stealthTaps = 0, stealthTimer = null;

  function buildShell() {
    const root = $('#root');
    root.innerHTML = '';
    root.append(
      h('header', { class: 'top', id: 'top' }),
      h('div', { class: 'chips hidden', id: 'chips' }),
      h('main', { id: 'list' }),
      h('button', { class: 'fab', id: 'fab', 'aria-label': 'Nuova nota', onclick: fabTap, html: I('plus', 28) })
    );
  }

  function renderTop() {
    const top = $('#top');
    top.innerHTML = '';
    if (S.sel.size) {
      const ids = [...S.sel];
      const notes = S.notes.filter((n) => S.sel.has(n.id));
      const inTrash = S.filter.type === 'trash';
      top.append(
        h('div', { class: 'selbar' },
          ibtn('x', () => { S.sel.clear(); renderAll(); }, 'Annulla selezione'),
          h('span', { class: 'cnt' }, ids.length + ' selezionat' + (ids.length === 1 ? 'a' : 'e')),
          inTrash
            ? [ibtn('restore', () => bulk('restore'), 'Ripristina'), ibtn('trash', () => bulk('purge'), 'Elimina definitivamente')]
            : [ibtn('pin', () => bulk('pin'), 'Fissa'), ibtn('archive', () => bulk('archive'), 'Archivia'), ibtn('folder', () => bulk('folder'), 'Sposta in cartella'), ibtn('down', () => exportSheet(notes), 'Esporta'), ibtn('trash', () => bulk('trash'), 'Elimina')]
        )
      );
      return;
    }
    const h1 = h('h1', {
      onclick: () => {
        if (!S.settings.stealth) return;
        stealthTaps++;
        clearTimeout(stealthTimer);
        stealthTimer = setTimeout(() => (stealthTaps = 0), 2500);
        if (stealthTaps >= 5) { stealthTaps = 0; enterVault(); }
      }
    }, sectionTitle());
    top.append(
      h('div', { class: 'row' },
        ibtn('menu', openDrawer, 'Menu'),
        h1,
        S.filter.type === 'vault' && S.key ? ibtn('lock', () => lockVault(true), 'Blocca note private', 'on') : null,
        ibtn(S.settings.view === 'grid' ? 'rows' : 'grid', toggleView, 'Cambia vista')
      ),
      h('label', { class: 'search' },
        h('span', { html: I('search', 18) }),
        h('input', { id: 'q', type: 'search', placeholder: S.filter.type === 'vault' ? 'Cerca nelle note private' : 'Cerca nelle note', value: S.filter.q, enterkeyhint: 'search', oninput: (e) => { S.filter.q = e.target.value; renderChips(); renderList(); } })
      )
    );
  }

  function renderChips() {
    const el = $('#chips');
    if (!el) return;
    el.innerHTML = '';
    const ctx = S.notes.filter((n) => !n._locked && !n.trashed && (S.filter.type === 'vault' ? n.hidden : !n.hidden));
    const tags = [...new Set(ctx.flatMap((n) => n.tags || []))].sort((a, b) => a.localeCompare(b, 'it'));
    if (!tags.length || S.filter.type === 'trash') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.append(h('button', { class: 'chip' + (!S.filter.tag ? ' on' : ''), onclick: () => { S.filter.tag = null; renderChips(); renderList(); } }, 'Tutti'));
    tags.forEach((t) => el.append(h('button', { class: 'chip' + (S.filter.tag === t ? ' on' : ''), onclick: () => { S.filter.tag = S.filter.tag === t ? null : t; renderChips(); renderList(); } }, '#' + t)));
  }

  function card(n) {
    const el = h('article', { class: 'card' + (S.sel.has(n.id) ? ' sel' : ''), tabindex: 0, draggable: FINE_POINTER ? 'true' : null, 'data-id': n.id });
    styleBg(el, n);
    const body = [];
    if (n.pinned) body.push(h('span', { class: 'pin', html: I('pin', 15) }));
    if (n.title) body.push(h('div', { class: 't' }, n.title));
    if (n.kind === 'list') {
      const its = (n.items || []).filter((i) => i.t.trim());
      body.push(h('div', { class: 'cl' }, its.slice(0, 6).map((i) => h('div', { class: i.done ? 'done' : '' }, h('span', { class: 'cb' + (i.done ? ' on' : '') }), h('span', null, i.t))), its.length > 6 ? h('div', { style: { opacity: '.6' } }, '+ ' + (its.length - 6) + ' altre') : null));
    } else if ((n.body || '').trim()) {
      body.push(h('div', { class: 's' }, n.body.trim().slice(0, 400)));
    }
    const foot = [];
    if (n.kind === 'list') { const its = (n.items || []).filter((i) => i.t.trim()); if (its.length) foot.push(h('span', null, '✓ ' + its.filter((i) => i.done).length + '/' + its.length)); }
    if (n.repeat && n.reminder) foot.push(h('span', null, '↻'));
    if (n.hidden) foot.push(h('span', { class: 'lock', html: I('lock', 13) }));
    if (n.reminder) foot.push(h('span', { style: { color: !n.reminded && n.reminder < Date.now() ? 'var(--danger)' : '' } }, '⏰ ' + fmtFull(n.reminder)));
    if (n.folder) foot.push(h('span', null, '📁 ' + n.folder));
    (n.tags || []).slice(0, 3).forEach((t) => foot.push(h('span', { class: 'tag' }, '#' + t)));
    foot.push(h('span', { style: { marginLeft: 'auto' } }, fmtDate(n.updated)));
    body.push(h('div', { class: 'foot' }, foot));
    el.append(...body);

    let lp = null, fired = false;
    const cancel = () => { if (lp) { clearTimeout(lp); lp = null; } };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return; // su touch la pressione lunga è gestita da drag_drop.js
      fired = false;
      lp = setTimeout(() => { lp = null; fired = true; if (navigator.vibrate) navigator.vibrate(15); toggleSel(n.id); }, 480);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) => el.addEventListener(ev, cancel));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      if (fired) { fired = false; return; }
      if (N.dragDrop && N.dragDrop.justActed()) return;
      if (S.sel.size) toggleSel(n.id);
      else if (n.trashed) trashSheet(n);
      else openEditor(n);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.click(); });
    return el;
  }

  function toggleSel(id) {
    if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
    renderTop();
    renderList();
  }

  function renderList() {
    const host = $('#list');
    if (!host) return;
    host.innerHTML = '';
    const list = visible();
    const f = S.filter;
    if (f.type === 'trash' && list.length) {
      host.append(h('div', { class: 'out', style: { marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center' } }, h('span', { style: { flex: 1, fontSize: '13.5px' } }, (S.settings.trashDays === 0 ? 'Le note restano nel cestino finché non lo svuoti.' : 'Le note nel cestino vengono eliminate dopo ' + (S.settings.trashDays || 30) + ' giorni.')), h('button', { class: 'btn danger', onclick: emptyTrash }, 'Svuota')));
    }
    if (!list.length) {
      const msg = f.q ? 'Nessun risultato per «' + f.q + '». Prova #tag, tipo:lista, ha:promemoria, cartella:nome' : f.type === 'archive' ? 'L’archivio è vuoto. Archivia le note che non ti servono ora, senza eliminarle.' : f.type === 'trash' ? 'Il cestino è vuoto' : f.type === 'vault' ? 'Nessuna nota privata. Tocca + per crearne una.' : f.type === 'reminders' ? 'Nessun promemoria impostato' : 'Nessuna nota. Tocca + per iniziare.';
      host.append(h('div', { class: 'empty' }, h('div', { html: I(f.type === 'vault' ? 'lock' : 'notes', 56) }), msg));
      return;
    }
    const g = h('div', { class: 'grid' + (S.settings.view === 'list' ? ' one' : '') });
    list.forEach((n) => g.append(card(n)));
    host.append(g);
    if (N.dragDrop) N.dragDrop.initDragAndDrop(g, (ids) => {
      // l'ordine manuale è salvato in "pos" e non altera la data di modifica
      const base = Date.now();
      ids.forEach((id, i) => { const item = S.notes.find((x) => x.id === id); if (item) { item.pos = base - i; persist(item); } });
      toast('Ordine salvato', 1200);
    }, (id) => toggleSel(id));
  }

  function renderAll() {
    renderTop();
    renderChips();
    renderList();
    const fab = $('#fab');
    if (fab) fab.classList.toggle('hidden', S.sel.size > 0 || S.filter.type === 'trash' || S.filter.type === 'archive');
  }

  function toggleView() {
    S.settings.view = S.settings.view === 'grid' ? 'list' : 'grid';
    saveSettings();
    renderTop();
    renderList();
  }

  /* =============== nuova nota =============== */
  function fabTap() {
    const inVault = S.filter.type === 'vault' && !!S.key;
    const wrap = h('div', { class: 'fabs' });
    const scrim = h('div', { class: 'scrim', style: { background: 'transparent' }, onclick: () => { wrap.remove(); scrim.remove(); } });
    const go = (kind) => { wrap.remove(); scrim.remove(); createNote(kind, inVault); };
    wrap.append(
      h('button', { onclick: () => go('list'), html: I('list', 20) + ' Lista' }),
      h('button', { onclick: () => go('text'), html: I('text', 20) + ' Testo' })
    );
    document.body.append(scrim, wrap);
  }

  function createNote(kind, hidden) {
    const now = Date.now();
    const n = normalize({ id: uid(), kind, created: now, updated: now, hidden: !!hidden, folder: S.filter.folder || '', tags: S.filter.tag ? [S.filter.tag] : [] });
    if (kind === 'list') n.items = [{ t: '', done: false }];
    S.notes.push(n);
    openEditor(n, true);
  }

  /* =============== editor =============== */
  function touch() {
    const e = S.ed;
    if (!e) return;
    e.n.updated = Date.now();
    e.dirty = true;
    clearTimeout(e.timer);
    e.timer = setTimeout(flush, 350);
  }
  function flush() {
    const e = S.ed;
    if (!e || !e.dirty) return;
    e.dirty = false;
    clearTimeout(e.timer);
    if (hasContent(e.n)) { snap(e.n); persist(e.n); }
  }

  function openEditor(n, isNew) {
    S.ed = { n, dirty: false, timer: null, isNew: !!isNew };
    const el = h('section', { class: 'editor', id: 'editor' });
    S.ed.el = el;

    const title = h('input', { class: 'ed-title', placeholder: 'Titolo', value: n.title, readonly: n.readonly, maxlength: 200, enterkeyhint: 'next', oninput: (e) => { n.title = e.target.value; touch(); updateInfo(); } });
    const content = h('div', { class: 'ed-content' });
    const meta = h('div', { class: 'ed-meta' });
    const info = h('div', { class: 'ed-info' });
    const links = h('div', { class: 'ed-links' });
    const pinBtn = ibtn('pin', () => { n.pinned = !n.pinned; pinBtn.classList.toggle('on', n.pinned); touch(); toast(n.pinned ? 'Nota fissata in alto' : 'Nota non più fissata', 1400); }, 'Fissa in alto', n.pinned ? 'on' : '');
    const tools = h('div', { class: 'ed-tools' },
      toolBtn('list', n.kind === 'list' ? 'Testo' : 'Lista', toggleKind),
      toolBtn('palette', 'Sfondo', () => bgSheet(n)),
      toolBtn('tag', 'Tag', () => tagSheet(n)),
      toolBtn('bell', 'Promemoria', () => reminderSheet(n)),
      toolBtn('spark', 'Assistente', () => assistantSheet(n)),
      toolBtn('mic', 'Audio', async () => {
        try {
          if (!N.audio) return toast('Registrazione audio non disponibile');
          if (!S.ed.recording) {
            await N.audio.start();
            S.ed.recording = true;
            toast('Registrazione avviata · premi di nuovo per fermare'); if (S.ed.el) S.ed.el.querySelector('.ed-tools button:nth-child(6)').classList.add('rec');
          } else {
            const data = await N.audio.stop();
            S.ed.recording = false; if (S.ed.el) S.ed.el.querySelector('.ed-tools button:nth-child(6)').classList.remove('rec');
            if (data) { n.audio = data; touch(); drawContent(); toast('Nota vocale salvata'); }
          }
        } catch (e) { S.ed.recording = false; toast('Microfono non disponibile o permesso negato'); }
      }),
      (window.SpeechRecognition || window.webkitSpeechRecognition) ? toolBtn('wave', 'Detta', () => dictate(n)) : null,
      toolBtn('down', 'Esporta', () => exportSheet([n]))
    );
    el.append(
      h('div', { class: 'ed-top' }, ibtn('back', () => back(), 'Indietro'), h('div', { class: 'grow' }), n.hidden ? h('span', { html: I('lock', 18), style: { opacity: '.6', marginRight: '6px' } }) : null, pinBtn, ibtn('more', () => editorMenu(n), 'Altro')),
      h('div', { class: 'ed-body' }, title, meta, content, info, links),
      tools
    );
    document.body.append(el);
    S.ed.drawMeta = drawMeta;
    S.ed.setTitle = (t) => { title.value = t; };
    S.ed.setRO = () => { title.readOnly = !!n.readonly; };
    S.ed.drawContent = drawContent;
    S.ed.applyBg = () => styleBg(el, n);
    S.ed.refreshTools = () => { tools.children[0].lastChild.textContent = n.kind === 'list' ? 'Testo' : 'Lista'; };

    function updateInfo() {
      const txt = N.ai.noteText(n);
      const words = (txt.match(/\S+/g) || []).length;
      info.textContent = words + ' parole' + (words >= 120 ? ' · ' + Math.round(words / 200 || 1) + ' min di lettura' : '') + ' · modificata ' + fmtDate(n.updated) + (n.readonly ? ' · sola lettura 🔒' : '');
      drawLinks();
    }
    function drawLinks() {
      links.innerHTML = '';
      const txt = N.ai.noteText(n);
      const titles = [...new Set([...txt.matchAll(/\[\[([^\]\n]{1,80})\]\]/g)].map((m) => m[1].trim()).filter(Boolean))];
      const pool = S.notes.filter((x) => x.id !== n.id && !x._locked && !x.trashed && !!x.hidden === !!n.hidden);
      const go = async (fn) => { await back(); fn(); };
      if (titles.length) links.append(h('div', { class: 'ed-linkhead' }, 'Collegamenti'));
      titles.forEach((t) => { const x = pool.find((p) => (p.title || '').trim().toLowerCase() === t.toLowerCase()); links.append(h('button', { class: 'chip', onclick: () => go(() => (x ? openEditor(x) : newLinked(t, n.hidden))) }, (x ? '↗ ' : '＋ ') + t)); });
      const me = (n.title || '').trim().toLowerCase();
      const cited = me ? pool.filter((x) => N.ai.noteText(x).toLowerCase().includes('[[' + me + ']]')) : [];
      if (cited.length) { links.append(h('div', { class: 'ed-linkhead' }, 'Citata in')); cited.forEach((x) => links.append(h('button', { class: 'chip', onclick: () => go(() => openEditor(x)) }, '↩ ' + (x.title || 'Senza titolo')))); }
    }
    function drawMeta() {
      meta.innerHTML = '';
      if (n.folder) meta.append(h('button', { class: 'chip', onclick: () => tagSheet(n) }, '📁 ' + n.folder));
      (n.tags || []).forEach((t) => meta.append(h('button', { class: 'chip', onclick: () => tagSheet(n) }, '#' + t)));
      if (n.reminder) meta.append(h('button', { class: 'chip', onclick: () => reminderSheet(n) }, '⏰ ' + fmtFull(n.reminder)));
      updateInfo();
    }
    function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, window.innerHeight * 0.4) + 'px'; }
    function drawContent(focusIdx) {
      content.innerHTML = '';
      if (n.kind === 'text') {
        const ta = h('textarea', { class: 'ed-text', placeholder: 'Scrivi qui…', value: n.body, readonly: n.readonly, oninput: (e) => { n.body = e.target.value; autosize(ta); touch(); updateInfo(); }, onkeydown: (e) => textKey(e, ta) });
        content.append(ta);
        requestAnimationFrame(() => { autosize(ta); if (S.ed && S.ed.isNew && !n.title && !n.body) ta.focus(); });
      } else {
        if (!n.items.length) n.items.push({ t: '', done: false });
        const rows = h('div');
        content.append(rows);
        n.items.forEach((it, i) => {
          const inp = h('input', { type: 'text', value: it.t, readonly: n.readonly, placeholder: 'Voce', enterkeyhint: 'next', oninput: (e) => { it.t = e.target.value; touch(); updateInfo(); }, onkeydown: (e) => {
            if (n.readonly) return;
            if (e.key === 'Enter') { e.preventDefault(); n.items.splice(i + 1, 0, { t: '', done: false }); touch(); drawContent(i + 1); }
            else if (e.key === 'Backspace' && !it.t && n.items.length > 1) { e.preventDefault(); n.items.splice(i, 1); touch(); drawContent(Math.max(0, i - 1)); }
          } });
          inp.dataset.i = i;
          rows.append(h('div', { class: 'li' + (it.done ? ' done' : '') },
            h('button', { class: 'tick', 'aria-label': 'Completa', onclick: () => { it.done = !it.done; touch(); drawContent(); }, html: it.done ? I('check', 16) : '' }),
            inp,
            h('button', { class: 'rm', 'aria-label': 'Rimuovi voce', onclick: () => { if (n.readonly) return toast('Nota in sola lettura'); n.items.splice(i, 1); if (!n.items.length) n.items.push({ t: '', done: false }); touch(); drawContent(); }, html: I('x', 16) })
          ));
        });
        content.append(h('div', { class: 'li add', onclick: () => { if (n.readonly) return toast('Nota in sola lettura'); n.items.push({ t: '', done: false }); touch(); drawContent(n.items.length - 1); } }, h('span', { html: I('plus', 20), style: { width: '24px' } }), h('span', null, 'Aggiungi voce')));
        if (focusIdx != null) { const t = content.querySelector('input[data-i="' + focusIdx + '"]'); if (t) t.focus(); }
        else if (S.ed && S.ed.isNew && !n.title && !n.items[0].t) { const t = content.querySelector('input[data-i="0"]'); if (t) t.focus(); }
      }
      if (n.audio) {
        const player = h('div', { class: 'audio-note' },
          h('div', { class: 'audio-note-label' }, 'Nota vocale'),
          h('audio', { controls: true, preload: 'metadata', src: n.audio }),
          h('button', { class: 'btn danger', onclick: () => { if (confirm('Eliminare la nota vocale?')) { n.audio = null; touch(); drawContent(); } } }, 'Elimina audio')
        );
        content.append(player);
      }
    }
    function toggleKind() {
      if (n.readonly) return toast('Nota in sola lettura');
      if (n.kind === 'text') {
        const lines = (n.body || '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]\s*)?(?:\[[ xX]\]\s*)?/, '').trim()).filter(Boolean);
        n.items = lines.length ? lines.map((t) => ({ t, done: false })) : [{ t: '', done: false }];
        n.body = '';
        n.kind = 'list';
      } else {
        n.body = n.items.map((i) => i.t).filter((t) => t.trim()).join('\n');
        n.items = [];
        n.kind = 'text';
      }
      touch();
      drawContent();
      S.ed.refreshTools();
    }

    drawMeta();
    drawContent();
    S.ed.applyBg();
    pushLayer(teardownEditor);
  }

  function toolBtn(icon, label, fn) {
    return h('button', { 'data-k': icon, onclick: fn, html: I(icon, 22) + '<span>' + label + '</span>' });
  }

  function teardownEditor() {
    const e = S.ed;
    if (!e) return;
    clearTimeout(e.timer);
    const n = e.n;
    if (!hasContent(n)) {
      removeForever(n);
    } else if (e.dirty) {
      snap(n);
      persist(n);
    }
    e.el.remove();
    S.ed = null;
    renderAll();
  }

  function editorMenu(n) {
    const box = h('div');
    const row = (icon, label, fn, cls, sub) => h('button', { class: 'item ' + (cls || ''), onclick: async () => { await sh.close(); fn(); } }, h('span', { html: I(icon, 22) }), h('span', null, label, sub ? h('small', null, sub) : null));
    box.append(
      ...editorExtraRows(n, row),
      row('copy', 'Duplica nota', () => {
        const d = normalize(JSON.parse(JSON.stringify(n)));
        d.id = uid(); d.created = d.updated = Date.now(); d.title = (n.title ? n.title + ' ' : '') + '(copia)'; d.pinned = false; d.reminder = null; d.reminded = false;
        S.notes.push(d);
        persist(d);
        toast('Nota duplicata');
        renderList();
      }),
      row(n.hidden ? 'unlock' : 'lock', n.hidden ? 'Rimuovi dalle note private' : 'Sposta nelle note private', () => toggleHidden(n), '', n.hidden ? 'Tornerà tra le note normali, senza cifratura.' : 'Verrà cifrata e nascosta dall’elenco principale.'),
      row('trash', 'Sposta nel cestino', () => { n.trashed = Date.now(); persist(n); toast('Nota spostata nel cestino', 6000, { label: 'Annulla', fn: () => { n.trashed = 0; persist(n); renderAll(); } }); back(); }, 'danger')
    );
    const sh = openSheet('Altro', box);
  }

  function toggleHidden(n) {
    const apply = async () => {
      flushNow(n);
      await chain;
      const wasHidden = n.hidden;
      n.hidden = !wasHidden;
      n.updated = Date.now();
      delete n._locked;
      await persist(n);
      toast(n.hidden ? 'Nota spostata nelle note private 🔒' : 'Nota spostata tra le note normali');
      if (S.ed) { S.ed.drawMeta(); }
      await back();
      renderAll();
    };
    if (n.hidden) return apply();
    requireVault(apply);
  }
  function flushNow(n) { if (S.ed && S.ed.n === n) { S.ed.dirty = false; clearTimeout(S.ed.timer); if (hasContent(n)) persist(n); } }

  /* =============== sfondo =============== */
  function bgSheet(n) {
    const box = h('div');
    const grid = h('div', { class: 'swatches' });
    const cur = (n.bg && n.bg.id) || 'none';
    function drawGrid() {
      grid.innerHTML = '';
      BGS.forEach((b) => {
        const on = ((n.bg && n.bg.id) || 'none') === b.id;
        grid.append(h('button', { class: 'sw' + (on ? ' on' : '') + (b.id === 'none' ? ' none' : ''), style: b.css ? { background: b.css } : {}, 'aria-label': b.name || b.id, onclick: () => { n.bg = { id: b.id }; touch(); S.ed.applyBg(); drawGrid(); drawInk(); } }, b.id === 'none' ? '—' : b.name && b.css ? h('span', { style: { fontSize: '10.5px', color: '#333', background: 'rgba(255,255,255,.7)', borderRadius: '6px', padding: '0 4px' } }, b.name) : ''));
      });
      const isImg = n.bg && n.bg.id === 'image';
      grid.append(h('button', { class: 'sw' + (isImg ? ' on' : ''), style: isImg && n.bg.img ? { background: 'url("' + n.bg.img + '") center/cover' } : {}, onclick: () => file.click(), 'aria-label': 'Foto dalla galleria', html: isImg ? '' : I('image', 22) }));
    }
    const inkBox = h('div');
    function drawInk() {
      inkBox.innerHTML = '';
      if (n.bg && n.bg.id === 'image') {
        inkBox.append(h('label', null, 'Colore del testo'), h('div', { class: 'seg' },
          h('button', { class: n.bg.ink !== 'light' ? 'on' : '', onclick: () => { n.bg.ink = 'dark'; touch(); S.ed.applyBg(); drawInk(); } }, 'Scuro'),
          h('button', { class: n.bg.ink === 'light' ? 'on' : '', onclick: () => { n.bg.ink = 'light'; touch(); S.ed.applyBg(); drawInk(); } }, 'Chiaro')));
      }
    }
    const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { n.bg = await fileToBg(f); touch(); S.ed.applyBg(); drawGrid(); drawInk(); }
      catch (err) { toast('Impossibile usare questa immagine'); }
      e.target.value = '';
    } });
    drawGrid(); drawInk();
    box.append(h('p', { class: 'hint' }, 'Scegli un colore, una sfumatura, una carta a righe/quadretti oppure una tua foto. La foto resta salvata sul telefono.'), grid, file, inkBox, h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: () => back() }, 'Fatto')));
    openSheet('Sfondo della nota', box);
  }

  /* =============== tag e cartella =============== */
  function tagSheet(n) {
    const box = h('div');
    function draw() {
      box.innerHTML = '';
      const inp = h('input', { class: 'field', placeholder: 'Nuovo tag (invio per aggiungere)', maxlength: 24, enterkeyhint: 'done', onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        const t = inp.value.trim().replace(/^#/, '').toLowerCase();
        if (!t) return;
        if (!n.tags.includes(t)) n.tags.push(t);
        touch(); S.ed.drawMeta(); draw();
      } });
      const tags = [...new Set([...allTags(), ...n.tags])];
      box.append(h('label', null, 'Tag'), inp, h('div', { class: 'tagrow' }, tags.map((t) => {
        const on = n.tags.includes(t);
        return h('button', { class: 'tagbtn' + (on ? ' on' : ''), style: on ? { background: tagColor(t) } : {}, onclick: () => { if (on) n.tags = n.tags.filter((x) => x !== t); else n.tags.push(t); touch(); S.ed.drawMeta(); draw(); } }, '#' + t);
      })));
      const sug = N.ai.keywords((n.title || '') + ' ' + N.ai.noteText(n), 10).filter((k) => k.length > 3 && !n.tags.includes(k)).slice(0, 5);
      if (sug.length) box.append(h('label', null, 'Suggeriti dal contenuto'), h('div', { class: 'tagrow' }, sug.map((k) => h('button', { class: 'tagbtn', onclick: () => { n.tags.push(k); touch(); S.ed.drawMeta(); draw(); } }, '#' + k))));
      const sel = h('select', { class: 'field', onchange: (e) => {
        if (e.target.value === '__new') {
          const name = (prompt('Nome della nuova cartella') || '').trim();
          if (name) { addFolder(name); n.folder = name; } else e.target.value = n.folder || '';
        } else n.folder = e.target.value;
        touch(); S.ed.drawMeta(); draw();
      } }, h('option', { value: '' }, 'Nessuna cartella'), allFolders().map((f) => h('option', { value: f }, f)), h('option', { value: '__new' }, '➕ Nuova cartella…'));
      sel.value = n.folder || '';
      box.append(h('label', null, 'Cartella'), sel, h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: () => back() }, 'Fatto')));
    }
    draw();
    openSheet('Tag e cartella', box);
  }
  function addFolder(name) {
    if (!S.folders.includes(name)) { S.folders.push(name); N.db.setMeta('folders', S.folders); }
  }

  /* =============== promemoria =============== */
  function reminderSheet(n) {
    const box = h('div');
    const d0 = n.reminder && n.reminder > Date.now() ? new Date(n.reminder) : new Date(Date.now() + 3600e3);
    d0.setSeconds(0, 0);
    const inp = h('input', { class: 'field', type: 'datetime-local', value: toLocalInput(d0) });
    const rep = h('select', { class: 'field' }, [['', 'Mai'], ['daily', 'Ogni giorno'], ['weekly', 'Ogni settimana'], ['monthly', 'Ogni mese']].map(([v, l]) => h('option', { value: v }, l)));
    rep.value = n.repeat || '';
    const quick = (label, fn) => h('button', { class: 'chip', onclick: () => { const d = fn(new Date()); inp.value = toLocalInput(d); } }, label);
    const at = (d, hh, mm, plus) => { d.setDate(d.getDate() + (plus || 0)); d.setHours(hh, mm, 0, 0); return d; };
    box.append(
      h('p', { class: 'hint' }, 'Riceverai una notifica all’ora scelta. Su Android l’avviso è affidabile se l’app è installata e aperta o in background; se il sistema la chiude, vedrai il promemoria scaduto appena la riapri.'),
      h('div', { class: 'tagrow' }, quick('Tra 1 ora', (d) => new Date(d.getTime() + 3600e3)), quick('Stasera 20:00', (d) => at(d, 20, 0, d.getHours() >= 20 ? 1 : 0)), quick('Domani 9:00', (d) => at(d, 9, 0, 1)), quick('Tra una settimana', (d) => at(d, 9, 0, 7))),
      h('label', null, 'Data e ora'), inp, h('label', null, 'Ripeti'), rep,
      h('div', { class: 'btns' },
        n.reminder ? h('button', { class: 'btn', onclick: async () => { n.reminder = null; n.reminded = false; n.repeat = ''; touch(); await back(); S.ed && S.ed.drawMeta(); toast('Promemoria rimosso'); } }, 'Rimuovi') : null,
        h('button', { class: 'btn pri', onclick: async () => {
          const t = new Date(inp.value).getTime();
          if (!t || isNaN(t)) return toast('Scegli data e ora');
          if (t < Date.now()) return toast('Scegli un momento nel futuro');
          if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) {} }
          n.reminder = t; n.reminded = false; n.repeat = rep.value; touch();
          await back();
          S.ed && S.ed.drawMeta();
          toast('Promemoria impostato: ' + fmtFull(t));
        } }, 'Imposta')
      )
    );
    openSheet('Promemoria', box);
  }

  async function notify(title, body, tag) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
        if (reg) { await reg.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png', vibrate: [120, 60, 120] }); return; }
        new Notification(title, { body, tag });
        return;
      }
    } catch (e) { console.warn(e); }
    toast('⏰ ' + title + (body ? ' — ' + body : ''), 6000);
  }
  function checkReminders() {
    const now = Date.now();
    let changed = false;
    S.notes.forEach((n) => {
      if (n._locked || n.trashed || !n.reminder || n.reminded || n.reminder > now) return;
      changed = true;
      const late = now - n.reminder > 120000;
      if (n.repeat) {
        const d = new Date(n.reminder);
        let guard = 0;
        while (d.getTime() <= now && guard++ < 800) { if (n.repeat === 'daily') d.setDate(d.getDate() + 1); else if (n.repeat === 'weekly') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1); }
        const next = d.getTime();
        n.reminded = false;
        persist(Object.assign({}, n, { reminder: next }));
        notify(n.hidden ? 'Promemoria (nota privata)' : n.title || 'Promemoria', n.hidden ? '' : (late ? 'Scaduto: ' : '') + (N.ai.noteText(n) || '').slice(0, 90), 'r-' + n.id);
        n.reminder = next;
        return;
      }
      n.reminded = true;
      persist(n);
      notify(n.hidden ? 'Promemoria (nota privata)' : n.title || 'Promemoria', n.hidden ? '' : (late ? 'Scaduto: ' : '') + (N.ai.noteText(n) || '').slice(0, 90), 'r-' + n.id);
    });
    if (changed && $('#list') && !S.ed) renderList();
  }

  /* =============== esportazione =============== */
  function exportSheet(notes) {
    const box = h('div');
    const one = notes.length === 1;
    const name = one ? N.exp.slug(notes[0].title || N.ai.noteText(notes[0]).slice(0, 30)) : 'note-' + notes.length;
    const hasPrivate = notes.some((n) => n.hidden);
    const doIt = async (kind) => {
      if (hasPrivate && !confirm('Il file esportato non sarà protetto da password. Continuare?')) return;
      let blob, fname;
      if (kind === 'pdf') { blob = N.exp.makePDF(notes); fname = name + '.pdf'; }
      else if (kind === 'docx') { blob = N.exp.makeDOCX(notes); fname = name + '.docx'; }
      else if (kind === 'md') { blob = new Blob([notes.map(N.exp.noteMarkdown).join('\n---\n\n')], { type: 'text/markdown' }); fname = name + '.md'; }
      else { blob = new Blob([notes.map(N.exp.notePlain).join('\n\n')], { type: 'text/plain' }); fname = name + '.txt'; }
      download(blob, fname);
      toast('File creato: ' + fname);
    };
    const share = async () => {
      const txt = notes.map(N.exp.notePlain).join('\n\n');
      try { if (navigator.share) await navigator.share({ title: notes[0].title || 'Nota', text: txt }); else { await navigator.clipboard.writeText(txt); toast('Testo copiato negli appunti'); } } catch (e) {}
    };
    const row = (icon, label, sub, fn) => h('button', { class: 'item', onclick: fn }, h('span', { html: I(icon, 22) }), h('span', null, label, h('small', null, sub)));
    box.append(
      row('file', 'PDF', 'Documento pronto da stampare o inviare', () => doIt('pdf')),
      row('file', 'Word (.docx)', 'Modificabile con Word, Google Documenti, LibreOffice', () => doIt('docx')),
      row('text', 'Markdown (.md)', 'Testo con formattazione semplice', () => doIt('md')),
      row('text', 'Testo semplice (.txt)', 'Compatibile con qualsiasi app', () => doIt('txt')),
      row('share', 'Condividi il testo', 'Invia ad altre app', share)
    );
    if (hasPrivate) box.append(h('p', { class: 'hint' }, '🔒 Include note private: il file esportato non sarà cifrato.'));
    openSheet(one ? 'Esporta nota' : 'Esporta ' + notes.length + ' note', box);
  }

  /* =============== assistente (offline) =============== */
  function assistantSheet(n) {
    const box = h('div');
    const tabsEl = h('div', { class: 'tabs' });
    const body = h('div');
    let cur = 0;
    const names = ['Riassunto', 'Mappa', 'Approfondisci'];
    function appendToNote(text) {
      if (n.kind === 'list') { n.items.push({ t: text.slice(0, 200), done: false }); }
      else n.body = (n.body ? n.body.replace(/\s+$/, '') + '\n\n' : '') + text;
      touch(); S.ed.drawContent(); S.ed.drawMeta(); toast('Aggiunto alla nota');
    }
    function empty() { return !hasContent(n); }
    function draw() {
      tabsEl.innerHTML = '';
      names.forEach((t, i) => tabsEl.append(h('button', { class: i === cur ? 'on' : '', onclick: () => { cur = i; draw(); } }, t)));
      body.innerHTML = '';
      if (empty()) { body.append(h('p', { class: 'hint' }, 'Scrivi qualcosa nella nota e poi riprova.')); return; }
      if (cur === 0) {
        const r = N.ai.summarize(n);
        body.append(h('div', { class: 'out' }, r.text));
        if (r.short) body.append(h('p', { class: 'hint' }, 'La nota è breve: non serve un riassunto.'));
        else if (r.keywords && r.keywords.length) body.append(h('p', { class: 'hint' }, 'Temi principali: ' + r.keywords.join(', ')));
        body.append(h('div', { class: 'btns' },
          h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(r.text); toast('Copiato'); } catch (e) { toast('Copia non disponibile'); } } }, 'Copia'),
          n.kind === 'text' && !r.short ? h('button', { class: 'btn pri', onclick: () => appendToNote('— Riassunto —\n' + r.text) }, 'Aggiungi alla nota') : null));
      } else if (cur === 1) {
        const tree = N.ai.mindTree(n);
        if (!tree.children.length) { body.append(h('p', { class: 'hint' }, 'Servono più contenuti per costruire una mappa. Prova con titoli (# Titolo), elenchi o più paragrafi.')); return; }
        const svg = N.ai.mindSVG(tree);
        const mapbox = h('div', { class: 'mapbox fit', html: svg });
        const zoomBtn = h('button', { class: 'btn', onclick: () => { const fit = mapbox.classList.toggle('fit'); zoomBtn.textContent = fit ? 'Ingrandisci' : 'Adatta allo schermo'; } }, 'Ingrandisci');
        body.append(mapbox, h('p', { class: 'hint' }, 'Si costruisce dai titoli, dagli elenchi o dai paragrafi della nota. Tocca «Ingrandisci» per leggere i dettagli e scorrerla.'));
        body.append(h('div', { class: 'btns' }, zoomBtn));
        body.append(h('div', { class: 'btns', style: { marginTop: '8px' } },
          h('button', { class: 'btn', onclick: () => download(new Blob([svg], { type: 'image/svg+xml' }), N.exp.slug(n.title || 'mappa') + '-mappa.svg') }, 'Scarica SVG'),
          h('button', { class: 'btn pri', onclick: () => svgToPng(svg, N.exp.slug(n.title || 'mappa') + '-mappa.png') }, 'Scarica PNG')));
      } else {
        const d = N.ai.deepDive(n);
        if (!d.keywords.length) { body.append(h('p', { class: 'hint' }, 'Nota troppo breve per trovare spunti.')); return; }
        body.append(h('label', null, 'Parole chiave'), h('div', { class: 'tagrow' }, d.keywords.map((k) => h('span', { class: 'chip' }, k))));
        body.append(h('label', null, 'Domande per approfondire'), h('ul', { class: 'q' }, d.questions.map((q) => h('li', null, q))));
        body.append(h('label', null, 'Approfondisci su Wikipedia'));
        if (!navigator.onLine) body.append(h('p', { class: 'hint' }, 'Sei offline: la ricerca si attiverà quando torni online.'));
        else {
          const wres = h('div', { class: 'wres' });
          const chips = h('div', { class: 'tagrow' });
          const run = async (q) => {
            [...chips.children].forEach((c) => c.classList.toggle('on', c.dataset.q === q));
            wres.innerHTML = '';
            wres.append(h('p', { class: 'hint' }, 'Cerco «' + q + '»…'));
            const r = await N.ai.searchOnline(q);
            wres.innerHTML = '';
            if (!r.online) return wres.append(h('p', { class: 'hint' }, 'Impossibile raggiungere Wikipedia. Riprova più tardi.'));
            if (!r.results.length) return wres.append(h('p', { class: 'hint' }, 'Nessun risultato per «' + q + '».'));
            r.results.forEach((it) => {
              const url = 'https://it.wikipedia.org/wiki/' + encodeURIComponent(it.title.replace(/ /g, '_'));
              const snip = (it.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
              wres.append(h('div', { class: 'wr' },
                h('a', { class: 'wt', href: url, target: '_blank', rel: 'noopener noreferrer' }, it.title + ' ↗'),
                h('p', null, snip + '…'),
                n.kind === 'text' ? h('button', { class: 'btn', onclick: () => appendToNote('— ' + it.title + ' —\n' + url) }, 'Aggiungi link alla nota') : null));
            });
          };
          d.keywords.slice(0, 5).forEach((k) => chips.append(h('button', { class: 'tagbtn', 'data-q': k, onclick: () => run(k) }, k)));
          body.append(chips, wres);
          run(d.keywords[0]);
        }
        body.append(h('div', { class: 'btns' }, n.kind === 'text' ? h('button', { class: 'btn pri', onclick: () => appendToNote('— Da approfondire —\n' + d.questions.map((q) => '• ' + q).join('\n')) }, 'Aggiungi domande alla nota') : null));
      }
    }
    box.append(h('p', { class: 'hint' }, 'Analisi eseguita sul telefono, anche offline. Individua le frasi e i temi più rilevanti della nota; non genera testo nuovo.'), tabsEl, body);
    draw();
    openSheet('Assistente', box);
  }

  function svgToPng(svg, name) {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const sc = 2;
      const c = document.createElement('canvas');
      c.width = img.width * sc; c.height = img.height * sc;
      const g = c.getContext('2d');
      g.fillStyle = '#fffdf8'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => b ? (download(b, name), toast('Immagine salvata')) : toast('Impossibile creare l’immagine'), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Impossibile creare l’immagine'); };
    img.src = url;
  }

  /* =============== cestino e selezione =============== */
  function trashSheet(n) {
    const box = h('div');
    box.append(
      h('p', { class: 'hint' }, (n.title || 'Nota senza titolo') + ' — nel cestino'),
      h('button', { class: 'item', onclick: async () => { n.trashed = 0; n.updated = Date.now(); persist(n); await sh.close(); renderAll(); toast('Nota ripristinata'); } }, h('span', { html: I('restore') }), 'Ripristina'),
      h('button', { class: 'item danger', onclick: async () => { if (!confirm('Eliminare definitivamente questa nota?')) return; await removeForever(n); await sh.close(); renderAll(); } }, h('span', { html: I('trash') }), 'Elimina definitivamente')
    );
    const sh = openSheet('Cestino', box);
  }
  async function emptyTrash() {
    const list = S.notes.filter((n) => n.trashed && !n._locked);
    if (!list.length || !confirm('Eliminare definitivamente ' + list.length + ' note? Non si può annullare.')) return;
    for (const n of list) await removeForever(n);
    renderAll();
    toast('Cestino svuotato');
  }
  async function bulk(action) {
    const notes = S.notes.filter((n) => S.sel.has(n.id));
    if (!notes.length) return;
    if (action === 'pin') { const on = !notes.every((n) => n.pinned); notes.forEach((n) => { n.pinned = on; n.updated = Date.now(); persist(n); }); }
    else if (action === 'trash') { notes.forEach((n) => { n.trashed = Date.now(); persist(n); }); toast(notes.length + ' note nel cestino', 6000, { label: 'Annulla', fn: () => { notes.forEach((n) => { n.trashed = 0; persist(n); }); renderAll(); } }); }
    else if (action === 'archive') { const on = !notes.every((n) => n.archived); notes.forEach((n) => { n.archived = on; persist(n); }); toast(on ? notes.length + ' note archiviate' : 'Note ripristinate dall’archivio'); }
    else if (action === 'restore') { notes.forEach((n) => { n.trashed = 0; persist(n); }); }
    else if (action === 'purge') { if (!confirm('Eliminare definitivamente ' + notes.length + ' note?')) return; for (const n of notes) await removeForever(n); }
    else if (action === 'folder') {
      const box = h('div');
      const mv = async (f) => { notes.forEach((n) => { n.folder = f; n.updated = Date.now(); persist(n); }); await sh.close(); S.sel.clear(); renderAll(); toast('Note spostate'); };
      box.append(h('button', { class: 'item', onclick: () => mv('') }, h('span', { html: I('folder') }), 'Nessuna cartella'));
      allFolders().forEach((f) => box.append(h('button', { class: 'item', onclick: () => mv(f) }, h('span', { html: I('folder') }), f)));
      box.append(h('button', { class: 'item', onclick: () => { const nm = (prompt('Nome della nuova cartella') || '').trim(); if (nm) { addFolder(nm); mv(nm); } } }, h('span', { html: I('plus') }), 'Nuova cartella…'));
      const sh = openSheet('Sposta in cartella', box);
      return;
    }
    S.sel.clear();
    renderAll();
  }


  /* =============== dashboard personale e calendario =============== */
  function openDashboard() {
    const notes = S.notes.filter(n => !n._locked && !n.hidden && !n.trashed && !n.archived);
    const today = new Date(); today.setHours(0,0,0,0);
    const todayNotes = notes.filter(n => new Date(n.updated || n.created).setHours(0,0,0,0) === today.getTime());
    const tasks = notes.flatMap(n => (n.items || []).filter(i => i.t && !i.done).map(i => ({title:i.t,note:n})));
    const upcoming = notes.filter(n => n.reminder && n.reminder >= Date.now()).sort((a,b)=>a.reminder-b.reminder).slice(0,5);
    const pinned = notes.filter(n=>n.pinned).length;
    const words = notes.reduce((a,n)=>a+(N.ai.noteText(n).match(/\S+/g)||[]).length,0);
    const actDays = new Set(S.notes.filter(n=>!n._locked&&!n.trashed).map(n=>new Date(n.updated||n.created).toDateString()));
    let streak = 0; const sd = new Date(); if (!actDays.has(sd.toDateString())) sd.setDate(sd.getDate()-1);
    while (actDays.has(sd.toDateString())) { streak++; sd.setDate(sd.getDate()-1); }
    const box = h('div',{class:'dash'});
    box.append(h('div',{class:'dashstats'},
      ...[['Note',notes.length],['Modificate oggi',todayNotes.length],['Da fare',tasks.length],['Preferite',pinned],['Parole scritte',words.toLocaleString('it-IT')],['Giorni di fila',streak]].map(([a,b])=>h('div',{class:'dashstat'},h('strong',null,String(b)),h('small',null,a)))
    ));
    box.append(h('h4',null,'Promemoria in arrivo'));
    if (!upcoming.length) box.append(h('p',{class:'hint'},'Nessun promemoria futuro.'));
    upcoming.forEach(n=>box.append(h('button',{class:'item',onclick:async()=>{await sh.close();openEditor(n);}},h('span',null,'⏰'),h('span',null,n.title||'Nota senza titolo',h('small',null,fmtFull(n.reminder))))));
    box.append(h('h4',null,'Attività da completare'));
    tasks.slice(0,6).forEach(t=>box.append(h('div',{class:'dash-task'},h('span',null,'○'),h('span',null,t.title),h('small',null,t.note.title||'Nota'))));
    if (!tasks.length) box.append(h('p',{class:'hint'},'Non ci sono attività in sospeso.'));
    box.append(h('div',{class:'btns'},
      h('button',{class:'btn',onclick:async()=>{const pool=notes.filter(hasContent); if(!pool.length) return toast('Non hai ancora note'); const week=Date.now()-7*864e5; const old=pool.filter(n=>n.updated<week); const src=old.length?old:pool; const r=src[Math.floor(Math.random()*src.length)]; await sh.close(); openEditor(r);}},'🎲 Riscopri una nota'),
      h('button',{class:'btn pri',onclick:async()=>{await sh.close();setFilter({type:'all'});}},'Vai a tutte le note')));
    const sh=openSheet('La mia panoramica',box);
  }

  function openCalendar() {
    let month = new Date(); month.setDate(1);
    const box=h('div',{class:'calendar-wrap'});
    const draw=()=>{
      box.innerHTML='';
      const head=h('div',{class:'cal-head'},h('button',{class:'btn',onclick:()=>{month.setMonth(month.getMonth()-1);draw();}},'‹'),h('strong',null,month.toLocaleDateString('it-IT',{month:'long',year:'numeric'})),h('button',{class:'btn',onclick:()=>{month.setMonth(month.getMonth()+1);draw();}},'›'));
      box.append(head);
      const grid=h('div',{class:'cal-grid'});
      ['L','M','M','G','V','S','D'].forEach(x=>grid.append(h('b',null,x)));
      const first=(month.getDay()+6)%7;
      const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
      for(let i=0;i<first;i++) grid.append(h('span',{class:'cal-empty'},''));
      for(let d=1;d<=days;d++){
        const date=new Date(month.getFullYear(),month.getMonth(),d); const start=date.getTime(); const end=start+86400000;
        const hits=S.notes.filter(n=>!n._locked&&!n.hidden&&!n.trashed&&((n.reminder>=start&&n.reminder<end)||(n.updated>=start&&n.updated<end))).sort((a,b)=>(a.reminder||a.updated)-(b.reminder||b.updated));
        const cell=h('button',{class:'cal-day'+(date.toDateString()===new Date().toDateString()?' today':'')+(hits.length?' has-events':''),onclick:()=>showDay(date,hits)},String(d));
        if(hits.length) cell.append(h('i',null,'')); grid.append(cell);
      }
      box.append(grid,h('p',{class:'hint'},'I punti indicano note create/modificate o promemoria in quella data. Tocca un giorno per vedere i dettagli.'));
    };
    const showDay=(date,hits)=>{
      const content=h('div');
      content.append(h('p',{class:'hint'},date.toLocaleDateString('it-IT',{dateStyle:'full'})));
      if(!hits.length) content.append(h('p',{class:'hint'},'Nessuna nota per questo giorno.'));
      hits.forEach(n=>content.append(h('button',{class:'item',onclick:async()=>{await daySheet.close();await sh.close();openEditor(n);}},h('span',null,n.reminder?'⏰':'📝'),h('span',null,n.title||'Nota senza titolo',h('small',null,n.reminder?fmtFull(n.reminder):'Modificata '+fmtFull(n.updated))))));
      const daySheet=openSheet('Note del giorno',content);
    };
    draw(); const sh=openSheet('Calendario',box);
  }

  /* =============== strumenti (convertitore, sconti, timer, appunti) =============== */
  function toolsCtx() {
    return {
      h, I, openSheet, toast, notify,
      // trasforma gli appunti temporanei in una nota vera
      saveAsNote: (text) => {
        const now = Date.now(), first = text.split('\n').find((l) => l.trim()) || '';
        const n = normalize({ id: uid(), kind: 'text', title: first.trim().slice(0, 60), body: text, created: now, updated: now });
        S.notes.push(n);
        persist(n);
        if ($('#list')) renderAll();
        return true;
      }
    };
  }
  function openTools(tab, mode) { N.tools.init(toolsCtx()); N.tools.open(tab, mode); }

  /* =============== documenti (PDF, Word, Excel) =============== */
  function docsCtx() {
    return {
      h, I, ibtn, toast, openSheet, pushLayer, back, download, fmtDate, uid,
      // crea una nota vera a partire dal testo di un documento
      saveAsNote: (title, text) => {
        const now = Date.now();
        const n = normalize({ id: uid(), kind: 'text', title: String(title || '').slice(0, 80), body: text || '', created: now, updated: now });
        S.notes.push(n);
        persist(n);
        if ($('#list')) renderAll();
        return n;
      }
    };
  }
  function openDocs() { N.docs.init(docsCtx()); return N.docs.open(); }

  /* =============== menu laterale =============== */
  function openDrawer() {
    const scrim = h('div', { class: 'scrim' });
    const dr = h('nav', { class: 'drawer' });
    let closed = false;
    const close = () => { if (closed) return; closed = true; scrim.remove(); dr.remove(); };
    scrim.addEventListener('click', () => back());
    const go = async (patch) => { await back(); setFilter(patch); };
    const f = S.filter;
    const count = (fn) => S.notes.filter((n) => !n._locked && fn(n)).length;
    const item = (icon, label, on, fn, n) => h('button', { class: 'item' + (on ? ' on' : ''), onclick: fn }, h('span', { html: I(icon, 22) }), label, n != null ? h('span', { class: 'n' }, n) : null);
    dr.append(
      h('h2', null, 'Le Mie Note'),
      item('notes', 'Tutte le note', f.type === 'all' && !f.folder, () => go({}), count((n) => !n.hidden && !n.trashed && !n.archived)),
      item('bell', 'Promemoria', f.type === 'reminders', () => go({ type: 'reminders' }), count((n) => !n.hidden && !n.trashed && n.reminder)),
      item('notes', 'Panoramica personale', false, async () => { await back(); openDashboard(); }),
      item('calendar', 'Calendario', false, async () => { await back(); openCalendar(); }),
      item('tools', 'Strumenti', false, async () => { await back(); openTools(); }),
      item('file', 'Documenti', false, async () => { await back(); openDocs(); }),
      item('edit', 'Nota di oggi', false, async () => { await back(); openToday(); })
    );
    dr.append(h('div', { class: 'sec' }, 'Cartelle'));
    allFolders().forEach((fo) => dr.append(h('div', { style: { display: 'flex', alignItems: 'center' } },
      Object.assign(item('folder', fo, f.folder === fo, () => go({ folder: fo }), count((n) => !n.hidden && !n.trashed && n.folder === fo)), { style: 'flex:1' }),
      h('button', { class: 'ibtn', 'aria-label': 'Gestisci cartella ' + fo, onclick: async () => { await back(); folderSheet(fo); }, html: I('edit', 18) }))));
    dr.append(item('plus', 'Nuova cartella', false, async () => { await back(); const nm = (prompt('Nome della nuova cartella') || '').trim(); if (nm) { addFolder(nm); setFilter({ folder: nm }); } }));
    dr.append(h('div', { class: 'sec' }, 'Altro'));
    if (!S.settings.stealth || S.key) dr.append(item(S.key ? 'unlock' : 'lock', 'Note private', f.type === 'vault', async () => { await back(); enterVault(); }));
    dr.append(
      item('archive', 'Archivio', f.type === 'archive', () => go({ type: 'archive' }), count((n) => !n.hidden && !n.trashed && n.archived)),
      item('trash', 'Cestino', f.type === 'trash', () => go({ type: 'trash' }), count((n) => n.trashed)),
      item('down', 'Backup e importazione', false, async () => { await back(); backupSheet(); }),
      item('gear', 'Impostazioni', false, async () => { await back(); settingsSheet(); })
    );
    document.body.append(scrim, dr);
    pushLayer(close);
  }

  function folderSheet(name) {
    const box = h('div');
    const inp = h('input', { class: 'field', value: name, maxlength: 40 });
    box.append(h('label', null, 'Nome cartella'), inp, h('div', { class: 'btns' },
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Eliminare la cartella «' + name + '»? Le note resteranno, senza cartella.')) return;
        S.folders = S.folders.filter((x) => x !== name); N.db.setMeta('folders', S.folders);
        S.notes.forEach((n) => { if (n.folder === name && !n._locked) { n.folder = ''; persist(n); } });
        await sh.close(); if (S.filter.folder === name) setFilter({}); else renderAll();
      } }, 'Elimina'),
      h('button', { class: 'btn pri', onclick: async () => {
        const nn = inp.value.trim();
        if (!nn || nn === name) return sh.close();
        S.folders = S.folders.filter((x) => x !== name); if (!S.folders.includes(nn)) S.folders.push(nn); N.db.setMeta('folders', S.folders);
        S.notes.forEach((n) => { if (n.folder === name && !n._locked) { n.folder = nn; persist(n); } });
        await sh.close(); if (S.filter.folder === name) setFilter({ folder: nn }); else renderAll();
      } }, 'Salva')));
    const sh = openSheet('Cartella', box);
  }

  /* =============== note private (cassaforte) =============== */
  function enterVault() {
    if (S.key) return setFilter({ type: 'vault' });
    requireVault(() => setFilter({ type: 'vault' }));
  }
  function requireVault(cb) {
    if (S.key) return cb();
    if (!S.vaultMeta) return setupVault(cb);
    unlockVault(cb);
  }

  function pwField(id, ph) {
    const f = h('input', { class: 'field', id, type: 'password', placeholder: ph, autocomplete: 'off', enterkeyhint: 'done' });
    return f;
  }

  function setupVault(cb) {
    const box = h('div');
    const p1 = pwField('pw1', 'Password (almeno 6 caratteri)');
    const p2 = pwField('pw2', 'Ripeti la password');
    const ok = h('input', { type: 'checkbox' });
    const err = h('div', { class: 'err' });
    const btn = h('button', { class: 'btn pri', onclick: submit }, 'Crea note private');
    async function submit() {
      err.textContent = '';
      if (p1.value.length < 6) return (err.textContent = 'La password deve avere almeno 6 caratteri.');
      if (p1.value !== p2.value) return (err.textContent = 'Le due password non coincidono.');
      if (!ok.checked) return (err.textContent = 'Conferma di aver capito che la password non si può recuperare.');
      btn.disabled = true; btn.textContent = 'Creazione…';
      try {
        const v = await N.crypto.createVault(p1.value);
        await N.db.setMeta('vault', v.meta);
        S.vaultMeta = v.meta; S.key = v.key; S.fails = 0;
        await sh.close();
        toast('Note private attive 🔒');
        cb();
      } catch (e) { err.textContent = 'Errore: ' + e.message; btn.disabled = false; btn.textContent = 'Crea note private'; }
    }
    box.append(
      h('p', { class: 'hint' }, 'Le note private sono cifrate (AES-256) con la tua password e non compaiono nell’elenco principale né nella ricerca generale.'),
      p1, h('div', { style: { height: '10px' } }), p2,
      h('label', { class: 'check' }, ok, h('span', null, 'Ho capito: se dimentico la password, le note private non si possono recuperare da nessuno.')),
      err, h('div', { class: 'btns' }, btn)
    );
    const sh = openSheet('Crea la password', box);
    setTimeout(() => p1.focus(), 250);
  }

  function unlockVault(cb) {
    const box = h('div');
    const p = pwField('pw', 'Password');
    const err = h('div', { class: 'err' });
    const btn = h('button', { class: 'btn pri', onclick: submit }, 'Sblocca');
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      if (!p.value) return;
      btn.disabled = true; err.textContent = '';
      if (S.fails) await sleep(Math.min(S.fails * 700, 6000));
      const key = await N.crypto.openVault(S.vaultMeta, p.value);
      if (!key) {
        S.fails++;
        err.textContent = 'Password errata.';
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        btn.disabled = false; p.select();
        return;
      }
      S.key = key; S.fails = 0;
      const bad = await decryptAll();
      await sh.close();
      if (bad) toast(bad + ' note private non decifrabili (da un altro backup?)', 4500);
      cb();
    }
    box.append(p, err, h('div', { class: 'btns' }, btn));
    const sh = openSheet('Note private', box);
    setTimeout(() => p.focus(), 250);
  }

  async function lockVault(manual) {
    if (!S.key) return;
    if (S.ed && S.ed.n.hidden) { flushNow(S.ed.n); }
    await chain;
    if (layers.length) {
      history.go(-layers.length);
      await new Promise((r) => { waiters.push(r); setTimeout(r, 600); });
    }
    await chain;
    S.key = null;
    await loadNotes();
    if (S.filter.type === 'vault') S.filter = { type: 'all', folder: null, tag: null, q: '' };
    S.sel.clear();
    renderAll();
    if (manual) toast('Note private bloccate 🔒');
  }

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else {
      if (S.key && S.settings.lockOnExit && hiddenAt && Date.now() - hiddenAt > 20000) lockVault(false);
      checkReminders();
    }
  });

  function changePasswordSheet() {
    if (!S.key) return requireVault(changePasswordSheet);
    const box = h('div');
    const o = pwField('o', 'Password attuale');
    const p1 = pwField('n1', 'Nuova password (almeno 6 caratteri)');
    const p2 = pwField('n2', 'Ripeti la nuova password');
    const err = h('div', { class: 'err' });
    const btn = h('button', { class: 'btn pri', onclick: async () => {
      err.textContent = '';
      if (S.notes.some((n) => n.hidden && n._locked)) return (err.textContent = 'Alcune note private non sono decifrabili: impossibile cambiare password.');
      if (!(await N.crypto.openVault(S.vaultMeta, o.value))) return (err.textContent = 'La password attuale non è corretta.');
      if (p1.value.length < 6) return (err.textContent = 'La nuova password deve avere almeno 6 caratteri.');
      if (p1.value !== p2.value) return (err.textContent = 'Le due nuove password non coincidono.');
      btn.disabled = true; btn.textContent = 'Aggiornamento…';
      try {
        await chain;
        const v = await N.crypto.createVault(p1.value);
        const recs = [];
        for (const n of S.notes.filter((x) => x.hidden)) {
          const payload = {}; FIELDS.forEach((f) => (payload[f] = n[f]));
          recs.push({ id: n.id, hidden: true, created: n.created, updated: n.updated, enc: await N.crypto.encryptJSON(v.key, payload) });
        }
        await N.db.putMany(recs);
        await N.db.setMeta('vault', v.meta);
        S.vaultMeta = v.meta; S.key = v.key;
        await sh.close(); toast('Password aggiornata ✓');
      } catch (e) { err.textContent = 'Errore: ' + e.message; btn.disabled = false; btn.textContent = 'Cambia password'; }
    } }, 'Cambia password');
    box.append(o, h('div', { style: { height: '10px' } }), p1, h('div', { style: { height: '10px' } }), p2, err, h('div', { class: 'btns' }, btn));
    const sh = openSheet('Cambia password', box);
  }

  /* =============== backup / importazione =============== */
  async function exportBackup(pw) {
    const raw = await N.db.all();
    const payload = { notes: raw, vault: S.vaultMeta || null, folders: S.folders };
    const file = pw
      ? { format: 'mie-note-backup', v: 1, encrypted: true, sealed: await N.crypto.sealWithPassword(pw, payload) }
      : { format: 'mie-note-backup', v: 1, encrypted: false, payload };
    const d = new Date();
    const fname = 'mie-note-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    download(new Blob([JSON.stringify(file)], { type: 'application/json' }), fname);
    await N.db.setMeta('lastBackup', Date.now());
    toast('Backup salvato: ' + fname, 3500);
  }

  async function restoreBackup(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { return toast('File non valido'); }
    if (!obj || obj.format !== 'mie-note-backup') return toast('Questo non è un backup di Le Mie Note');
    let payload = obj.payload;
    if (obj.encrypted) {
      const pw = prompt('Questo backup è protetto. Inserisci la password del backup:');
      if (!pw) return;
      try { payload = await N.crypto.unsealWithPassword(pw, obj.sealed); } catch (e) { return toast('Password del backup errata'); }
    }
    if (!payload || !Array.isArray(payload.notes)) return toast('Backup danneggiato');
    const current = new Map((await N.db.all()).map((r) => [r.id, r]));
    let skippedHidden = 0, added = 0;
    const hasHidden = payload.notes.some((r) => r.hidden);
    if (hasHidden && payload.vault) {
      if (!S.vaultMeta) { S.vaultMeta = payload.vault; await N.db.setMeta('vault', payload.vault); }
    }
    const incompatible = hasHidden && S.vaultMeta && (!payload.vault || payload.vault.salt !== S.vaultMeta.salt);
    const toPut = [];
    for (const r of payload.notes) {
      if (!r || !r.id) continue;
      if (r.hidden && incompatible) { skippedHidden++; continue; }
      const ex = current.get(r.id);
      if (!ex || (r.updated || 0) > (ex.updated || 0)) { toPut.push(r); added++; }
    }
    await N.db.putMany(toPut);
    (payload.folders || []).forEach((f) => { if (!S.folders.includes(f)) S.folders.push(f); });
    await N.db.setMeta('folders', S.folders);
    const wasKey = S.key;
    await loadNotes();
    if (wasKey) await decryptAll();
    renderAll();
    toast('Ripristinate ' + added + ' note' + (skippedHidden ? ' (' + skippedHidden + ' private ignorate: password diversa)' : ''), 4500);
  }

  async function importTexts(files) {
    let c = 0;
    for (const f of files) {
      const t = await f.text();
      const now = Date.now();
      const n = normalize({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), body: t, created: now, updated: now });
      S.notes.push(n);
      await persist(n);
      c++;
    }
    renderAll();
    toast(c + ' file importati come note');
  }

  async function backupSheet() {
    const box = h('div');
    const last = await N.db.getMeta('lastBackup');
    const pw = h('input', { class: 'field', type: 'password', placeholder: 'Password del backup (facoltativa)', autocomplete: 'off' });
    const fRestore = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { await sh.close(); restoreBackup(f); } } });
    const fImport = h('input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown', multiple: true, class: 'hidden', onchange: async (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) { await sh.close(); importTexts(fs); } } });
    box.append(
      h('p', { class: 'hint' }, 'Le note vivono solo su questo telefono. Fai un backup ogni tanto e conservalo altrove (Drive, PC…). ' + (last ? 'Ultimo backup: ' + new Date(last).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) + '.' : 'Non hai ancora fatto nessun backup.')),
      h('label', null, 'Proteggi il file di backup con una password'), pw,
      h('p', { class: 'hint' }, 'Senza password il backup contiene le note normali in chiaro; le note private restano sempre cifrate.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: async () => { await exportBackup(pw.value || null); sh.close(); } }, 'Crea backup')),
      h('div', { class: 'sec', style: { margin: '18px 4px 6px', color: 'var(--muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.06em' } }, 'Ripristina e importa'),
      h('button', { class: 'item', onclick: () => fRestore.click() }, h('span', { html: I('restore') }), h('span', null, 'Ripristina da backup', h('small', null, 'Unisce le note del file a quelle esistenti'))),
      h('button', { class: 'item', onclick: () => fImport.click() }, h('span', { html: I('file') }), h('span', null, 'Importa file di testo', h('small', null, 'Uno o più file .txt o .md, ognuno diventa una nota'))),
      fRestore, fImport
    );
    const sh = openSheet('Backup e importazione', box);
  }

  /* =============== impostazioni =============== */
  function applyTheme() {
    const t = S.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const m = $('#themeColor');
    if (m) m.content = dark ? '#000000' : '#f2f2f7';
    const a = ACCENTS[S.settings.accent] || ACCENTS.amber, st = document.documentElement.style;
    st.setProperty('--accent', dark ? a[0] : a[1]);
    st.setProperty('--accent-ink', dark ? a[2] : '#ffffff');
    st.fontSize = (S.settings.fontSize || 100) + '%';
    st.setProperty('--font-size-base', '1rem');
  }
  function saveSettings() { N.db.setMeta('settings', S.settings); }

  function settingsSheet() {
    const box = h('div');
    function draw() {
      box.innerHTML = '';
      box.append(
        h('label', null, 'Tema'),
        h('div', { class: 'seg' }, [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([v, l]) => h('button', { class: S.settings.theme === v ? 'on' : '', onclick: () => { S.settings.theme = v; saveSettings(); applyTheme(); draw(); } }, l))),
        h('label', null, 'Colore d’accento'),
        h('div', { class: 'swatches', style: { gridTemplateColumns: 'repeat(6, 1fr)' } }, Object.entries(ACCENTS).map(([k, a]) => h('button', { class: 'sw' + ((S.settings.accent || 'amber') === k ? ' on' : ''), style: { background: a[0] }, 'aria-label': k, onclick: () => { S.settings.accent = k; saveSettings(); applyTheme(); draw(); } }))),
        h('label', null, 'Dimensione del testo'),
        h('div', { class: 'seg' }, [[90, 'Piccolo'], [100, 'Normale'], [112, 'Grande'], [126, 'Enorme']].map(([v, l]) => h('button', { class: (S.settings.fontSize || 100) === v ? 'on' : '', onclick: () => { S.settings.fontSize = v; saveSettings(); applyTheme(); draw(); } }, l))),
        h('label', null, 'Ordina le note per'),
        h('div', { class: 'seg' }, [['modified', 'Modifica'], ['created', 'Creazione'], ['title', 'Titolo']].map(([v, l]) => h('button', { class: (S.settings.sort || 'modified') === v ? 'on' : '', onclick: () => { S.settings.sort = v; saveSettings(); renderList(); draw(); } }, l))),
        h('label', null, 'Cestino: elimina dopo'),
        h('div', { class: 'seg' }, [[7, '7 giorni'], [30, '30 giorni'], [90, '90 giorni'], [0, 'Mai']].map(([v, l]) => h('button', { class: (S.settings.trashDays === undefined ? 30 : S.settings.trashDays) === v ? 'on' : '', onclick: () => { S.settings.trashDays = v; saveSettings(); draw(); } }, l))),
        h('label', { class: 'switch' }, h('span', null, 'Cronologia delle versioni', h('small', null, 'Ogni nota conserva versioni precedenti a cui tornare')), h('input', { type: 'checkbox', checked: S.settings.versions !== false, onchange: (e) => { S.settings.versions = e.target.checked; saveSettings(); } })),
        h('label', null, 'Versioni conservate per nota'),
        h('div', { class: 'seg' }, [5, 15, 30].map((v) => h('button', { class: (S.settings.verLimit || 15) === v ? 'on' : '', onclick: () => { S.settings.verLimit = v; saveSettings(); draw(); } }, String(v)))),
        h('button', { class: 'item', onclick: () => {
          const withV = S.notes.filter((n) => !n._locked && n.versions && n.versions.length);
          if (!withV.length) return toast('Non ci sono cronologie da cancellare');
          if (!confirm('Cancellare le versioni salvate di ' + withV.length + ' note? Le note restano com’è ora.')) return;
          withV.forEach((n) => { n.versions = []; persist(n); });
          toast('Cronologie cancellate');
        } }, h('span', { html: I('trash') }), h('span', null, 'Cancella tutte le cronologie', h('small', null, 'Libera spazio e riduce la dimensione dei backup'))),
        h('div', { style: { height: '8px' } }),
        h('label', { class: 'switch' }, h('span', null, 'Blocca le note private all’uscita', h('small', null, 'Richiede di nuovo la password dopo aver lasciato l’app per più di 20 secondi')), h('input', { type: 'checkbox', checked: S.settings.lockOnExit, onchange: (e) => { S.settings.lockOnExit = e.target.checked; saveSettings(); } })),
        h('button', { class: 'item', onclick: async () => { if (!('Notification' in window)) return toast('Notifiche non supportate da questo dispositivo'); const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notifiche abilitate' : 'Permesso notifiche non concesso'); } }, h('span', { html: I('bell') }), h('span', null, 'Abilita notifiche', h('small', null, 'Per ricevere gli avvisi dei promemoria'))),
        h('label', { class: 'switch' }, h('span', null, 'Nascondi la voce «Note private»', h('small', null, 'Per aprirle tocca 5 volte il titolo «Note» in alto')), h('input', { type: 'checkbox', checked: S.settings.stealth, onchange: (e) => { S.settings.stealth = e.target.checked; saveSettings(); } })),
        S.vaultMeta ? h('button', { class: 'item', onclick: async () => { await sh.close(); changePasswordSheet(); } }, h('span', { html: I('lock') }), 'Cambia password delle note private') : document.createComment(''),
        S.installEvt ? h('button', { class: 'item', onclick: async () => { S.installEvt.prompt(); try { await S.installEvt.userChoice; } catch (e) {} S.installEvt = null; draw(); } }, h('span', { html: I('down') }), 'Installa l’app sul telefono') : h('p', { class: 'hint' }, 'Per installarla: nel menu del browser (⋮) scegli «Installa app» o «Aggiungi a schermata Home». Poi funziona anche senza internet.'),
        h('p', { class: 'hint', id: 'storeinfo' })
      );
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then((e) => { const el = $('#storeinfo', box); if (el) el.textContent = 'Spazio usato: ' + ((e.usage || 0) / 1048576).toFixed(1) + ' MB. Le note restano salvate sul dispositivo.'; });
      }
    }
    draw();
    const sh = openSheet('Impostazioni', box);
  }


  /* =============== funzioni extra =============== */
  const ACCENTS = { amber: ['#ff9f0a', '#c77700', '#1a1100'], blue: ['#0a84ff', '#0066d6', '#ffffff'], green: ['#30d158', '#1f8f3d', '#04210d'], pink: ['#ff375f', '#d6264a', '#ffffff'], purple: ['#bf5af2', '#8e3fc4', '#ffffff'], graphite: ['#aeaeb2', '#48484a', '#111111'] };

  /* calcolatrice nel testo: scrivi "12*3+4 =" e premi Invio */
  function calc(src) {
    const s = src.replace(/[x×X]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '').replace(/,/g, '.');
    let i = 0;
    const peek = () => s[i];
    function num() { const m = s.slice(i).match(/^\d*\.?\d+/); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); }
    function prim() { if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; } return num(); }
    function post() { let v = prim(); while (peek() === '%') { i++; v /= 100; } return v; }
    function un() { if (peek() === '-') { i++; return -un(); } if (peek() === '+') { i++; return un(); } return post(); }
    function pow() { const b = un(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; }
    function term() { let v = pow(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const r = pow(); v = o === '*' ? v * r : v / r; } return v; }
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
    try { const v = expr(); return i === s.length && isFinite(v) ? v : null; } catch (e) { return null; }
  }
  function textKey(e, ta) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || ta.readOnly) return;
    const v = ta.value, pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return;
    const ls = v.lastIndexOf('\n', pos - 1) + 1, line = v.slice(ls, pos);
    const put = (t) => { ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); };
    const cm = line.match(/^\s*([\d\s.,+\-*/()^%×÷xX]*\d[\d\s.,+\-*/()^%×÷xX]*?)\s*=\s*$/);
    if (cm && /[+\-*/^×÷xX%]/.test(cm[1].trim().replace(/^-/, ''))) {
      const r = calc(cm[1]);
      if (r != null) { e.preventDefault(); put(' ' + (+r.toFixed(8)).toLocaleString('it-IT', { maximumFractionDigits: 8 }) + '\n'); return; }
    }
    const bm = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (bm) {
      e.preventDefault();
      if (!bm[3].trim()) { ta.setRangeText('', ls, pos, 'end'); ta.dispatchEvent(new Event('input')); return; }
      const mk = /^\d/.test(bm[2]) ? (parseInt(bm[2], 10) + 1) + bm[2].slice(-1) : bm[2];
      put('\n' + bm[1] + mk + ' ');
    }
  }

  /* cronologia versioni */
  function snap(n, force) {
    const v = n.versions = n.versions || [];
    const cur = { t: Date.now(), kind: n.kind, title: n.title, body: n.body, items: JSON.parse(JSON.stringify(n.items || [])) };
    const last = v[v.length - 1];
    const same = last && last.kind === cur.kind && last.title === cur.title && last.body === cur.body && JSON.stringify(last.items) === JSON.stringify(cur.items);
    if (same || !hasContent(n) || (!force && (S.settings.versions === false || (last && cur.t - last.t < 300000)))) return;
    v.push(cur);
    const lim = S.settings.verLimit || 15;
    while (v.length > lim) v.shift();
  }
  function versionsSheet(n) {
    const box = h('div');
    const vs = (n.versions || []).slice().reverse();
    if (!vs.length) box.append(h('p', { class: 'hint' }, S.settings.versions === false ? 'La cronologia è disattivata: puoi riattivarla in Impostazioni.' : 'Le versioni si salvano da sole mentre scrivi (al massimo una ogni 5 minuti). Per ora non ce ne sono.'));
    else box.append(h('p', { class: 'hint' }, 'Ripristinando una versione, quella attuale viene salvata prima: non perdi nulla.'));
    vs.forEach((v) => {
      const prev = (v.kind === 'list' ? (v.items || []).map((i) => i.t).join(', ') : v.body || '').trim().slice(0, 90) || '(vuota)';
      box.append(h('div', { class: 'ver' },
        h('div', null, h('strong', null, fmtFull(v.t)), h('small', null, (v.title ? v.title + ' — ' : '') + prev)),
        h('button', { class: 'btn', onclick: async () => {
          snap(n, true);
          n.kind = v.kind; n.title = v.title || ''; n.body = v.body || ''; n.items = JSON.parse(JSON.stringify(v.items || []));
          await sh.close();
          touch(); S.ed.setTitle(n.title); S.ed.drawContent(); S.ed.refreshTools(); S.ed.drawMeta();
          toast('Versione ripristinata');
        } }, 'Ripristina')));
    });
    const sh = openSheet('Cronologia versioni', box);
  }

  /* collegamenti tra note [[Titolo]] */
  function linkSheet(n) {
    const box = h('div');
    const list = S.notes.filter((x) => x.id !== n.id && !x._locked && !x.trashed && !!x.hidden === !!n.hidden && (x.title || '').trim()).sort((a, b) => a.title.localeCompare(b.title, 'it'));
    if (!list.length) box.append(h('p', { class: 'hint' }, 'Servono altre note con un titolo. Nel testo puoi anche scrivere [[Titolo]] a mano: se la nota non esiste, la crei con un tocco.'));
    else box.append(h('p', { class: 'hint' }, 'Inserisce [[Titolo]] nel testo. Nella nota collegata comparirà «Citata in».'));
    list.forEach((x) => box.append(h('button', { class: 'item', onclick: async () => {
      await sh.close();
      n.body = (n.body ? n.body.replace(/\s+$/, '') + ' ' : '') + '[[' + x.title.trim() + ']]';
      touch(); S.ed.drawContent(); S.ed.drawMeta();
    } }, h('span', { html: I('link') }), x.title)));
    const sh = openSheet('Collega a una nota', box);
  }
  function newLinked(title, hidden) {
    const now = Date.now();
    const nn = normalize({ id: uid(), kind: 'text', title, created: now, updated: now, hidden: !!hidden });
    S.notes.push(nn);
    persist(nn);
    openEditor(nn, true);
  }

  function editorExtraRows(n, row) {
    const R = [];
    const refresh = () => { touch(); S.ed.drawContent(); S.ed.drawMeta(); };
    if (n.kind === 'list') {
      R.push(row('check', 'Completate in fondo', () => { n.items = [...n.items.filter((i) => !i.done), ...n.items.filter((i) => i.done)]; refresh(); }));
      R.push(row('trash', 'Elimina voci completate', () => { n.items = n.items.filter((i) => !i.done); if (!n.items.length) n.items = [{ t: '', done: false }]; refresh(); }));
    } else R.push(row('link', 'Collega a un’altra nota…', () => linkSheet(n)));
    const rw = (fn) => () => (n.readonly ? toast('Nota in sola lettura') : fn());
    if (n.kind === 'list') R.push(row('restore', 'Deseleziona tutte le voci', () => { n.items.forEach((i) => (i.done = false)); refresh(); }, '', 'Utile per liste che si ripetono'));
    else {
      R.push(row('text', 'Ordina le righe A→Z', rw(() => { n.body = (n.body || '').split('\n').filter((l) => l.trim()).sort((a, b) => a.localeCompare(b, 'it')).join('\n'); refresh(); })));
      R.push(row('copy', 'Rimuovi le righe duplicate', rw(() => { const seen = new Set(); n.body = (n.body || '').split('\n').filter((l) => { if (!l.trim()) return true; const k = l.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join('\n'); refresh(); })));
    }
    R.push(row('clock', 'Inserisci data e ora', rw(() => { const s = new Date().toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'short' }); if (n.kind === 'list') n.items.push({ t: s, done: false }); else n.body = (n.body ? n.body.replace(/\s+$/, '') + '\n' : '') + s; refresh(); })));
    R.push(row('copy', 'Copia il testo', () => { navigator.clipboard.writeText(N.ai.noteText(n)).then(() => toast('Testo copiato'), () => toast('Copia non disponibile')); }));
    R.push(row('edit', n.readonly ? 'Rendi modificabile' : 'Sola lettura', () => { n.readonly = !n.readonly; touch(); S.ed.setRO(); S.ed.drawContent(); S.ed.drawMeta(); toast(n.readonly ? 'Nota bloccata: non si può modificare' : 'Nota modificabile'); }, '', 'Evita modifiche accidentali'));
    R.push(row('archive', n.archived ? 'Rimuovi dall’archivio' : 'Archivia', () => { n.archived = !n.archived; persist(n); toast(n.archived ? 'Nota archiviata' : 'Nota ripristinata', 5000, { label: 'Annulla', fn: () => { n.archived = !n.archived; persist(n); renderAll(); } }); back(); }, '', 'La nasconde senza eliminarla'));
    R.push(row('clock', 'Cronologia versioni', () => versionsSheet(n), '', (n.versions || []).length + ' salvate'));
    const f = S.ed.el.classList.contains('focus');
    R.push(row('eye', f ? 'Esci dalla modalità focus' : 'Modalità focus', () => S.ed.el.classList.toggle('focus'), '', 'Nasconde tutto tranne il testo'));
    return R;
  }

  /* dettatura vocale (dove il browser la supporta) */
  let rec = null;
  function dictate(n) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mark = (on) => { const b = S.ed && S.ed.el && S.ed.el.querySelector('[data-k="wave"]'); if (b) b.classList.toggle('rec', on); };
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
      t = t.trim();
      if (!t || !S.ed) return;
      if (n.kind === 'list') n.items = n.items.filter((x) => x.t.trim()).concat({ t, done: false });
      else n.body = (n.body && !/\s$/.test(n.body) ? n.body + ' ' : n.body || '') + t;
      touch(); S.ed.drawContent(); S.ed.drawMeta();
    };
    rec.onerror = (e) => toast(e.error === 'not-allowed' ? 'Permesso al microfono negato' : 'Dettatura non riuscita');
    rec.onend = () => { rec = null; mark(false); };
    try { rec.start(); mark(true); toast('Sto ascoltando… tocca di nuovo per fermare'); } catch (e) { rec = null; }
  }

  /* diario: una nota per ogni giorno */
  function openToday() {
    let t = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    t = t.charAt(0).toUpperCase() + t.slice(1);
    let n = S.notes.find((x) => !x._locked && !x.hidden && !x.trashed && x.title === t && x.folder === 'Diario');
    if (!n) {
      const now = Date.now();
      addFolder('Diario');
      n = normalize({ id: uid(), kind: 'text', title: t, folder: 'Diario', tags: ['diario'], created: now, updated: now });
      S.notes.push(n);
      persist(n);
    }
    openEditor(n);
  }

  /* =============== avvio =============== */
  async function boot() {
    document.documentElement.lang = 'it';
    try {
      S.settings = Object.assign(S.settings, (await N.db.getMeta('settings')) || {});
      S.vaultMeta = (await N.db.getMeta('vault')) || null;
      S.folders = (await N.db.getMeta('folders')) || [];
      await loadNotes();
    } catch (e) {
      $('#root').innerHTML = '<p style="padding:24px">Impossibile aprire l’archivio locale. Se stai usando la navigazione privata, riprova in una finestra normale.</p>';
      console.error(e);
      return;
    }
    // svuota automaticamente il cestino dopo 30 giorni
    const old = S.notes.filter((n) => !n._locked && n.trashed && (S.settings.trashDays === undefined ? 30 : S.settings.trashDays) > 0 && Date.now() - n.trashed > (S.settings.trashDays === undefined ? 30 : S.settings.trashDays) * 86400e3);
    for (const n of old) await removeForever(n);
    applyTheme();
    buildShell();
    renderAll();
    const quick = new URLSearchParams(location.search).get('new');
    if (quick) {
      history.replaceState(null, '', location.pathname);
      if (quick === 'today') openToday(); else if (quick === 'text' || quick === 'list') createNote(quick, false);
    }
    N.tools.init(toolsCtx()); // riprende cronometro / conto alla rovescia rimasti attivi
    if (new URLSearchParams(location.search).get('docs') !== null) {
      history.replaceState(null, '', location.pathname);
      openDocs();
    }
    if (new URLSearchParams(location.search).get('tools') !== null) {
      const tq = new URLSearchParams(location.search).get('tools');
      history.replaceState(null, '', location.pathname);
      openTools(['unit', 'disc', 'time', 'pad'].includes(tq) ? tq : undefined);
    }
    setTimeout(async () => {
      try {
        const now = Date.now(), last = await N.db.getMeta('lastBackup'), nag = await N.db.getMeta('nag');
        let first = await N.db.getMeta('firstSeen'); if (!first) { first = now; await N.db.setMeta('firstSeen', now); }
        if (S.notes.length > 2 && !S.ed && now - (last || first) > 14 * 864e5 && !(nag && now - nag < 3 * 864e5)) {
          await N.db.setMeta('nag', now);
          toast('Non fai un backup da più di due settimane', 9000, { label: 'Backup', fn: backupSheet });
        }
      } catch (e) {}
    }, 2500);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
    window.addEventListener('pagehide', () => { if (S.ed) flush(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

    checkReminders();
    setInterval(checkReminders, 15000);
    window.__app = { S, N }; // utile per il debug
  }

  boot();
})();
