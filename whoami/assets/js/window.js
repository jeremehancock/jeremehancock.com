/* =========================================================================
 * window.js — desktop "window manager" for the terminal.
 *
 * Makes the terminal a real floating window you can move (drag the title bar)
 * and resize (drag the edges/corners), and wires the title-bar buttons:
 *   minimize -> collapse to the bottom-left corner (click to restore)
 *   maximize -> fill the screen (toggle)
 *   close    -> hide the window and show a "restart terminal" button
 * Inert on mobile/narrow screens (the window chrome is hidden there).
 * Exposes a single global: window.WindowManager
 * ========================================================================= */
(function (global) {
  'use strict';

  var DESKTOP = '(min-width: 681px)';
  var MINW = 360, MINH = 200, MARGIN = 10, KEEP = 64; // px kept on-screen when moving

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* Pure geometry for a resize drag — exported for testing. */
  function resizeGeom(dir, g0, dx, dy, vw, vh) {
    var g = { left: g0.left, top: g0.top, width: g0.width, height: g0.height };
    if (dir.indexOf('e') > -1) { g.width = clamp(g0.width + dx, MINW, vw - g0.left); }
    if (dir.indexOf('s') > -1) { g.height = clamp(g0.height + dy, MINH, vh - g0.top); }
    if (dir.indexOf('w') > -1) {
      var nw = clamp(g0.width - dx, MINW, g0.left + g0.width);
      g.left = g0.left + (g0.width - nw); g.width = nw;
    }
    if (dir.indexOf('n') > -1) {
      var nh = clamp(g0.height - dy, MINH, g0.top + g0.height);
      g.top = g0.top + (g0.height - nh); g.height = nh;
    }
    return g;
  }

  function WindowManager(term, els) {
    this.term = term;
    this.win = els.root;
    this.titlebar = els.titlebar;
    this.restartBtn = els.restartBtn;
    this.handles = els.handles || [];
    this.state = 'normal';            // normal | maximized | minimized | closed
    this.saved = null;                // geometry to restore to
    this.mq = global.matchMedia
      ? global.matchMedia(DESKTOP)
      : { matches: false, addEventListener: function () {}, addListener: function () {} };
    this._wire();
  }

  WindowManager.prototype.isDesktop = function () { return this.mq.matches; };

  WindowManager.prototype._geom = function () {
    var r = this.win.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  WindowManager.prototype._apply = function (g) {
    var s = this.win.style;
    s.left = g.left + 'px'; s.top = g.top + 'px';
    s.width = g.width + 'px'; s.height = g.height + 'px';
    s.transform = 'none'; s.margin = '0';
  };
  WindowManager.prototype._clearInline = function () {
    var s = this.win.style;
    s.left = s.top = s.width = s.height = s.transform = s.margin = '';
  };
  WindowManager.prototype._defaultGeom = function () {
    var w = Math.min(960, global.innerWidth * 0.92);
    var h = Math.min(760, global.innerHeight * 0.86);
    return { left: (global.innerWidth - w) / 2, top: (global.innerHeight - h) / 2, width: w, height: h };
  };

  WindowManager.prototype._wire = function () {
    var self = this;

    this.win.querySelectorAll('.winbtn').forEach(function (b) {
      var act = b.classList.contains('min') ? 'minimize'
        : b.classList.contains('max') ? 'toggleMaximize'
        : b.classList.contains('close') ? 'close' : null;
      if (!act) { return; }
      b.addEventListener('click', function (e) { e.stopPropagation(); self[act](); });
    });
    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', function () { self.restart(); });
    }

    this.titlebar.addEventListener('pointerdown', function (e) { self._startMove(e); });
    this.titlebar.addEventListener('dblclick', function (e) {
      if (e.target.closest('.winbtn')) { return; }
      self.toggleMaximize();
    });
    // click a collapsed (minimized) window to bring it back
    this.win.addEventListener('click', function (e) {
      if (self.state === 'minimized' && !e.target.closest('.winbtn')) { self.restore(); }
    });
    this.handles.forEach(function (h) {
      h.addEventListener('pointerdown', function (e) { self._startResize(e, h.dataset.dir); });
    });

    var onBp = function () { self._onBreakpoint(); };
    if (this.mq.addEventListener) { this.mq.addEventListener('change', onBp); }
    else if (this.mq.addListener) { this.mq.addListener(onBp); } // older browsers
    global.addEventListener('resize', function () { self._onViewportResize(); });

    this._onBreakpoint();
  };

  /* ----- drag to move ---------------------------------------------- */
  WindowManager.prototype._startMove = function (e) {
    if (!this.isDesktop() || this.state === 'minimized' || this.state === 'maximized') { return; }
    if (e.target.closest('.winbtn') || e.target.closest('.rh')) { return; }
    e.preventDefault();
    var self = this, g0 = this._geom(), sx = e.clientX, sy = e.clientY;
    this.win.classList.add('is-dragging');
    function move(ev) {
      var left = clamp(g0.left + (ev.clientX - sx), KEEP - g0.width, global.innerWidth - KEEP);
      var top = clamp(g0.top + (ev.clientY - sy), 0, global.innerHeight - 40);
      self.win.style.left = left + 'px'; self.win.style.top = top + 'px';
      self.win.style.transform = 'none'; self.win.style.margin = '0';
    }
    function up() {
      self.win.classList.remove('is-dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  /* ----- drag to resize -------------------------------------------- */
  WindowManager.prototype._startResize = function (e, dir) {
    if (!this.isDesktop() || this.state !== 'normal') { return; }
    e.preventDefault(); e.stopPropagation();
    var self = this, g0 = this._geom(), sx = e.clientX, sy = e.clientY;
    this.win.classList.add('is-resizing');
    function move(ev) {
      self._apply(resizeGeom(dir, g0, ev.clientX - sx, ev.clientY - sy,
        global.innerWidth, global.innerHeight));
    }
    function up() {
      self.win.classList.remove('is-resizing');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      self.term.scroll();
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  /* ----- window states --------------------------------------------- */
  WindowManager.prototype.toggleMaximize = function () {
    if (!this.isDesktop()) { return; }
    if (this.state === 'maximized') { this.restore(); return; }
    if (this.state === 'normal') { this.saved = this._geom(); }
    this.state = 'maximized';
    this.win.classList.remove('is-minimized');
    this.win.classList.add('is-maximized');
    this._apply({ left: 0, top: 0, width: global.innerWidth, height: global.innerHeight });
    this.term.scroll(); this.term.focus();
  };

  WindowManager.prototype.minimize = function () {
    if (!this.isDesktop()) { return; }
    if (this.state === 'normal') { this.saved = this._geom(); }
    this.state = 'minimized';
    this.win.classList.remove('is-maximized');
    this.win.classList.add('is-minimized');
    this._apply({ left: MARGIN, top: global.innerHeight - 38 - MARGIN, width: 260, height: 38 });
  };

  WindowManager.prototype.restore = function () {
    if (!this.isDesktop()) { return; }
    this.state = 'normal';
    this.win.classList.remove('is-maximized', 'is-minimized');
    this._apply(this.saved || this._defaultGeom());
    this.term.scroll(); this.term.focus();
  };

  WindowManager.prototype.close = function () {
    if (!this.isDesktop()) { return; }
    if (this.state === 'normal') { this.saved = this._geom(); }
    this.state = 'closed';
    this.win.classList.remove('is-maximized', 'is-minimized');
    this.win.classList.add('is-closed');
    if (this.restartBtn) { this.restartBtn.hidden = false; }
  };

  WindowManager.prototype.restart = function () {
    this.win.classList.remove('is-closed', 'is-maximized', 'is-minimized');
    if (this.restartBtn) { this.restartBtn.hidden = true; }
    this.state = 'normal';
    if (this.isDesktop()) { this._apply(this.saved || this._defaultGeom()); }
    else { this._clearInline(); }
    this.term.reset(); // boot the terminal fresh
  };

  /* ----- responsive bookkeeping ------------------------------------ */
  WindowManager.prototype._onBreakpoint = function () {
    if (this.isDesktop()) {
      if (this.state === 'closed') { return; }
      if (!this.win.style.width) { this._apply(this._geom()); } // pin the CSS-centered geometry
    } else {
      this.state = 'normal';
      this.win.classList.remove('is-maximized', 'is-minimized', 'is-closed');
      if (this.restartBtn) { this.restartBtn.hidden = true; }
      this._clearInline(); // hand layout back to the mobile CSS
    }
  };

  WindowManager.prototype._onViewportResize = function () {
    if (!this.isDesktop()) { return; }
    if (this.state === 'maximized') {
      this._apply({ left: 0, top: 0, width: global.innerWidth, height: global.innerHeight });
    } else if (this.state === 'minimized') {
      this._apply({ left: MARGIN, top: global.innerHeight - 38 - MARGIN, width: 260, height: 38 });
    } else if (this.state === 'normal' && this.win.style.width) {
      var g = this._geom();
      this.win.style.left = clamp(g.left, KEEP - g.width, global.innerWidth - KEEP) + 'px';
      this.win.style.top = clamp(g.top, 0, global.innerHeight - 40) + 'px';
    }
  };

  WindowManager.resizeGeom = resizeGeom; // exposed for tests
  global.WindowManager = WindowManager;
})(window);
