/* Esportazione offline: PDF, DOCX, Markdown, testo. Nessuna libreria esterna. */
(function (N) {
  'use strict';

  /* ---------- testo ---------- */
  function noteText(n) {
    if (n.kind === 'list') return (n.items || []).filter((i) => i.t.trim()).map((i) => (i.done ? '[x] ' : '[ ] ') + i.t).join('\n');
    return n.body || '';
  }
  function noteMarkdown(n) {
    const head = n.title ? '# ' + n.title + '\n\n' : '';
    if (n.kind === 'list') return head + (n.items || []).filter((i) => i.t.trim()).map((i) => '- [' + (i.done ? 'x' : ' ') + '] ' + i.t).join('\n') + '\n';
    return head + (n.body || '') + '\n';
  }
  function notePlain(n) {
    return (n.title ? n.title + '\n' + '='.repeat(Math.min(n.title.length, 60)) + '\n\n' : '') + noteText(n) + '\n';
  }
  function metaLine(n) {
    const parts = [];
    if (n.folder) parts.push('Cartella: ' + n.folder);
    if (n.tags && n.tags.length) parts.push('Tag: ' + n.tags.map((t) => '#' + t).join(' '));
    parts.push('Modificata: ' + new Date(n.updated || Date.now()).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }));
    return parts.join('  |  ');
  }

  /* ---------- ZIP (senza compressione) ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files, mime) {
    const te = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = te.encode(f.name);
      const data = typeof f.data === 'string' ? te.encode(f.data) : f.data;
      const crc = crc32(data);
      const size = data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dt, true);
      lh.setUint16(12, dd, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dt, true);
      ch.setUint16(14, dd, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    let csize = 0;
    for (const c of central) csize += c.length;
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true);
    eo.setUint16(8, files.length, true);
    eo.setUint16(10, files.length, true);
    eo.setUint32(12, csize, true);
    eo.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(eo.buffer)], { type: mime || 'application/zip' });
  }

  /* ---------- DOCX ---------- */
  const xesc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\t/g, '    ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  function para(text, o) {
    o = o || {};
    const ppr = o.style ? '<w:pPr><w:pStyle w:val="' + o.style + '"/></w:pPr>' : '';
    let rpr = '';
    if (o.bold) rpr += '<w:b/>';
    if (o.italic) rpr += '<w:i/>';
    if (o.color) rpr += '<w:color w:val="' + o.color + '"/>';
    if (o.size) rpr += '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>';
    return '<w:p>' + ppr + '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xesc(text) + '</w:t></w:r></w:p>';
  }

  function makeDOCX(notes) {
    let body = '';
    notes.forEach((n, idx) => {
      if (idx > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      body += para(n.title || 'Senza titolo', { style: 'Heading1' });
      body += para(metaLine(n), { size: 18, color: '7B7467' });
      if (n.kind === 'list') {
        (n.items || []).filter((i) => i.t.trim()).forEach((i) => {
          body += para((i.done ? '☑ ' : '☐ ') + i.t, { color: i.done ? '8A8678' : null });
        });
      } else {
        const lines = (n.body || '').replace(/\r/g, '').split('\n');
        lines.forEach((l) => {
          body += l.trim() ? para(l) : '<w:p/>';
        });
      }
    });
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + W + '"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style></w:styles>';
    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    const docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    return zip(
      [
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rels },
        { name: 'word/document.xml', data: document },
        { name: 'word/styles.xml', data: styles },
        { name: 'word/_rels/document.xml.rels', data: docRels }
      ],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  }

  /* ---------- PDF ---------- */
  // Larghezze Helvetica (AFM) per i caratteri ASCII 32..126, in millesimi di em.
  const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const WIN = {0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f};

  function charW(ch, bold) {
    const c = ch.charCodeAt(0);
    let w;
    if (c >= 32 && c <= 126) w = HW[c - 32];
    else {
      const b = ch.normalize('NFD').charCodeAt(0);
      w = b >= 32 && b <= 126 ? HW[b - 32] : 556;
    }
    return bold ? w * 1.06 : w;
  }
  function toWin(str) {
    let out = '';
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c < 32) continue;
      if (c < 256) out += String.fromCharCode(c);
      else if (WIN[c]) out += String.fromCharCode(WIN[c]);
      else out += '?';
    }
    return out;
  }
  const pdfEsc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  function wrap(text, size, maxW, bold) {
    const lines = [];
    const measure = (s) => {
      let w = 0;
      for (const ch of s) w += charW(ch, bold);
      return (w * size) / 1000;
    };
    const paragraphs = String(text).replace(/\r/g, '').replace(/\t/g, '    ').split('\n');
    for (const p of paragraphs) {
      if (!p.trim()) {
        lines.push('');
        continue;
      }
      const lead = (p.match(/^\s*/) || [''])[0];
      let cur = lead;
      for (const word of p.trim().split(/\s+/)) {
        const test = cur.trim() ? cur + ' ' + word : cur + word;
        if (measure(test) <= maxW) {
          cur = test;
          continue;
        }
        if (cur.trim()) lines.push(cur);
        cur = '';
        if (measure(word) > maxW) {
          let piece = '';
          for (const ch of word) {
            if (measure(piece + ch) > maxW) {
              lines.push(piece);
              piece = '';
            }
            piece += ch;
          }
          cur = piece;
        } else cur = word;
      }
      lines.push(cur);
    }
    return lines;
  }

  function makePDF(notes) {
    const W = 595.28, H = 841.89, M = 56, bodySize = 11, lead = 16;
    const pages = [];
    let cur = null, y = 0;
    const newPage = () => {
      cur = [];
      pages.push(cur);
      y = H - M;
    };
    const put = (txt, size, bold, x, gray) => {
      cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + (gray ? '0.45 0.43 0.40 rg' : '0.1 0.1 0.08 rg') + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + pdfEsc(toWin(txt)) + ') Tj ET');
    };
    const block = (text, size, bold, gray, step) => {
      const lines = wrap(text, size, W - 2 * M, bold);
      for (const l of lines) {
        if (y - step < M) newPage();
        y -= step;
        if (l) put(l, size, bold, M, gray);
      }
    };

    notes.forEach((n) => {
      newPage();
      block(n.title || 'Senza titolo', 20, true, false, 26);
      block(metaLine(n), 9, false, true, 14);
      y -= 8;
      cur.push('0.85 0.83 0.78 RG 0.6 w ' + M + ' ' + y.toFixed(2) + ' m ' + (W - M) + ' ' + y.toFixed(2) + ' l S');
      y -= 6;
      const text = noteText(n);
      block(text || '(nota vuota)', bodySize, false, !text, lead);
    });
    if (!pages.length) newPage();

    const total = pages.length;
    pages.forEach((p, i) => {
      p.push('BT /F1 9 Tf 0.5 0.48 0.44 rg ' + (W / 2 - 14).toFixed(2) + ' 28 Td (' + (i + 1) + ' / ' + total + ') Tj ET');
    });

    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const kids = pages.map((_, i) => 5 + i * 2 + ' 0 R').join(' ');
    objs[2] = '<< /Type /Pages /Kids [' + kids + '] /Count ' + total + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach((p, i) => {
      const stream = p.join('\n');
      objs[5 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>';
      objs[6 + i * 2] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
    });

    let out = '%PDF-1.4\n%âãÏÓ\n';
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += i + ' 0 obj\n' + objs[i] + '\nendobj\n';
    }
    const xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function slug(s) {
    return (
      String(s || 'nota')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 40) || 'nota'
    );
  }

  N.exp = { noteText, noteMarkdown, notePlain, makePDF, makeDOCX, slug, zip, crc32 };
})((window.N = window.N || {}));
