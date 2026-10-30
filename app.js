(function () {
  'use strict';
  const L = window.Lib;
  const PAGE = 48;
  const KEY = 'cfr:v1:';
  const FUND_MAX = 1000;
  const $ = function (id) { return document.getElementById(id); };

  let items = [];
  let filtered = [];
  let shown = PAGE;
  let priceCap = 1000; // slider max = highest price in data (USD, rounded up)

  const user = {
    viewed: L.store.get(KEY + 'viewed', {}),
    fav: L.store.get(KEY + 'fav', {}),
    hidden: L.store.get(KEY + 'hidden', {}),
    notes: L.store.get(KEY + 'notes', {}),
  };
  const save = function (k) { L.store.set(KEY + k, user[k]); };

  // ---------- filter state <-> controls <-> hash ----------
  const DEFAULTS = {
    q: '', platform: '', phase: '', sort: 'score', cats: [],
    price: null, pnone: true, fmin: 0, fmax: FUND_MAX, ending: false, fav: false, hid: false,
  };

  function readControls() {
    return {
      q: $('q').value.trim(),
      platform: $('platform').value,
      phase: $('phase').value,
      sort: $('sort').value,
      cats: Array.from(document.querySelectorAll('.chip[aria-pressed=true]')).map(function (c) { return c.dataset.cat; }),
      price: +$('price').value >= priceCap ? null : +$('price').value,
      pnone: $('pnone').checked,
      fmin: +$('fmin').value,
      fmax: +$('fmax').value,
      ending: $('ending').checked,
      fav: $('favOnly').checked,
      hid: $('showHidden').checked,
    };
  }

  function writeControls(s) {
    $('q').value = s.q;
    $('platform').value = s.platform;
    $('phase').value = s.phase;
    $('sort').value = s.sort;
    $('price').value = s.price == null ? priceCap : s.price;
    $('pnone').checked = s.pnone;
    $('fmin').value = s.fmin;
    $('fmax').value = s.fmax;
    $('ending').checked = s.ending;
    $('favOnly').checked = s.fav;
    $('showHidden').checked = s.hid;
    document.querySelectorAll('.chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String(s.cats.indexOf(c.dataset.cat) !== -1));
    });
  }

  function toHash(s) {
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.platform) p.set('p', s.platform);
    if (s.phase) p.set('ph', s.phase);
    if (s.sort !== DEFAULTS.sort) p.set('s', s.sort);
    if (s.cats.length) p.set('c', s.cats.join(','));
    if (s.price != null) p.set('pr', s.price);
    if (!s.pnone) p.set('pn', '0');
    if (s.fmin > 0) p.set('f0', s.fmin);
    if (s.fmax < FUND_MAX) p.set('f1', s.fmax);
    if (s.ending) p.set('e', '1');
    if (s.fav) p.set('fav', '1');
    if (s.hid) p.set('h', '1');
    return p.toString();
  }

  function fromHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const num = function (k, d) { const v = parseFloat(p.get(k)); return isNaN(v) ? d : v; };
    const oneOf = function (el, v, d) {
      return Array.from($(el).options).some(function (o) { return o.value === v; }) ? v : d;
    };
    return {
      q: (p.get('q') || '').slice(0, 200),
      platform: oneOf('platform', p.get('p') || '', ''),
      phase: oneOf('phase', p.get('ph') || '', ''),
      sort: oneOf('sort', p.get('s') || '', 'score'),
      cats: (p.get('c') || '').split(',').filter(Boolean),
      price: p.has('pr') ? num('pr', null) : null,
      pnone: p.get('pn') !== '0',
      fmin: Math.max(0, num('f0', 0)),
      fmax: Math.min(FUND_MAX, num('f1', FUND_MAX)),
      ending: p.get('e') === '1',
      fav: p.get('fav') === '1',
      hid: p.get('h') === '1',
    };
  }

  let lastHash = '';
  function syncHash(s) {
    const h = toHash(s);
    lastHash = h;
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* sandboxed */ }
  }

  // ---------- filtering / sorting ----------
  const priceOf = function (it) {
    const c = it.price_early_bird != null ? it.price_early_bird : it.price_regular;
    return c == null ? null : c / 100; // shortcut: non-USD items compared unconverted, add FX if mixed currencies appear
  };
  const num = function (v) { return typeof v === 'number' && !isNaN(v) ? v : null; };
  // nulls always last
  const by = function (get, dir) {
    return function (a, b) {
      const x = get(a), y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return dir * (x - y);
    };
  };
  const SORTS = {
    score: by(function (i) { return num(i.score); }, -1),
    price: by(priceOf, 1),
    funding: by(function (i) { var v = num(i.funding_pct); return v != null ? v * 100 : null; }, -1),
    backers: by(function (i) { return num(i.backers); }, -1),
    newest: by(function (i) { return num(i.first_seen); }, -1),
    ending: by(function (i) { return num(i.days_left); }, 1),
  };

  function matches(it, s) {
    if (!s.hid && user.hidden[it.id]) return false;
    if (s.fav && !user.fav[it.id]) return false;
    if (s.platform && it.platform !== s.platform) return false;
    if (s.phase && it.phase !== s.phase) return false;
    if (s.cats.length && s.cats.indexOf(it.category) === -1) return false;
    if (s.ending && !(it.days_left != null && it.days_left > 0 && it.days_left <= 2)) return false;
    const pr = priceOf(it);
    if (pr == null) { if (!s.pnone) return false; }
    else if (s.price != null && pr > s.price) return false;
    const f = num(it.funding_pct) == null ? 0 : it.funding_pct * 100;
    if (f < s.fmin) return false;
    if (s.fmax < FUND_MAX && f > s.fmax) return false;
    if (s.q && !L.fuzzyMatch(it._idx, s.q)) return false;
    return true;
  }

  // ---------- rendering ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function scoreClass(n) {
    if (n == null) return '';
    return n >= 70 ? 'high' : n >= 40 ? 'mid' : 'low';
  }

  function markViewed(it, card) {
    if (user.viewed[it.id]) return;
    user.viewed[it.id] = Date.now();
    save('viewed');
    card.classList.add('viewed');
  }

  function link(href, cls, text) {
    const a = el('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function card(it) {
    const c = el('article', 'card');
    if (user.viewed[it.id]) c.classList.add('viewed');
    if (user.hidden[it.id]) c.classList.add('is-hidden');
    const url = L.safeUrl(it.project_url);

    // image
    const thumb = url ? link(url, 'thumb') : el('div', 'thumb');
    if (url) { thumb.tabIndex = -1; thumb.setAttribute('aria-hidden', 'true'); }
    const img = L.safeUrl(it.image);
    const placeholder = function () {
      thumb.textContent = '';
      thumb.appendChild(el('div', 'ph', 'Brak obrazu'));
    };
    if (img) {
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.decoding = 'async';
      im.alt = '';
      im.referrerPolicy = 'no-referrer';
      im.addEventListener('error', placeholder, { once: true });
      im.src = img;
      thumb.appendChild(im);
    } else placeholder();
    c.appendChild(thumb);

    // actions
    const act = el('div', 'actions');
    const fav = el('button', 'icon-btn fav', '★');
    fav.type = 'button';
    fav.title = 'Ulubione';
    fav.setAttribute('aria-label', 'Ulubione');
    fav.setAttribute('aria-pressed', String(!!user.fav[it.id]));
    fav.addEventListener('click', function () { toggle('fav', it.id); });
    const hid = el('button', 'icon-btn hide', user.hidden[it.id] ? '🙈' : '👁');
    hid.type = 'button';
    hid.title = user.hidden[it.id] ? 'Przywróć' : 'Ukryj';
    hid.setAttribute('aria-label', hid.title);
    hid.setAttribute('aria-pressed', String(!!user.hidden[it.id]));
    hid.addEventListener('click', function () { toggle('hidden', it.id); });
    act.append(fav, hid);
    c.appendChild(act);

    const b = el('div', 'body');

    // title
    const h = el('h2', 'title');
    if (url) h.appendChild(link(url, null, it.title || it.id)); else h.textContent = it.title || it.id;
    b.appendChild(h);
    [thumb, h.firstChild].forEach(function (a) {
      if (!a || !a.addEventListener) return;
      a.addEventListener('click', function () { markViewed(it, c); });
      a.addEventListener('auxclick', function () { markViewed(it, c); });
    });

    // score
    const sc = el('div', 'row');
    const sn = num(it.score);
    sc.appendChild(el('span', 'score ' + scoreClass(sn), sn == null ? '–' : String(Math.round(sn))));
    if (it.score_label) sc.appendChild(el('span', 'score-label', it.score_label));
    b.appendChild(sc);

    // price
    const pr = el('div', 'price');
    const early = L.formatPrice(it.price_early_bird, it.currency);
    const reg = L.formatPrice(it.price_regular, it.currency);
    if (early == null && reg == null) pr.appendChild(el('span', 'unknown', 'Cena nieznana'));
    else if (early != null) {
      pr.appendChild(el('span', 'early', early));
      if (reg != null && reg !== early) pr.appendChild(el('span', 'regular struck', reg));
    } else pr.appendChild(el('span', 'early', reg));
    b.appendChild(pr);

    // funding
    const fpRaw = num(it.funding_pct);
    const fp = fpRaw != null ? fpRaw * 100 : null;
    const fu = el('div', 'funding');
    const line = el('div');
    const pb = el('b', null, fp == null ? '–' : (fp >= 100 ? Math.round(fp) : Math.round(fp * 10) / 10) + '%');
    line.append(pb);
    if (num(it.backers) != null) line.append(' · ' + it.backers.toLocaleString('pl-PL') + ' wspierających');
    const bar = el('div', 'bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.min(100, Math.round(fp || 0))));
    const fill = document.createElement('span');
    fill.style.width = Math.max(0, Math.min(100, fp || 0)) + '%';
    bar.appendChild(fill);
    fu.append(line, bar);
    b.appendChild(fu);

    // days left
    const d = num(it.days_left);
    if (d != null) {
      const cls = d <= 0 ? '' : d <= 3 ? ' ending' : d <= 7 ? ' warn' : '';
      const r = el('div', 'row');
      r.appendChild(el('span', 'badge' + cls, d <= 0 ? 'Zakończony' : d + ' ' + L.plural(d, 'dzień', 'dni', 'dni')));
      if (it.phase === 'late_pledge') r.appendChild(el('span', 'meta', 'late pledge'));
      b.appendChild(r);
    }

    // arguments
    if (it.argument_buy || it.argument_skip) {
      const ul = el('ul', 'args');
      if (it.argument_buy) ul.appendChild(el('li', null, '👍 ' + it.argument_buy));
      if (it.argument_skip) ul.appendChild(el('li', null, '👎 ' + it.argument_skip));
      b.appendChild(ul);
    }

    // tags
    if (Array.isArray(it.tags) && it.tags.length) {
      const t = el('div', 'tags');
      it.tags.forEach(function (x) { t.appendChild(el('span', 'tag', x)); });
      b.appendChild(t);
    }

    // creator + country
    const who = [it.creator, it.country].filter(Boolean).join(' · ');
    if (who) b.appendChild(el('div', 'meta', who));

    // platform + source
    const foot = el('div', 'foot');
    foot.appendChild(el('span', 'pill ' + (it.platform || ''), it.platform || '?'));
    const src = L.safeUrl(it.source_url);
    if (src) foot.appendChild(link(src, null, 'Źródło'));
    b.appendChild(foot);

    // notes
    const dn = el('details', 'notes');
    const hasNote = !!user.notes[it.id];
    dn.appendChild(el('summary', null, 'Notatki' + (hasNote ? ' •' : '')));
    const ta = document.createElement('textarea');
    ta.value = user.notes[it.id] || '';
    ta.setAttribute('aria-label', 'Notatki');
    ta.maxLength = 2000;
    ta.addEventListener('input', L.debounce(function () {
      if (ta.value) user.notes[it.id] = ta.value; else delete user.notes[it.id];
      save('notes');
      dn.firstChild.textContent = 'Notatki' + (ta.value ? ' •' : '');
    }, 400));
    dn.appendChild(ta);
    b.appendChild(dn);

    c.appendChild(b);
    return c;
  }

  function toggle(kind, id) {
    if (user[kind][id]) delete user[kind][id]; else user[kind][id] = 1;
    save(kind);
    apply(true);
  }

  function renderChunk(from, to) {
    const frag = document.createDocumentFragment();
    filtered.slice(from, to).forEach(function (it) { frag.appendChild(card(it)); });
    $('grid').appendChild(frag);
  }

  function updateCount() {
    $('count').textContent = 'Pokaż ' + filtered.length + ' z ' + items.length + ' projektów';
    $('loadMore').hidden = shown >= filtered.length;
    $('status').textContent = filtered.length ? '' : 'Brak projektów dla tych filtrów.';
  }

  function updateOutputs(s) {
    $('priceOut').textContent = s.price == null ? 'bez limitu' : 'do $' + s.price;
    $('fundOut').textContent = s.fmin + '% – ' + (s.fmax >= FUND_MAX ? FUND_MAX + '%+' : s.fmax + '%');
  }

  // keepShown: after fav/hide toggles keep the current page length
  function apply(keepShown) {
    const s = readControls();
    if (s.fmin > s.fmax) { // keep the two sliders ordered
      if (document.activeElement === $('fmin')) { s.fmin = s.fmax; $('fmin').value = s.fmin; }
      else { s.fmax = s.fmin; $('fmax').value = s.fmax; }
    }
    updateOutputs(s);
    syncHash(s);
    filtered = items.filter(function (it) { return matches(it, s); }).sort(SORTS[s.sort]);
    if (!keepShown) shown = PAGE;
    $('grid').textContent = '';
    renderChunk(0, shown);
    updateCount();
  }

  // ---------- init ----------
  function buildCats() {
    const counts = {};
    items.forEach(function (it) { if (it.category) counts[it.category] = (counts[it.category] || 0) + 1; });
    const box = $('cats');
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (cat) {
      const b = el('button', 'chip', cat.replace(/[-_]/g, ' '));
      b.type = 'button';
      b.dataset.cat = cat;
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(el('small', null, String(counts[cat])));
      b.addEventListener('click', function () {
        b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
        apply();
      });
      box.appendChild(b);
    });
  }

  function setupPriceSlider() {
    const max = items.reduce(function (m, it) { return Math.max(m, priceOf(it) || 0); }, 0);
    const step = max > 2000 ? 100 : max > 300 ? 25 : 5;
    priceCap = Math.max(step * 2, Math.ceil(max / step) * step);
    $('price').max = priceCap;
    $('price').step = step;
    $('price').value = priceCap;
  }

  function restore() {
    writeControls(Object.assign({}, DEFAULTS, fromHash()));
    apply();
  }

  function start(data) {
    items = (data.items || []).filter(function (it) { return it && it.id; });
    items.forEach(function (it) {
      it._idx = L.buildIndex([it.title, it.creator, it.description_short, it.category, (it.tags || []).join(' ')]);
    });
    if (data.generated_at) {
      const ms = L.toMs(data.generated_at);
      if (ms != null) $('updated').textContent = 'Aktualizacja: ' + L.formatRelative(ms);
    }
    setupPriceSlider();
    buildCats();
    if (window.matchMedia('(min-width: 900px)').matches) $('more').open = true;

    const run = L.debounce(function () { apply(); }, 300);
    $('q').addEventListener('input', run);
    ['platform', 'phase', 'sort', 'pnone', 'ending', 'favOnly', 'showHidden'].forEach(function (id) {
      $(id).addEventListener('change', function () { apply(); });
    });
    ['price', 'fmin', 'fmax'].forEach(function (id) {
      $(id).addEventListener('input', L.debounce(function () { apply(); }, 120));
    });
    $('reset').addEventListener('click', function () {
      writeControls(Object.assign({}, DEFAULTS));
      apply();
    });
    $('loadMore').addEventListener('click', function () {
      const from = shown;
      shown += PAGE;
      renderChunk(from, shown);
      updateCount();
    });
    window.addEventListener('hashchange', function () {
      if (location.hash.replace(/^#/, '') !== lastHash) restore();
    });
    restore();
  }

  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(start)
    .catch(function (e) {
      $('status').textContent = 'Nie udało się wczytać danych (' + e.message + ').';
    });
})();
