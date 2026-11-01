/* Assistente locale + ricerca online facoltativa. Le note vengono analizzate sul dispositivo. */
(function (N) {
  'use strict';
  const noteText = (n) => n.kind === 'list'
    ? (n.items || []).filter((i) => (i.t || '').trim()).map((i) => (i.done ? '[x] ' : '[ ] ') + i.t).join('\n')
    : (n.body || '');

  function keywords(text, limit) {
    const stop = new Set(('come della delle dello degli nella nelle nello negli dalla dalle dallo dagli che per con una uno gli alla alle allo agli sono essere avere questo questa questi quelle anche quando dove quale quali molto tutta tutto dopo prima loro suoi sua suo sulle sulla degli delle then than from that this with have were they your into about there their what which').split(/\s+/));
    const freq = new Map();
    (String(text).toLocaleLowerCase('it').match(/[\p{L}\p{N}']{3,}/gu) || []).forEach((w) => {
      if (!stop.has(w) && !/^\d+$/.test(w)) freq.set(w, (freq.get(w) || 0) + 1);
    });
    return [...freq.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit || 6).map(([w]) => w);
  }

  function summarize(n) {
    const text = noteText(n).trim();
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length < 3 || text.length < 240) return { text: text || 'La nota è vuota.', short: true, keywords: keywords(text, 5) };
    const keys = keywords(text, 10);
    const scored = sentences.map((s, i) => {
      const ws = (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
      const score = ws.reduce((a,w) => a + (keys.indexOf(w) >= 0 ? 1 : 0), 0) / Math.sqrt(Math.max(ws.length, 1));
      return { s, i, score };
    });
    const count = Math.max(2, Math.min(5, Math.ceil(sentences.length * 0.3)));
    const chosen = scored.sort((a,b) => b.score - a.score).slice(0, count).sort((a,b) => a.i - b.i).map(x => x.s);
    return { text: chosen.join(' '), short: false, keywords: keys.slice(0, 6) };
  }

  function mindTree(n) {
    const text = noteText(n);
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const root = { name: (n.title || 'Nota').slice(0, 70), children: [] };
    let current = null;
    for (const line of lines) {
      const heading = line.match(/^#{1,6}\s+(.+)/);
      const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)/);
      if (heading) {
        current = { name: heading[1].slice(0, 70), children: [] };
        root.children.push(current);
      } else if (bullet) {
        if (!current) { current = { name: 'Punti principali', children: [] }; root.children.push(current); }
        current.children.push({ name: bullet[1].replace(/^\[[ xX]\]\s*/, '').slice(0, 70), children: [] });
      } else if (line.length > 35) {
        root.children.push({ name: line.slice(0, 70) + (line.length > 70 ? '…' : ''), children: [] });
      }
    }
    if (root.children.length === 1 && !root.children[0].children.length && lines.length > 1) {
      root.children = lines.slice(0, 8).map(s => ({ name: s.slice(0, 70), children: [] }));
    }
    return root;
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function mindSVG(tree) {
    const nodes = [];
    tree.children.slice(0, 12).forEach((c, i) => {
      nodes.push({ text: c.name, x: 340, y: 54 + i * 78, parent: true });
      (c.children || []).slice(0, 3).forEach((g, j) => nodes.push({ text: g.name, x: 620, y: 54 + i * 78 + (j - 1) * 28, parent: false }));
    });
    const height = Math.max(180, 100 + Math.min(tree.children.length, 12) * 78);
    let lines = '', boxes = '';
    nodes.forEach((node, i) => {
      const y = node.y;
      if (node.parent) {
        lines += `<path d="M280 86 C310 86 310 ${y+20} 340 ${y+20}" fill="none" stroke="#ff9800" stroke-width="2"/>`;
        boxes += `<rect x="340" y="${y}" width="250" height="42" rx="12" fill="#2c2c2c" stroke="#ff9800"/><text x="355" y="${y+26}" fill="#fff" font-size="14">${esc(node.text)}</text>`;
      } else {
        lines += `<path d="M590 ${y+20} H620" stroke="#a0a0a0" stroke-width="2"/>`;
        boxes += `<rect x="620" y="${y}" width="250" height="42" rx="12" fill="#1e1e1e" stroke="#555"/><text x="635" y="${y+26}" fill="#eee" font-size="13">${esc(node.text)}</text>`;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 ${height}" width="900" height="${height}"><rect width="100%" height="100%" rx="16" fill="#121212"/><rect x="30" y="55" width="250" height="62" rx="16" fill="#ff9800"/><text x="155" y="92" text-anchor="middle" fill="#17130a" font-size="18" font-weight="700">${esc(tree.name)}</text>${lines}${boxes}</svg>`;
  }

  function deepDive(n) {
    const text = noteText(n);
    const keys = keywords(text, 8);
    return {
      keywords: keys,
      questions: keys.slice(0, 5).map(k => `Qual è il ruolo di “${k}” in questa nota?`).concat(keys.length ? ['Quali collegamenti ci sono tra questi argomenti?', 'Quali informazioni sarebbe utile verificare?'] : [])
    };
  }

  async function searchOnline(query) {
    if (!navigator.onLine) return { online: false, results: [] };
    try {
      const url = 'https://it.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&format=json&origin=*';
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return { online: true, results: data.query?.search?.slice(0, 3) || [] };
    } catch (_) { return { online: false, results: [] }; }
  }
  N.ai = Object.assign(N.ai || {}, { noteText, keywords, summarize, mindTree, mindSVG, deepDive, searchOnline });
})(window.N = window.N || {});
