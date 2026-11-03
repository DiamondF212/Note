/* Word — logica pura (senza interfaccia): modello del documento, scrittura .docx e impaginazione per il PDF.
   Il documento è un elenco di blocchi:
     { t:'p',  style:'n'|'h1'|'h2'|'h3', align:'left'|'center'|'right'|'justify', runs:[...] }
     { t:'li', ord:boolean, list:numero, level:0..8, align, runs:[...] }
     { t:'img', mime:'image/png'|'image/jpeg', bytes:Uint8Array, w, h }            (w, h in pixel)
     { t:'tbl', rows:[[ { blocks:[p|li|img...], span:1 } ]] }
   e ogni «run» è { text, b, i, u, s } oppure { br:true } (a capo dentro il paragrafo).
   Niente DOM qui: si prova da solo in Node. L'interfaccia è in word_view.js. */
(function (N) {
  'use strict';

  const STYLES = { n: { size: 11, bold: false, before: 0, after: 6 }, h1: { size: 20, bold: true, before: 12, after: 6 }, h2: { size: 16, bold: true, before: 10, after: 5 }, h3: { size: 13, bold: true, before: 8, after: 4 } };
  const ALIGNS = ['left', 'center', 'right', 'justify'];
  const MAX_IMG_PX = 600; // larghezza massima di un'immagine nel documento (pixel)

  /* =====================================================================
     1) MODELLO: utilità
     ===================================================================== */

  const normAlign = (a) => (ALIGNS.includes(a) ? a : 'left');
  const normStyle = (s) => (STYLES[s] ? s : 'n');
  const isEmptyRuns = (runs) => !runs.some((r) => r.br || (r.text && r.text.length));

  // Testo semplice del documento (per «Salva come nota»)
  function modelText(model) {
    const out = [];
    const counters = {};
    const blockText = (b) => {
      if (b.t === 'p') return runsText(b.runs);
      if (b.t === 'li') {
        let mark = '- ';
        if (b.ord) { const c = counters[b.list] = counters[b.list] || []; c[b.level] = (c[b.level] || 0) + 1; c.length = b.level + 1; mark = c[b.level] + '. '; }
        return '  '.repeat(b.level || 0) + mark + runsText(b.runs);
      }
      return '';
    };
    for (const b of model) {
      if (b.t === 'tbl') b.rows.forEach((row) => out.push(row.map((c) => c.blocks.map(blockText).filter(Boolean).join(' ')).join(' | ')));
      else if (b.t === 'img') continue;
      else out.push(blockText(b));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function runsText(runs) { return runs.map((r) => (r.br ? '\n' : r.text || '')).join('').replace(/ /g, ' '); }

  /* =====================================================================
     2) SCRITTURA DOCX (parti XML)
     ===================================================================== */

  const xesc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const PAGE_W = 11906, PAGE_H = 16838, PAGE_M = 1134, TEXT_W = PAGE_W - 2 * PAGE_M; // twip

  function runXml(r) {
    if (r.br) return '<w:r><w:br/></w:r>';
    if (!r.text) return '';
    let rpr = '';
    if (r.b) rpr += '<w:b/><w:bCs/>';
    if (r.i) rpr += '<w:i/><w:iCs/>';
    if (r.s) rpr += '<w:strike/>';
    if (r.u) rpr += '<w:u w:val="single"/>';
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xesc(r.text.replace(/\t/g, '    ')) + '</w:t></w:r>';
  }

  function paraXml(b, ctx) {
    let ppr = '';
    if (b.t === 'li') {
      const numId = b.ord ? ctx.numFor(b.list) : 1;
      ppr += '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="' + Math.max(0, Math.min(8, b.level | 0)) + '"/><w:numId w:val="' + numId + '"/></w:numPr>';
    } else if (b.style && b.style !== 'n' && STYLES[b.style]) ppr += '<w:pStyle w:val="Heading' + b.style.slice(1) + '"/>';
    const al = normAlign(b.align);
    if (al !== 'left') ppr += '<w:jc w:val="' + (al === 'justify' ? 'both' : al) + '"/>';
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + b.runs.map(runXml).join('') + '</w:p>';
  }

  function imgSize(b, maxPx) {
    let w = Math.max(1, b.w || 300), h = Math.max(1, b.h || 200);
    const k = Math.min(1, (maxPx || MAX_IMG_PX) / w);
    return [Math.round(w * k), Math.round(h * k)];
  }

  function imgXml(b, ctx) {
    const [w, h] = imgSize(b);
    const id = ctx.addImage(b), cx = w * 9525, cy = h * 9525, n = ctx.images.length;
    return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + n + '" name="Immagine ' + n + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + n + '" name="immagine' + n + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  function tableXml(b, ctx) {
    const cols = Math.max(1, ...b.rows.map((r) => r.reduce((a, c) => a + (c.span || 1), 0)));
    const cw = Math.floor(TEXT_W / cols);
    let x = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="' + cw * cols + '" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + ('<w:gridCol w:w="' + cw + '"/>').repeat(cols) + '</w:tblGrid>';
    for (const row of b.rows) {
      x += '<w:tr>';
      let used = 0;
      for (const c of row) {
        const span = Math.max(1, Math.min(c.span || 1, cols - used)); used += span;
        const inner = c.blocks.length ? c.blocks.map((cb) => blockXml(cb, ctx)).join('') : '<w:p/>';
        x += '<w:tc><w:tcPr><w:tcW w:w="' + cw * span + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + '</w:tcPr>' + inner + '</w:tc>';
      }
      for (; used < cols; used++) x += '<w:tc><w:tcPr><w:tcW w:w="' + cw + '" w:type="dxa"/></w:tcPr><w:p/></w:tc>';
      x += '</w:tr>';
    }
    return x + '</w:tbl><w:p/>'; // dopo una tabella Word vuole sempre un paragrafo
  }

  function blockXml(b, ctx) {
    if (b.t === 'tbl') return tableXml(b, ctx);
    if (b.t === 'img') return imgXml(b, ctx);
    return paraXml(b, ctx);
  }

  const STYLES_XML = HEAD + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    [['1', 40, 240, 120], ['2', 32, 200, 100], ['3', 26, 160, 80]].map(([n, sz, bef, aft]) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="' + bef + '" w:after="' + aft + '"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>').join('') +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>').join('') + '</w:tblBorders></w:tblPr></w:style></w:styles>';

  function numberingXml(orderedIds) {
    const lvls = (ord) => Array.from({ length: 9 }, (_, l) => '<w:lvl w:ilvl="' + l + '"><w:start w:val="1"/><w:numFmt w:val="' + (ord ? 'decimal' : 'bullet') + '"/><w:lvlText w:val="' + (ord ? '%' + (l + 1) + '.' : '•') + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + 720 * (l + 1) + '" w:hanging="360"/></w:pPr>' + (ord ? '' : '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/></w:rPr>') + '</w:lvl>').join('');
    let x = HEAD + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';
    x += '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls(false) + '</w:abstractNum>';
    x += '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls(true) + '</w:abstractNum>';
    x += '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    orderedIds.forEach((_, k) => { x += '<w:num w:numId="' + (k + 2) + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'; });
    return x + '</w:numbering>';
  }

  // Restituisce i file del pacchetto .docx: [{ name, data: stringa | Uint8Array }]
  function buildDocxFiles(model) {
    const ordered = []; // id elenco numerato -> numId (2, 3, …): ogni elenco riparte da 1
    const images = [];
    const ctx = {
      images,
      numFor(list) { let k = ordered.indexOf(list); if (k < 0) { ordered.push(list); k = ordered.length - 1; } return k + 2; },
      addImage(b) { images.push(b); return 'rIdImg' + images.length; }
    };
    const blocks = model && model.length ? model : [{ t: 'p', style: 'n', runs: [] }];
    const body = blocks.map((b) => blockXml(b, ctx)).join('');
    const doc = HEAD + '<w:document ' + NS + '><w:body>' + body + '<w:sectPr><w:pgSz w:w="' + PAGE_W + '" w:h="' + PAGE_H + '"/><w:pgMar w:top="' + PAGE_M + '" w:right="' + PAGE_M + '" w:bottom="' + PAGE_M + '" w:left="' + PAGE_M + '" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const ext = (m) => (m === 'image/png' ? 'png' : 'jpeg');
    const exts = new Set(images.map((b) => ext(b.mime)));
    const types = HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      [...exts].map((e) => '<Default Extension="' + e + '" ContentType="image/' + e + '"/>').join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>';
    const rels = HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const docRels = HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + 'styles" Target="styles.xml"/><Relationship Id="rId2" Type="' + R + 'numbering" Target="numbering.xml"/>' +
      images.map((b, k) => '<Relationship Id="rIdImg' + (k + 1) + '" Type="' + R + 'image" Target="media/image' + (k + 1) + '.' + ext(b.mime) + '"/>').join('') + '</Relationships>';
    return [
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: STYLES_XML },
      { name: 'word/numbering.xml', data: numberingXml(ordered) },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      ...images.map((b, k) => ({ name: 'word/media/image' + (k + 1) + '.' + ext(b.mime), data: b.bytes }))
    ];
  }

  /* =====================================================================
     3) IMPAGINAZIONE PER IL PDF
     measure(stile, corpo, testo) → larghezza in punti; fix(testo) → testo con soli caratteri disegnabili.
     Risultato: pagine; ogni pagina è un elenco di elementi con y misurata dall'alto della pagina:
       { k:'t', x, y, size, st:'r'|'b'|'i'|'bi', text, u, s }   testo (y = alto della riga)
       { k:'i', x, y, w, h, img }                                 immagine
       { k:'l', x1, y1, x2, y2 }                                  linea (bordi tabella)
     ===================================================================== */

  const LINE = 1.3;

  function stKey(r, bold) { const b = bold || r.b, i = r.i; return b ? (i ? 'bi' : 'b') : (i ? 'i' : 'r'); }

  // Spezza i run di un paragrafo in righe lunghe al massimo `width`.
  function wrapRuns(runs, width, size, bold, measure, fix) {
    const lines = [];
    let cur = { segs: [], w: 0 };
    const push = () => { lines.push(cur); cur = { segs: [], w: 0 }; };
    const put = (txt, st, r, withSp) => {
      const last = cur.segs[cur.segs.length - 1];
      const piece = (withSp ? ' ' : '') + txt;
      if (last && last.st === st && !!last.u === !!r.u && !!last.s === !!r.s) last.text += piece;
      else cur.segs.push({ text: piece, st, u: !!r.u, s: !!r.s, w: 0 });
    };
    let pendSp = false;
    for (const r of runs) {
      if (r.br) { push(); pendSp = false; continue; }
      const st = stKey(r, bold);
      const parts = fix(r.text || '').split(/(\s+)/);
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { pendSp = true; continue; }
        let word = p;
        for (;;) {
          const empty = !cur.segs.length;
          const sp = !empty && pendSp ? measure(st, size, ' ') : 0;
          const ww = measure(st, size, word);
          if (empty || cur.w + sp + ww <= width) {
            if (empty && ww > width && word.length > 1) { // parola più larga della riga: si spezza
              let k = 1;
              while (k < word.length && measure(st, size, word.slice(0, k + 1)) <= width) k++;
              put(word.slice(0, k), st, r, false); cur.w = measure(st, size, word.slice(0, k));
              push(); pendSp = false; word = word.slice(k); continue;
            }
            put(word, st, r, !empty && pendSp); cur.w += sp + ww; pendSp = false;
            break;
          }
          push(); // non entra: nuova riga e riprova
        }
      }
    }
    if (cur.segs.length || !lines.length) push();
    lines.forEach((l) => { l.segs.forEach((s) => { s.w = measure(s.st, size, s.text); }); l.w = l.segs.reduce((a, s) => a + s.w, 0); });
    return lines;
  }

  function lineItems(line, x, y, width, size, align) {
    let ox = x;
    if (align === 'center') ox = x + (width - line.w) / 2; else if (align === 'right') ox = x + width - line.w;
    const out = [];
    for (const s of line.segs) { out.push({ k: 't', x: ox, y, size, st: s.st, text: s.text, u: s.u, s: s.s }); ox += s.w; }
    return out;
  }

  // Impagina il documento. Restituisce { pages: [[elementi]], pw, ph }.
  function layout(model, measure, fix, opts) {
    const o = Object.assign({ pw: 595.28, ph: 841.89, m: 56 }, opts || {});
    fix = fix || ((t) => t);
    const cw = o.pw - 2 * o.m, bottom = o.ph - o.m;
    const pages = [[]];
    let y = o.m;
    const newPage = () => { pages.push([]); y = o.m; };
    const here = () => pages[pages.length - 1];

    // Misura e disegna i blocchi di una cella, relativi a (0,0); restituisce { items, h }
    function flowBlocks(blocks, x0, width, out) {
      let yy = 0;
      const counters = {};
      for (const b of blocks) {
        if (b.t === 'img') {
          const [iw, ih] = imgSize(b, 1e9);
          const k = Math.min(1, width / iw, 400 / ih);
          out.push({ k: 'i', x: x0, y: yy, w: iw * k, h: ih * k, img: b }); yy += ih * k + 4; continue;
        }
        const st = b.t === 'p' ? STYLES[normStyle(b.style)] : STYLES.n;
        let indent = 0, mark = null;
        if (b.t === 'li') {
          const lv = Math.max(0, Math.min(8, b.level | 0));
          indent = 18 * (lv + 1);
          if (b.ord) { const c = counters[b.list] = counters[b.list] || []; c[lv] = (c[lv] || 0) + 1; c.length = lv + 1; mark = c[lv] + '.'; } else mark = '•';
        }
        const lines = wrapRuns(b.runs, width - indent, st.size, st.bold, measure, fix);
        const lh = st.size * LINE;
        lines.forEach((ln, idx) => {
          if (mark && idx === 0) { const mw = measure('r', st.size, fix(mark)); out.push({ k: 't', x: x0 + indent - 6 - mw, y: yy, size: st.size, st: 'r', text: fix(mark), u: false, s: false }); }
          out.push(...lineItems(ln, x0 + indent, yy, width - indent, st.size, normAlign(b.align)));
          yy += lh;
        });
        yy += b.t === 'li' ? 2 : st.after;
      }
      return yy;
    }

    const counters = {};
    for (const b of model) {
      if (b.t === 'tbl') {
        const cols = Math.max(1, ...b.rows.map((r) => r.reduce((a, c) => a + (c.span || 1), 0)));
        const colW = cw / cols, pad = 4;
        for (const row of b.rows) {
          const cells = []; let used = 0, rh = 0;
          for (const c of row) {
            const span = Math.max(1, Math.min(c.span || 1, cols - used));
            const items = [];
            const hh = flowBlocks(c.blocks, pad, colW * span - 2 * pad, items) + 2 * pad - 4;
            cells.push({ x: used * colW, w: colW * span, items, h: hh }); used += span; rh = Math.max(rh, hh);
          }
          rh = Math.max(rh, 14 + 2 * pad - 4);
          if (y + rh > bottom && y > o.m) newPage();
          for (const c of cells) {
            c.items.forEach((it) => { const t = Object.assign({}, it); t.x += o.m + c.x; t.y += y + pad; here().push(t); });
            const x1 = o.m + c.x, x2 = x1 + c.w;
            here().push({ k: 'l', x1, y1: y, x2, y2: y }, { k: 'l', x1, y1: y + rh, x2, y2: y + rh }, { k: 'l', x1, y1: y, x2: x1, y2: y + rh }, { k: 'l', x1: x2, y1: y, x2, y2: y + rh });
          }
          y += rh;
        }
        y += 8; continue;
      }
      if (b.t === 'img') {
        const [iw, ih] = imgSize(b, 1e9);
        const k = Math.min(1, cw / iw, (bottom - o.m) / ih), w = iw * k, h = ih * k;
        if (y + h > bottom && y > o.m) newPage();
        here().push({ k: 'i', x: o.m, y, w, h, img: b }); y += h + 6; continue;
      }
      const st = b.t === 'p' ? STYLES[normStyle(b.style)] : STYLES.n;
      let indent = 0, mark = null;
      if (b.t === 'li') {
        const lv = Math.max(0, Math.min(8, b.level | 0));
        indent = 18 * (lv + 1);
        if (b.ord) { const c = counters[b.list] = counters[b.list] || []; c[lv] = (c[lv] || 0) + 1; c.length = lv + 1; mark = c[lv] + '.'; } else mark = '•';
      }
      const lines = wrapRuns(b.runs, cw - indent, st.size, st.bold, measure, fix);
      const lh = st.size * LINE;
      if (y > o.m) y += st.before;
      lines.forEach((ln, idx) => {
        if (y + lh > bottom && y > o.m) newPage();
        if (mark && idx === 0) { const mm = fix(mark); here().push({ k: 't', x: o.m + indent - 6 - measure('r', st.size, mm), y, size: st.size, st: 'r', text: mm, u: false, s: false }); }
        here().push(...lineItems(ln, o.m + indent, y, cw - indent, st.size, normAlign(b.align)));
        y += lh;
      });
      y += b.t === 'li' ? 2 : st.after;
    }
    return { pages, pw: o.pw, ph: o.ph };
  }

  N.wordCore = { buildDocxFiles, layout, modelText, _logic: { xesc, runXml, paraXml, tableXml, numberingXml, wrapRuns, layout, modelText, imgSize, normAlign, normStyle, isEmptyRuns, buildDocxFiles, STYLES, MAX_IMG_PX, LINE } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.wordCore;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
