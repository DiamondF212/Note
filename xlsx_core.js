/* Excel — logica pura (nessun DOM): modello del foglio, formule, formati, lettura e scrittura .xlsx con ExcelJS.
   Modello: { sheets: [ { name, rows, cols, cells: Map(chiave → cella), colW: { colonna: px } } ], warnings: [] }
   Chiave cella = riga * 256 + colonna (da 0). Cella (oggetto mai modificato sul posto, solo sostituito):
   { v: valore | f: formula in forma «inglese» senza «=», rv: ultimo risultato letto dal file, b, i, al, nf }.
   Valori: numero, testo, booleano, oppure errore { err: '#DIV/0!' }. Le date sono numeri seriali (come in Excel).
   Formule: si scrive in italiano (=SOMMA(A1:A3); virgola decimale con «;» come separatore) o in inglese
   (=SUM(A1:A3), punto decimale e «,»): nel file finiscono sempre in forma inglese.
   Limiti onesti: solo le funzioni elencate in FN_IT; una formula con funzione sconosciuta mostra l'ultimo risultato
   salvato nel file (finché non si modifica la cella); formule con intere colonne (A:A), nomi o tabelle diventano valori. */
(function (N) {
  'use strict';

  const K = 256, MAXR = 10000, MAXC = 200;
  const key = (r, c) => r * K + c;
  const rowOf = (k) => Math.floor(k / K), colOf = (k) => k % K;

  /* =====================================================================
     1) RIFERIMENTI E VALORI
     ===================================================================== */

  function colName(i) { let s = ''; i = i + 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(s) { let n = 0; for (const ch of String(s).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
  const refName = (r, c) => colName(c) + (r + 1);
  function parseRef(s) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(s).trim());
    if (!m) return null;
    const r = parseInt(m[2], 10) - 1, c = colIndex(m[1]);
    return r < 0 ? null : { r, c };
  }

  class XE { constructor(code) { this.err = code; } }
  const isErr = (v) => v !== null && typeof v === 'object' && typeof v.err === 'string';
  const ERR_IT = { '#VALUE!': '#VALORE!', '#NAME?': '#NOME?', '#REF!': '#RIF!', '#DIV/0!': '#DIV/0!', '#N/A': '#N/D', '#NUM!': '#NUM!', '#CIRC!': '#CIRC!' };
  const ERR_EN = { '#VALORE!': '#VALUE!', '#NOME?': '#NAME?', '#RIF!': '#REF!', '#N/D': '#N/A' };
  const normErr = (s) => { const u = String(s).toUpperCase(); return ERR_EN[u] || u; };

  function numToText(n) {
    if (!isFinite(n)) return '#NUM!';
    return String(Number(n.toPrecision(15))).replace('.', ',');
  }
  function toText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return numToText(v);
    if (typeof v === 'boolean') return v ? 'VERO' : 'FALSO';
    if (isErr(v)) return ERR_IT[v.err] || v.err;
    return String(v);
  }
  function parseNum(s) {
    s = String(s).trim();
    if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
    if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)(e[+-]?\d+)?$/i.test(s)) return null;
    const n = parseFloat(s.replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  /* date: numeri seriali di Excel (1 = 01/01/1900, con il noto errore del 1900 bisestile) */
  const DAY = 86400000, EPOCH = Date.UTC(1899, 11, 30);
  function toSerial(d) { return (d.getTime() - EPOCH) / DAY; }
  function fromSerial(n) { return new Date(EPOCH + Math.round(n * DAY)); }
  function dateSerial(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return (t.getTime() - EPOCH) / DAY;
  }

  /* =====================================================================
     2) FORMATI NUMERICI (solo quelli di uso comune; gli altri → «Generale»)
     ===================================================================== */

  const NF = { general: 'General', num: '0.00', int: '#,##0', eur: '#,##0.00 "€"', pct: '0.00%', date: 'dd/mm/yyyy' };
  const isDateFmt = (nf) => !!nf && /[dy]/i.test(String(nf).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''));
  function group(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fixed(x, d) { // arrotondamento «lontano da zero» senza errori binari
    const s = Math.sign(x), a = Math.abs(x);
    const r = Number(Math.round(Number(a + 'e' + d)) + 'e-' + d);
    return (s < 0 ? -r : r).toFixed(d);
  }
  function formatNumber(n, nf) {
    if (!isFinite(n)) return '#NUM!';
    if (!nf || /^general$/i.test(nf)) return numToText(n);
    if (nf === 'mm-dd-yy') nf = NF.date;
    if (isDateFmt(nf)) {
      const d = fromSerial(n);
      const parts = { yyyy: String(d.getUTCFullYear()), yy: String(d.getUTCFullYear()).slice(-2), mm: String(d.getUTCMonth() + 1).padStart(2, '0'), m: String(d.getUTCMonth() + 1), dd: String(d.getUTCDate()).padStart(2, '0'), d: String(d.getUTCDate()) };
      return nf.replace(/"[^"]*"/g, '').replace(/yyyy|yy|mm|m|dd|d/gi, (t) => parts[t.toLowerCase()]);
    }
    const bare = nf.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    const pct = bare.includes('%');
    const m = /\.(0|#)+/.exec(bare);
    const dec = m ? m[0].length - 1 : 0;
    if (!/[0#]/.test(bare)) return numToText(n);
    let x = pct ? n * 100 : n;
    let txt = fixed(x, dec);
    let neg = false;
    if (txt[0] === '-') { neg = true; txt = txt.slice(1); }
    let [ip, fp] = txt.split('.');
    if (bare.includes(',')) ip = group(ip);
    let out = ip + (fp ? ',' + fp : '');
    if (/^-?0+(,0+)?$/.test((neg ? '-' : '') + out.replace(/\./g, ''))) neg = false;
    if (pct) out += '%';
    const cur = /[€$£]/.exec(nf);
    if (cur) out = nf.search(/[€$£]/) < nf.search(/[0#]/) ? cur[0] + ' ' + out : out + ' ' + cur[0];
    return (neg ? '-' : '') + out;
  }
  function formatValue(v, nf) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return formatNumber(v, nf);
    return toText(v);
  }

  /* =====================================================================
     3) FORMULE: lettura (token), forma inglese/italiana, riferimenti
     ===================================================================== */

  const FN_IT = {
    SUM: 'SOMMA', AVERAGE: 'MEDIA', MIN: 'MIN', MAX: 'MAX', COUNT: 'CONTA.NUMERI', COUNTA: 'CONTA.VALORI', IF: 'SE', AND: 'E', OR: 'O', NOT: 'NON',
    ROUND: 'ARROTONDA', ABS: 'ASS', SQRT: 'RADQ', POWER: 'POTENZA', MOD: 'RESTO', INT: 'INT', PRODUCT: 'PRODOTTO', CONCATENATE: 'CONCATENA', CONCAT: 'CONCAT',
    LEN: 'LUNGHEZZA', UPPER: 'MAIUSC', LOWER: 'MINUSC', SUMIF: 'SOMMA.SE', COUNTIF: 'CONTA.SE', IFERROR: 'SE.ERRORE', TODAY: 'OGGI'
  };
  const FN_EN = {};
  for (const [en, it] of Object.entries(FN_IT)) { FN_EN[it] = en; FN_EN[en] = en; }
  FN_EN.CONTA = 'COUNT'; // «CONTA(» è usato spesso al posto di CONTA.NUMERI

  const synt = (m) => { const e = new Error(m || 'Formula non valida'); e.syntax = true; return e; };

  function sheetPrefix(s) {
    if (s === null || s === undefined) return '';
    const plain = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) && !/^[A-Za-z]{1,3}\d+$/.test(s);
    return (plain ? s : "'" + s.replace(/'/g, "''") + "'") + '!';
  }
  const endText = (e) => (e.ac ? '$' : '') + colName(e.c) + (e.ar ? '$' : '') + (e.r + 1);

  function tokenize(src) {
    const s = String(src);
    const bare = s.replace(/"(?:[^"]|"")*"/g, '');
    // «;» = stile italiano (virgola decimale). Senza funzioni, una virgola può essere solo decimale (=B1*1,5).
    const itMode = /;/.test(bare) || (/,/.test(bare) && !/[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ.]*\s*\(/.test(bare));
    const numRe = itMode ? /^(\d+(,\d*)?|,\d+)([eE][+-]?\d+)?/ : /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
    const out = [];
    let i = 0;
    const refAt = (str) => {
      const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_.(])/.exec(str);
      return m ? { len: m[0].length, e: { ac: !!m[1], c: colIndex(m[2]), ar: !!m[3], r: parseInt(m[4], 10) - 1 } } : null;
    };
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        let j = i + 1, str = '';
        for (;;) {
          if (j >= s.length) throw synt('Testo non chiuso: manca «"»');
          if (s[j] === '"') { if (s[j + 1] === '"') { str += '"'; j += 2; continue; } break; }
          str += s[j++];
        }
        out.push({ t: 'str', v: str }); i = j + 1; continue;
      }
      if (ch === '#') {
        const m = /^#(REF!|RIF!|DIV\/0!|VALUE!|VALORE!|NAME\?|NOME\?|N\/A|N\/D|NUM!)/i.exec(s.slice(i));
        if (!m) throw synt();
        out.push({ t: 'err', v: normErr(m[0]) }); i += m[0].length; continue;
      }
      let sheet = null, hasSheet = false;
      if (ch === "'") {
        let j = i + 1, nm = '';
        for (;;) {
          if (j >= s.length) throw synt();
          if (s[j] === "'") { if (s[j + 1] === "'") { nm += "'"; j += 2; continue; } break; }
          nm += s[j++];
        }
        if (s[j + 1] !== '!') throw synt();
        sheet = nm; hasSheet = true; i = j + 2;
      } else {
        const m = /^([A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ.]*)!/.exec(s.slice(i));
        if (m) { sheet = m[1]; hasSheet = true; i += m[0].length; }
      }
      const rest = s.slice(i);
      const ra = refAt(rest);
      if (ra) {
        i += ra.len;
        if (s[i] === ':') {
          const rb = refAt(s.slice(i + 1));
          if (!rb) throw synt();
          i += 1 + rb.len;
          let a = ra.e, b = rb.e;
          if (a.r > b.r) { const t = a.r, ta = a.ar; a = Object.assign({}, a, { r: b.r, ar: b.ar }); b = Object.assign({}, b, { r: t, ar: ta }); }
          if (a.c > b.c) { const t = a.c, ta = a.ac; a = Object.assign({}, a, { c: b.c, ac: b.ac }); b = Object.assign({}, b, { c: t, ac: ta }); }
          out.push({ t: 'rng', sheet, a, b });
        } else out.push({ t: 'ref', sheet, a: ra.e });
        continue;
      }
      if (hasSheet) throw synt();
      const nm = numRe.exec(rest);
      if (nm) { out.push({ t: 'num', v: parseFloat(nm[0].replace(',', '.')) }); i += nm[0].length; continue; }
      const id = /^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ.]*/.exec(rest);
      if (id) {
        const name = id[0].toUpperCase();
        i += id[0].length;
        let j = i; while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === '(') out.push({ t: 'fn', v: FN_EN[name] || name });
        else if (name === 'TRUE' || name === 'VERO') out.push({ t: 'bool', v: true });
        else if (name === 'FALSE' || name === 'FALSO') out.push({ t: 'bool', v: false });
        else throw synt('Nome non riconosciuto: ' + id[0]);
        continue;
      }
      const two = s.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=') { out.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/^&=<>%(),;'.includes(ch)) { out.push({ t: 'op', v: ch === ';' ? ',' : ch }); i++; continue; }
      throw synt('Carattere non valido: ' + ch);
    }
    return out;
  }

  function tokText(tk, it) {
    switch (tk.t) {
      case 'str': return '"' + tk.v.replace(/"/g, '""') + '"';
      case 'num': return it ? String(tk.v).replace('.', ',') : String(tk.v);
      case 'bool': return it ? (tk.v ? 'VERO' : 'FALSO') : (tk.v ? 'TRUE' : 'FALSE');
      case 'err': return it ? (ERR_IT[tk.v] || tk.v) : tk.v;
      case 'fn': return it ? (FN_IT[tk.v] || tk.v) : tk.v;
      case 'ref': return sheetPrefix(tk.sheet) + endText(tk.a);
      case 'rng': return sheetPrefix(tk.sheet) + endText(tk.a) + ':' + endText(tk.b);
      default: return it && tk.v === ',' ? ';' : tk.v;
    }
  }
  const tokensToText = (toks, it) => toks.map((t) => tokText(t, it)).join('');

  /* analisi → albero */
  function parse(toks) {
    let p = 0;
    const peek = () => toks[p], isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
    function comparison() {
      let a = concat();
      while (toks[p] && toks[p].t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(toks[p].v)) { const op = toks[p++].v; a = { t: 'bin', op, a, b: concat() }; }
      return a;
    }
    function concat() { let a = add(); while (isOp('&')) { p++; a = { t: 'bin', op: '&', a, b: add() }; } return a; }
    function add() { let a = mul(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; a = { t: 'bin', op, a, b: mul() }; } return a; }
    function mul() { let a = pow(); while (isOp('*') || isOp('/')) { const op = toks[p++].v; a = { t: 'bin', op, a, b: pow() }; } return a; }
    function pow() { let a = unary(); while (isOp('^')) { p++; a = { t: 'bin', op: '^', a, b: unary() }; } return a; }
    function unary() {
      if (isOp('-')) { p++; return { t: 'neg', a: unary() }; }
      if (isOp('+')) { p++; return unary(); }
      let a = primary();
      while (isOp('%')) { p++; a = { t: 'pct', a }; }
      return a;
    }
    function primary() {
      const tk = peek();
      if (!tk) throw synt('Formula incompleta');
      p++;
      if (tk.t === 'num' || tk.t === 'str' || tk.t === 'bool' || tk.t === 'err') return { t: tk.t, v: tk.v };
      if (tk.t === 'ref' || tk.t === 'rng') return tk;
      if (tk.t === 'fn') {
        if (!isOp('(')) throw synt();
        p++;
        const args = [];
        if (isOp(')')) { p++; return { t: 'fn', name: tk.v, args }; }
        for (;;) {
          if (isOp(',') || isOp(')')) args.push({ t: 'empty' }); else args.push(comparison());
          if (isOp(',')) { p++; continue; }
          if (isOp(')')) { p++; break; }
          throw synt('Manca «)» o «;»');
        }
        return { t: 'fn', name: tk.v, args };
      }
      if (tk.t === 'op' && tk.v === '(') {
        const e = comparison();
        if (!isOp(')')) throw synt('Manca «)»');
        p++; return e;
      }
      throw synt();
    }
    if (!toks.length) throw synt('Formula vuota');
    const ast = comparison();
    if (p < toks.length) throw synt('Formula non valida');
    return ast;
  }

  const astCache = new Map();
  function astOf(f) {
    let a = astCache.get(f);
    if (!a) { a = parse(tokenize(f)); if (astCache.size > 5000) astCache.clear(); astCache.set(f, a); }
    return a;
  }

  // Forma inglese «canonica» (quella che finisce nel file). Lancia un errore se la formula non è valida.
  function canon(text) {
    let s = String(text).trim();
    if (s[0] === '=') s = s.slice(1);
    const toks = tokenize(s);
    parse(toks);
    return tokensToText(toks, false);
  }
  function display(f) { try { return tokensToText(tokenize(f), true); } catch (e) { return f; } }

  // Riscrive i riferimenti di una formula. fn(token) → token nuovo | null (diventa #REF!) | undefined (invariato)
  function rewrite(f, fn) {
    let toks;
    try { toks = tokenize(f); } catch (e) { return f; }
    const out = toks.map((tk) => {
      if (tk.t !== 'ref' && tk.t !== 'rng') return tk;
      const r = fn(tk);
      if (r === undefined) return tk;
      return r === null ? { t: 'err', v: '#REF!' } : r;
    });
    return tokensToText(out, false);
  }
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  /* =====================================================================
     4) CALCOLO
     ===================================================================== */

  function numArg(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const n = parseNum(v); if (n === null) throw new XE('#VALUE!'); return n; }
    throw new XE('#VALUE!');
  }
  function boolArg(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'string') { const u = v.toUpperCase(); if (u === 'TRUE' || u === 'VERO') return true; if (u === 'FALSE' || u === 'FALSO') return false; }
    throw new XE('#VALUE!');
  }
  const rank = (v) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);
  function compare(a, b) {
    if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
    if (typeof a === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function critMatcher(crit) {
    let op = '=', rhs = crit;
    if (typeof crit === 'string') {
      const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(crit);
      if (m) { op = m[1]; rhs = m[2]; }
      const n = parseNum(rhs);
      if (n !== null) rhs = n;
    }
    return (v) => {
      if (v === null || v === undefined) return op === '<>' ? rhs !== '' : (rhs === '' && op === '=');
      if (isErr(v)) return false;
      const bothNum = typeof v === 'number' && typeof rhs === 'number';
      const bothTxt = typeof v === 'string' && typeof rhs === 'string';
      if (!bothNum && !bothTxt) return op === '<>';
      const c = compare(v, rhs);
      return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
    };
  }
  function roundAway(x, d) {
    d = Math.trunc(d);
    const s = Math.sign(x), a = Math.abs(x);
    const r = Number(Math.round(Number(a + 'e' + d)) + 'e' + (-d));
    return s < 0 ? -r : r;
  }

  function createCalc(model) {
    const cache = new Map(), active = new Set();

    function sheetIdx(name, own) {
      if (name === null || name === undefined) return own;
      return model.sheets.findIndex((s) => sameName(s.name, name));
    }
    function cellValue(si, r, c) {
      const sh = model.sheets[si];
      if (!sh) return { err: '#REF!' };
      const cell = sh.cells.get(key(r, c));
      if (!cell) return null;
      if (cell.f === undefined) return cell.v === undefined ? null : cell.v;
      const ck = si + ':' + key(r, c);
      if (cache.has(ck)) return cache.get(ck);
      if (active.has(ck)) return { err: '#CIRC!' };
      active.add(ck);
      let v;
      try { v = evalNode(astOf(cell.f), si); if (v === null || v === undefined) v = 0; }
      catch (e) {
        if (e instanceof XE) v = { err: e.err };
        else if (e instanceof RangeError) v = { err: '#VALUE!' };
        else if (e && e.syntax) v = { err: '#NAME?' };
        else throw e;
      }
      active.delete(ck);
      if (isErr(v) && v.err === '#NAME?' && cell.rv !== undefined) v = cell.rv;
      if (isErr(v) && v.err === '#CIRC!') { cache.set(ck, v); return v; }
      cache.set(ck, v);
      return v;
    }
    const scalar = (n, si) => { const v = evalNode(n, si); if (isErr(v)) throw new XE(v.err); return v; };
    const isRef = (n) => n.t === 'ref' || n.t === 'rng';

    // elenco piatto dei valori di un argomento: { v, ref } (ref = viene da una cella, non da un valore scritto nella formula)
    function items(args, si, keepErr) {
      const out = [];
      for (const n of args) {
        if (n.t === 'rng' || n.t === 'ref') {
          const s = sheetIdx(n.sheet, si), B = n.t === 'rng' ? n.b : n.a;
          if (s < 0) throw new XE('#REF!');
          for (let r = n.a.r; r <= B.r; r++) for (let c = n.a.c; c <= B.c; c++) {
            const v = cellValue(s, r, c);
            if (isErr(v) && !keepErr) throw new XE(v.err);
            out.push({ v, ref: true });
          }
        } else if (n.t === 'empty') out.push({ v: null, ref: false });
        else {
          const v = evalNode(n, si);
          if (isErr(v) && !keepErr) throw new XE(v.err);
          out.push({ v, ref: isRef(n) });
        }
      }
      return out;
    }
    function nums(args, si) {
      const out = [];
      for (const it of items(args, si)) {
        if (it.ref) { if (typeof it.v === 'number') out.push(it.v); }
        else if (it.v !== null) out.push(numArg(it.v));
      }
      return out;
    }
    const need = (args, min, max) => { if (args.length < min || args.length > max) throw new XE('#VALUE!'); };
    const one = (args, si) => scalar(args[0], si);

    const FN = {
      SUM: (a, si) => nums(a, si).reduce((x, y) => x + y, 0),
      PRODUCT: (a, si) => nums(a, si).reduce((x, y) => x * y, 1),
      AVERAGE: (a, si) => { const n = nums(a, si); if (!n.length) throw new XE('#DIV/0!'); return n.reduce((x, y) => x + y, 0) / n.length; },
      MIN: (a, si) => { const n = nums(a, si); return n.length ? Math.min(...n) : 0; },
      MAX: (a, si) => { const n = nums(a, si); return n.length ? Math.max(...n) : 0; },
      COUNT: (a, si) => items(a, si, true).filter((it) => (it.ref ? typeof it.v === 'number' : (it.v !== null && !isErr(it.v) && (typeof it.v === 'number' || typeof it.v === 'boolean' || (typeof it.v === 'string' && parseNum(it.v) !== null))))).length,
      COUNTA: (a, si) => items(a, si, true).filter((it) => it.v !== null && it.v !== '').length,
      IF: (a, si) => {
        need(a, 2, 3);
        if (boolArg(scalar(a[0], si))) return scalar(a[1], si);
        return a.length > 2 ? scalar(a[2], si) : false;
      },
      IFERROR: (a, si) => { need(a, 2, 2); try { return scalar(a[0], si); } catch (e) { if (e instanceof XE) return scalar(a[1], si); throw e; } },
      AND: (a, si) => { const l = items(a, si).filter((it) => !(it.ref && (typeof it.v === 'string' || it.v === null))); if (!l.length) throw new XE('#VALUE!'); return l.every((it) => boolArg(it.v)); },
      OR: (a, si) => { const l = items(a, si).filter((it) => !(it.ref && (typeof it.v === 'string' || it.v === null))); if (!l.length) throw new XE('#VALUE!'); return l.some((it) => boolArg(it.v)); },
      NOT: (a, si) => { need(a, 1, 1); return !boolArg(one(a, si)); },
      ROUND: (a, si) => { need(a, 2, 2); return roundAway(numArg(scalar(a[0], si)), numArg(scalar(a[1], si))); },
      ABS: (a, si) => { need(a, 1, 1); return Math.abs(numArg(one(a, si))); },
      INT: (a, si) => { need(a, 1, 1); return Math.floor(numArg(one(a, si))); },
      SQRT: (a, si) => { need(a, 1, 1); const x = numArg(one(a, si)); if (x < 0) throw new XE('#NUM!'); return Math.sqrt(x); },
      POWER: (a, si) => { need(a, 2, 2); const r = Math.pow(numArg(scalar(a[0], si)), numArg(scalar(a[1], si))); if (!isFinite(r)) throw new XE('#NUM!'); return r; },
      MOD: (a, si) => { need(a, 2, 2); const x = numArg(scalar(a[0], si)), y = numArg(scalar(a[1], si)); if (y === 0) throw new XE('#DIV/0!'); return x - y * Math.floor(x / y); },
      CONCATENATE: (a, si) => items(a, si).map((it) => toText(it.v)).join(''),
      CONCAT: (a, si) => items(a, si).map((it) => toText(it.v)).join(''),
      LEN: (a, si) => { need(a, 1, 1); return toText(one(a, si)).length; },
      UPPER: (a, si) => { need(a, 1, 1); return toText(one(a, si)).toUpperCase(); },
      LOWER: (a, si) => { need(a, 1, 1); return toText(one(a, si)).toLowerCase(); },
      TODAY: () => Math.floor(toSerial(new Date(Date.now() - new Date().getTimezoneOffset() * 60000))),
      SUMIF: (a, si) => sumCount(a, si, true),
      COUNTIF: (a, si) => sumCount(a, si, false)
    };
    function sumCount(a, si, sum) {
      need(a, sum ? 2 : 2, sum ? 3 : 2);
      const rg = a[0];
      if (rg.t !== 'rng' && rg.t !== 'ref') throw new XE('#VALUE!');
      const crit = scalar(a[1], si), match = critMatcher(crit);
      const s = sheetIdx(rg.sheet, si);
      if (s < 0) throw new XE('#REF!');
      const A = rg.a, B = rg.t === 'rng' ? rg.b : rg.a;
      let sr = null, ss = s;
      if (sum && a[2]) {
        if (a[2].t !== 'rng' && a[2].t !== 'ref') throw new XE('#VALUE!');
        sr = a[2].a; ss = sheetIdx(a[2].sheet, si);
        if (ss < 0) throw new XE('#REF!');
      }
      let total = 0;
      for (let r = A.r; r <= B.r; r++) for (let c = A.c; c <= B.c; c++) {
        if (!match(cellValue(s, r, c))) continue;
        if (!sum) { total++; continue; }
        const v = sr ? cellValue(ss, sr.r + (r - A.r), sr.c + (c - A.c)) : cellValue(s, r, c);
        if (typeof v === 'number') total += v;
      }
      return total;
    }

    function evalNode(n, si) {
      switch (n.t) {
        case 'num': case 'str': case 'bool': return n.v;
        case 'err': throw new XE(n.v);
        case 'empty': return null;
        case 'ref': {
          const s = sheetIdx(n.sheet, si);
          if (s < 0) throw new XE('#REF!');
          const v = cellValue(s, n.a.r, n.a.c);
          if (isErr(v)) throw new XE(v.err);
          return v;
        }
        case 'rng': throw new XE('#VALUE!');
        case 'neg': return -numArg(scalar(n.a, si));
        case 'pct': return numArg(scalar(n.a, si)) / 100;
        case 'bin': {
          const a = scalar(n.a, si), b = scalar(n.b, si);
          switch (n.op) {
            case '+': return numArg(a) + numArg(b);
            case '-': return numArg(a) - numArg(b);
            case '*': return numArg(a) * numArg(b);
            case '/': { const d = numArg(b); if (d === 0) throw new XE('#DIV/0!'); return numArg(a) / d; }
            case '^': { const r = Math.pow(numArg(a), numArg(b)); if (!isFinite(r)) throw new XE('#NUM!'); return r; }
            case '&': return toText(a) + toText(b);
            default: {
              const c = compare(a, b);
              return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0;
            }
          }
        }
        case 'fn': {
          const f = FN[n.name];
          if (!f) throw new XE('#NAME?');
          return f(n.args, si);
        }
      }
      throw new XE('#VALUE!');
    }

    return {
      get(si, r, c) { return cellValue(si, r, c); },
      clear() { cache.clear(); }
    };
  }

  /* =====================================================================
     5) INSERIMENTO IMPORTO / ELIMINAZIONE DI RIGHE E COLONNE
     ===================================================================== */

  function newSheet(name, rows, cols) { return { name, rows: rows || 50, cols: cols || 12, cells: new Map(), colW: {} }; }
  function newModel() { return { sheets: [newSheet('Foglio 1')], warnings: [] }; }

  function usedRange(sh) {
    let r = 0, c = 0;
    for (const k of sh.cells.keys()) { r = Math.max(r, rowOf(k) + 1); c = Math.max(c, colOf(k) + 1); }
    return { rows: r, cols: c };
  }

  // x = indice (riga o colonna) di un estremo; ritorna il nuovo indice, o null se non esiste più
  function shiftIndex(x, at, n, del, isEnd) {
    if (!del) return x >= at ? x + n : x;
    const removed = (v) => Math.max(0, Math.min(v - at, n));
    if (x >= at && x < at + n) return isEnd ? at - 1 : at;
    return x - removed(x);
  }
  function adjustToken(tk, own, target, axis, at, n, del) {
    if (!sameName(tk.sheet === null ? own : tk.sheet, target)) return undefined;
    const k = axis === 'row' ? 'r' : 'c';
    if (tk.t === 'ref') {
      const x = tk.a[k];
      if (del && x >= at && x < at + n) return null;
      return Object.assign({}, tk, { a: Object.assign({}, tk.a, { [k]: shiftIndex(x, at, n, del, false) }) });
    }
    const a = shiftIndex(tk.a[k], at, n, del, false), b = shiftIndex(tk.b[k], at, n, del, true);
    if (del && (a > b || a < 0 || b < 0)) return null;
    return Object.assign({}, tk, { a: Object.assign({}, tk.a, { [k]: a }), b: Object.assign({}, tk.b, { [k]: b }) });
  }
  function adjustAllFormulas(model, target, axis, at, n, del) {
    for (const sh of model.sheets) {
      for (const [k, cell] of sh.cells) {
        if (cell.f === undefined) continue;
        const f = rewrite(cell.f, (tk) => adjustToken(tk, sh.name, target, axis, at, n, del));
        if (f !== cell.f) sh.cells.set(k, Object.assign({}, cell, { f, rv: undefined }));
      }
    }
  }
  function moveCells(sh, axis, at, n, del) {
    const out = new Map();
    for (const [k, cell] of sh.cells) {
      let r = rowOf(k), c = colOf(k);
      const x = axis === 'row' ? r : c;
      let nx;
      if (del) { if (x >= at && x < at + n) continue; nx = x >= at + n ? x - n : x; }
      else nx = x >= at ? x + n : x;
      if (axis === 'row') r = nx; else c = nx;
      out.set(key(r, c), cell);
    }
    sh.cells = out;
  }
  function insertRows(model, si, at, n) {
    n = n || 1; const sh = model.sheets[si];
    moveCells(sh, 'row', at, n, false); sh.rows = Math.min(MAXR, sh.rows + n);
    adjustAllFormulas(model, sh.name, 'row', at, n, false);
  }
  function deleteRows(model, si, at, n) {
    n = n || 1; const sh = model.sheets[si];
    moveCells(sh, 'row', at, n, true); sh.rows = Math.max(1, sh.rows - n);
    adjustAllFormulas(model, sh.name, 'row', at, n, true);
  }
  function shiftWidths(sh, at, n, del) {
    const w = {};
    for (const [c, px] of Object.entries(sh.colW)) {
      const x = +c;
      if (del) { if (x >= at && x < at + n) continue; w[x >= at + n ? x - n : x] = px; }
      else w[x >= at ? x + n : x] = px;
    }
    sh.colW = w;
  }
  function insertCols(model, si, at, n) {
    n = n || 1; const sh = model.sheets[si];
    moveCells(sh, 'col', at, n, false); shiftWidths(sh, at, n, false); sh.cols = Math.min(MAXC, sh.cols + n);
    adjustAllFormulas(model, sh.name, 'col', at, n, false);
  }
  function deleteCols(model, si, at, n) {
    n = n || 1; const sh = model.sheets[si];
    moveCells(sh, 'col', at, n, true); shiftWidths(sh, at, n, true); sh.cols = Math.max(1, sh.cols - n);
    adjustAllFormulas(model, sh.name, 'col', at, n, true);
  }
  function renameSheet(model, si, name) {
    const old = model.sheets[si].name;
    model.sheets[si].name = name;
    for (const sh of model.sheets) for (const [k, cell] of sh.cells) {
      if (cell.f === undefined) continue;
      const f = rewrite(cell.f, (tk) => (tk.sheet !== null && sameName(tk.sheet, old) ? Object.assign({}, tk, { sheet: name }) : undefined));
      if (f !== cell.f) sh.cells.set(k, Object.assign({}, cell, { f }));
    }
  }
  function removeSheet(model, si) {
    const name = model.sheets[si].name;
    model.sheets.splice(si, 1);
    for (const sh of model.sheets) for (const [k, cell] of sh.cells) {
      if (cell.f === undefined) continue;
      const f = rewrite(cell.f, (tk) => (tk.sheet !== null && sameName(tk.sheet, name) ? null : undefined));
      if (f !== cell.f) sh.cells.set(k, Object.assign({}, cell, { f, rv: undefined }));
    }
  }
  function cleanSheetName(s, taken) {
    let base = String(s || '').replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Foglio';
    let name = base, i = 2;
    const low = new Set((taken || []).map((x) => x.toLowerCase()));
    while (low.has(name.toLowerCase())) { const suf = ' (' + i++ + ')'; name = base.slice(0, 31 - suf.length) + suf; }
    return name;
  }

  /* =====================================================================
     6) DA TESTO DIGITATO A CELLA
     ===================================================================== */

  // Ritorna null (cella vuota) oppure { v } / { f } con eventualmente nf. Una formula non valida lancia un errore.
  function parseInput(text) {
    let s = String(text === null || text === undefined ? '' : text);
    if (!s.trim()) return null;
    if (s[0] === "'") return { v: s.slice(1) };
    const t = s.trim();
    if (t[0] === '=' && t.length > 1) return { f: canon(t) };
    const n = parseNum(t);
    if (n !== null) return { v: n };
    let m = /^([+-]?\d+(?:[.,]\d+)?)%$/.exec(t);
    if (m) { const d = (m[1].split(/[.,]/)[1] || '').length; return { v: Math.round(parseFloat(m[1].replace(',', '.')) * 1e10) / 1e12, nf: '0' + (d ? '.' + '0'.repeat(d) : '') + '%' }; }
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(t);
    if (m) { const ser = dateSerial(+m[3], +m[2], +m[1]); if (ser !== null) return { v: ser, nf: NF.date }; }
    if (/^(vero|true)$/i.test(t)) return { v: true };
    if (/^(falso|false)$/i.test(t)) return { v: false };
    return { v: s };
  }

  // Testo da mostrare nella barra di modifica per una cella
  function editText(cell) {
    if (!cell) return '';
    if (cell.f !== undefined) return '=' + display(cell.f);
    const v = cell.v;
    if (typeof v === 'number') {
      if (isDateFmt(cell.nf) || cell.nf === 'mm-dd-yy') return formatNumber(v, NF.date);
      if (cell.nf && cell.nf.includes('%')) { const p = Number((v * 100).toPrecision(12)); return String(p).replace('.', ',') + '%'; }
      return String(Number(v.toPrecision(15))).replace('.', ',');
    }
    if (typeof v === 'string') {
      if (/^['=]/.test(v)) return "'" + v;
      const p = parseInput(v);
      return p && typeof p.v === 'string' ? v : (p ? "'" + v : v);
    }
    return toText(v);
  }

  function sheetText(model, si, calc) {
    const sh = model.sheets[si], u = usedRange(sh), lines = [];
    for (let r = 0; r < u.rows; r++) {
      const row = [];
      for (let c = 0; c < u.cols; c++) {
        const cell = sh.cells.get(key(r, c));
        row.push(cell ? formatValue(calc.get(si, r, c), cell.nf).replace(/[\t\r\n]+/g, ' ') : '');
      }
      lines.push(row.join('\t').replace(/\t+$/, ''));
    }
    return lines.join('\n').replace(/\s+$/, '');
  }

  /* =====================================================================
     7) LETTURA E SCRITTURA .xlsx (ExcelJS)
     ===================================================================== */

  function cellFromExcel(cell) {
    const v = cell.value;
    if (v === null || v === undefined) return null;
    const out = {};
    const setRes = (res) => {
      if (res instanceof Date) return toSerial(res);
      if (res && typeof res === 'object' && 'error' in res) return { err: normErr(res.error) };
      if (res && typeof res === 'object' && res.richText) return res.richText.map((t) => t.text).join('');
      return res === undefined ? undefined : res;
    };
    if (v instanceof Date) { out.v = toSerial(v); if (!isDateFmt(cell.numFmt)) out.nf = NF.date; }
    else if (typeof v === 'object') {
      if ('formula' in v || 'sharedFormula' in v) {
        const res = setRes(v.result);
        let f = null;
        try { f = canon(String(cell.formula || '')); } catch (e) { f = null; }
        if (f) { out.f = f; if (res !== undefined) out.rv = res; }
        else if (res !== undefined) out.v = res;
        else return null;
        if (v.result instanceof Date && !isDateFmt(cell.numFmt)) out.nf = NF.date;
      } else if (v.richText) out.v = v.richText.map((t) => t.text).join('');
      else if ('hyperlink' in v) out.v = String(v.text && v.text.richText ? v.text.richText.map((t) => t.text).join('') : (v.text !== undefined ? v.text : v.hyperlink));
      else if ('error' in v) out.v = { err: normErr(v.error) };
      else out.v = String(v);
    } else out.v = v;
    const nf = cell.numFmt;
    if (nf && !/^general$/i.test(nf) && !out.nf) out.nf = nf === 'mm-dd-yy' ? NF.date : nf;
    const font = cell.font;
    if (font && font.bold) out.b = true;
    if (font && font.italic) out.i = true;
    const al = cell.alignment && cell.alignment.horizontal;
    if (al === 'left' || al === 'center' || al === 'right') out.al = al;
    return out;
  }

  async function readXlsx(ExcelJS, data) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data);
    const model = { sheets: [], warnings: [] };
    const names = [];
    wb.eachSheet((ws) => {
      const name = cleanSheetName(ws.name, names); names.push(name);
      const sh = newSheet(name);
      let cut = false, merged = false;
      ws.eachRow({ includesEmpty: false }, (row, rn) => {
        if (rn > MAXR) { cut = true; return; }
        row.eachCell({ includesEmpty: false }, (cell, cn) => {
          if (cn > MAXC) { cut = true; return; }
          if (cell.isMerged && cell.master && cell.master !== cell) { merged = true; return; }
          const c = cellFromExcel(cell);
          if (c) sh.cells.set(key(rn - 1, cn - 1), c);
        });
      });
      const cols = ws.columns || [];
      cols.forEach((col, i) => { if (col && col.width && i < MAXC) sh.colW[i] = Math.max(32, Math.min(400, Math.round(col.width * 7 + 5))); });
      const u = usedRange(sh);
      sh.rows = Math.min(MAXR, Math.max(40, u.rows + 20));
      sh.cols = Math.min(MAXC, Math.max(12, u.cols + 3));
      if (cut) model.warnings.push('«' + name + '»: oltre ' + MAXR + ' righe o ' + MAXC + ' colonne non vengono caricate');
      if (merged) model.warnings.push('«' + name + '»: le celle unite sono state separate');
      model.sheets.push(sh);
    });
    if (!model.sheets.length) model.sheets.push(newSheet('Foglio 1'));
    return model;
  }

  function excelResult(v) {
    if (isErr(v)) return { error: v.err === '#CIRC!' ? '#REF!' : v.err };
    if (v === null || v === undefined) return 0;
    return v;
  }
  async function buildXlsx(ExcelJS, model) {
    const calc = createCalc(model);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Note'; wb.created = new Date(); wb.modified = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    const used = [];
    model.sheets.forEach((sh, si) => {
      const name = cleanSheetName(sh.name, used); used.push(name);
      const ws = wb.addWorksheet(name);
      for (const [k, cell] of sh.cells) {
        const r = rowOf(k) + 1, c = colOf(k) + 1;
        const x = ws.getCell(r, c);
        if (cell.f !== undefined) x.value = { formula: cell.f, result: excelResult(calc.get(si, r - 1, c - 1)) };
        else if (cell.v !== undefined && cell.v !== null) x.value = isErr(cell.v) ? { error: cell.v.err } : cell.v;
        if (cell.b || cell.i) x.font = Object.assign({}, cell.b ? { bold: true } : {}, cell.i ? { italic: true } : {});
        if (cell.al) x.alignment = { horizontal: cell.al };
        if (cell.nf && !/^general$/i.test(cell.nf)) x.numFmt = cell.nf;
      }
      for (const [c, px] of Object.entries(sh.colW)) ws.getColumn(+c + 1).width = Math.max(2, (px - 5) / 7);
    });
    const buf = await wb.xlsx.writeBuffer();
    return buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  N.xlsxCore = {
    K, MAXR, MAXC, NF, key, rowOf, colOf, colName, colIndex, refName, parseRef,
    isErr, toText, parseInput, editText, formatValue, formatNumber, isDateFmt,
    canon, display, createCalc, newModel, newSheet, usedRange, sheetText,
    insertRows, deleteRows, insertCols, deleteCols, renameSheet, removeSheet, cleanSheetName,
    readXlsx, buildXlsx,
    _logic: { tokenize, parse, rewrite, shiftIndex, compare, critMatcher, roundAway, parseNum, toSerial, fromSerial, dateSerial, numToText, FN_IT }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.xlsxCore;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
