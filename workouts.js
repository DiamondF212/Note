/* Allenamenti — schede e progressi salvati solo sul dispositivo. */
(function (N) {
  'use strict';

  const STORE_ID = 'program';
  const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const MAX_SETS = 20, MAX_REPS = 100, MAX_KG = 1000;
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
  function normalizeProgram(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return {
      id: STORE_ID,
      days: Array.isArray(p.days) ? p.days.filter((d) => d && d.id).map((d) => ({
        id: String(d.id), name: cleanName(d.name) || 'Giornata', weekday: WEEKDAYS.includes(d.weekday) ? d.weekday : '',
        created: Number(d.created) || Date.now(),
        exercises: Array.isArray(d.exercises) ? d.exercises.filter((e) => e && e.id).map((e) => ({
          id: String(e.id), name: cleanName(e.name) || 'Esercizio',
          setCount: whole(e.setCount, 3, 1, MAX_SETS), reps: whole(e.reps, 10, 1, MAX_REPS), kg: weight(e.kg, 0)
        })) : [],
        activeSession: d.activeSession && Array.isArray(d.activeSession.exercises) ? d.activeSession : null
      })) : [],
      sessions: Array.isArray(p.sessions) ? p.sessions.filter((s) => s && s.id && Array.isArray(s.exercises)) : [],
      updated: Number(p.updated) || Date.now()
    };
  }
  function makeSession(day, id, startedAt) {
    return {
      id, dayId: day.id, dayName: day.name, startedAt,
      exercises: (day.exercises || []).map((ex) => ({
        exerciseId: ex.id, name: ex.name,
        sets: Array.from({ length: whole(ex.setCount, 3, 1, MAX_SETS) }, () => ({ reps: ex.reps, kg: ex.kg, done: false }))
      }))
    };
  }
  function sessionStats(session) {
    const sets = (session && session.exercises || []).flatMap((ex) => ex.sets || []);
    const done = sets.filter((s) => s.done);
    return {
      totalSets: sets.length,
      completedSets: done.length,
      volume: done.reduce((sum, s) => sum + (Number(s.reps) || 0) * (Number(s.kg) || 0), 0)
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
      const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId);
      const done = ex ? (ex.sets || []).filter((x) => x && x.done && Number.isFinite(Number(x.kg))) : [];
      if (!done.length) return;
      const best = done.reduce((a, b) => {
        const ka = Number(a.kg), kb = Number(b.kg);
        return kb > ka || (kb === ka && Number(b.reps) > Number(a.reps)) ? b : a;
      });
      out.push({ t: Number(s.completedAt) || Number(s.startedAt) || 0, kg: Number(best.kg) || 0, reps: Number(best.reps) || 0 });
    });
    return out.sort((a, b) => a.t - b.t);
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
    if (sessions.length) renderHistory(body, sessions);
  }
  function summaryText(stats) {
    return stats.completedSets + ' / ' + stats.totalSets + ' serie completate · ' + fmtKg(stats.volume) + ' kg di volume';
  }
  function renderExercise(day, ex, active) {
    const current = active && active.exercises.find((item) => item.exerciseId === ex.id);
    const card = ctx.h('article', { class: 'workout-exercise-card', 'data-workout-exercise': ex.id });
    card.append(ctx.h('div', { class: 'workout-exercise-top' },
      ctx.h('div', { class: 'workout-exercise-icon', html: ctx.I('dumbbell', 18) }),
      ctx.h('div', { class: 'workout-exercise-name' },
        ctx.h('strong', null, ex.name),
        ctx.h('small', null, ex.setCount + ' serie · ' + ex.reps + ' rip · ' + fmtKg(ex.kg) + ' kg')
      ),
      ctx.ibtn('more', () => exerciseOptions(day.id, ex.id), 'Opzioni di ' + ex.name, 'workout-exercise-more'),
      day.exercises.length > 1 ? gripButton('Riordina ' + ex.name) : null
    ));
    if (!active || !current) {
      card.append(ctx.h('div', { class: 'workout-target-row' },
        ctx.h('span', null, 'Obiettivo'),
        ctx.h('strong', null, ex.setCount + ' × ' + ex.reps),
        ctx.h('b', null, fmtKg(ex.kg) + ' kg')
      ));
      return card;
    }
    card.append(ctx.h('div', { class: 'workout-set-head' },
      ctx.h('span', null, 'SERIE'), ctx.h('span', null, 'RIP'), ctx.h('span', null, 'KG'), ctx.h('span', { class: 'workout-done-head' }, 'OK')
    ));
    current.sets.forEach((set, index) => {
      const row = ctx.h('div', { class: 'workout-set-row' + (set.done ? ' completed' : ''), 'data-workout-set': index });
      row.append(ctx.h('span', { class: 'workout-set-number' }, String(index + 1).padStart(2, '0')));
      const reps = ctx.h('input', { class: 'workout-number', type: 'number', min: '1', max: String(MAX_REPS), step: '1', inputmode: 'numeric', value: set.reps, 'aria-label': 'Ripetizioni serie ' + (index + 1), 'data-set-reps': '1' });
      reps.addEventListener('change', () => updateSet(day, current, index, 'reps', whole(reps.value, set.reps, 1, MAX_REPS)));
      const kg = ctx.h('input', { class: 'workout-number', type: 'number', min: '0', max: String(MAX_KG), step: '0.5', inputmode: 'decimal', value: set.kg, 'aria-label': 'Carico in kg serie ' + (index + 1), 'data-set-kg': '1' });
      kg.addEventListener('change', () => updateSet(day, current, index, 'kg', weight(kg.value, set.kg)));
      row.append(reps, kg);
      row.append(ctx.h('button', {
        class: 'workout-set-done' + (set.done ? ' is-done' : ''), type: 'button',
        'data-set-done': '1', 'aria-label': (set.done ? 'Annulla ' : 'Completa ') + 'serie ' + (index + 1),
        'aria-pressed': set.done ? 'true' : 'false',
        onclick: (e) => toggleSet(day, current, index, e.currentTarget)
      }, ctx.h('span', { html: ctx.I('check', 17) })));
      card.append(row);
    });
    return card;
  }
  function updateSet(day, current, index, key, value) {
    if (!current.sets[index]) return;
    current.sets[index][key] = value;
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
          ctx.h('small', null, stats.completedSets + ' serie · ' + fmtKg(stats.volume) + ' kg')
        ),
        ctx.h('span', { class: 'workout-chevron', 'aria-hidden': 'true' }, '›')
      ));
    });
    body.append(list);
  }
  function showSession(session) {
    const body = ctx.h('div', { class: 'workout-session-details' });
    const stats = sessionStats(session);
    body.append(ctx.h('p', { class: 'hint' }, fmtDate(session.completedAt, true) + ' · ' + stats.completedSets + ' serie completate · ' + fmtKg(stats.volume) + ' kg'));
    (session.exercises || []).forEach((ex) => {
      const done = (ex.sets || []).filter((s) => s.done);
      if (!done.length) return;
      body.append(ctx.h('div', { class: 'workout-history-exercise' },
        ctx.h('strong', null, ex.name),
        ctx.h('small', null, done.map((s) => s.reps + ' × ' + fmtKg(s.kg) + ' kg').join('  ·  '))
      ));
    });
    ctx.openSheet(session.dayName || 'Allenamento', body);
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
    setTimeout(() => name.focus(), 180);
    async function saveDay() {
      const clean = cleanName(name.value);
      if (!clean) { error.textContent = 'Inserisci un nome per la giornata.'; name.focus(); return; }
      if (existing) {
        existing.name = clean; existing.weekday = weekday.value;
        try { await save(); await sheet.close(); render(); ctx.toast('Giornata aggiornata'); }
        catch (e) { onSaveError(e); }
        return;
      }
      const day = { id: ctx.uid(), name: clean, weekday: weekday.value, created: Date.now(), exercises: [], activeSession: null };
      state.program.days.push(day);
      try { await save(); await sheet.close(); openDay(day.id); }
      catch (e) { onSaveError(e); }
    }
  }
  function openExerciseForm(dayId, existing) {
    const day = dayById(dayId);
    if (!day) return;
    const name = ctx.h('input', { class: 'field', maxlength: '60', placeholder: 'es. Panca piana', value: existing ? existing.name : '', 'data-workout-exercise-name': '1', autocomplete: 'off' });
    const sets = ctx.h('input', { class: 'field', type: 'number', min: '1', max: String(MAX_SETS), step: '1', inputmode: 'numeric', value: existing ? existing.setCount : 3, 'data-workout-exercise-sets': '1' });
    const reps = ctx.h('input', { class: 'field', type: 'number', min: '1', max: String(MAX_REPS), step: '1', inputmode: 'numeric', value: existing ? existing.reps : 10, 'data-workout-exercise-reps': '1' });
    const kg = ctx.h('input', { class: 'field', type: 'number', min: '0', max: String(MAX_KG), step: '0.5', inputmode: 'decimal', value: existing ? existing.kg : 0, 'data-workout-exercise-kg': '1' });
    const error = ctx.h('p', { class: 'err', role: 'alert' });
    let sheet;
    const content = ctx.h('div', { class: 'workout-form' },
      ctx.h('label', null, 'Nome esercizio', name),
      ctx.h('div', { class: 'workout-form-grid' },
        ctx.h('label', null, 'Serie', sets),
        ctx.h('label', null, 'Ripetizioni', reps),
        ctx.h('label', null, 'Kg', kg)
      ),
      ctx.h('p', { class: 'hint' }, 'Sono i valori di partenza: durante l’allenamento potrai registrarli serie per serie.'),
      error,
      ctx.h('div', { class: 'btns' },
        ctx.h('button', { class: 'btn', onclick: () => sheet.close() }, 'Annulla'),
        ctx.h('button', { class: 'btn pri', 'data-workout-save-exercise': '1', onclick: saveExercise }, existing ? 'Salva esercizio' : 'Aggiungi esercizio')
      )
    );
    sheet = ctx.openSheet(existing ? 'Modifica esercizio' : 'Nuovo esercizio', content);
    setTimeout(() => name.focus(), 180);
    async function saveExercise() {
      const clean = cleanName(name.value);
      const count = whole(sets.value, null, 1, MAX_SETS);
      const repCount = whole(reps.value, null, 1, MAX_REPS);
      const loadKg = weight(kg.value, null);
      if (!clean) { error.textContent = 'Inserisci il nome dell’esercizio.'; name.focus(); return; }
      if (count == null || repCount == null || loadKg == null) { error.textContent = 'Serie, ripetizioni o carico non validi.'; return; }
      if (existing) {
        existing.name = clean; existing.setCount = count; existing.reps = repCount; existing.kg = loadKg;
        const active = day.activeSession && day.activeSession.exercises.find((e) => e.exerciseId === existing.id);
        if (active) active.sets = Array.from({ length: count }, (_, i) => active.sets[i] || { reps: repCount, kg: loadKg, done: false });
      } else {
        const ex = { id: ctx.uid(), name: clean, setCount: count, reps: repCount, kg: loadKg };
        day.exercises.push(ex);
        if (day.activeSession) day.activeSession.exercises.push({
          exerciseId: ex.id, name: ex.name,
          sets: Array.from({ length: count }, () => ({ reps: repCount, kg: loadKg, done: false }))
        });
      }
      try { await save(); await sheet.close(); render(); ctx.toast(existing ? 'Esercizio aggiornato' : 'Esercizio aggiunto'); }
      catch (e) { onSaveError(e); }
    }
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
        await save(); await sheet.close();
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

  const _logic = { cleanName, whole, weight, makeSession, sessionStats, recentCount, normalizeProgram, exerciseHistory, lineChartSvg, reorderById, MAX_SETS, MAX_REPS, MAX_KG, WEEKDAYS };
  N.workouts = { init, open, _logic, _state: state };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.workouts;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
