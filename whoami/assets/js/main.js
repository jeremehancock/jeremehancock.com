/* =========================================================================
 * main.js — load the content manifest, then build & boot the terminal.
 *
 * Content lives in content.json (fetched at load). Files referenced with
 * { "file": "..." } are fetched too. If anything can't load (e.g. the page
 * was opened as a file:// URL), we fall back to FS.FALLBACK so the terminal
 * still works.
 * ========================================================================= */
(function (global) {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  // Walk the manifest tree and replace every { file: "path" } node's content
  // with the fetched text. Runs all fetches in parallel.
  function resolveExternals(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return Promise.resolve();
    }
    var tasks = [];
    Object.keys(node).forEach(function (key) {
      var v = node[key];
      if (!v || typeof v !== 'object' || Array.isArray(v)) { return; }
      if ('file' in v && !('content' in v)) {
        tasks.push(
          fetch(v.file, { cache: 'no-cache' })
            .then(function (r) {
              if (!r.ok) { throw new Error('HTTP ' + r.status); }
              return r.text();
            })
            .then(function (t) { v.content = t.replace(/\n+$/, ''); })
            .catch(function (e) { v.content = '(could not load ' + v.file + ': ' + e.message + ')'; })
        );
      } else if (!('content' in v)) {
        tasks.push(resolveExternals(v)); // it's a directory — recurse
      }
    });
    return Promise.all(tasks);
  }

  function loadManifest() {
    return fetch('content.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .then(function (manifest) {
        return resolveExternals(manifest.tree).then(function () { return manifest; });
      })
      .catch(function (e) {
        if (global.console) {
          console.warn('[whoami] Could not load content.json (' + e.message +
            '). Using fallback content — serve the site over HTTP to load yours.');
        }
        return global.FS.FALLBACK;
      });
  }

  function launch() {
    var els = {
      root:      byId('terminal'),
      screen:    byId('screen'),
      output:    byId('output'),
      promptEl:  byId('prompt'),
      typed:     byId('typed'),
      cursor:    byId('cursor'),
      rest:      byId('rest'),
      input:     byId('hidden-input'),
      titleText: byId('title-text'),
      quickbar:  byId('quickbar')
    };

    var term = new global.Terminal(els);
    global.term = term; // handy for poking at it from the console
    term.boot();

    global.addEventListener('focus', function () { term.focus(); });
  }

  function start() {
    loadManifest().then(function (manifest) {
      global.FS.setManifest(manifest);
      launch();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
