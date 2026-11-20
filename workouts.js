/* Allenamenti — schede e progressi salvati solo sul dispositivo. */
(function (N) {
  'use strict';

  const STORE_ID = 'program';
  const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const MAX_SETS = 20, MAX_REPS = 100, MAX_KG = 1000;
  const SET_TYPES = ['normal', 'warmup', 'drop'];
  const SET_TYPE_LABEL = { normal: 'Normale', warmup: 'Riscaldamento', drop: 'Drop set' };
  const SET_TYPE_SHORT = { warmup: 'risc.', drop: 'drop' };
  const MAX_EX_NOTE = 200, MAX_NOTE = 300, MAX_SESSION_NOTE = 500;
  const REMINDER_BASE = 7200;
  let ctx = null, saveChain = Promise.resolve();
  const state = { program: null, ui: null, selectedDayId: null };

  function cleanName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60); }
  function whole(value, fallback, min, max) {
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  }
  function weight(value, fallback) {
    const n = Number(String(value == null ? '' : value).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= MAX_KG ? Math.round(n * 10) / 10 : fallback;
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function cleanType(value) { return SET_TYPES.includes(value) ? value : 'normal'; }
  function cleanNote(value, max) { return String(value == null ? '' : value).replace(/\r/g, '').trim().slice(0, max || MAX_NOTE); }
  // RPE da 1 a 10 con passi di 0,5; vuoto o non valido = nessun valore.
  function cleanRpe(value) {
    if (value === '' || value == null) return null;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) && n >= 1 && n <= 10 ? Math.round(n * 2) / 2 : null;
  }
  // Ripetizioni e tipo di ogni serie: se l'esercizio non ha valori per serie vale il valore unico `reps`.
  function repsFor(ex, i) {
    const own = ex && Array.isArray(ex.setReps) ? ex.setReps[i] : null;
    return whole(own, whole(ex && ex.reps, 10, 1, MAX_REPS), 1, MAX_REPS);
  }
  function typeFor(ex, i) { return cleanType(ex && Array.isArray(ex.setTypes) ? ex.setTypes[i] : null); }
  function repsList(ex) { return Array.from({ length: whole(ex && ex.setCount, 3, 1, MAX_SETS) }, (_, i) => repsFor(ex, i)); }
  // «3 × 10» se uguali, altrimenti «12 · 10 · 8».
  function repsSummary(ex) {
    const list = repsList(ex);
    return list.every((r) => r === list[0]) ? list.length + ' × ' + list[0] : list.join(' · ');
  }
  function makeSet(ex, i) {
    const set = { reps: repsFor(ex, i), kg: ex.kg, done: false };
    const type = typeFor(ex, i);
    if (type !== 'normal') set.type = type;
    return set;
  }
  function normalizeProgram(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return {
      id: STORE_ID,
      days: Array.isArray(p.days) ? p.days.filter((d) => d && d.id).map((d) => ({
        id: String(d.id), name: cleanName(d.name) || 'Giornata', weekday: WEEKDAYS.includes(d.weekday) ? d.weekday : '',
        created: Number(d.created) || Date.now(),
        exercises: Array.isArray(d.exercises) ? d.exercises.filter((e) => e && e.id).map(normalizeExercise) : [],
        activeSession: d.activeSession && Array.isArray(d.activeSession.exercises) ? d.activeSession : null
      })) : [],
      sessions: Array.isArray(p.sessions) ? p.sessions.filter((s) => s && s.id && Array.isArray(s.exercises)) : [],
      bodyWeights: (Array.isArray(p.bodyWeights) ? p.bodyWeights : [])
        .map((w) => ({ t: Number(w && w.t), kg: bodyWeight(w && w.kg) }))
        .filter((w) => Number.isFinite(w.t) && w.t > 0 && w.kg != null)
        .sort((a, b) => a.t - b.t),
      reminder: normalizeReminder(p.reminder),
      updated: Number(p.updated) || Date.now()
    };
  }
  // I campi nuovi (ripetizioni per serie, tipi, nota) ci sono solo se servono: le schede vecchie restano identiche.
  function normalizeExercise(e) {
    const setCount = whole(e.setCount, 3, 1, MAX_SETS), reps = whole(e.reps, 10, 1, MAX_REPS);
    const out = { id: String(e.id), name: cleanName(e.name) || 'Esercizio', setCount, reps, kg: weight(e.kg, 0) };
    if (Array.isArray(e.setReps)) {
      const list = Array.from({ length: setCount }, (_, i) => whole(e.setReps[i], reps, 1, MAX_REPS));
      if (!list.every((r) => r === list[0])) out.setReps = list;
      else out.reps = list[0];
    }
    if (Array.isArray(e.setTypes)) {
      const list = Array.from({ length: setCount }, (_, i) => cleanType(e.setTypes[i]));
      if (list.some((t) => t !== 'normal')) out.setTypes = list;
    }
    const note = cleanNote(e.note, MAX_EX_NOTE);
    if (note) out.note = note;
    const group = cleanGroup(e.group);
    if (group) out.group = group;
    return out;
  }
  function normalizeReminder(r) {
    const raw = r && typeof r === 'object' ? r : {};
    return { enabled: raw.enabled === true, time: parseTime(raw.time) ? raw.time : '18:00' };
  }
  function parseTime(value) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!m) return null;
    const hour = Number(m[1]), minute = Number(m[2]);
    return hour < 24 && minute < 60 ? { hour, minute } : null;
  }
  function makeSession(day, id, startedAt) {
    return {
      id, dayId: day.id, dayName: day.name, startedAt,
      exercises: (day.exercises || []).map((ex) => Object.assign({
        exerciseId: ex.id, name: ex.name,
        sets: Array.from({ length: whole(ex.setCount, 3, 1, MAX_SETS) }, (_, i) => makeSet(ex, i))
      }, ex.group ? { group: ex.group } : {}))
    };
  }
  function sessionStats(session) {
    const sets = (session && session.exercises || []).flatMap((ex) => ex.sets || []);
    const done = sets.filter((s) => s.done);
    return {
      totalSets: sets.length,
      completedSets: done.length,
      // Le serie di riscaldamento si contano tra quelle fatte ma non nel volume.
      volume: done.filter((s) => s.type !== 'warmup').reduce((sum, s) => sum + (Number(s.reps) || 0) * (Number(s.kg) || 0), 0)
    };
  }
  function recentCount(sessions, now, days) {
    const since = (now == null ? Date.now() : now) - (days == null ? 7 : days) * 864e5;
    return (sessions || []).filter((s) => Number(s.completedAt) >= since).length;
  }
  function fmtKg(n) { return Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 }); }
  function fmtDate(ts, full) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('it-IT', full
      ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' });
  }

  // Storico di un esercizio: per ogni sessione completata tiene la serie più pesante (kg e ripetizioni).
  function exerciseHistory(program, exerciseId) {
    const out = [];
    ((program && program.sessions) || []).forEach((s) => {
      const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId && !e.substitute);
      const done = ex ? (ex.sets || []).filter((x) => x && x.done && x.type !== 'warmup' && Number.isFinite(Number(x.kg))) : [];
      if (!done.length) return;
      const best = done.reduce((a, b) => {
        const ka = Number(a.kg), kb = Number(b.kg);
        return kb > ka || (kb === ka && Number(b.reps) > Number(a.reps)) ? b : a;
      });
      out.push({ t: Number(s.completedAt) || Number(s.startedAt) || 0, kg: Number(best.kg) || 0, reps: Number(best.reps) || 0 });
    });
    return out.sort((a, b) => a.t - b.t);
  }
  // ---- Costanza: settimane da lunedì a domenica nel fuso orario del telefono ----
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function startOfWeek(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }
  function sessionTime(s) { return Number(s && (s.completedAt || s.startedAt)) || 0; }
  // Settimane consecutive con almeno una sessione. La settimana in corso non spezza la serie se ancora senza sessioni.
  function weekStreak(sessions, now) {
    const weeks = new Set((sessions || []).map(sessionTime).filter((t) => t > 0).map(startOfWeek));
    const d = new Date(startOfWeek(now == null ? Date.now() : now));
    let streak = weeks.has(d.getTime()) ? 1 : 0;
    for (let guard = 0; guard < 1500; guard++) {
      d.setDate(d.getDate() - 7);
      if (!weeks.has(d.getTime())) break;
      streak++;
    }
    return streak;
  }
  // I sette giorni della settimana in corso: quali con allenamento e quale è oggi.
  function weekDots(sessions, now) {
    const t = now == null ? Date.now() : now;
    const trained = new Set((sessions || []).map(sessionTime).filter((x) => x > 0).map(dayKey));
    const d = new Date(startOfWeek(t));
    const today = dayKey(t);
    return WEEKDAYS.map((name) => {
      const key = dayKey(d.getTime());
      const item = { name, letter: name[0], key, done: trained.has(key), today: key === today };
      d.setDate(d.getDate() + 1);
      return item;
    });
  }
  // Celle di un mese (lunedì per primo): null per i vuoti iniziali, altrimenti { day, key, count }.
  function monthGrid(year, month, sessions) {
    const counts = new Map();
    (sessions || []).map(sessionTime).filter((t) => t > 0).forEach((t) => { const k = dayKey(t); counts.set(k, (counts.get(k) || 0) + 1); });
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const total = new Date(year, month + 1, 0).getDate();
    const cells = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= total; day++) {
      const key = year + '-' + pad2(month + 1) + '-' + pad2(day);
      cells.push({ day, key, count: counts.get(key) || 0 });
    }
    return cells;
  }
  // ---- Peso corporeo ----
  function bodyWeight(value) {
    const n = Number(String(value == null ? '' : value).replace(',', '.'));
    return Number.isFinite(n) && n >= 20 && n <= 400 ? Math.round(n * 10) / 10 : null;
  }
  // Una sola misura per giorno: se ne registri un'altra lo stesso giorno sostituisce la precedente.
  function upsertBodyWeight(list, t, kg) {
    const key = dayKey(t);
    return (list || []).filter((w) => dayKey(w.t) !== key).concat([{ t, kg }]).sort((a, b) => a.t - b.t);
  }
  // Da 'AAAA-MM-GG' a mezzogiorno di quel giorno (evita problemi di fuso e ora legale).
  function dateInputToTime(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d.getTime() : null;
  }
  // ---- Promemoria: una notifica a settimana per ogni giorno della settimana assegnato ----
  // `weekday` segue la convenzione di Capacitor (1 = domenica … 7 = sabato).
  function reminderPlan(program) {
    const byWeekday = new Map();
    ((program && program.days) || []).forEach((day) => {
      const i = WEEKDAYS.indexOf(day.weekday);
      if (i < 0) return;
      if (!byWeekday.has(i)) byWeekday.set(i, []);
      byWeekday.get(i).push(day.name);
    });
    return Array.from(byWeekday.entries()).sort((a, b) => a[0] - b[0])
      .map(([i, names]) => ({ id: REMINDER_BASE + i, weekday: ((i + 1) % 7) + 1, label: WEEKDAYS[i], names }));
  }

  function escAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtNum(v) { return String(Math.round(Number(v) * 10) / 10).replace('.', ','); }
  // Grafico SVG a linea. points = [{ label, kg, reps }], key = 'kg' | 'reps'. Le sessioni sono distanziate in modo uniforme.
  function lineChartSvg(points, key, title) {
    const W = 320, H = 150, L = 40, R = 16, T = 14, B = 26;
    const n = points.length;
    const vals = points.map((p) => Number(p[key]) || 0);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = Math.max(1, (max - min) * 0.15);
    const lo = Math.max(0, min - pad);
    const hi = Math.max(max + pad, lo + 1);
    const x = (i) => (n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const grid = [hi, (hi + lo) / 2, lo].map((v) => {
      const yy = y(v).toFixed(1);
      return '<line class="wk-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text class="wk-tick" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + fmtNum(v) + '</text>';
    }).join('');
    const coords = vals.map((v, i) => [x(i), y(v)]);
    const line = n > 1 ? '<polyline class="wk-line" points="' + coords.map((c) => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ') + '"/>' : '';
    const dots = coords.map((c, i) => '<circle class="wk-dot' + (i === n - 1 ? ' last' : '') + '" cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="' + (i === n - 1 ? 5 : 3.5) + '"/>').join('');
    const lastC = coords[n - 1];
    const value = '<text class="wk-value" x="' + lastC[0].toFixed(1) + '" y="' + (lastC[1] - 10).toFixed(1) + '" text-anchor="' + (n === 1 ? 'middle' : 'end') + '">' + fmtNum(vals[n - 1]) + '</text>';
    const xLabels = n > 1
      ? '<text class="wk-x" x="' + L + '" y="' + (H - 6) + '" text-anchor="start">' + escAttr(points[0].label) + '</text>' +
        '<text class="wk-x" x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + escAttr(points[n - 1].label) + '</text>'
      : '<text class="wk-x" x="' + x(0) + '" y="' + (H - 6) + '" text-anchor="middle">' + escAttr(points[0].label) + '</text>';
    return '<svg class="wk-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + escAttr(title) + '">' +
      grid + line + dots + value + xLabels + '</svg>';
  }

  // Riordina `list` secondo `ids`. Non perde elementi: gli id sconosciuti si ignorano, quelli mancanti restano in coda.
  function reorderById(list, ids, getId) {
    const arr = Array.isArray(list) ? list : [];
    const pool = new Map();
    arr.forEach((item) => {
      const id = getId(item);
      if (!pool.has(id)) pool.set(id, []);
      pool.get(id).push(item);
    });
    const out = [];
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      const queue = pool.get(id);
      if (queue && queue.length) out.push(queue.shift());
    });
    const taken = new Set(out);
    arr.forEach((item) => { if (!taken.has(item)) out.push(item); });
    return out;
  }

  // Riordino con maniglia: puntatore (mouse, touch, penna) e tastiera (frecce su/giù sulla maniglia).
  // Usa la proprietà `translate`, indipendente da `transform`, così non confligge con le animazioni delle card.
  function makeSortable(container, itemSel, handleSel, idOf, onReorder) {
    const items = () => Array.from(container.children).filter((el) => el.matches(itemSel));
    const ids = () => items().map(idOf);
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    let drag = null;

    function step(item, dir) {
      const list = items();
      const ref = list[list.indexOf(item) + dir];
      if (!ref) return false;
      if (dir < 0) ref.before(item); else ref.after(item);
      return true;
    }
    // Esegue `mutate` e fa scorrere con morbidezza gli elementi che cambiano posizione (tecnica FLIP).
    function animateAround(skip, mutate) {
      const others = items().filter((el) => el !== skip);
      const before = others.map((el) => el.getBoundingClientRect().top);
      mutate();
      others.forEach((el, i) => {
        const dy = before[i] - el.getBoundingClientRect().top;
        if (!dy) return;
        el.style.transition = 'none';
        el.style.translate = '0 ' + dy + 'px';
        void el.offsetHeight;
        el.style.transition = 'translate .18s var(--ease-smooth)';
        el.style.translate = '0 0';
      });
    }
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    function update() {
      if (!drag) return;
      const item = drag.item;
      const center = drag.y - drag.grab + drag.h / 2;
      for (let guard = 0; guard < 20; guard++) {
        const list = items();
        const i = list.indexOf(item);
        if (list[i - 1] && center < mid(list[i - 1])) animateAround(item, () => step(item, -1));
        else if (list[i + 1] && center > mid(list[i + 1])) animateAround(item, () => step(item, 1));
        else break;
      }
      const natural = item.getBoundingClientRect().top - drag.ty;
      drag.ty = drag.y - drag.grab - natural;
      item.style.translate = '0 ' + drag.ty + 'px';
    }
    function edgeScroll() {
      const scroller = container.closest('.workout-body');
      if (!scroller || !drag) return;
      const r = scroller.getBoundingClientRect();
      drag.speed = drag.y < r.top + 70 ? -10 : drag.y > r.bottom - 70 ? 10 : 0;
      if (!drag.speed || drag.raf) return;
      const tick = () => {
        if (!drag || !drag.speed) { if (drag) drag.raf = 0; return; }
        scroller.scrollTop += drag.speed;
        update();
        drag.raf = requestAnimationFrame(tick);
      };
      drag.raf = requestAnimationFrame(tick);
    }
    function finish(e, cancelled) {
      if (!drag || (e && e.pointerId !== drag.pointerId)) return;
      const d = drag;
      drag = null;
      cancelAnimationFrame(d.raf);
      try { container.releasePointerCapture(d.pointerId); } catch (_) { /* già rilasciato */ }
      if (cancelled) {
        const byId = new Map(items().map((el) => [idOf(el), el]));
        d.startIds.forEach((id) => { const el = byId.get(id); if (el) container.append(el); });
      }
      d.item.classList.remove('is-sorting-item');
      d.item.classList.add('is-settling');
      d.item.style.transition = 'translate .18s var(--ease-smooth)';
      d.item.style.translate = '0 0';
      setTimeout(() => {
        items().forEach((el) => { el.style.translate = ''; el.style.transition = ''; el.classList.remove('is-settling'); });
        container.classList.remove('workout-sorting');
      }, 230);
      const now = ids();
      if (!same(now, d.startIds)) {
        if (navigator.vibrate) navigator.vibrate(8);
        onReorder(now);
      }
    }

    container.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest(handleSel);
      if (!handle || !container.contains(handle) || drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const item = handle.closest(itemSel);
      if (!item) return;
      e.preventDefault();
      // La cattura sta sul contenitore, che non si sposta: la maniglia viaggia con la card e perderebbe la cattura.
      try { container.setPointerCapture(e.pointerId); } catch (_) { /* non supportato */ }
      const rect = item.getBoundingClientRect();
      drag = { item, handle, pointerId: e.pointerId, y: e.clientY, grab: e.clientY - rect.top, h: rect.height, ty: 0, startIds: ids(), raf: 0, speed: 0 };
      item.classList.add('is-sorting-item');
      container.classList.add('workout-sorting');
      if (navigator.vibrate) navigator.vibrate(12);
    });
    container.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.y = e.clientY;
      update();
      edgeScroll();
    });
    container.addEventListener('pointerup', (e) => finish(e, false));
    container.addEventListener('pointercancel', (e) => finish(e, true));
    container.addEventListener('lostpointercapture', (e) => finish(e, true));
    container.addEventListener('keydown', (e) => {
      const handle = e.target.closest(handleSel);
      if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const item = handle.closest(itemSel);
      if (!item) return;
      e.preventDefault();
      let moved = false;
      animateAround(null, () => { moved = step(item, e.key === 'ArrowUp' ? -1 : 1); });
      if (moved) { handle.focus(); onReorder(ids()); }
    });
  }
  function gripButton(label) {
    return ctx.h('button', {
      class: 'ibtn workout-grip', type: 'button', 'data-workout-grip': '1',
      'aria-label': label, title: 'Trascina per riordinare (o usa le frecce su/giù)', html: ctx.I('grip', 20)
    });
  }
  function applyDayOrder(ids) {
    state.program.days = reorderById(state.program.days, ids, (d) => d.id);
    if (state.ui) state.ui.body.querySelectorAll('.workout-day-number').forEach((el, i) => { el.textContent = String(i + 1).padStart(2, '0'); });
    save().catch(onSaveError);
  }
  function applyExerciseOrder(day, ids) {
    day.exercises = reorderById(day.exercises, ids, (e) => e.id);
    if (day.activeSession) day.activeSession.exercises = reorderById(day.activeSession.exercises, ids, (e) => e.exerciseId);
    save().catch(onSaveError);
  }

  async function load() {
    state.program = normalizeProgram(await N.db.workouts.get(STORE_ID));
  }
  function save() {
    if (!state.program) return Promise.resolve();
    state.program.updated = Date.now();
    const snapshot = copy(state.program);
    saveChain = saveChain.catch(() => {}).then(() => N.db.workouts.put(snapshot));
    return saveChain;
  }
  function dayById(id) { return state.program.days.find((d) => d.id === id); }
  function daySessions(id) {
    return state.program.sessions.filter((s) => s.dayId === id).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  }
  function onSaveError(error) {
    console.error(error);
    ctx.toast('Non riesco a salvare sul dispositivo. Controlla lo spazio disponibile.', 4200);
  }

  function init(c) { ctx = c; }
  function makeScreen() {
    const title = ctx.h('h2', { class: 'ds-title' }, 'Allenamenti');
    const actions = ctx.h('div', { class: 'ds-actions' });
    const body = ctx.h('div', { class: 'workout-body' });
    const el = ctx.h('section', { class: 'workout-screen', role: 'dialog', 'aria-label': 'Allenamenti' },
      ctx.h('header', { class: 'ds-bar' },
        ctx.ibtn('back', () => ctx.back(), 'Indietro'),
        title,
        actions
      ),
      body
    );
    document.body.append(el);
    const ui = { el, title, actions, body };
    state.ui = ui;
    ctx.pushLayer(() => {
      if (state.ui !== ui) return;
      el.remove();
      state.ui = null;
      state.selectedDayId = null;
    });
    return ui;
  }
  async function open() {
    if (!ctx) throw new Error('Allenamenti non inizializzati');
    if (state.ui) { render(); return state.ui; }
    await load();
    refreshReminders();
    const ui = makeScreen();
    render();
    return ui;
  }
  function render() {
    const ui = state.ui;
    if (!ui || !state.program) return;
    const day = state.selectedDayId ? dayById(state.selectedDayId) : null;
    ui.title.textContent = day ? day.name : 'Allenamenti';
    ui.actions.replaceChildren(ctx.ibtn(day ? 'more' : 'plus', () => day ? dayOptions(day.id) : openDayForm(), day ? 'Opzioni giornata' : 'Nuova giornata', day ? '' : 'workout-add-day'));
    ui.body.replaceChildren();
    if (day) renderDay(ui.body, day);
    else renderOverview(ui.body);
  }
  function openDay(id) {
    if (!dayById(id)) return;
    state.selectedDayId = id;
    ctx.pushLayer(() => {
      if (state.selectedDayId !== id) return;
      state.selectedDayId = null;
      render();
    });
    render();
  }
  function stat(value, label) {
    return ctx.h('div', { class: 'workout-stat' }, ctx.h('strong', null, value), ctx.h('span', null, label));
  }

  function renderOverview(body) {
    const days = state.program.days;
    const sessions = state.program.sessions;
    const latest = sessions.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
    body.append(ctx.h('section', { class: 'workout-hero' },
      ctx.h('div', { class: 'workout-hero-icon', html: ctx.I('dumbbell', 24) }),
      ctx.h('p', { class: 'workout-eyebrow' }, 'IL TUO PERCORSO'),
      ctx.h('h3', null, 'Allenati con un piano chiaro'),
      ctx.h('p', { class: 'workout-hero-copy' }, latest ? 'Una sessione alla volta: registra le serie e ritrova i progressi quando vuoi.' : 'Crea i tuoi giorni, organizza gli esercizi e registra ogni serie.'),
      ctx.h('div', { class: 'workout-stats' }, stat(String(days.length), 'giorni'), stat(String(recentCount(sessions)), 'sessioni · 7 gg'))
    ));
    body.append(ctx.h('div', { class: 'workout-local-note' }, ctx.h('span', { html: ctx.I('lock', 17) }), 'Schede e progressi restano sul dispositivo, anche offline.'));
    body.append(ctx.h('div', { class: 'workout-section-heading' },
      ctx.h('div', null, ctx.h('p', { class: 'workout-eyebrow' }, 'PROGRAMMA'), ctx.h('h3', null, 'I tuoi giorni')),
      days.length ? ctx.h('span', { class: 'workout-count' }, String(days.length)) : null
    ));
    if (!days.length) {
      body.append(ctx.h('section', { class: 'workout-empty' },
        ctx.h('span', { class: 'workout-empty-icon', html: ctx.I('dumbbell', 28) }),
        ctx.h('h3', null, 'La tua scheda parte da qui'),
        ctx.h('p', null, 'Crea un giorno di allenamento, ad esempio “Petto e tricipiti” o “Lunedì”.'),
        ctx.h('button', { class: 'btn pri', 'data-workout-add-first': '1', onclick: () => openDayForm() }, 'Crea il primo giorno')
      ));
    } else {
      const list = ctx.h('div', { class: 'workout-days' });
      days.forEach((day, index) => {
        const exercises = day.exercises.length;
        const last = daySessions(day.id)[0];
        list.append(ctx.h('article', { class: 'workout-day-card', 'data-workout-day-card': day.id },
          ctx.h('button', { class: 'workout-day-main', 'data-workout-open-day': day.id, onclick: () => openDay(day.id) },
            ctx.h('span', { class: 'workout-day-number' }, String(index + 1).padStart(2, '0')),
            ctx.h('span', { class: 'workout-day-copy' },
              ctx.h('span', { class: 'workout-day-meta' }, day.weekday || 'Routine personalizzata'),
              ctx.h('strong', null, day.name),
              ctx.h('small', null, exercises + (exercises === 1 ? ' esercizio' : ' esercizi') + (last ? ' · Ultimo: ' + fmtDate(last.completedAt) : ' · Tocca per iniziare'))
            ),
            ctx.h('span', { class: 'workout-chevron', 'aria-hidden': 'true' }, '›')
          ),
          ctx.ibtn('more', () => dayOptions(day.id), 'Opzioni di ' + day.name, 'workout-day-more'),
          days.length > 1 ? gripButton('Riordina ' + day.name) : null
        ));
      });
      body.append(list);
      if (days.length > 1) makeSortable(list, '.workout-day-card', '.workout-grip', (el) => el.dataset.workoutDayCard, applyDayOrder);
    }
    if (latest) {
      const stats = sessionStats(latest);
      body.append(ctx.h('section', { class: 'workout-last-session' },
        ctx.h('span', { class: 'workout-session-mark', html: ctx.I('check', 18) }),
        ctx.h('div', null, ctx.h('strong', null, 'Ultimo allenamento'), ctx.h('small', null, fmtDate(latest.completedAt, true) + ' · ' + stats.completedSets + ' serie completate')),
        ctx.h('b', null, fmtKg(stats.volume) + ' kg')
      ));
    }
    renderVolumeChart(body);
    renderWeeklyVolume(body);
    renderMonthCard(body);
    renderConsistency(body);
    renderBodyWeight(body);
    renderBackup(body);
  }

  function renderDay(body, day) {
    const active = day.activeSession;
    const sessions = daySessions(day.id);
    const exerciseCount = day.exercises.length;
    const setCount = day.exercises.reduce((n, ex) => n + ex.setCount, 0);
    body.append(ctx.h('section', { class: 'workout-day-hero' },
      ctx.h('div', { class: 'workout-day-hero-top' },
        ctx.h('span', { class: 'workout-day-badge' }, day.weekday || 'Giornata ' + (state.program.days.indexOf(day) + 1)),
        ctx.h('span', { class: 'workout-day-badge soft' }, exerciseCount + ' ' + (exerciseCount === 1 ? 'esercizio' : 'esercizi'))
      ),
      ctx.h('h3', { class: 'workout-day-title' }, day.name),
      ctx.h('p', { class: 'workout-day-sub' }, active ? 'Sessione in corso · i dati si salvano automaticamente.' : exerciseCount ? setCount + ' serie previste · il tuo piano è pronto.' : 'Aggiungi gli esercizi che farai in questa sessione.')
    ));
    body.append(ctx.h('div', { class: 'workout-section-heading' },
      ctx.h('div', null, ctx.h('p', { class: 'workout-eyebrow' }, active ? 'SESSIONE' : 'LA TUA SCHEDA'), ctx.h('h3', null, active ? 'Registra le serie' : 'Esercizi')),
      ctx.h('button', { class: 'workout-add-exercise', 'data-workout-add-exercise': '1', onclick: () => openExerciseForm(day.id) }, ctx.h('span', { html: ctx.I('plus', 17) }), 'Aggiungi')
    ));
    if (active && exerciseCount) body.append(ctx.h('p', { class: 'hint workout-set-hint' }, 'Tocca il numero di una serie per segnarla come riscaldamento o drop set. RPE: quanto è stata faticosa, da 1 a 10.'));
    if (!exerciseCount) {
      body.append(ctx.h('section', { class: 'workout-empty compact' },
        ctx.h('h3', null, 'Nessun esercizio ancora'),
        ctx.h('p', null, 'Aggiungi il primo esercizio con serie, ripetizioni e carico di partenza.')
      ));
    } else {
      const list = ctx.h('div', { class: 'workout-exercises' });
      day.exercises.forEach((ex) => list.append(renderExercise(day, ex, active)));
      body.append(list);
      if (exerciseCount > 1) makeSortable(list, '.workout-exercise-card', '.workout-grip', (el) => el.dataset.workoutExercise, (ids) => applyExerciseOrder(day, ids));
    }
    if (active) {
      body.append(sessionNoteField(active, 'Nota della sessione', 'session'));
      body.append(ctx.h('div', { class: 'workout-session-summary', id: 'workout-session-summary' }, summaryText(sessionStats(active))));
      body.append(ctx.h('div', { class: 'workout-footer' },
        ctx.h('button', { class: 'btn pri workout-finish', 'data-workout-finish': '1', onclick: () => finishSession(day) }, 'Concludi sessione')
      ));
    } else if (exerciseCount) {
      body.append(ctx.h('div', { class: 'workout-start-card' },
        ctx.h('div', { class: 'workout-start-copy' },
          ctx.h('strong', null, sessions.length ? 'Pronto per il prossimo allenamento?' : 'Pronto a iniziare?'),
          ctx.h('small', null, sessions.length ? sessions.length + (sessions.length === 1 ? ' sessione salvata' : ' sessioni salvate') : 'Durante la sessione puoi modificare ripetizioni e carichi.')
        ),
        ctx.h('button', { class: 'btn pri', 'data-workout-start': '1', onclick: () => startSession(day) }, 'Inizia allenamento')
      ));
    }
    if (!active && sessions.length) {
      const prev = previousSession(state.program.sessions, sessions[0]);
      if (prev) body.append(comparisonCard(sessions[0], prev));
    }
    if (sessions.length) renderHistory(body, sessions);
  }
  function summaryText(stats) {
    return stats.completedSets + ' / ' + stats.totalSets + ' serie completate · ' + fmtKg(stats.volume) + ' kg di volume';
  }
  function exerciseSummary(ex) {
    const list = repsList(ex);
    const same = list.every((r) => r === list[0]);
    return ex.setCount + ' serie · ' + (same ? list[0] : list.join('/')) + ' rip · ' + fmtKg(ex.kg) + ' kg';
  }
  function renderExercise(day, ex, active) {
    const current = active && active.exercises.find((item) => item.exerciseId === ex.id);
    const card = ctx.h('article', { class: 'workout-exercise-card', 'data-workout-exercise': ex.id });
    card.append(ctx.h('div', { class: 'workout-exercise-top' },
      ctx.h('div', { class: 'workout-exercise-icon', html: ctx.I('dumbbell', 18) }),
      ctx.h('div', { class: 'workout-exercise-name' },
        ctx.h('strong', null, current ? current.name : ex.name),
        ctx.h('small', null, current && current.substitute ? 'Oggi al posto di ' + ex.name : exerciseSummary(ex))
      ),
      ctx.ibtn('swap', () => openSubstitute(day.id, ex.id), 'Sostituisci ' + ex.name, 'workout-exercise-swap'),
      ctx.ibtn('more', () => exerciseOptions(day.id, ex.id), 'Opzioni di ' + ex.name, 'workout-exercise-more'),
      day.exercises.length > 1 ? gripButton('Riordina ' + ex.name) : null
    ));
    if (ex.note) card.append(ctx.h('p', { class: 'workout-exercise-note', 'data-exercise-fixed-note': '1' }, ctx.h('span', { html: ctx.I('edit', 14) }), ex.note));
    const suggestion = current && current.substitute ? null : progressionSuggestion(state.program, ex);
    if (suggestion && !(current && current.sets.some((x) => x.done))) card.append(progressionBanner(day, ex, current, suggestion));
    if (!active || !current) {
      card.append(ctx.h('div', { class: 'workout-target-row' },
        ctx.h('span', null, 'Obiettivo'),
        ctx.h('strong', null, repsSummary(ex)),
        ctx.h('b', null, fmtKg(ex.kg) + ' kg')
      ));
      return card;
    }
    card.append(ctx.h('div', { class: 'workout-set-head' },
      ctx.h('span', null, 'SERIE'), ctx.h('span', null, 'RIP'), ctx.h('span', null, 'KG'), ctx.h('span', null, 'RPE'), ctx.h('span', { class: 'workout-done-head' }, 'OK')
    ));
    const work = current.sets.find((s) => cleanType(s.type) === 'normal');
    if (work && !current.sets.some((s) => s.type === 'warmup') && warmupPlan(work.kg, work.reps).length) {
      card.append(ctx.h('button', { class: 'workout-warmup-btn', type: 'button', 'data-workout-warmup': '1', onclick: () => addWarmup(current, work) },
        ctx.h('span', { html: ctx.I('dumbbell', 15) }), 'Riscaldamento suggerito · ' + warmupPlan(work.kg, work.reps).length + ' serie'));
    }
    current.sets.forEach((set, index) => {
      const row = ctx.h('div', { class: 'workout-set-row' + (set.done ? ' completed' : ''), 'data-workout-set': index, 'data-type': cleanType(set.type) });
      const badge = ctx.h('button', { class: 'workout-set-number', type: 'button', 'data-set-type': '1' });
      paintBadge(badge, index, set);
      badge.addEventListener('click', () => cycleSetType(day, current, index, badge));
      row.append(badge);
      const reps = ctx.h('input', { class: 'workout-number', type: 'number', min: '1', max: String(MAX_REPS), step: '1', inputmode: 'numeric', value: set.reps, 'aria-label': 'Ripetizioni serie ' + (index + 1), 'data-set-reps': '1' });
      reps.addEventListener('change', () => updateSet(day, current, index, 'reps', whole(reps.value, set.reps, 1, MAX_REPS)));
      const kg = ctx.h('input', { class: 'workout-number', type: 'number', min: '0', max: String(MAX_KG), step: '0.5', inputmode: 'decimal', value: set.kg, 'aria-label': 'Carico in kg serie ' + (index + 1), 'data-set-kg': '1' });
      kg.addEventListener('change', () => updateSet(day, current, index, 'kg', weight(kg.value, set.kg)));
      const rpe = ctx.h('input', { class: 'workout-number workout-rpe', type: 'number', min: '1', max: '10', step: '0.5', inputmode: 'decimal', placeholder: '–', value: set.rpe == null ? '' : set.rpe, 'aria-label': 'RPE serie ' + (index + 1), 'data-set-rpe': '1' });
      rpe.addEventListener('change', () => { const value = cleanRpe(rpe.value); rpe.value = value == null ? '' : value; updateSet(day, current, index, 'rpe', value); });
      row.append(reps, kg, rpe);
      row.append(ctx.h('button', {
        class: 'workout-set-done' + (set.done ? ' is-done' : ''), type: 'button',
        'data-set-done': '1', 'aria-label': (set.done ? 'Annulla ' : 'Completa ') + 'serie ' + (index + 1),
        'aria-pressed': set.done ? 'true' : 'false',
        onclick: (e) => toggleSet(day, current, index, e.currentTarget)
      }, ctx.h('span', { html: ctx.I('check', 17) })));
      card.append(row);
    });
    card.append(sessionNoteField(current, 'Nota di oggi su questo esercizio', 'exercise'));
    return card;
  }
  function paintBadge(badge, index, set) {
    const type = cleanType(set.type);
    badge.replaceChildren(ctx.h('b', null, String(index + 1).padStart(2, '0')));
    if (type !== 'normal') badge.append(ctx.h('em', null, SET_TYPE_SHORT[type]));
    badge.setAttribute('aria-label', 'Serie ' + (index + 1) + ', ' + SET_TYPE_LABEL[type].toLowerCase() + '. Tocca per cambiare il tipo');
    if (badge.parentElement) badge.parentElement.dataset.type = type;
  }
  function cycleSetType(day, current, index, badge) {
    const set = current.sets[index];
    if (!set) return;
    const next = SET_TYPES[(SET_TYPES.indexOf(cleanType(set.type)) + 1) % SET_TYPES.length];
    if (next === 'normal') delete set.type; else set.type = next;
    paintBadge(badge, index, set);
    if (navigator.vibrate) navigator.vibrate(8);
    save().catch(onSaveError);
    refreshSessionSummary(day);
  }
  // Nota libera: `kind` 'exercise' = nota di oggi su un esercizio della sessione, 'session' = nota dell'intera sessione.
  function sessionNoteField(target, label, kind) {
    const max = kind === 'session' ? MAX_SESSION_NOTE : MAX_NOTE;
    const attrs = { class: 'field workout-note', rows: kind === 'session' ? '3' : '2', maxlength: String(max), placeholder: kind === 'session' ? 'Com’è andata? Sensazioni, energia, sonno… (facoltativa)' : 'es. spalla fastidiosa, ho cambiato presa', 'aria-label': label };
    attrs['data-' + kind + '-note'] = '1';
    const area = ctx.h('textarea', attrs);
    area.value = target.note || '';
    area.addEventListener('input', () => { const value = cleanNote(area.value, max); if (value) target.note = value; else delete target.note; });
    area.addEventListener('change', () => save().catch(onSaveError));
    if (kind === 'session') return ctx.h('label', { class: 'workout-note-card' }, ctx.h('span', null, label), area);
    area.hidden = !target.note;
    const toggleText = document.createTextNode('');
    const paintLabel = () => { toggleText.nodeValue = (!area.hidden || target.note) ? 'Nota di oggi' : 'Aggiungi una nota'; };
    const toggle = ctx.h('button', { class: 'workout-note-toggle', type: 'button', 'data-exercise-note-toggle': '1', onclick: () => { area.hidden = !area.hidden; paintLabel(); if (!area.hidden) area.focus(); } },
      ctx.h('span', { html: ctx.I('edit', 15) }), toggleText);
    area.addEventListener('input', paintLabel);
    paintLabel();
    return ctx.h('div', { class: 'workout-note-wrap' }, toggle, area);
  }
  function updateSet(day, current, index, key, value) {
    if (!current.sets[index]) return;
    if (value == null) delete current.sets[index][key]; else current.sets[index][key] = value;
    save().catch(onSaveError);
    refreshSessionSummary(day);
  }
  function toggleSet(day, current, index, button) {
    const set = current.sets[index];
    if (!set) return;
    set.done = !set.done;
    const row = button.closest('.workout-set-row');
    row.classList.toggle('completed', set.done);
    button.classList.toggle('is-done', set.done);
    button.setAttribute('aria-pressed', String(set.done));
    button.setAttribute('aria-label', (set.done ? 'Annulla ' : 'Completa ') + 'serie ' + (index + 1));
    if (navigator.vibrate) navigator.vibrate(10);
    save().catch(onSaveError);
    refreshSessionSummary(day);
  }
  function refreshSessionSummary(day) {
    const el = state.ui && state.ui.body.querySelector('#workout-session-summary');
    if (el && day.activeSession) el.textContent = summaryText(sessionStats(day.activeSession));
  }
  async function startSession(day) {
    if (!day.exercises.length) return ctx.toast('Aggiungi prima almeno un esercizio.');
    day.activeSession = makeSession(day, ctx.uid(), Date.now());
    try { await save(); render(); ctx.toast('Allenamento iniziato'); }
    catch (e) { onSaveError(e); }
  }
  async function finishSession(day) {
    const active = day.activeSession;
    if (!active) return;
    const stats = sessionStats(active);
    if (!stats.completedSets) return ctx.toast('Completa almeno una serie prima di salvare la sessione.');
    const record = copy(active);
    record.dayName = day.name;
    record.completedAt = Date.now();
    state.program.sessions.push(record);
    day.activeSession = null;
    try { await save(); render(); ctx.toast('Sessione salvata nei progressi'); }
    catch (e) { onSaveError(e); }
  }
  function renderHistory(body, sessions) {
    body.append(ctx.h('div', { class: 'workout-section-heading history-heading' },
      ctx.h('div', null, ctx.h('p', { class: 'workout-eyebrow' }, 'PROGRESSI'), ctx.h('h3', null, 'Cronologia'))
    ));
    const list = ctx.h('div', { class: 'workout-history' });
    sessions.forEach((session) => {
      const stats = sessionStats(session);
      list.append(ctx.h('button', { class: 'workout-history-row', 'data-workout-history': session.id, onclick: () => showSession(session) },
        ctx.h('span', { class: 'workout-history-check', html: ctx.I('check', 16) }),
        ctx.h('span', { class: 'workout-history-copy' },
          ctx.h('strong', null, fmtDate(session.completedAt, true)),
          ctx.h('small', null, stats.completedSets + ' serie · ' + fmtKg(stats.volume) + ' kg' + (session.note ? ' · con nota' : ''))
        ),
        ctx.h('span', { class: 'workout-chevron', 'aria-hidden': 'true' }, '›')
      ));
    });
    body.append(list);
  }
  function setText(set) {
    const prefix = set.type === 'warmup' ? 'Risc. ' : set.type === 'drop' ? 'Drop ' : '';
    return prefix + set.reps + ' × ' + fmtKg(set.kg) + ' kg' + (set.rpe != null ? ' · RPE ' + fmtNum(set.rpe) : '');
  }
  function showSession(session) {
    const body = ctx.h('div', { class: 'workout-session-details' });
    const stats = sessionStats(session);
    body.append(ctx.h('p', { class: 'hint' }, fmtDate(session.completedAt, true) + ' · ' + stats.completedSets + ' serie completate · ' + fmtKg(stats.volume) + ' kg'));
    (session.exercises || []).forEach((ex) => {
      const done = (ex.sets || []).filter((s) => s.done);
      if (!done.length && !ex.note) return;
      const box = ctx.h('div', { class: 'workout-history-exercise' }, ctx.h('strong', null, ex.name));
      if (done.length) box.append(ctx.h('small', null, done.map(setText).join('  ·  ')));
      if (ex.note) box.append(ctx.h('small', { class: 'workout-history-note' }, ex.note));
      body.append(box);
    });
    if (session.note) body.append(ctx.h('div', { class: 'workout-history-exercise' }, ctx.h('strong', null, 'Nota della sessione'), ctx.h('small', { class: 'workout-history-note' }, session.note)));
    const prev = previousSession(state.program.sessions, session);
    if (prev) body.append(comparisonCard(session, prev));
    ctx.openSheet(session.dayName || 'Allenamento', body);
  }

  // Porta il cursore sul primo campo a pannello aperto, ma solo se l'utente non ha già scelto un altro campo
  // (altrimenti ciò che sta scrivendo finirebbe nel campo sbagliato).
  function focusSoon(getSheet, input, select) {
    setTimeout(() => {
      const sheet = getSheet();
      const active = document.activeElement;
      if (!sheet || !sheet.el.isConnected) return;
      if (active && active !== document.body && sheet.el.contains(active)) return;
      input.focus();
      if (select) input.select();
    }, 180);
  }
  function openDayForm(existing) {
    const isEdit = !!existing;
    const name = ctx.h('input', { class: 'field', maxlength: '60', placeholder: 'es. Petto e tricipiti', value: existing ? existing.name : '', 'data-workout-day-name': '1', autocomplete: 'off' });
    const weekday = ctx.h('select', { class: 'field', 'data-workout-day-weekday': '1' },
      ctx.h('option', { value: '' }, 'Senza giorno fisso'),
      ...WEEKDAYS.map((day) => ctx.h('option', { value: day }, day))
    );
    weekday.value = existing ? existing.weekday : '';
    const error = ctx.h('p', { class: 'err', role: 'alert' });
    let sheet;
    const content = ctx.h('div', { class: 'workout-form' },
      ctx.h('label', null, 'Nome del giorno', name),
      ctx.h('label', null, 'Giorno della settimana (facoltativo)', weekday),
      error,
      ctx.h('div', { class: 'btns' },
        ctx.h('button', { class: 'btn', onclick: () => sheet.close() }, 'Annulla'),
        ctx.h('button', { class: 'btn pri', 'data-workout-save-day': '1', onclick: saveDay }, isEdit ? 'Salva modifiche' : 'Crea giornata')
      )
    );
    sheet = ctx.openSheet(isEdit ? 'Modifica giornata' : 'Nuovo giorno', content);
    focusSoon(() => sheet, name);
    async function saveDay() {
      const clean = cleanName(name.value);
      if (!clean) { error.textContent = 'Inserisci un nome per la giornata.'; name.focus(); return; }
      if (existing) {
        existing.name = clean; existing.weekday = weekday.value;
        try { await save(); refreshReminders(); await sheet.close(); render(); ctx.toast('Giornata aggiornata'); }
        catch (e) { onSaveError(e); }
        return;
      }
      const day = { id: ctx.uid(), name: clean, weekday: weekday.value, created: Date.now(), exercises: [], activeSession: null };
      state.program.days.push(day);
      try { await save(); refreshReminders(); await sheet.close(); openDay(day.id); }
      catch (e) { onSaveError(e); }
    }
  }
  function openExerciseForm(dayId, existing) {
    const day = dayById(dayId);
    if (!day) return;
    // Ripetizioni e tipo di ogni serie: le liste non si accorciano mentre si scrive, così cambiare il numero di serie non fa perdere i valori.
    const repsAll = [], typesAll = [];
    const startCount = existing ? existing.setCount : 3;
    for (let i = 0; i < startCount; i++) { repsAll.push(existing ? repsFor(existing, i) : 10); typesAll.push(existing ? typeFor(existing, i) : 'normal'); }
    function ensure(count, fill) { while (repsAll.length < count) { repsAll.push(fill); typesAll.push('normal'); } }
    const name = ctx.h('input', { class: 'field', maxlength: '60', placeholder: 'es. Panca piana', value: existing ? existing.name : '', 'data-workout-exercise-name': '1', autocomplete: 'off' });
    const sets = ctx.h('input', { class: 'field', type: 'number', min: '1', max: String(MAX_SETS), step: '1', inputmode: 'numeric', value: startCount, 'data-workout-exercise-sets': '1' });
    const reps = ctx.h('input', { class: 'field', type: 'number', min: '1', max: String(MAX_REPS), step: '1', inputmode: 'numeric', value: existing ? repsAll[0] : 10, 'data-workout-exercise-reps': '1' });
    const kg = ctx.h('input', { class: 'field', type: 'number', min: '0', max: String(MAX_KG), step: '0.5', inputmode: 'decimal', value: existing ? existing.kg : 0, 'data-workout-exercise-kg': '1' });
    const group = ctx.h('select', { class: 'field', 'data-workout-exercise-group': '1' },
      ctx.h('option', { value: '' }, 'Nessun gruppo'),
      ...GROUPS.map((g) => ctx.h('option', { value: g }, g)));
    group.value = existing && existing.group ? existing.group : '';
    const note = ctx.h('input', { class: 'field', maxlength: String(MAX_EX_NOTE), placeholder: 'es. sedile in posizione 4', value: existing && existing.note ? existing.note : '', 'data-workout-exercise-note': '1', autocomplete: 'off' });
    const perSet = ctx.h('div', { class: 'workout-perset', 'data-workout-perset': '1' });
    const error = ctx.h('p', { class: 'err', role: 'alert' });
    const currentCount = () => whole(sets.value, repsAll.length, 1, MAX_SETS);
    function drawPerSet() {
      const count = currentCount();
      ensure(count, whole(reps.value, 10, 1, MAX_REPS));
      perSet.replaceChildren();
      for (let i = 0; i < count; i++) {
        const input = ctx.h('input', { class: 'workout-number', type: 'number', min: '1', max: String(MAX_REPS), step: '1', inputmode: 'numeric', value: repsAll[i], 'aria-label': 'Ripetizioni serie ' + (i + 1), 'data-perset-reps': String(i) });
        input.addEventListener('input', () => { const n = whole(input.value, null, 1, MAX_REPS); if (n != null) repsAll[i] = n; });
        const type = ctx.h('select', { class: 'workout-type-select', 'aria-label': 'Tipo della serie ' + (i + 1), 'data-perset-type': String(i) },
          ...SET_TYPES.map((t) => ctx.h('option', { value: t }, SET_TYPE_LABEL[t])));
        type.value = typesAll[i];
        type.addEventListener('change', () => { typesAll[i] = cleanType(type.value); });
        perSet.append(ctx.h('div', { class: 'workout-perset-row' }, ctx.h('span', null, 'Serie ' + (i + 1)), input, type));
      }
    }
    sets.addEventListener('input', drawPerSet);
    reps.addEventListener('input', () => {
      const n = whole(reps.value, null, 1, MAX_REPS);
      if (n == null) return;
      for (let i = 0; i < repsAll.length; i++) repsAll[i] = n;
      drawPerSet();
    });
    drawPerSet();
    let sheet;
    const content = ctx.h('div', { class: 'workout-form' },
      ctx.h('label', null, 'Nome esercizio', name),
      ctx.h('div', { class: 'workout-form-grid' },
        ctx.h('label', null, 'Serie', sets),
        ctx.h('label', null, 'Rip. di tutte', reps),
        ctx.h('label', null, 'Kg', kg)
      ),
      ctx.h('div', { class: 'workout-perset-head' }, ctx.h('strong', null, 'Ripetizioni per serie'), ctx.h('small', null, 'Cambia le singole serie, ad esempio 12 · 10 · 8, o segnale come riscaldamento o drop set.')),
      perSet,
      ctx.h('label', null, 'Gruppo muscolare', group),
      ctx.h('label', null, 'Nota fissa (facoltativa)', note),
      ctx.h('p', { class: 'hint' }, 'Sono i valori di partenza: durante l’allenamento potrai registrarli serie per serie.'),
      error,
      ctx.h('div', { class: 'btns' },
        ctx.h('button', { class: 'btn', onclick: () => sheet.close() }, 'Annulla'),
        ctx.h('button', { class: 'btn pri', 'data-workout-save-exercise': '1', onclick: saveExercise }, existing ? 'Salva esercizio' : 'Aggiungi esercizio')
      )
    );
    sheet = ctx.openSheet(existing ? 'Modifica esercizio' : 'Nuovo esercizio', content);
    focusSoon(() => sheet, name);
    async function saveExercise() {
      const clean = cleanName(name.value);
      const count = whole(sets.value, null, 1, MAX_SETS);
      const loadKg = weight(kg.value, null);
      if (!clean) { error.textContent = 'Inserisci il nome dell’esercizio.'; name.focus(); return; }
      if (count == null || loadKg == null) { error.textContent = 'Serie o carico non validi.'; return; }
      ensure(count, whole(reps.value, 10, 1, MAX_REPS));
      const list = repsAll.slice(0, count), types = typesAll.slice(0, count);
      const ex = existing || { id: ctx.uid() };
      ex.name = clean; ex.setCount = count; ex.kg = loadKg; ex.reps = list[0];
      if (list.every((r) => r === list[0])) delete ex.setReps; else ex.setReps = list;
      if (types.every((t) => t === 'normal')) delete ex.setTypes; else ex.setTypes = types;
      const text = cleanNote(note.value, MAX_EX_NOTE);
      if (text) ex.note = text; else delete ex.note;
      const chosenGroup = cleanGroup(group.value);
      if (chosenGroup) ex.group = chosenGroup; else delete ex.group;
      const active = day.activeSession && day.activeSession.exercises.find((e) => e.exerciseId === ex.id);
      if (existing) {
        if (active) { active.name = clean; active.sets = Array.from({ length: count }, (_, i) => active.sets[i] || makeSet(ex, i)); }
      } else {
        day.exercises.push(ex);
        if (day.activeSession) day.activeSession.exercises.push({ exerciseId: ex.id, name: ex.name, sets: Array.from({ length: count }, (_, i) => makeSet(ex, i)) });
      }
      if (day.activeSession) {
        const running = day.activeSession.exercises.find((e) => e.exerciseId === ex.id);
        if (running) { if (ex.group) running.group = ex.group; else delete running.group; }
      }
      try { await save(); await sheet.close(); render(); ctx.toast(existing ? 'Esercizio aggiornato' : 'Esercizio aggiunto'); }
      catch (e) { onSaveError(e); }
    }
  }
  /* ---------- Progressione automatica ---------- */
  function repsLabel(list) { return list.every((r) => r === list[0]) ? list.length + ' × ' + list[0] : list.join(' · '); }
  function progressionBanner(day, ex, current, sug) {
    const title = sug.mode === 'weight' ? 'Aumenta il peso' : 'Aumenta le ripetizioni';
    const repsChanged = sug.setReps.some((r, i) => r !== sug.fromReps[i]);
    const detail = sug.mode === 'weight'
      ? fmtKg(sug.fromKg) + ' → ' + fmtKg(sug.kg) + ' kg' + (repsChanged ? ' · ' + repsLabel(sug.setReps) : '')
      : repsLabel(sug.fromReps) + ' → ' + repsLabel(sug.setReps);
    return ctx.h('div', { class: 'workout-progress-card', 'data-workout-progression': sug.mode },
      ctx.h('span', { class: 'workout-progress-icon', html: ctx.I('spark', 18) }),
      ctx.h('div', { class: 'workout-progress-copy' },
        ctx.h('strong', null, title),
        ctx.h('b', { class: 'workout-progress-detail' }, detail),
        ctx.h('small', null, 'Hai completato tutte le serie nelle ultime ' + PROG_SESSIONS + ' sessioni.')),
      ctx.h('button', {
        class: 'workout-progress-apply', type: 'button', 'data-workout-progress-apply': '1', 'aria-label': 'Applica: ' + title,
        onclick: (e) => applyProgression(ex, current, sug, e.currentTarget)
      }, ctx.h('span', { html: ctx.I('check', 18) })));
  }
  async function applyProgression(ex, current, sug, button) {
    const before = copy(ex), beforeSets = current ? copy(current.sets) : null;
    applyTarget(ex, sug.kg, sug.setReps);
    if (current) retargetSession(current, ex);
    try { await save(); } catch (e) { onSaveError(e); return; }
    button.disabled = true;
    button.classList.add('is-applied');
    await new Promise((r) => setTimeout(r, 420));
    render();
    ctx.toast('Obiettivo aggiornato: ' + fmtKg(ex.kg) + ' kg · ' + repsSummary(ex), 5200, {
      label: 'Annulla',
      fn: async () => {
        Object.keys(ex).forEach((k) => { delete ex[k]; });
        Object.assign(ex, before);
        if (current && beforeSets) current.sets = beforeSets;
        try { await save(); render(); ctx.toast('Obiettivo ripristinato'); } catch (e) { onSaveError(e); }
      }
    });
  }

  /* ---------- Sostituzione degli esercizi ---------- */
  function cap(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
  function openSubstitute(dayId, exerciseId) {
    const day = dayById(dayId);
    const ex = day && day.exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    const entry = day.activeSession ? day.activeSession.exercises.find((e) => e.exerciseId === ex.id) : null;
    if (entry && entry.sets.some((x) => x.done)) { ctx.toast('Hai già fatto serie di questo esercizio: puoi sostituirlo dopo la sessione.', 4200); return; }
    const found = findCatalog(ex.name);
    let group = cleanGroup(ex.group) || (found && found.group) || '';
    let mode = entry ? 'today' : 'plan';
    const box = ctx.h('div', { class: 'workout-substitute', 'data-workout-substitute': '1' });
    const sheet = ctx.openSheet('Sostituisci ' + ex.name, box);
    function draw() {
      const result = substituteSuggestions(ex, day.exercises, group);
      const parts = [];
      if (entry) {
        parts.push(ctx.h('div', { class: 'workout-segment', role: 'group', 'aria-label': 'Dove applicare la sostituzione' },
          ...[['today', 'Solo oggi'], ['plan', 'Nella scheda']].map(([value, label]) => ctx.h('button', {
            class: 'workout-segment-btn' + (mode === value ? ' active' : ''), type: 'button', 'data-sub-mode': value, 'aria-pressed': String(mode === value),
            onclick: () => { mode = value; draw(); }
          }, label))));
      }
      parts.push(ctx.h('div', { class: 'workout-chips', role: 'group', 'aria-label': 'Gruppo muscolare' },
        ...GROUPS.filter((g) => g !== GROUP_OTHER).map((g) => ctx.h('button', {
          class: 'workout-chip' + (g === group ? ' active' : ''), type: 'button', 'data-sub-group': g, 'aria-pressed': String(g === group),
          onclick: () => { group = g; draw(); }
        }, g))));
      if (!result.items.length) {
        parts.push(ctx.h('p', { class: 'hint', 'data-sub-empty': '1' }, 'Scegli un gruppo muscolare per vedere le alternative.'));
      } else {
        const from = equipmentOf(ex);
        result.items.forEach((pick) => {
          const start = substituteKg(ex.kg, from, pick.equipment);
          parts.push(ctx.h('div', { class: 'workout-sub-row', 'data-sub-name': pick.name },
            ctx.h('div', { class: 'workout-sub-copy' },
              ctx.h('strong', null, pick.name),
              ctx.h('small', null, cap(pick.equipment) + (pick.samePattern ? ' · stesso movimento' : '') + (start > 0 ? ' · parti da ' + fmtKg(start) + ' kg' + (pick.equipment === 'manubri' ? ' a manubrio' : '') : ''))),
            ctx.h('button', { class: 'btn pri workout-sub-use', type: 'button', 'data-sub-use': pick.name, onclick: () => choose(pick) }, 'Usa')));
        });
        parts.push(ctx.h('p', { class: 'hint' }, 'Serie e ripetizioni restano uguali. Il carico di partenza è una stima prudente: correggilo alla prima serie.'));
      }
      box.replaceChildren(...parts);
    }
    async function choose(pick) {
      const sub = makeSubstitute(ex, pick, ctx.uid());
      const fresh = () => Array.from({ length: whole(sub.setCount, 3, 1, MAX_SETS) }, (_, i) => makeSet(sub, i));
      const today = !!entry && mode === 'today';
      if (today) {
        entry.name = sub.name; entry.group = sub.group; entry.substitute = true; entry.sets = fresh();
      } else {
        day.exercises[day.exercises.findIndex((e) => e.id === ex.id)] = sub;
        if (entry) day.activeSession.exercises[day.activeSession.exercises.indexOf(entry)] = { exerciseId: sub.id, name: sub.name, group: sub.group, sets: fresh() };
      }
      try { await save(); await sheet.close(); render(); ctx.toast(today ? 'Oggi farai ' + sub.name : sub.name + ' al posto di ' + ex.name, 3200); }
      catch (e) { onSaveError(e); }
    }
    draw();
  }

  /* ---------- Volume settimanale nel tempo ---------- */
  function fmtCompact(v) { return v >= 1000 ? (Math.round(v / 100) / 10).toLocaleString('it-IT') + 'k' : String(v); }
  // Grafico SVG a barre. points = [{ label, value, current }].
  function barChartSvg(points, title) {
    const W = 320, H = 150, L = 8, R = 8, T = 18, B = 24;
    const max = Math.max(1, ...points.map((p) => p.value));
    const slot = (W - L - R) / points.length, bw = Math.min(26, slot * 0.62);
    const base = H - B;
    const bars = points.map((p, i) => {
      const h = p.value > 0 ? Math.max(3, (base - T) * (p.value / max)) : 0;
      const x = L + i * slot + (slot - bw) / 2, y = base - h;
      return (h ? '<rect class="wk-bar' + (p.current ? ' current' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="5"/>' : '') +
        (p.value > 0 ? '<text class="wk-value" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle">' + fmtCompact(p.value) + '</text>' : '') +
        '<text class="wk-x" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + escAttr(p.label) + '</text>';
    }).join('');
    return '<svg class="wk-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + escAttr(title) + '">' +
      '<line class="wk-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + base + '" y2="' + base + '"/>' + bars + '</svg>';
  }
  function renderVolumeChart(body) {
    if (!state.program.sessions.length) return;
    const series = weeklyVolumeSeries(state.program.sessions, Date.now(), 8);
    const last = series[series.length - 1], before = series[series.length - 2];
    const points = series.map((w, i) => {
      const d = new Date(w.start);
      return { label: d.getDate() + '/' + (d.getMonth() + 1), value: w.volume, current: i === series.length - 1 };
    });
    let summary = 'Questa settimana: ' + fmtKg(last.volume) + ' kg.';
    if (before.volume > 0) {
      const pct = Math.round(((last.volume - before.volume) / before.volume) * 100);
      summary += ' ' + (pct === 0 ? 'Come la settimana scorsa.' : (pct > 0 ? '+' : '') + pct + '% rispetto alla settimana scorsa.');
    }
    body.append(ctx.h('section', { class: 'workout-card workout-volume-chart', 'data-workout-volume-chart': '1' },
      ctx.h('div', { class: 'workout-section-heading' },
        ctx.h('div', null, ctx.h('p', { class: 'workout-eyebrow' }, 'ULTIME 8 SETTIMANE'), ctx.h('h3', null, 'Volume settimanale'))),
      ctx.h('div', { class: 'wk-chart-wrap', html: barChartSvg(points, 'Volume in kg per settimana') }),
      ctx.h('p', { class: 'hint', 'data-volume-summary': '1' }, summary)));
  }

  /* ---------- Riepilogo mensile ---------- */
  function renderMonthCard(body) {
    if (!state.program.sessions.length) return;
    const now = new Date();
    const m = monthlySummary(state.program, now.getFullYear(), now.getMonth());
    body.append(ctx.h('button', { class: 'workout-card workout-month-card', type: 'button', 'data-workout-month': '1', onclick: openMonthly },
      ctx.h('span', { class: 'workout-month-icon', html: ctx.I('calendar', 20) }),
      ctx.h('span', { class: 'workout-month-copy' },
        ctx.h('strong', null, 'Riepilogo di ' + now.toLocaleDateString('it-IT', { month: 'long' })),
        ctx.h('small', null, m.sessions + (m.sessions === 1 ? ' sessione' : ' sessioni') + ' · ' + fmtKg(m.volume) + ' kg di volume')),
      ctx.h('span', { class: 'workout-chevron', 'aria-hidden': 'true' }, '›')));
  }
  function openMonthly() {
    const now = new Date();
    let year = now.getFullYear(), month = now.getMonth();
    const box = ctx.h('div', { class: 'workout-monthly', 'data-workout-monthly-sheet': '1' });
    const isCurrent = () => year === now.getFullYear() && month === now.getMonth();
    function shift(delta) {
      month += delta;
      if (month < 0) { month = 11; year--; } else if (month > 11) { month = 0; year++; }
      draw();
    }
    const tile = (label, value, note) => ctx.h('div', { class: 'workout-month-tile' }, ctx.h('small', null, label), ctx.h('strong', null, value), note ? ctx.h('span', null, note) : null);
    const signedInt = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
    function draw() {
      const m = monthlySummary(state.program, year, month);
      const title = new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const parts = [ctx.h('div', { class: 'workout-cal-head' },
        ctx.h('button', { class: 'ibtn workout-cal-nav', type: 'button', 'data-month-prev': '1', 'aria-label': 'Mese precedente', onclick: () => shift(-1) }, '‹'),
        ctx.h('strong', { 'data-month-title': '1' }, cap(title)),
        ctx.h('button', { class: 'ibtn workout-cal-nav', type: 'button', 'data-month-next': '1', 'aria-label': 'Mese successivo', disabled: isCurrent(), onclick: () => shift(1) }, '›'))];
      if (!m.sessions) {
        parts.push(ctx.h('p', { class: 'hint', 'data-month-empty': '1' }, 'Nessuna sessione in questo mese.'));
      } else {
        parts.push(ctx.h('div', { class: 'workout-month-grid' },
          tile('Sessioni', String(m.sessions), m.prevSessions ? (m.sessions === m.prevSessions ? 'come il mese prima' : signedInt(m.sessions - m.prevSessions) + ' sul mese prima') : ''),
          tile('Volume', fmtKg(m.volume) + ' kg', m.volumePct == null ? '' : m.volumePct === 0 ? 'come il mese prima' : (m.volumePct > 0 ? '+' : '') + m.volumePct + '% sul mese prima'),
          tile('Serie', String(m.sets), ''),
          tile('Giorni attivi', String(m.activeDays), '')));
        if (m.topDays.length) {
          parts.push(ctx.h('h4', { class: 'workout-month-h' }, 'Giorni più frequenti'));
          m.topDays.forEach((d) => parts.push(ctx.h('div', { class: 'workout-compare-row', 'data-month-day': d.name }, ctx.h('span', null, d.name), ctx.h('b', null, d.count + (d.count === 1 ? ' volta' : ' volte')))));
        }
        if (m.groups.length) {
          parts.push(ctx.h('h4', { class: 'workout-month-h' }, 'Gruppi più allenati'));
          const top = m.groups[0].sets;
          m.groups.forEach((g) => parts.push(ctx.h('div', { class: 'workout-volume-row', 'data-month-group': g.group },
            ctx.h('span', { class: 'workout-volume-label' }, g.group),
            ctx.h('span', { class: 'workout-volume-track' }, ctx.h('span', { class: 'workout-volume-bar', style: { width: Math.round((g.sets / top) * 100) + '%' } })),
            ctx.h('b', null, g.sets + ' serie'))));
        }
        parts.push(ctx.h('h4', { class: 'workout-month-h' }, 'Miglior progresso'));
        parts.push(m.best
          ? ctx.h('div', { class: 'workout-month-best', 'data-month-best': '1' },
              ctx.h('strong', null, m.best.name),
              ctx.h('span', null, fmtKg(m.best.from) + ' → ' + fmtKg(m.best.to) + (m.best.unit === 'kg' ? ' kg di massimale stimato' : ' ripetizioni') + ' (+' + m.best.pct + '%)'))
          : ctx.h('p', { class: 'hint', 'data-month-best-empty': '1' }, 'Nessun miglioramento ancora: serve almeno un esercizio fatto più volte.'));
      }
      box.replaceChildren(...parts);
    }
    ctx.openSheet('Riepilogo mensile', box);
    draw();
  }

  /* ---------- Riscaldamento, confronto, volume settimanale, backup ---------- */
  async function addWarmup(current, work) {
    const plan = warmupPlan(work.kg, work.reps);
    if (!plan.length) return;
    current.sets = plan.map((s) => ({ reps: s.reps, kg: s.kg, done: false, type: 'warmup' })).concat(current.sets);
    try { await save(); render(); ctx.toast('Riscaldamento aggiunto'); }
    catch (e) { onSaveError(e); }
  }
  function signed(n) { return (n > 0 ? '+' : '') + fmtKg(n); }
  function comparisonCard(session, prev) {
    const c = compareSessions(prev, session);
    const cls = c.delta >= 0 ? 'up' : 'down';
    const card = ctx.h('section', { class: 'workout-compare', 'data-workout-compare': '1' },
      ctx.h('p', { class: 'workout-eyebrow' }, 'CONFRONTO'),
      ctx.h('h4', null, 'Rispetto a ' + fmtDate(prev.completedAt, true)),
      ctx.h('p', { class: 'workout-compare-total ' + cls }, signed(c.delta) + ' kg di volume' + (c.pct != null ? ' (' + (c.pct > 0 ? '+' : '') + c.pct + '%)' : ''))
    );
    if (!c.exercises.length) {
      card.append(ctx.h('p', { class: 'hint' }, 'Nessun esercizio in comune con la sessione precedente.'));
    } else {
      c.exercises.forEach((e) => card.append(ctx.h('div', { class: 'workout-compare-row' },
        ctx.h('span', null, e.name + ' · ' + fmtKg(e.kg) + ' kg'),
        ctx.h('b', { class: e.delta >= 0 ? 'up' : 'down' }, signed(e.delta) + ' kg'))));
    }
    return card;
  }
  function renderWeeklyVolume(body) {
    if (!state.program.sessions.length) return;
    const rows = weeklyGroupVolume(state.program.sessions, Date.now());
    const card = ctx.h('section', { class: 'workout-volume', 'data-workout-volume': '1' },
      ctx.h('div', { class: 'workout-section-heading' },
        ctx.h('div', null, ctx.h('p', { class: 'workout-eyebrow' }, 'ULTIMI 7 GIORNI'), ctx.h('h3', null, 'Volume per gruppo muscolare'))));
    if (!rows.length) {
      card.append(ctx.h('p', { class: 'hint' }, 'Completa una sessione e assegna un gruppo agli esercizi per vedere il volume per gruppo.'));
    } else {
      const max = rows[0].sets;
      rows.forEach((row) => card.append(ctx.h('div', { class: 'workout-volume-row' },
        ctx.h('span', { class: 'workout-volume-label' }, row.group),
        ctx.h('span', { class: 'workout-volume-track' }, ctx.h('span', { class: 'workout-volume-bar', style: { width: Math.round((row.sets / max) * 100) + '%' } })),
        ctx.h('b', null, row.sets + ' serie')
      )));
    }
    body.append(card);
  }
  function renderBackup(body) {
    body.append(ctx.h('section', { class: 'workout-backup', 'data-workout-backup': '1' },
      ctx.h('div', null, ctx.h('p', { class: 'workout-eyebrow' }, 'BACKUP'), ctx.h('h3', null, 'Salva o ripristina')),
      ctx.h('p', { class: 'hint' }, 'Esporta schede e progressi in un file JSON, da reimportare in questa sezione.'),
      ctx.h('div', { class: 'workout-backup-actions' },
        ctx.h('button', { class: 'btn', 'data-workout-export': '1', onclick: exportBackup }, 'Esporta'),
        ctx.h('button', { class: 'btn', 'data-workout-import': '1', onclick: pickBackup }, 'Importa')
      )
    ));
  }
  function exportBackup() {
    const data = makeBackup(state.program, Date.now());
    ctx.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'allenamenti-' + dayKey(Date.now()) + '.json');
    ctx.toast('Backup esportato');
  }
  function pickBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try { confirmImport(parseBackup(await file.text())); }
      catch (e) { ctx.toast(e.message || 'Backup non valido', 4200); }
    });
    input.click();
  }
  function countText(program) {
    const d = program.days.length, n = program.sessions.length;
    return d + (d === 1 ? ' giornata' : ' giornate') + ' e ' + n + (n === 1 ? ' sessione' : ' sessioni');
  }
  function confirmImport(incoming) {
    const cur = state.program;
    const body = ctx.h('div', { class: 'workout-form' },
      ctx.h('p', { 'data-import-summary': '1' }, 'Il backup contiene ' + countText(incoming) + '.'),
      ctx.h('p', { class: 'hint' }, 'Ora hai ' + countText(cur) + '. Ripristinando, i dati attuali vengono sostituiti: esporta prima un backup se vuoi conservarli.'),
      ctx.h('div', { class: 'btns' },
        ctx.h('button', { class: 'btn', onclick: () => sheet.close() }, 'Annulla'),
        ctx.h('button', { class: 'btn pri', 'data-workout-import-confirm': '1', onclick: applyImport }, 'Sostituisci e ripristina')
      ));
    const sheet = ctx.openSheet('Ripristinare il backup?', body);
    async function applyImport() {
      state.program = incoming;
      state.selectedDayId = null;
      try { await save(); await sheet.close(); refreshReminders(); render(); ctx.toast('Backup ripristinato'); }
      catch (e) { onSaveError(e); }
    }
  }

  /* ---------- Promemoria (notifiche di sistema nell'app Android) ---------- */
  const REMINDER_TEXT = {
    unsupported: 'I promemoria funzionano nell’app Android: da qui non posso avvisarti ad app chiusa.',
    denied: 'Permesso per le notifiche negato: abilitalo dalle impostazioni del telefono.',
    'no-days': 'Assegna un giorno della settimana ad almeno una giornata per ricevere il promemoria.',
    error: 'Non sono riuscito a programmare il promemoria. Riprova.'
  };
  function nativeLN() {
    try {
      const C = window.Capacitor;
      if (C && C.isNativePlatform && C.isNativePlatform()) return (C.Plugins && C.Plugins.LocalNotifications) || null;
    } catch (e) { /* ignora */ }
    return null;
  }
  // Riprogramma da zero gli avvisi: 'ok' | 'off' | 'unsupported' | 'no-days' | 'denied' | 'error'.
  async function syncReminders() {
    const LN = nativeLN();
    if (!LN) return 'unsupported';
    try {
      await LN.cancel({ notifications: Array.from({ length: 7 }, (_, i) => ({ id: REMINDER_BASE + i })) });
      const reminder = state.program.reminder;
      if (!reminder.enabled) return 'off';
      const plan = reminderPlan(state.program);
      if (!plan.length) return 'no-days';
      let perm = await LN.checkPermissions();
      if (perm.display !== 'granted') perm = await LN.requestPermissions();
      if (perm.display !== 'granted') return 'denied';
      try { await LN.createChannel({ id: 'lmn-workout', name: 'Allenamenti', description: 'Promemoria dei giorni di allenamento', importance: 4, visibility: 1, vibration: true }); } catch (e) { /* canale già esistente */ }
      const time = parseTime(reminder.time) || { hour: 18, minute: 0 };
      await LN.schedule({ notifications: plan.map((item) => ({
        id: item.id, title: 'È ora di allenarti', body: item.names.join(' · '), channelId: 'lmn-workout',
        schedule: { on: { weekday: item.weekday, hour: time.hour, minute: time.minute }, allowWhileIdle: true },
        extra: { tool: 'workout' }
      })) });
      return 'ok';
    } catch (e) { console.warn('Promemoria allenamento non programmato', e); return 'error'; }
  }
  // Dopo aver cambiato i giorni della scheda: aggiorna gli avvisi solo se sono attivi.
  function refreshReminders() {
    if (state.program && state.program.reminder.enabled) syncReminders().catch(() => {});
  }
  async function applyReminder(patch) {
    const reminder = state.program.reminder;
    Object.assign(reminder, patch);
    const result = await syncReminders();
    const failed = reminder.enabled && result !== 'ok';
    if (failed) reminder.enabled = false;
    try { await save(); } catch (e) { onSaveError(e); }
    render();
    if (failed) ctx.toast(REMINDER_TEXT[result] || REMINDER_TEXT.error, 4200);
    else if (patch.enabled === true) ctx.toast('Promemoria attivo alle ' + reminder.time + ' nei giorni assegnati');
    else if (patch.enabled === false) ctx.toast('Promemoria disattivato');
  }
  function reminderHint(plan, reminder) {
    if (!plan.length) return 'Assegna un giorno della settimana a una giornata per attivarlo.';
    const days = plan.map((item) => item.label.slice(0, 3)).join(' · ');
    return reminder.enabled ? days + ' alle ' + reminder.time : 'Ti avviso nei giorni assegnati: ' + days;
  }

  /* ---------- Costanza e calendario ---------- */
  function renderConsistency(body) {
    const sessions = state.program.sessions;
    const streak = weekStreak(sessions);
    const reminder = state.program.reminder;
    const plan = reminderPlan(state.program);
    const dots = ctx.h('div', { class: 'workout-week', role: 'list', 'aria-label': 'Settimana in corso' },
      ...weekDots(sessions).map((d) => ctx.h('span', {
        class: 'workout-week-dot' + (d.done ? ' done' : '') + (d.today ? ' today' : ''), role: 'listitem', 'data-day': d.key,
        'aria-label': d.name + (d.done ? ': allenato' : '') + (d.today ? ' (oggi)' : '')
      }, d.letter)));
    const time = ctx.h('input', { class: 'workout-time', type: 'time', value: reminder.time, 'aria-label': 'Ora del promemoria', 'data-workout-reminder-time': '1' });
    time.addEventListener('change', () => {
      if (!parseTime(time.value)) { time.value = reminder.time; return; }
      applyReminder({ time: time.value });
    });
    const toggle = ctx.h('button', {
      class: 'workout-switch' + (reminder.enabled ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(reminder.enabled),
      'aria-label': 'Promemoria dei giorni di allenamento', 'data-workout-reminder-toggle': '1',
      onclick: () => applyReminder({ enabled: !reminder.enabled })
    }, ctx.h('span', null));
    body.append(ctx.h('section', { class: 'workout-card workout-consistency', 'data-workout-consistency': '1' },
      ctx.h('div', { class: 'workout-card-head' },
        ctx.h('span', { class: 'workout-card-icon', html: ctx.I('flame', 20) }),
        ctx.h('div', null,
          ctx.h('p', { class: 'workout-eyebrow' }, 'COSTANZA'),
          ctx.h('h3', { 'data-workout-streak': String(streak) }, streak ? streak + (streak === 1 ? ' settimana di fila' : ' settimane di fila') : 'Inizia la tua serie')
        )
      ),
      ctx.h('p', { class: 'workout-card-copy' }, streak ? 'Basta una sessione a settimana, da lunedì a domenica, per tenere viva la serie.' : 'Registra una sessione questa settimana per iniziare la serie.'),
      dots,
      ctx.h('button', { class: 'workout-link-btn', type: 'button', 'data-workout-calendar': '1', onclick: openCalendar }, ctx.h('span', { html: ctx.I('calendar', 17) }), 'Calendario delle sessioni'),
      ctx.h('div', { class: 'workout-reminder' },
        ctx.h('div', { class: 'workout-reminder-copy' }, ctx.h('strong', null, 'Promemoria'), ctx.h('small', { 'data-workout-reminder-hint': '1' }, reminderHint(plan, reminder))),
        time, toggle
      )
    ));
  }
  function openCalendar() {
    const now = new Date();
    let year = now.getFullYear(), month = now.getMonth(), picked = null;
    const box = ctx.h('div', { class: 'workout-calendar', 'data-workout-calendar-sheet': '1' });
    function shift(delta) {
      month += delta;
      if (month < 0) { month = 11; year--; } else if (month > 11) { month = 0; year++; }
      picked = null;
      draw();
    }
    function draw() {
      const cells = monthGrid(year, month, state.program.sessions);
      const today = dayKey(Date.now());
      const title = new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const grid = ctx.h('div', { class: 'workout-cal-grid' });
      WEEKDAYS.forEach((name) => grid.append(ctx.h('span', { class: 'workout-cal-wd', 'aria-hidden': 'true' }, name[0])));
      cells.forEach((c) => {
        if (!c) { grid.append(ctx.h('span', { class: 'workout-cal-empty' })); return; }
        const cls = 'workout-cal-day' + (c.count ? ' has' : '') + (c.key === today ? ' today' : '') + (c.key === picked ? ' picked' : '');
        if (!c.count) { grid.append(ctx.h('span', { class: cls, 'data-cal-day': c.key }, String(c.day))); return; }
        grid.append(ctx.h('button', {
          class: cls, type: 'button', 'data-cal-day': c.key, 'aria-pressed': String(c.key === picked),
          'aria-label': c.day + ': ' + c.count + (c.count === 1 ? ' sessione' : ' sessioni'),
          onclick: () => { picked = picked === c.key ? null : c.key; draw(); }
        }, String(c.day)));
      });
      const total = cells.reduce((n, c) => n + (c ? c.count : 0), 0);
      const list = ctx.h('div', { class: 'workout-cal-list' });
      if (picked) {
        state.program.sessions.filter((x) => dayKey(sessionTime(x)) === picked).sort((a, b) => sessionTime(b) - sessionTime(a)).forEach((x) => {
          const stats = sessionStats(x);
          list.append(ctx.h('button', { class: 'workout-history-row', type: 'button', 'data-cal-session': x.id, onclick: () => showSession(x) },
            ctx.h('span', { class: 'workout-history-check', html: ctx.I('check', 16) }),
            ctx.h('span', { class: 'workout-history-copy' }, ctx.h('strong', null, x.dayName || 'Allenamento'), ctx.h('small', null, stats.completedSets + ' serie · ' + fmtKg(stats.volume) + ' kg')),
            ctx.h('span', { class: 'workout-chevron', 'aria-hidden': 'true' }, '›')));
        });
      } else {
        list.append(ctx.h('p', { class: 'hint', 'data-cal-summary': '1' }, total ? total + (total === 1 ? ' sessione' : ' sessioni') + ' in questo mese · tocca un giorno evidenziato per vederle.' : 'Nessuna sessione in questo mese.'));
      }
      box.replaceChildren(
        ctx.h('div', { class: 'workout-cal-head' },
          ctx.h('button', { class: 'ibtn workout-cal-nav', type: 'button', 'data-cal-prev': '1', 'aria-label': 'Mese precedente', onclick: () => shift(-1) }, '‹'),
          ctx.h('strong', { 'data-cal-title': '1' }, title.charAt(0).toUpperCase() + title.slice(1)),
          ctx.h('button', { class: 'ibtn workout-cal-nav', type: 'button', 'data-cal-next': '1', 'aria-label': 'Mese successivo', onclick: () => shift(1) }, '›')
        ),
        grid, list
      );
    }
    ctx.openSheet('Calendario allenamenti', box);
    draw();
  }

  /* ---------- Peso corporeo ---------- */
  function renderBodyWeight(body) {
    const list = state.program.bodyWeights;
    const last = list[list.length - 1], before = list[list.length - 2];
    let copy = 'Registra il tuo peso per vederne l’andamento nel tempo.';
    if (last) {
      copy = fmtDate(last.t, true);
      if (before) {
        const delta = Math.round((last.kg - before.kg) * 10) / 10;
        copy += ' · ' + (delta === 0 ? 'invariato' : (delta > 0 ? '+' : '−') + fmtKg(Math.abs(delta)) + ' kg') + ' rispetto alla misura precedente';
      }
    }
    body.append(ctx.h('section', { class: 'workout-card workout-weight', 'data-workout-weight': '1' },
      ctx.h('div', { class: 'workout-card-head' },
        ctx.h('span', { class: 'workout-card-icon', html: ctx.I('scale', 20) }),
        ctx.h('div', null, ctx.h('p', { class: 'workout-eyebrow' }, 'PESO CORPOREO'), ctx.h('h3', { 'data-workout-weight-last': last ? String(last.kg) : '' }, last ? fmtKg(last.kg) + ' kg' : 'Nessuna misura'))
      ),
      ctx.h('p', { class: 'workout-card-copy' }, copy),
      ctx.h('div', { class: 'workout-card-actions' },
        ctx.h('button', { class: 'btn pri', type: 'button', 'data-workout-weight-add': '1', onclick: openWeightForm }, 'Registra peso'),
        list.length ? ctx.h('button', { class: 'btn', type: 'button', 'data-workout-weight-trend': '1', onclick: openWeightTrend }, 'Andamento') : null
      )
    ));
  }
  function openWeightForm() {
    const list = state.program.bodyWeights;
    const last = list[list.length - 1];
    const today = dayKey(Date.now());
    const kg = ctx.h('input', { class: 'field', type: 'number', min: '20', max: '400', step: '0.1', inputmode: 'decimal', placeholder: 'es. 78,5', value: last ? last.kg : '', 'data-workout-weight-kg': '1' });
    const date = ctx.h('input', { class: 'field', type: 'date', value: today, max: today, 'data-workout-weight-date': '1' });
    const error = ctx.h('p', { class: 'err', role: 'alert' });
    let sheet;
    const content = ctx.h('div', { class: 'workout-form' },
      ctx.h('label', null, 'Peso (kg)', kg),
      ctx.h('label', null, 'Data', date),
      ctx.h('p', { class: 'hint' }, 'Una misura al giorno: se ne registri un’altra nello stesso giorno sostituisce la precedente.'),
      error,
      ctx.h('div', { class: 'btns' },
        ctx.h('button', { class: 'btn', onclick: () => sheet.close() }, 'Annulla'),
        ctx.h('button', { class: 'btn pri', 'data-workout-weight-save': '1', onclick: saveWeight }, 'Salva')
      )
    );
    sheet = ctx.openSheet('Registra il peso', content);
    focusSoon(() => sheet, kg, true);
    async function saveWeight() {
      const value = bodyWeight(kg.value);
      const t = dateInputToTime(date.value);
      if (value == null) { error.textContent = 'Inserisci un peso tra 20 e 400 kg.'; kg.focus(); return; }
      if (t == null || dayKey(t) > dayKey(Date.now())) { error.textContent = 'Scegli una data valida, non nel futuro.'; return; }
      state.program.bodyWeights = upsertBodyWeight(state.program.bodyWeights, t, value);
      try { await save(); await sheet.close(); render(); ctx.toast('Peso registrato'); }
      catch (e) { onSaveError(e); }
    }
  }
  function openWeightTrend() {
    const box = ctx.h('div', { class: 'workout-progress workout-weight-trend', 'data-workout-weight-sheet': '1' });
    function draw() {
      const list = state.program.bodyWeights;
      box.replaceChildren();
      if (!list.length) { box.append(ctx.h('p', { class: 'hint' }, 'Nessuna misura registrata.')); return; }
      const first = list[0], last = list[list.length - 1];
      const change = Math.round((last.kg - first.kg) * 10) / 10;
      box.append(ctx.h('p', { class: 'hint' }, list.length + (list.length === 1 ? ' misura' : ' misure') + (list.length > 1 ? ' · da ' + fmtKg(first.kg) + ' a ' + fmtKg(last.kg) + ' kg (' + (change > 0 ? '+' : change < 0 ? '−' : '') + fmtKg(Math.abs(change)) + ')' : '')));
      if (list.length > 1) {
        const points = list.map((w) => ({ label: fmtDate(w.t), kg: w.kg }));
        box.append(ctx.h('div', { class: 'wk-chart-wrap', html: lineChartSvg(points, 'kg', 'Peso corporeo in kg') }));
      } else {
        box.append(ctx.h('p', { class: 'hint' }, 'Registra un’altra misura per vedere l’andamento.'));
      }
      const rows = ctx.h('div', { class: 'workout-weight-list' });
      list.slice().reverse().forEach((w) => rows.append(ctx.h('div', { class: 'workout-weight-row', 'data-weight-row': dayKey(w.t) },
        ctx.h('span', null, fmtDate(w.t, true)), ctx.h('strong', null, fmtKg(w.kg) + ' kg'),
        ctx.ibtn('trash', () => removeWeight(w.t), 'Elimina la misura del ' + fmtDate(w.t, true), 'workout-weight-del'))));
      box.append(rows);
    }
    async function removeWeight(t) {
      state.program.bodyWeights = state.program.bodyWeights.filter((w) => w.t !== t);
      try { await save(); } catch (e) { onSaveError(e); }
      draw();
      render();
    }
    ctx.openSheet('Andamento del peso', box);
    draw();
  }

  function openProgress(dayId, exerciseId) {
    const day = dayById(dayId);
    const ex = day && day.exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    const history = exerciseHistory(state.program, ex.id).map((p) => Object.assign({ label: fmtDate(p.t) }, p));
    const body = ctx.h('div', { class: 'workout-progress' });
    if (!history.length) {
      body.append(ctx.h('p', { class: 'hint' }, 'Ancora nessun dato. Completa almeno una serie in una sessione per vedere i progressi.'));
    } else {
      const last = history[history.length - 1];
      body.append(ctx.h('p', { class: 'hint' }, history.length + (history.length === 1 ? ' sessione registrata' : ' sessioni registrate') + ' · ultimo: ' + fmtKg(last.kg) + ' kg × ' + last.reps));
      if (history.length === 1) body.append(ctx.h('p', { class: 'hint' }, 'Completa un’altra sessione per vedere l’andamento nel tempo.'));
      body.append(ctx.h('h4', { class: 'wk-chart-title' }, 'Carico massimo (kg)'),
        ctx.h('div', { class: 'wk-chart-wrap', html: lineChartSvg(history, 'kg', 'Carico massimo in kg di ' + ex.name) }));
      body.append(ctx.h('h4', { class: 'wk-chart-title' }, 'Ripetizioni'),
        ctx.h('div', { class: 'wk-chart-wrap', html: lineChartSvg(history, 'reps', 'Ripetizioni di ' + ex.name) }));
      body.append(ctx.h('p', { class: 'hint' }, 'Per ogni sessione viene mostrata la serie più pesante completata.'));
      const best = bestOneRm(history);
      if (best) {
        body.append(ctx.h('div', { class: 'workout-orm', 'data-workout-orm': '1' },
          ctx.h('span', null, 'Massimale stimato'),
          ctx.h('strong', null, fmtKg(best.value) + ' kg'),
          ctx.h('small', null, 'da ' + fmtKg(best.kg) + ' kg × ' + best.reps + ' · ' + fmtDate(best.t))));
        body.append(ctx.h('p', { class: 'hint' }, 'Stima con la formula di Epley, valida fino a 12 ripetizioni: è un’indicazione, non un test.'));
      }
    }
    ctx.openSheet(ex.name, body);
  }
  function dayOptions(id) {
    const day = dayById(id);
    if (!day) return;
    let sheet;
    sheet = ctx.openSheet(day.name, ctx.h('div', null,
      ctx.h('button', { class: 'item', onclick: async () => { await sheet.close(); openDayForm(day); } }, ctx.h('span', { html: ctx.I('edit', 20) }), 'Modifica giornata'),
      ctx.h('button', { class: 'item danger', onclick: async () => { await sheet.close(); confirmDeleteDay(day); } }, ctx.h('span', { html: ctx.I('trash', 20) }), 'Elimina giornata')
    ));
  }
  function exerciseOptions(dayId, exerciseId) {
    const day = dayById(dayId);
    const ex = day && day.exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    let sheet;
    sheet = ctx.openSheet(ex.name, ctx.h('div', null,
      ctx.h('button', { class: 'item', 'data-workout-progress': '1', onclick: async () => { await sheet.close(); openProgress(dayId, ex.id); } }, ctx.h('span', { html: ctx.I('chart', 20) }), 'Vedi progressi'),
      ctx.h('button', { class: 'item', onclick: async () => { await sheet.close(); openExerciseForm(dayId, ex); } }, ctx.h('span', { html: ctx.I('edit', 20) }), 'Modifica obiettivo'),
      ctx.h('button', { class: 'item danger', onclick: async () => { await sheet.close(); confirmDeleteExercise(day, ex); } }, ctx.h('span', { html: ctx.I('trash', 20) }), 'Rimuovi esercizio')
    ));
  }
  function confirmDeleteDay(day) {
    let sheet;
    const content = ctx.h('div', null,
      ctx.h('p', { class: 'hint' }, 'La giornata, gli esercizi e la cronologia associata verranno rimossi. Note e documenti non cambieranno.'),
      ctx.h('div', { class: 'btns' },
        ctx.h('button', { class: 'btn', onclick: () => sheet.close() }, 'Annulla'),
        ctx.h('button', { class: 'btn danger', 'data-workout-confirm-delete-day': '1', onclick: remove }, 'Elimina giornata')
      )
    );
    sheet = ctx.openSheet('Eliminare la giornata?', content);
    async function remove() {
      state.program.days = state.program.days.filter((d) => d.id !== day.id);
      state.program.sessions = state.program.sessions.filter((s) => s.dayId !== day.id);
      try {
        await save(); refreshReminders(); await sheet.close();
        if (state.selectedDayId === day.id) await ctx.back();
        render(); ctx.toast('Giornata eliminata');
      } catch (e) { onSaveError(e); }
    }
  }
  function confirmDeleteExercise(day, ex) {
    let sheet;
    const content = ctx.h('div', null,
      ctx.h('p', { class: 'hint' }, 'Rimuovo l’esercizio dalla scheda e dalla sessione in corso, se presente.'),
      ctx.h('div', { class: 'btns' },
        ctx.h('button', { class: 'btn', onclick: () => sheet.close() }, 'Annulla'),
        ctx.h('button', { class: 'btn danger', 'data-workout-confirm-delete-exercise': '1', onclick: remove }, 'Rimuovi')
      )
    );
    sheet = ctx.openSheet('Rimuovere ' + ex.name + '?', content);
    async function remove() {
      day.exercises = day.exercises.filter((e) => e.id !== ex.id);
      if (day.activeSession) day.activeSession.exercises = day.activeSession.exercises.filter((e) => e.exerciseId !== ex.id);
      try { await save(); await sheet.close(); render(); ctx.toast('Esercizio rimosso'); }
      catch (e) { onSaveError(e); }
    }
  }

  /* ---------- Logica pura: gruppi, riscaldamento, confronto, massimale, backup ---------- */
  const GROUPS = ['Petto', 'Dorso', 'Spalle', 'Bicipiti', 'Tricipiti', 'Gambe', 'Glutei', 'Addome', 'Altro'];
  const GROUP_OTHER = 'Altro';
  const WARMUP_STEPS = [{ pct: 0.5, reps: 8 }, { pct: 0.7, reps: 5 }, { pct: 0.85, reps: 3 }];
  const BACKUP_APP = 'mie-note-allenamenti', BACKUP_VERSION = 1, MAX_BACKUP_CHARS = 5 * 1024 * 1024;

  function cleanGroup(value) { return GROUPS.includes(value) ? value : null; }
  function groupOf(ex) { return cleanGroup(ex && ex.group) || GROUP_OTHER; }
  // Carico massimo tra le serie di lavoro completate (il riscaldamento non conta).
  function topKg(ex) {
    const kgs = (ex && ex.sets || []).filter((x) => x && x.done && x.type !== 'warmup').map((x) => Number(x.kg)).filter(Number.isFinite);
    return kgs.length ? Math.max.apply(null, kgs) : null;
  }
  // Serie di lavoro completate per gruppo muscolare tra `from` (incluso) e `to` (escluso); il riscaldamento non conta.
  function groupVolumeBetween(sessions, from, to) {
    const totals = new Map();
    (sessions || []).filter((s) => Number(s.completedAt) >= from && Number(s.completedAt) < to).forEach((s) => {
      (s.exercises || []).forEach((ex) => {
        const group = groupOf(ex);
        (ex.sets || []).forEach((set) => {
          if (!set || !set.done || set.type === 'warmup') return;
          const row = totals.get(group) || { group, sets: 0, volume: 0 };
          row.sets += 1;
          row.volume += (Number(set.reps) || 0) * (Number(set.kg) || 0);
          totals.set(group, row);
        });
      });
    });
    return Array.from(totals.values()).sort((a, b) => b.sets - a.sets || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  }
  // Ultimi `days` giorni (7 se non indicato).
  function weeklyGroupVolume(sessions, now, days) {
    const since = (now == null ? Date.now() : now) - (days == null ? 7 : days) * 864e5;
    return groupVolumeBetween(sessions, since, Infinity);
  }
  // Formula di Epley: 1RM = kg × (1 + rip/30). Oltre 12 ripetizioni la stima non è affidabile.
  function estimateOneRm(kg, reps) {
    const w = Number(kg), r = Number(reps);
    if (!Number.isFinite(w) || w <= 0 || !Number.isInteger(r) || r < 1 || r > 12) return null;
    if (r === 1) return w;
    return Math.round(w * (1 + r / 30) * 10) / 10;
  }
  function bestOneRm(history) {
    let best = null;
    (history || []).forEach((p) => {
      const value = estimateOneRm(p.kg, p.reps);
      if (value != null && (!best || value > best.value)) best = { value, t: p.t, kg: p.kg, reps: p.reps };
    });
    return best;
  }
  // Tre serie leggere sotto il carico di lavoro (50%, 70%, 85%), arrotondate a 2,5 kg. Sotto 20 kg non serve.
  function warmupPlan(workKg, workReps) {
    const load = Number(workKg);
    if (!Number.isFinite(load) || load < 20) return [];
    const top = whole(workReps, 10, 1, MAX_REPS);
    const out = [];
    WARMUP_STEPS.forEach((step) => {
      const kg = Math.round((load * step.pct) / 2.5) * 2.5;
      if (kg <= 0 || kg >= load) return;
      if (out.length && out[out.length - 1].kg === kg) return;
      out.push({ kg, reps: Math.min(step.reps, top) });
    });
    return out;
  }
  // Sessione precedente dello stesso giorno, la più recente prima di `session`.
  function previousSession(sessions, session) {
    const t = sessionTime(session);
    return (sessions || [])
      .filter((s) => s.dayId === session.dayId && s.id !== session.id && sessionTime(s) < t)
      .sort((a, b) => sessionTime(b) - sessionTime(a))[0] || null;
  }
  function compareSessions(prev, curr) {
    const a = sessionStats(prev), b = sessionStats(curr);
    const delta = Math.round((b.volume - a.volume) * 10) / 10;
    const exercises = [];
    (curr.exercises || []).forEach((ex) => {
      if (ex.substitute) return;
      const before = (prev.exercises || []).find((e) => e.exerciseId === ex.exerciseId && !e.substitute);
      const now = topKg(ex), was = before ? topKg(before) : null;
      if (now == null || was == null) return;
      exercises.push({ name: ex.name, kg: now, prevKg: was, delta: Math.round((now - was) * 10) / 10 });
    });
    return { volume: b.volume, prevVolume: a.volume, delta, pct: a.volume > 0 ? Math.round((delta / a.volume) * 100) : null, exercises };
  }
  function makeBackup(program, now) {
    return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date(now == null ? Date.now() : now).toISOString(), program: normalizeProgram(copy(program)) };
  }
  // Legge un backup di questa sezione; lancia un errore con un messaggio leggibile se il file non va bene.
  function parseBackup(text) {
    if (typeof text !== 'string' || text.length > MAX_BACKUP_CHARS) throw new Error('Il file è troppo grande o non è un backup.');
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Il file non è un backup valido.'); }
    if (!data || data.app !== BACKUP_APP || !data.program || typeof data.program !== 'object') throw new Error('Il file non è un backup di Allenamenti.');
    if (data.version !== BACKUP_VERSION) throw new Error('Versione del backup non supportata.');
    const program = normalizeProgram(data.program);
    if (!program.days.length && !program.sessions.length) throw new Error('Il backup è vuoto.');
    return program;
  }


  /* ---------- Progressione automatica ---------- */
  const PROG_SESSIONS = 2, PROG_REP_CAP = 12, PROG_LOW_REPS = 6, PROG_BODY_CAP = 30, PROG_RESET_MIN = 8;
  function kgStep(kg) { return kg >= 20 ? 2.5 : 1; }
  // Posizioni delle serie «normali» (riscaldamento, cedimento e simili non contano per la progressione).
  function normalIndexes(ex) {
    const out = [];
    for (let i = 0; i < whole(ex && ex.setCount, 3, 1, MAX_SETS); i++) if (typeFor(ex, i) === 'normal') out.push(i);
    return out;
  }
  // La sessione raggiunge l'obiettivo se ogni serie normale è fatta, con almeno le ripetizioni e il carico previsti, e senza RPE oltre 9.
  function sessionMeetsTarget(entry, ex) {
    const idx = normalIndexes(ex);
    if (!entry || !idx.length) return false;
    const sets = (entry.sets || []).filter((x) => x && cleanType(x.type) === 'normal');
    if (sets.length < idx.length) return false;
    return idx.every((planned, j) => {
      const x = sets[j];
      return x.done === true && Number(x.reps) >= repsFor(ex, planned) && Number(x.kg) >= (Number(ex.kg) || 0) && !(Number(x.rpe) > 9);
    });
  }
  // Prossimo obiettivo. Fino a 6 rip. si sale di carico; da 7 a 11 si aggiunge una ripetizione per serie;
  // con tutte le serie a 12 o più si sale di carico e le ripetizioni si riducono. A corpo libero si aggiungono ripetizioni.
  function nextTarget(ex) {
    const idx = normalIndexes(ex);
    if (!idx.length) return null;
    const reps = repsList(ex), kg = Number(ex.kg) || 0;
    const normal = idx.map((i) => reps[i]);
    const next = reps.slice();
    let mode, nextKg = kg;
    const heavier = () => Math.min(MAX_KG, Math.round((kg + kgStep(kg)) * 10) / 10);
    if (kg <= 0) {
      if (Math.min(...normal) >= PROG_BODY_CAP) return null;
      mode = 'reps';
      idx.forEach((i) => { if (reps[i] < PROG_BODY_CAP) next[i] = reps[i] + 1; });
    } else if (Math.min(...normal) >= PROG_REP_CAP) {
      mode = 'weight'; nextKg = heavier();
      idx.forEach((i) => { next[i] = Math.max(PROG_RESET_MIN, Math.round(reps[i] * 0.7)); });
    } else if (Math.max(...normal) <= PROG_LOW_REPS) {
      mode = 'weight'; nextKg = heavier();
    } else {
      mode = 'reps';
      idx.forEach((i) => { if (reps[i] < PROG_REP_CAP) next[i] = reps[i] + 1; });
    }
    if (mode === 'weight' && nextKg <= kg) return null;
    return { mode, kg: nextKg, setReps: next, fromKg: kg, fromReps: reps };
  }
  // Propone la progressione solo se le ultime PROG_SESSIONS sessioni dell'esercizio hanno raggiunto l'obiettivo attuale.
  function progressionSuggestion(program, ex) {
    if (!ex) return null;
    const entries = [];
    ((program && program.sessions) || []).slice().sort((a, b) => sessionTime(b) - sessionTime(a)).forEach((sess) => {
      if (entries.length >= PROG_SESSIONS) return;
      const e = (sess.exercises || []).find((x) => x.exerciseId === ex.id && !x.substitute);
      if (e) entries.push(e);
    });
    if (entries.length < PROG_SESSIONS || !entries.every((e) => sessionMeetsTarget(e, ex))) return null;
    return nextTarget(ex);
  }
  function applyTarget(ex, kg, list) {
    ex.kg = weight(kg, ex.kg);
    ex.reps = list[0];
    if (list.every((r) => r === list[0])) delete ex.setReps; else ex.setReps = list.slice();
  }
  // Allinea alle nuove ripetizioni e al nuovo carico le serie normali non ancora fatte della sessione in corso.
  function retargetSession(entry, ex) {
    const idx = normalIndexes(ex);
    let j = 0;
    (entry && entry.sets || []).forEach((x) => {
      if (cleanType(x.type) !== 'normal') return;
      const planned = idx[j++];
      if (x.done || planned == null) return;
      x.kg = ex.kg;
      x.reps = repsFor(ex, planned);
    });
  }

  /* ---------- Sostituzione degli esercizi ---------- */
  function normName(v) {
    return String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // [nome, gruppo, movimento, attrezzo, sinonimi]. Il movimento serve a proporre prima le alternative più simili.
  const CATALOG = [
    ['Panca piana', 'Petto', 'spinta piana', 'bilanciere', ['panca piana bilanciere', 'bench press', 'distensioni su panca']],
    ['Panca piana manubri', 'Petto', 'spinta piana', 'manubri', ['panca piana con manubri', 'distensioni con manubri']],
    ['Chest press', 'Petto', 'spinta piana', 'macchina', ['pressa petto', 'chest press macchina']],
    ['Piegamenti', 'Petto', 'spinta piana', 'corpo libero', ['piegamenti sulle braccia', 'push up']],
    ['Panca inclinata', 'Petto', 'spinta inclinata', 'bilanciere', ['panca inclinata bilanciere']],
    ['Panca inclinata manubri', 'Petto', 'spinta inclinata', 'manubri', ['panca inclinata con manubri']],
    ['Chest press inclinata', 'Petto', 'spinta inclinata', 'macchina', []],
    ['Croci manubri', 'Petto', 'aperture', 'manubri', ['croci con manubri', 'croci su panca piana']],
    ['Croci ai cavi', 'Petto', 'aperture', 'cavi', ['croci cavi', 'cable crossover']],
    ['Pec deck', 'Petto', 'aperture', 'macchina', ['butterfly', 'pectoral machine']],
    ['Dip alle parallele', 'Petto', 'spinta declinata', 'corpo libero', ['parallele', 'dip', 'dips']],
    ['Panca declinata', 'Petto', 'spinta declinata', 'bilanciere', []],
    ['Lat machine', 'Dorso', 'trazione verticale', 'cavi', ['lat pulldown', 'lat machine presa larga']],
    ['Lat machine presa stretta', 'Dorso', 'trazione verticale', 'cavi', ['lat machine presa neutra']],
    ['Trazioni alla sbarra', 'Dorso', 'trazione verticale', 'corpo libero', ['trazioni', 'pull up', 'chin up']],
    ['Trazioni assistite', 'Dorso', 'trazione verticale', 'macchina', ['trazioni alla macchina']],
    ['Rematore con bilanciere', 'Dorso', 'rematore', 'bilanciere', ['rematore bilanciere']],
    ['Rematore con manubrio', 'Dorso', 'rematore', 'manubri', ['rematore manubrio', 'rematore manubri', 'rematore a un braccio']],
    ['Rematore al cavo', 'Dorso', 'rematore', 'cavi', ['pulley', 'low row', 'rematore ai cavi', 'rematore seduto']],
    ['Rematore alla macchina', 'Dorso', 'rematore', 'macchina', ['row machine', 'rematore macchina']],
    ['T-bar row', 'Dorso', 'rematore', 'bilanciere', ['rematore t bar']],
    ['Pullover ai cavi', 'Dorso', 'isolamento dorsali', 'cavi', ['pulldown braccia tese']],
    ['Hyperextension', 'Dorso', 'lombari', 'corpo libero', ['iperestensioni', 'estensioni lombari']],
    ['Stacco da terra', 'Dorso', 'stacco', 'bilanciere', ['stacco', 'deadlift']],
    ['Military press', 'Spalle', 'spinta verticale', 'bilanciere', ['lento avanti', 'overhead press']],
    ['Shoulder press manubri', 'Spalle', 'spinta verticale', 'manubri', ['lento avanti manubri', 'arnold press']],
    ['Shoulder press macchina', 'Spalle', 'spinta verticale', 'macchina', ['lento avanti macchina']],
    ['Alzate laterali manubri', 'Spalle', 'laterali', 'manubri', ['alzate laterali', 'alzate laterali con manubri']],
    ['Alzate laterali ai cavi', 'Spalle', 'laterali', 'cavi', ['alzate laterali cavo']],
    ['Alzate laterali macchina', 'Spalle', 'laterali', 'macchina', []],
    ['Alzate posteriori manubri', 'Spalle', 'posteriori', 'manubri', ['alzate posteriori', 'alzate a 90']],
    ['Reverse pec deck', 'Spalle', 'posteriori', 'macchina', ['pec deck inverso']],
    ['Face pull', 'Spalle', 'posteriori', 'cavi', []],
    ['Alzate frontali', 'Spalle', 'frontali', 'manubri', []],
    ['Scrollate', 'Spalle', 'trapezi', 'manubri', ['shrug']],
    ['Curl con bilanciere', 'Bicipiti', 'curl', 'bilanciere', ['curl bilanciere', 'curl ez', 'curl con ez']],
    ['Curl con manubri', 'Bicipiti', 'curl', 'manubri', ['curl manubri']],
    ['Curl a martello', 'Bicipiti', 'curl neutro', 'manubri', ['hammer curl']],
    ['Curl su panca inclinata', 'Bicipiti', 'curl allungato', 'manubri', []],
    ['Curl ai cavi', 'Bicipiti', 'curl', 'cavi', ['curl cavo']],
    ['Curl alla macchina', 'Bicipiti', 'curl', 'macchina', ['preacher curl', 'panca scott']],
    ['Curl concentrato', 'Bicipiti', 'isolamento', 'manubri', []],
    ['French press', 'Tricipiti', 'estensione sopra la testa', 'bilanciere', ['skull crusher', 'french press ez']],
    ['Pushdown ai cavi', 'Tricipiti', 'pushdown', 'cavi', ['pushdown', 'push down', 'tricipiti ai cavi']],
    ['Pushdown con corda', 'Tricipiti', 'pushdown', 'cavi', []],
    ['Estensioni sopra la testa', 'Tricipiti', 'estensione sopra la testa', 'manubri', ['estensione tricipiti manubrio']],
    ['Estensioni ai cavi sopra la testa', 'Tricipiti', 'estensione sopra la testa', 'cavi', []],
    ['Dip alla panca', 'Tricipiti', 'spinta', 'corpo libero', ['dip su panca']],
    ['Panca presa stretta', 'Tricipiti', 'spinta', 'bilanciere', []],
    ['Kickback', 'Tricipiti', 'kickback', 'manubri', []],
    ['Tricipiti alla macchina', 'Tricipiti', 'spinta', 'macchina', ['dip machine']],
    ['Squat', 'Gambe', 'squat', 'bilanciere', ['back squat', 'squat con bilanciere']],
    ['Front squat', 'Gambe', 'squat', 'bilanciere', []],
    ['Goblet squat', 'Gambe', 'squat', 'manubri', []],
    ['Hack squat', 'Gambe', 'squat', 'macchina', []],
    ['Leg press', 'Gambe', 'squat', 'macchina', ['pressa', 'pressa 45']],
    ['Affondi', 'Gambe', 'affondi', 'manubri', ['lunges', 'affondi con manubri']],
    ['Affondi bulgari', 'Gambe', 'affondi', 'manubri', ['bulgarian split squat', 'split squat bulgaro']],
    ['Step-up', 'Gambe', 'affondi', 'manubri', ['step up']],
    ['Leg extension', 'Gambe', 'quadricipiti isolamento', 'macchina', []],
    ['Leg curl seduto', 'Gambe', 'femorali', 'macchina', ['leg curl']],
    ['Leg curl sdraiato', 'Gambe', 'femorali', 'macchina', []],
    ['Stacchi rumeni', 'Gambe', 'femorali', 'bilanciere', ['stacco rumeno', 'romanian deadlift', 'rdl']],
    ['Stacchi rumeni manubri', 'Gambe', 'femorali', 'manubri', []],
    ['Calf in piedi', 'Gambe', 'polpacci', 'macchina', ['calf raise', 'polpacci']],
    ['Calf seduto', 'Gambe', 'polpacci', 'macchina', []],
    ['Adductor machine', 'Gambe', 'adduttori', 'macchina', ['adduttori']],
    ['Hip thrust', 'Glutei', 'ponte glutei', 'bilanciere', []],
    ['Ponte glutei', 'Glutei', 'ponte glutei', 'corpo libero', ['glute bridge']],
    ['Hip thrust alla macchina', 'Glutei', 'ponte glutei', 'macchina', []],
    ['Kickback ai cavi', 'Glutei', 'estensione anca', 'cavi', ['glute kickback']],
    ['Abductor machine', 'Glutei', 'abduzione', 'macchina', ['abduttori']],
    ['Abduzioni ai cavi', 'Glutei', 'abduzione', 'cavi', []],
    ['Affondi camminati', 'Glutei', 'affondi', 'manubri', []],
    ['Squat sumo', 'Glutei', 'squat', 'manubri', []],
    ['Crunch', 'Addome', 'crunch', 'corpo libero', []],
    ['Crunch ai cavi', 'Addome', 'crunch', 'cavi', ['cable crunch']],
    ['Crunch alla macchina', 'Addome', 'crunch', 'macchina', []],
    ['Plank', 'Addome', 'statico', 'corpo libero', []],
    ['Sollevamento gambe', 'Addome', 'gambe', 'corpo libero', ['leg raise', 'sollevamento gambe alla sbarra']],
    ['Russian twist', 'Addome', 'rotazioni', 'corpo libero', []],
    ['Ab wheel', 'Addome', 'rollout', 'corpo libero', ['ruota addominali', 'rollout']],
    ['Woodchop ai cavi', 'Addome', 'rotazioni', 'cavi', ['taglialegna'] ]
  ].map((r) => ({ name: r[0], group: r[1], pattern: r[2], equipment: r[3], keys: [normName(r[0])].concat(r[4].map(normName)) }));
  // Riconosce l'esercizio dal nome: prima la corrispondenza esatta, poi la parola chiave più lunga contenuta nel nome.
  function findCatalog(name) {
    const n = normName(name);
    if (!n) return null;
    const exact = CATALOG.find((c) => c.keys.includes(n));
    if (exact) return exact;
    let best = null, bestLen = 0;
    CATALOG.forEach((c) => c.keys.forEach((k) => {
      if (k.length >= 5 && k.length > bestLen && (' ' + n + ' ').includes(' ' + k + ' ')) { best = c; bestLen = k.length; }
    }));
    return best;
  }
  function equipmentOf(ex) { const f = findCatalog(ex && ex.name); return f ? f.equipment : null; }
  // Alternative dello stesso gruppo: prima lo stesso movimento con un altro attrezzo, poi le altre. Esclude gli esercizi già nella giornata.
  function substituteSuggestions(ex, dayExercises, group) {
    const found = findCatalog(ex && ex.name);
    const g = cleanGroup(group) || cleanGroup(ex && ex.group) || (found && found.group) || null;
    if (!g || g === GROUP_OTHER) return { group: g, items: [] };
    const taken = new Set((dayExercises || []).map((e) => normName(e.name)));
    const items = CATALOG.map((c, i) => ({ c, i }))
      .filter(({ c }) => c.group === g && !(found && c.name === found.name) && !taken.has(normName(c.name)))
      .map(({ c, i }) => ({ c, i, score: found && found.group === g ? (c.pattern === found.pattern ? 3 : 0) + (c.equipment !== found.equipment ? 1 : 0) : 0 }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, 6)
      .map(({ c }) => ({ name: c.name, group: c.group, equipment: c.equipment, samePattern: !!(found && found.group === g && c.pattern === found.pattern) }));
    return { group: g, items };
  }
  // Carico di partenza prudente per il nuovo attrezzo: è una stima da correggere alla prima serie.
  function substituteKg(kg, fromEquip, toEquip) {
    const k = Number(kg) || 0;
    if (k <= 0 || toEquip === 'corpo libero') return 0;
    let f = 0.7;
    if (fromEquip === 'bilanciere' && toEquip === 'manubri') f = 0.4;
    else if (fromEquip === 'manubri' && toEquip === 'bilanciere') f = 2;
    else if (fromEquip && fromEquip === toEquip && toEquip !== 'macchina') f = 1;
    const v = k * f;
    return v >= 20 ? Math.round(v / 2.5) * 2.5 : Math.max(1, Math.round(v * 2) / 2);
  }
  // Nuovo esercizio con le stesse serie e ripetizioni; la nota fissa riguardava quello vecchio e non si porta dietro.
  function makeSubstitute(ex, pick, id) {
    const out = { id, name: pick.name, group: pick.group, setCount: ex.setCount, reps: ex.reps, kg: substituteKg(ex.kg, equipmentOf(ex), pick.equipment) };
    if (ex.setReps) out.setReps = ex.setReps.slice();
    if (ex.setTypes) out.setTypes = ex.setTypes.slice();
    return normalizeExercise(out);
  }

  /* ---------- Volume settimanale nel tempo e riepilogo mensile ---------- */
  function addWeeks(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + 7 * n); return d.getTime(); }
  // Volume (kg sollevati) di ognuna delle ultime `weeks` settimane, da lunedì a domenica; l'ultima è quella in corso.
  function weeklyVolumeSeries(sessions, now, weeks) {
    const count = weeks || 8;
    const first = addWeeks(startOfWeek(now == null ? Date.now() : now), -(count - 1));
    const end = addWeeks(first, count);
    const out = Array.from({ length: count }, (_, i) => ({ start: addWeeks(first, i), volume: 0, sessions: 0 }));
    (sessions || []).forEach((sess) => {
      const when = sessionTime(sess);
      if (when < first || when >= end) return;
      let k = count - 1;
      while (k > 0 && out[k].start > when) k--;
      out[k].volume += sessionStats(sess).volume;
      out[k].sessions += 1;
    });
    out.forEach((w) => { w.volume = Math.round(w.volume); });
    return out;
  }
  // Valore di una serie per misurare il progresso: massimale stimato, o ripetizioni se a corpo libero.
  function progressMetric(x) {
    const kg = Number(x.kg) || 0, reps = Number(x.reps) || 0;
    if (kg > 0) return { value: estimateOneRm(kg, reps) || kg, unit: 'kg' };
    return { value: reps, unit: 'rip' };
  }
  // L'esercizio che nel mese è migliorato di più rispetto al suo miglior valore precedente (o alla prima sessione del mese).
  function bestProgress(sessions, from, to) {
    const byEx = new Map();
    (sessions || []).forEach((sess) => (sess.exercises || []).forEach((ex) => {
      if (ex.substitute) return;
      const done = (ex.sets || []).filter((x) => x && x.done && x.type !== 'warmup');
      if (!done.length) return;
      const top = done.map(progressMetric).reduce((a, b) => (b.value > a.value ? b : a));
      if (!(top.value > 0)) return;
      const list = byEx.get(ex.exerciseId) || [];
      list.push({ t: sessionTime(sess), value: top.value, unit: top.unit, name: ex.name });
      byEx.set(ex.exerciseId, list);
    }));
    let best = null;
    byEx.forEach((list) => {
      list.sort((a, b) => a.t - b.t);
      const inMonth = list.filter((p) => p.t >= from && p.t < to);
      if (!inMonth.length) return;
      const before = list.filter((p) => p.t < from);
      const baseline = before.length ? Math.max(...before.map((p) => p.value)) : (inMonth.length >= 2 ? inMonth[0].value : null);
      if (!(baseline > 0)) return;
      const peak = Math.max(...inMonth.map((p) => p.value));
      const gain = peak - baseline;
      if (!(gain > 0)) return;
      const cand = { name: inMonth[inMonth.length - 1].name, from: Math.round(baseline * 10) / 10, to: Math.round(peak * 10) / 10, pct: Math.round((gain / baseline) * 100), unit: inMonth[0].unit, gain };
      if (!best || cand.pct > best.pct || (cand.pct === best.pct && cand.gain > best.gain)) best = cand;
    });
    if (best) delete best.gain;
    return best;
  }
  function monthlySummary(program, year, month) {
    const from = new Date(year, month, 1).getTime(), to = new Date(year, month + 1, 1).getTime();
    const prevFrom = new Date(year, month - 1, 1).getTime();
    const all = (program && program.sessions) || [];
    const within = (a, b) => all.filter((x) => { const t = sessionTime(x); return t >= a && t < b; });
    const list = within(from, to), prev = within(prevFrom, from);
    const sum = (arr, key) => arr.reduce((n, x) => n + sessionStats(x)[key], 0);
    const volume = Math.round(sum(list, 'volume')), prevVolume = Math.round(sum(prev, 'volume'));
    const days = new Map();
    list.forEach((x) => { const name = x.dayName || 'Allenamento'; days.set(name, (days.get(name) || 0) + 1); });
    return {
      from, sessions: list.length, sets: sum(list, 'completedSets'), volume,
      activeDays: new Set(list.map((x) => dayKey(sessionTime(x)))).size,
      prevSessions: prev.length, prevVolume,
      volumePct: prevVolume > 0 ? Math.round(((volume - prevVolume) / prevVolume) * 100) : null,
      topDays: Array.from(days, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3),
      groups: groupVolumeBetween(all, from, to).slice(0, 4),
      best: bestProgress(all, from, to)
    };
  }

  const _logic = { progressionSuggestion, nextTarget, applyTarget, retargetSession, sessionMeetsTarget, findCatalog, substituteSuggestions, substituteKg, makeSubstitute, weeklyVolumeSeries, monthlySummary, bestProgress, groupVolumeBetween, CATALOG, cleanGroup, groupOf, weeklyGroupVolume, estimateOneRm, bestOneRm, warmupPlan, previousSession, compareSessions, makeBackup, parseBackup, GROUPS, cleanName, whole, weight, makeSession, sessionStats, recentCount, normalizeProgram, exerciseHistory, lineChartSvg, reorderById, cleanType, cleanNote, cleanRpe, repsFor, typeFor, repsSummary, makeSet,
    dayKey, startOfWeek, weekStreak, weekDots, monthGrid, bodyWeight, upsertBodyWeight, dateInputToTime, reminderPlan, parseTime, SET_TYPES, MAX_SETS, MAX_REPS, MAX_KG, WEEKDAYS };
  N.workouts = { init, open, _logic, _state: state };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.workouts;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
