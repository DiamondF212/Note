/* Riordino delle note: mouse (drag HTML5) e touch (tieni premuto, poi trascina). */
(function (N) {
  'use strict';
  let lastAction = 0;

  function initDragAndDrop(containerSelector, onReorder, onLongPress) {
    const container = typeof containerSelector === 'string' ? document.querySelector(containerSelector) : containerSelector;
    if (!container) return;
    const cards = () => Array.from(container.querySelectorAll('.card'));
    const clear = () => cards().forEach((c) => c.classList.remove('drag-over', 'dragging'));
    const emit = () => { if (typeof onReorder === 'function') onReorder(cards().map((c) => c.dataset.id).filter(Boolean)); };
    const place = (dragged, target) => {
      if (cards().indexOf(dragged) < cards().indexOf(target)) target.after(dragged); else target.before(dragged);
    };

    /* ---------- mouse ---------- */
    let dragged = null;
    container.addEventListener('dragstart', (e) => {
      dragged = e.target.closest('.card');
      if (dragged) dragged.classList.add('dragging');
    });
    container.addEventListener('dragend', () => { clear(); dragged = null; });
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const t = e.target.closest('.card');
      if (t && t !== dragged) { cards().forEach((c) => c.classList.remove('drag-over')); t.classList.add('drag-over'); }
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const t = e.target.closest('.card');
      if (t && dragged && t !== dragged) place(dragged, t);
      clear();
      emit();
    });

    /* ---------- touch / penna: pressione lunga, poi trascinamento ---------- */
    const HOLD = 420;
    let st = null;
    const scroller = container.closest('main') || container.parentElement;

    function endTouch() {
      if (!st) return;
      clearTimeout(st.timer);
      if (st.card) { st.card.classList.remove('lifted'); st.card.style.transform = ''; st.card.style.zIndex = ''; st.card.style.pointerEvents = ''; }
      clear();
      cancelAnimationFrame(st.raf);
      st = null;
    }

    container.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const card = e.target.closest('.card');
      if (!card) return;
      endTouch();
      st = { card, x: e.clientX, y: e.clientY, armed: false, moved: false, id: e.pointerId, scroll: 0 };
      st.timer = setTimeout(() => {
        if (!st) return;
        st.armed = true;
        if (navigator.vibrate) navigator.vibrate(18);
        card.classList.add('lifted');
      }, HOLD);
    });

    container.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.armed) {
        if (Math.hypot(dx, dy) > 9) { clearTimeout(st.timer); st = null; } // era uno scorrimento normale
        return;
      }
      if (Math.hypot(dx, dy) > 6) st.moved = true;
      st.card.style.transform = 'translate(' + dx + 'px,' + (dy + st.scroll) + 'px) scale(1.03)';
      st.card.style.zIndex = '10';
      st.card.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const t = under && under.closest && under.closest('.card');
      cards().forEach((c) => c.classList.remove('drag-over'));
      st.target = t && t !== st.card && container.contains(t) ? t : null;
      if (st.target) st.target.classList.add('drag-over');
      // scorrimento automatico ai bordi
      const r = scroller.getBoundingClientRect();
      const speed = e.clientY < r.top + 70 ? -10 : e.clientY > r.bottom - 70 ? 10 : 0;
      cancelAnimationFrame(st.raf);
      if (speed) {
        const step = () => { if (!st) return; const before = scroller.scrollTop; scroller.scrollTop += speed; st.scroll += scroller.scrollTop - before; st.raf = requestAnimationFrame(step); };
        st.raf = requestAnimationFrame(step);
      }
    });

    container.addEventListener('pointerup', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st;
      if (s.armed) {
        lastAction = Date.now();
        const id = s.card.dataset.id;
        if (s.moved && s.target) { place(s.card, s.target); endTouch(); emit(); }
        else { endTouch(); if (!s.moved && typeof onLongPress === 'function') onLongPress(id); }
      } else endTouch();
    });
    container.addEventListener('pointercancel', () => { if (st && !st.armed) endTouch(); });

    // Durante il trascinamento la pagina non deve scorrere.
    container.addEventListener('touchmove', (e) => { if (st && st.armed && e.cancelable) e.preventDefault(); }, { passive: false });
    container.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  N.dragDrop = { initDragAndDrop, justActed: () => Date.now() - lastAction < 500 };
})((window.N = window.N || {}));
