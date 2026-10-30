/* Helpers: formatting, fuzzy search, safe localStorage. Exposes window.Lib. */
(function () {
  'use strict';

  // --- plural / dates ---------------------------------------------------
  function plural(n, one, few, many) {
    const a = Math.abs(n);
    if (a === 1) return one;
    const m10 = a % 10, m100 = a % 100;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
    return many;
  }

  function unit(n, u) {
    const forms = {
      min: ['minutę', 'minuty', 'minut'],
      h: ['godzinę', 'godziny', 'godzin'],
      d: ['dzień', 'dni', 'dni'],
    }[u];
    // "dzień" in accusative-like phrases: "1 dzień temu", "za 1 dzień"; 2+ -> dni
    return n + ' ' + plural(n, forms[0], forms[1], forms[2]);
  }

  // ts: unix seconds, ms number, or ISO string. Returns "2 dni temu" / "za 5 dni".
  function formatRelative(ts, now) {
    const t = toMs(ts);
    if (t == null) return '';
    const diff = t - (now || Date.now());
    const abs = Math.abs(diff);
    const min = Math.round(abs / 60000);
    let text;
    if (min < 1) return 'przed chwilą';
    if (min < 60) text = unit(min, 'min');
    else if (min < 60 * 24) text = unit(Math.round(min / 60), 'h');
    else text = unit(Math.round(min / 1440), 'd');
    return diff < 0 ? text + ' temu' : 'za ' + text;
  }

  function toMs(ts) {
    if (ts == null || ts === '') return null;
    if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
    const d = Date.parse(ts);
    return isNaN(d) ? null : d;
  }

  // --- price ------------------------------------------------------------
  // cents -> "$99" / "$99.50"; null/NaN -> null. Unknown currency code falls back to "99 XYZ".
  function formatPrice(cents, currency) {
    if (cents == null || isNaN(cents)) return null;
    const v = cents / 100;
    const cur = currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(v);
    } catch (e) {
      return v + ' ' + cur;
    }
  }

  // --- fuzzy search -----------------------------------------------------
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function words(s) {
    return normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
  }

  // Levenshtein distance with early exit above `max`.
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const c = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        cur[j] = c;
        if (c < rowMin) rowMin = c;
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // Precompute once per item: { text, words }.
  function buildIndex(parts) {
    const text = normalize(parts.filter(Boolean).join(' '));
    return { text: text, words: Array.from(new Set(text.split(/[^a-z0-9]+/).filter(Boolean))) };
  }

  // Every query token must match: substring, or a word within 1 edit (2 for tokens >= 7 chars).
  function fuzzyMatch(index, query) {
    const tokens = words(query);
    if (!tokens.length) return true;
    return tokens.every(function (tok) {
      if (index.text.indexOf(tok) !== -1) return true;
      if (tok.length < 4) return false;
      const max = tok.length >= 7 ? 2 : 1;
      return index.words.some(function (w) { return editDistance(tok, w, max) <= max; });
    });
  }

  // --- localStorage wrapper --------------------------------------------
  const memory = {};
  const store = {
    get: function (key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw == null) return key in memory ? memory[key] : fallback;
        return JSON.parse(raw);
      } catch (e) {
        return key in memory ? memory[key] : fallback;
      }
    },
    set: function (key, value) {
      memory[key] = value; // keeps the session working when storage is blocked
      try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
  };

  // Only allow http(s) URLs into href/src.
  function safeUrl(u) {
    if (typeof u !== 'string') return null;
    try {
      const p = new URL(u);
      return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
    } catch (e) { return null; }
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  window.Lib = {
    plural: plural, formatRelative: formatRelative, formatPrice: formatPrice,
    buildIndex: buildIndex, fuzzyMatch: fuzzyMatch, normalize: normalize,
    store: store, safeUrl: safeUrl, debounce: debounce, toMs: toMs,
  };
})();
