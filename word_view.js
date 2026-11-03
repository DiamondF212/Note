/* Word — editor di documenti .docx (offline). Si apre da Documenti (tocca un file Word o + → Nuovo Word).
   Lettura: mammoth converte il .docx in HTML (titoli, grassetto/corsivo/sottolineato, elenchi, tabelle, immagini).
   Modifica: area di testo modificabile con barra degli strumenti. Salvataggio: il documento viene riscritto
   come .docx con il writer di word_core.js. Esporta in PDF (font Liberation Sans incorporato) e in nota.
   Limiti onesti: un .docx importato NON viene sovrascritto — le modifiche vanno in una copia «Nome (modificato)»
   (l'originale resta intatto); impaginazione, intestazioni/piè di pagina, note, caselle di testo, link, colori e
   caratteri dell'originale non sono conservati; celle unite in verticale non sono supportate. */
(function (N) {
  'use strict';

  const C = () => N.wordCore;
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /* =====================================================================
     1) HTML → HTML PULITO → MODELLO (serve un DOM)
     ===================================================================== */

  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'PRE', 'LI']);
  const KEEP = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL', 'BR', 'IMG', 'BLOCKQUOTE', 'PRE']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);
  const IMG_SRC = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i;

  function alignOf(el) {
    const a = ((el.style && el.style.textAlign) || el.getAttribute('align') || '').toLowerCase();
    return a === 'center' || a === 'right' || a === 'justify' ? a : (a === 'left' || a === 'start' ? 'left' : null);
  }

  // Copia in un HTML nuovo solo ciò che serve (niente script, stili, attributi strani, immagini da fuori).
  function sanitize(html) {
    const src = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html').body;
    const out = document.createElement('div');
    (function copy(from, to) {
      for (const n of Array.from(from.childNodes)) {
        if (n.nodeType === 3) { to.append(document.createTextNode(n.data)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toUpperCase();
        if (DROP.has(tag)) continue;
        if (!KEEP.has(tag)) { copy(n, to); continue; }
        if (tag === 'IMG') {
          const s = n.getAttribute('src') || '';
          if (IMG_SRC.test(s)) { const im = document.createElement('img'); im.setAttribute('src', s); im.setAttribute('alt', ''); to.append(im); }
          continue;
        }
        const e = document.createElement(tag === 'DIV' || tag === 'BLOCKQUOTE' || tag === 'PRE' ? 'p' : tag.toLowerCase());
        const al = alignOf(n); if (al && al !== 'left') e.style.textAlign = al;
        if (tag === 'TD' || tag === 'TH') { const cs = parseInt(n.getAttribute('colspan'), 10); if (cs > 1 && cs < 50) e.setAttribute('colspan', String(cs)); }
        copy(n, e); to.append(e);
        // un DIV con dentro altri blocchi è solo un contenitore
        if (tag === 'DIV' && Array.from(e.children).some((c) => BLOCK.has(c.tagName.toUpperCase()))) { while (e.firstChild) to.insertBefore(e.firstChild, e); e.remove(); }
      }
    })(src, out);
    return out.innerHTML;
  }

  function dataUri(src) {
    const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(src || '');
    if (!m) return null;
    try {
      const bin = atob(m[2]), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return { mime: m[1].toLowerCase().replace('image/jpg', 'image/jpeg'), bytes: u };
    } catch (e) { return null; }
  }

  function mergeRuns(runs) {
    const out = [];
    for (const r of runs) {
      const l = out[out.length - 1];
      if (l && !r.br && !l.br && !!l.b === !!r.b && !!l.i === !!r.i && !!l.u === !!r.u && !!l.s === !!r.s) l.text += r.text;
      else out.push(Object.assign({}, r));
    }
    return out;
  }

  // Trasforma un elemento HTML (l'editor) nel modello di word_core.js.
  function domToModel(root) {
    let listId = 0;
    const hasBlock = (el) => Array.from(el.children).some((c) => BLOCK.has(c.tagName.toUpperCase()) || c.tagName === 'TABLE');
    const isBlockEl = (n) => n.nodeType === 1 && (BLOCK.has(n.tagName) || n.tagName === 'TABLE');

    // contenuto "in linea": riempie st.runs; le immagini chiudono il paragrafo corrente e diventano blocchi
    function inline(node, fmt, st) {
      if (node.nodeType === 3) { const t = node.data.replace(/[\r\n\t]+/g, ' '); if (t) st.runs.push(Object.assign({ text: t }, fmt)); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'BR') { st.runs.push({ br: true }); return; }
      if (tag === 'IMG') {
        const d = dataUri(node.getAttribute('src'));
        if (!d) return;
        st.flush(false); st.imgs = (st.imgs || 0) + 1;
        st.blocks.push({ t: 'img', mime: d.mime, bytes: d.bytes, w: node.naturalWidth || 0, h: node.naturalHeight || 0 });
        return;
      }
      const f = Object.assign({}, fmt);
      if (tag === 'B' || tag === 'STRONG') f.b = true;
      if (tag === 'I' || tag === 'EM') f.i = true;
      if (tag === 'U') f.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
      if (BLOCK.has(tag) && st.runs.length) st.runs.push({ br: true }); // blocco dentro un paragrafo: va a capo
      for (const c of Array.from(node.childNodes)) inline(c, f, st);
    }

    // un <br> finale in un blocco non si vede in HTML: non va contato come a capo
    function trimBr(runs) {
      const n = runs.length;
      if (n && runs[n - 1].br && (n === 1 || !runs[n - 2].br)) return runs.slice(0, n - 1);
      return runs;
    }

    // paragrafo (o voce di elenco) da un elemento
    function para(el, mk, blocks) {
      const st = { runs: [], imgs: 0, flush(force) {
        const runs = trimBr(mergeRuns(st.runs)); st.runs = [];
        if (runs.length || force) blocks.push(mk(runs));
      } };
      st.blocks = blocks;
      for (const c of Array.from(el.childNodes)) inline(c, {}, st);
      st.flush(!st.imgs); // un paragrafo vuoto resta, ma non se conteneva solo un'immagine
    }

    function list(el, level, ord, id, blocks) {
      const sub = (k) => { const o = k.tagName === 'OL'; list(k, Math.min(8, level + 1), o, o === ord ? id : ++listId, blocks); };
      for (const c of Array.from(el.children)) {
        const tag = c.tagName;
        if (tag === 'UL' || tag === 'OL') { sub(c); continue; }
        if (tag !== 'LI') continue;
        const al = alignOf(c) || 'left';
        const own = document.createElement('li');
        for (const k of Array.from(c.childNodes)) if (!(k.nodeType === 1 && (k.tagName === 'UL' || k.tagName === 'OL'))) own.append(k.cloneNode(true));
        para(own, (runs) => ({ t: 'li', ord, list: id, level, align: al, runs }), blocks);
        for (const k of Array.from(c.children)) if (k.tagName === 'UL' || k.tagName === 'OL') sub(k);
      }
    }

    function table(el, flat, blocks) {
      const rows = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el);
      const model = [];
      for (const tr of rows) {
        const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
        if (!cells.length) continue;
        model.push(cells.map((c) => ({ blocks: collect(c, true), span: Math.max(1, parseInt(c.getAttribute('colspan'), 10) || 1) })));
      }
      if (!model.length) return;
      if (flat) { model.forEach((r) => r.forEach((c) => c.blocks.forEach((b) => { if (b.t !== 'tbl') blocks.push(b); }))); return; }
      blocks.push({ t: 'tbl', rows: model });
    }

    // visita i figli di un contenitore e produce blocchi; il testo "sciolto" diventa paragrafi
    function collect(parent, inCell) {
      const blocks = [];
      let loose = { runs: [], blocks, imgs: 0, flush() { const runs = trimBr(mergeRuns(loose.runs)); loose.runs = []; if (runs.length && runs.some((r) => r.br || /\S/.test(r.text))) blocks.push({ t: 'p', style: 'n', align: 'left', runs }); } };
      for (const n of Array.from(parent.childNodes)) {
        if (!isBlockEl(n)) { inline(n, {}, loose); continue; }
        loose.flush();
        const tag = n.tagName;
        if (tag === 'UL' || tag === 'OL') { list(n, 0, tag === 'OL', ++listId, blocks); continue; }
        if (tag === 'TABLE') { table(n, !!inCell, blocks); continue; }
        if (tag === 'LI') { const id = ++listId; para(n, (runs) => ({ t: 'li', ord: false, list: id, level: 0, align: 'left', runs }), blocks); continue; }
        if (hasBlock(n)) { blocks.push(...collect(n, inCell)); continue; }
        const style = tag === 'H1' ? 'h1' : tag === 'H2' ? 'h2' : /^H[3-6]$/.test(tag) ? 'h3' : 'n';
        const al = alignOf(n) || 'left';
        para(n, (runs) => ({ t: 'p', style, align: al, runs }), blocks);
      }
      loose.flush();
      return blocks;
    }
    return collect(root, false);
  }

  /* =====================================================================
     2) IMMAGINI, ZIP, PDF
     ===================================================================== */

  function* allImages(model) {
    for (const b of model) {
      if (b.t === 'img') yield b;
      else if (b.t === 'tbl') for (const r of b.rows) for (const c of r.cells || r) yield* allImages(c.blocks);
    }
  }

  // Word e PDF accettano solo PNG e JPEG: gli altri formati (WebP, GIF) si convertono; misure mancanti si leggono.
  async function fixImages(model) {
    for (const b of Array.from(allImages(model))) {
      if ((b.mime === 'image/png' || b.mime === 'image/jpeg') && b.w > 0 && b.h > 0) continue;
      const bmp = await createImageBitmap(new Blob([b.bytes], { type: b.mime }));
      b.w = bmp.width; b.h = bmp.height;
      if (b.mime !== 'image/png' && b.mime !== 'image/jpeg') {
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        b.bytes = new Uint8Array(await blob.arrayBuffer()); b.mime = 'image/png';
      }
      if (bmp.close) bmp.close();
    }
  }

  async function buildDocx(model) {
    await fixImages(model);
    const blob = N.exp.zip(C().buildDocxFiles(model), MIME);
    return blob.arrayBuffer();
  }

  async function buildPdf(A, model, title) {
    await A.lib('pdflib');
    await fixImages(model);
    const { PDFDocument, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(window.fontkit);
    const files = { r: 'Regular', b: 'Bold', i: 'Italic', bi: 'BoldItalic' }, fonts = {}, sets = {};
    for (const k of Object.keys(files)) {
      const r = await fetch('vendor/pdfjs/standard_fonts/LiberationSans-' + files[k] + '.ttf');
      if (!r.ok) throw new Error('font non trovato');
      fonts[k] = await doc.embedFont(await r.arrayBuffer(), { subset: true });
      sets[k] = new Set(fonts[k].getCharacterSet());
    }
    // un carattere che il font non ha (emoji, simboli rari) diventa «?»
    const fix = (t) => Array.from(String(t).replace(/ /g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')).map((ch) => (sets.r.has(ch.codePointAt(0)) ? ch : '?')).join('');
    const measure = (st, size, text) => fonts[st].widthOfTextAtSize(text, size);
    const L = C().layout(model, measure, fix);
    const cache = new Map();
    const black = rgb(0, 0, 0), grey = rgb(0.5, 0.5, 0.5);
    for (const items of L.pages) {
      const pg = doc.addPage([L.pw, L.ph]);
      for (const it of items) {
        if (it.k === 't') {
          const base = L.ph - it.y - it.size * 1.055;
          pg.drawText(it.text, { x: it.x, y: base, size: it.size, font: fonts[it.st], color: black });
          const w = fonts[it.st].widthOfTextAtSize(it.text, it.size);
          if (it.u) pg.drawLine({ start: { x: it.x, y: base - it.size * 0.12 }, end: { x: it.x + w, y: base - it.size * 0.12 }, thickness: it.size * 0.06, color: black });
          if (it.s) pg.drawLine({ start: { x: it.x, y: base + it.size * 0.3 }, end: { x: it.x + w, y: base + it.size * 0.3 }, thickness: it.size * 0.06, color: black });
        } else if (it.k === 'l') {
          pg.drawLine({ start: { x: it.x1, y: L.ph - it.y1 }, end: { x: it.x2, y: L.ph - it.y2 }, thickness: 0.6, color: grey });
        } else if (it.k === 'i') {
          let im = cache.get(it.img);
          if (!im) { im = it.img.mime === 'image/png' ? await doc.embedPng(it.img.bytes) : await doc.embedJpg(it.img.bytes); cache.set(it.img, im); }
          pg.drawImage(im, { x: it.x, y: L.ph - it.y - it.h, width: it.w, height: it.h });
        }
      }
    }
    doc.setTitle(String(title || 'Documento'));
    const u8 = await doc.save();
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  /* =====================================================================
     3) INTERFACCIA
     ===================================================================== */

  const SVG_AL = { left: [[4, 6, 16], [4, 11, 10], [4, 16, 16]], center: [[4, 6, 16], [7, 11, 10], [4, 16, 16]], right: [[4, 6, 16], [10, 11, 10], [4, 16, 16]], justify: [[4, 6, 16], [4, 11, 16], [4, 16, 16]] };
  const alignIcon = (k) => '<svg class="i" viewBox="0 0 24 24" width="22" height="22">' + SVG_AL[k].map(([x, y, w]) => '<path d="M' + x + ' ' + y + 'h' + w + '"/>').join('') + '</svg>';

  async function picture(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const png = /png|gif|webp|svg/.test(file.type);
    if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const url = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86);
    c.width = c.height = 0;
    return url;
  }

  async function openWord(d, A) {
    const h = A.h;
    await A.lib('mammoth');
    await A.lib('pdflib'); // già pronta per l'esportazione in PDF (resta in cache)
    let html = '';
    try {
      const r = await window.mammoth.convertToHtml({ arrayBuffer: d.data.slice(0) }, { styleMap: ['u => u', 'strike => s'] });
      html = r.value || '';
    } catch (e) { throw new Error('file Word non leggibile'); }
    let target = d, dirty = false, dead = false, last = null, chain = Promise.resolve();

    const editor = h('div', { class: 'word-doc', contenteditable: 'true', spellcheck: 'true', lang: 'it', 'data-word-editor': '1', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Testo del documento' });
    editor.innerHTML = sanitize(html) || '<div><br></div>';
    if (!editor.firstChild) editor.innerHTML = '<div><br></div>';

    const model = () => domToModel(editor);

    /* ----- salvataggio ----- */
    function save() {
      chain = chain.then(async () => {
        if (!dirty) return;
        dirty = false;
        try {
          const data = await buildDocx(model());
          if (target.origin !== 'note') {
            const c = await A.addDoc('docx', target.name + ' (modificato)', data);
            c.origin = 'note'; await A.save(c);
            target = c; if (!dead) scr.setTitle(c.name);
            A.toast('Copia creata: «' + c.name + '». L’originale non è stato toccato.', 4200);
          } else {
            target.data = data; await A.save(target);
            if (!dead) A.toast('Salvato');
          }
        } catch (e) { dirty = true; console.error(e); A.toast('Impossibile salvare: ' + (e.message || e), 4500); }
      });
      return chain;
    }

    /* ----- selezione e barra ----- */
    const inEditor = () => { const s = document.getSelection(); return s && s.rangeCount && editor.contains(s.anchorNode); };
    const onSel = () => {
      if (dead) return;
      if (inEditor()) last = document.getSelection().getRangeAt(0).cloneRange();
      paintBar();
    };
    const restore = () => {
      editor.focus();
      const s = document.getSelection();
      if (last && editor.contains(last.startContainer)) { s.removeAllRanges(); s.addRange(last); return; }
      const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); s.removeAllRanges(); s.addRange(r);
    };
    const run = (cmd, val) => { if (!inEditor()) restore(); document.execCommand(cmd, false, val); dirty = true; onSel(); };
    const blockTag = () => { try { return String(document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, ''); } catch (e) { return ''; } };
    const state = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };

    const bar = h('div', { class: 'word-bar', role: 'toolbar', 'aria-label': 'Formattazione' });
    const btns = [];
    const add = (key, label, fn, opts) => {
      opts = opts || {};
      const b = h('button', { type: 'button', class: 'wbtn' + (opts.cls ? ' ' + opts.cls : ''), 'data-w': key, 'aria-label': opts.aria || label, onpointerdown: (e) => e.preventDefault(), onmousedown: (e) => e.preventDefault(), onclick: fn, html: opts.html || null }, opts.html ? null : label);
      btns.push([key, b, opts.on]); bar.append(b); return b;
    };
    const sep = () => bar.append(h('span', { class: 'wsep' }));
    add('bold', 'B', () => run('bold'), { aria: 'Grassetto', cls: 'wb', on: () => state('bold') });
    add('italic', 'I', () => run('italic'), { aria: 'Corsivo', cls: 'wi', on: () => state('italic') });
    add('underline', 'U', () => run('underline'), { aria: 'Sottolineato', cls: 'wu', on: () => state('underline') });
    add('strike', 'S', () => run('strikeThrough'), { aria: 'Barrato', cls: 'ws', on: () => state('strikeThrough') });
    sep();
    add('p', 'Aa', () => run('formatBlock', 'p'), { aria: 'Testo normale', on: () => ['p', 'div', ''].includes(blockTag()) && !state('insertUnorderedList') && !state('insertOrderedList') });
    add('h1', 'T1', () => run('formatBlock', 'h1'), { aria: 'Titolo 1', on: () => blockTag() === 'h1' });
    add('h2', 'T2', () => run('formatBlock', 'h2'), { aria: 'Titolo 2', on: () => blockTag() === 'h2' });
    add('h3', 'T3', () => run('formatBlock', 'h3'), { aria: 'Titolo 3', on: () => blockTag() === 'h3' });
    sep();
    add('ul', '•', () => run('insertUnorderedList'), { aria: 'Elenco puntato', on: () => state('insertUnorderedList') });
    add('ol', '1.', () => run('insertOrderedList'), { aria: 'Elenco numerato', on: () => state('insertOrderedList') });
    add('indent', '→', () => run('indent'), { aria: 'Rientra (sotto-elenco)' });
    add('outdent', '←', () => run('outdent'), { aria: 'Riduci rientro' });
    sep();
    [['left', 'justifyLeft', 'Allinea a sinistra'], ['center', 'justifyCenter', 'Centra'], ['right', 'justifyRight', 'Allinea a destra'], ['justify', 'justifyFull', 'Giustifica']].forEach(([k, c, aria]) => add('al-' + k, '', () => run(c), { aria, html: alignIcon(k), on: () => state(c) }));
    sep();
    add('table', '▦', () => tableSheet(), { aria: 'Inserisci tabella' });
    add('image', '', () => pick.click(), { aria: 'Inserisci immagine', html: A.I('image', 22) });
    sep();
    add('undo', '↶', () => run('undo'), { aria: 'Annulla' });
    add('redo', '↷', () => run('redo'), { aria: 'Ripeti' });
    function paintBar() { for (const [, b, on] of btns) if (on) b.classList.toggle('on', !!on()); }

    const pick = h('input', { type: 'file', accept: 'image/*', class: 'hidden', 'data-word-img': '1', onchange: async () => {
      const f = pick.files && pick.files[0]; pick.value = '';
      if (!f) return;
      try { const url = await picture(f); restore(); document.execCommand('insertHTML', false, '<img src="' + url + '" alt=""><p><br></p>'); dirty = true; onSel(); } catch (e) { console.error(e); A.toast('Immagine non leggibile'); }
    } });

    function tableSheet() {
      let rows = 3, cols = 3;
      const cnt = (key, get, set, min, max) => {
        const out = h('span', { 'data-tcount': key, style: { flex: '1', textAlign: 'center', alignSelf: 'center', fontWeight: '650' } }, String(get()));
        return h('div', { class: 'seg' },
          h('button', { type: 'button', 'aria-label': 'Meno', onclick: () => { set(Math.max(min, get() - 1)); out.textContent = String(get()); } }, '−'), out,
          h('button', { type: 'button', 'aria-label': 'Più', onclick: () => { set(Math.min(max, get() + 1)); out.textContent = String(get()); } }, '+'));
      };
      const lab = (t) => h('p', { class: 'sub', style: { margin: '14px 2px 6px' } }, t);
      A.openSheet('Inserisci tabella', h('div', null,
        lab('Righe'), cnt('rows', () => rows, (v) => { rows = v; }, 1, 30),
        lab('Colonne'), cnt('cols', () => cols, (v) => { cols = v; }, 1, 8),
        h('button', { class: 'btn pri', 'data-table-ok': '1', style: { width: '100%', marginTop: '18px' }, onclick: async () => {
          await A.back();
          const tr = '<tr>' + '<td><br></td>'.repeat(cols) + '</tr>';
          restore(); document.execCommand('insertHTML', false, '<table><tbody>' + tr.repeat(rows) + '</tbody></table><p><br></p>'); dirty = true; onSel();
        } }, 'Inserisci')));
    }

    /* ----- menu «Altro» ----- */
    function moreSheet() {
      const row = (act, icon, text, sub, fn) => h('button', { class: 'item', 'data-act': act, onclick: async () => { await A.back(); fn(); } }, h('span', { html: A.I(icon, 22) }), h('span', null, text, sub ? h('small', null, sub) : null));
      A.openSheet('Altro', h('div', null,
        row('pdf', 'file', 'Esporta come PDF', 'Una copia PDF in Documenti', async () => {
          try { const data = await buildPdf(A, model(), target.name); await A.addDoc('pdf', target.name, data); A.toast('PDF creato in Documenti'); } catch (e) { console.error(e); A.toast('Impossibile creare il PDF: ' + (e.message || e), 4500); }
        }),
        row('note', 'notes', 'Salva il testo come nota', null, () => { const t = C().modelText(model()); if (!t) return A.toast('Il documento è vuoto'); A.saveAsNote(target.name, t); }),
        row('docx', 'share', 'Esporta .docx', 'Salva e condividi il file Word', async () => {
          await save();
          A.exportFile(await A.getDoc(target.id));
        })));
    }

    const cleanup = () => {
      dead = true;
      document.removeEventListener('selectionchange', onSel);
      if (dirty) save(); // uscendo, le modifiche si salvano
    };
    const scr = A.screen(d.name, { onClose: cleanup });
    scr.actions.append(
      A.ibtn('check', () => { if (!dirty) return A.toast('Nessuna modifica da salvare'); save(); }, 'Salva', 'word-save'),
      A.ibtn('more', () => moreSheet(), 'Altro'));
    scr.body.classList.add('word-body');
    scr.body.append(bar, h('div', { class: 'word-scroll' }, editor), pick);
    document.addEventListener('selectionchange', onSel);
    editor.addEventListener('input', () => { dirty = true; });
    editor.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); if (t) { document.execCommand('insertText', false, t); dirty = true; } });
    editor.addEventListener('drop', (e) => e.preventDefault());
    paintBar();
    return { editor, save, model };
  }

  async function createWord(A) {
    const data = await buildDocx([{ t: 'p', style: 'n', align: 'left', runs: [] }]);
    const d = await A.addDoc('docx', 'Nuovo documento', data);
    d.origin = 'note'; await A.save(d);
    await openWord(d, A);
  }

  if (N.docs && N.docs.register) N.docs.register('docx', { open: (d, A) => openWord(d, A), create: (A) => createWord(A) });

  N.wordView = { _logic: { sanitize, domToModel, mergeRuns, dataUri }, buildDocx, buildPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.wordView;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
