/* =========================================================================
 * util.js — tiny shared helpers (no dependencies)
 * Exposes a single global: window.U
 * ========================================================================= */
(function (global) {
  'use strict';

  /* Escape text so it is safe to drop into innerHTML. */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c];
    });
  }

  /* Wrap pre-built HTML in a span with a class (does NOT escape). */
  function wrap(html, cls) {
    return '<span class="' + cls + '">' + html + '</span>';
  }

  /* Build a "painter": takes plain text, escapes it, wraps in a color class. */
  function painter(cls) {
    return function (t) { return wrap(esc(t), cls); };
  }

  var color = {
    green:   painter('clr-green'),
    blue:    painter('clr-blue'),
    cyan:    painter('clr-cyan'),
    yellow:  painter('clr-yellow'),
    red:     painter('clr-red'),
    magenta: painter('clr-magenta'),
    gray:    painter('clr-gray'),
    orange:  painter('clr-orange'),
    white:   painter('clr-white'),
    accent:  painter('clr-accent'),
    bold:    painter('bold'),
    dim:     painter('dim')
  };

  /* Turn URLs and emails inside ALREADY-ESCAPED text into clickable links. */
  function linkify(escaped) {
    // Full http(s) URLs
    escaped = escaped.replace(
      /\bhttps?:\/\/[^\s<]+[^\s<.,;:)\]'"]/g,
      function (m) {
        return '<a href="' + m + '" target="_blank" rel="noopener noreferrer">' + m + '</a>';
      }
    );
    // Bare www.something
    escaped = escaped.replace(
      /(^|[\s(>])(www\.[^\s<]+[^\s<.,;:)\]'"])/g,
      function (_, pre, m) {
        return pre + '<a href="https://' + m + '" target="_blank" rel="noopener noreferrer">' + m + '</a>';
      }
    );
    // Emails
    escaped = escaped.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      function (m) { return '<a href="mailto:' + m + '">' + m + '</a>'; }
    );
    return escaped;
  }

  /* Split a command line into tokens, honouring 'single' and "double" quotes. */
  function tokenize(str) {
    var out = [], cur = '', quote = null, has = false, i;
    for (i = 0; i < str.length; i++) {
      var ch = str[i];
      if (quote) {
        if (ch === quote) { quote = null; }
        else { cur += ch; }
        has = true;
      } else if (ch === '"' || ch === "'") {
        quote = ch; has = true;
      } else if (/\s/.test(ch)) {
        if (has) { out.push(cur); cur = ''; has = false; }
      } else {
        cur += ch; has = true;
      }
    }
    if (has) { out.push(cur); }
    return out;
  }

  /* Right-pad a string to a given visible length. */
  function pad(s, n) {
    s = String(s);
    while (s.length < n) { s += ' '; }
    return s;
  }

  global.U = {
    esc: esc,
    wrap: wrap,
    color: color,
    c: color,
    linkify: linkify,
    tokenize: tokenize,
    pad: pad
  };
})(window);
