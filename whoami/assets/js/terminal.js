/* =========================================================================
 * terminal.js — the interactive shell engine.
 * Exposes a single global: window.Terminal
 * ========================================================================= */
(function (global) {
  "use strict";

  var FS = global.FS;
  var U = global.U;
  var c = U.color;
  var Commands = global.Commands;

  var THEMES = ["default", "matrix", "amber", "dracula", "light"];
  var THEME_KEY = "whoami-theme";

  /* Touch-only quick bar. `key` = a keyboard action (otherwise unreachable on
   * phones), `run` = run this command now, `ins` = type this and wait.
   * Edit this list to change the buttons. */
  var QUICKBAR = [
    { key: "tab", label: "Tab", title: "Autocomplete" },
    { key: "up", label: "↑", title: "Previous command" },
    { key: "down", label: "↓", title: "Next command" },
    { sep: true },
    { run: "whoami" },
    { run: "ls" },
    { run: "cd ..", label: "cd .." },
    { ins: "cat ", label: "cat" },
    { run: "tree" },
    { run: "help" },
    { run: "clear" },
    { run: "reset" },
  ];

  function Terminal(els) {
    this.els = els;
    this.cwd = FS.HOME;
    this.history = [];
    this.histIndex = 0;
    this.draft = "";
    this.bootTime = Date.now();
    this.themes = THEMES;
    this.themeName = "default";
    this.ready = false; // input ignored until boot finishes
    this._wire();
    this.buildQuickbar();
    this._trackViewport();
  }

  Terminal.prototype._wire = function () {
    var self = this,
      els = this.els;

    els.input.addEventListener("keydown", function (e) {
      self._onKeyDown(e);
    });
    els.input.addEventListener("input", function () {
      self.renderInput();
      self.scroll(); // typing while scrolled up jumps the prompt back into view
    });
    els.input.addEventListener("keyup", function () {
      self.renderInput();
    });
    els.input.addEventListener("click", function () {
      self.renderInput();
    });
    els.input.addEventListener("focus", function () {
      els.root.classList.add("focused");
    });
    els.input.addEventListener("blur", function () {
      els.root.classList.remove("focused");
    });

    // Click/tap anywhere on the terminal -> focus the input. Doing it on the
    // real `click` gesture is what lets the mobile keyboard pop up. We skip it
    // when the user is selecting text or following a link.
    els.root.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) {
        return;
      }
      if (String(global.getSelection()) === "") {
        self.focus();
      }
    });
  };

  /* ----- focus / theme --------------------------------------------- */
  Terminal.prototype.focus = function () {
    this.els.input.focus();
  };

  Terminal.prototype.loadTheme = function () {
    var saved;
    try {
      saved = global.localStorage.getItem(THEME_KEY);
    } catch (e) {
      saved = null;
    }
    this.setTheme(THEMES.indexOf(saved) > -1 ? saved : "default");
  };

  Terminal.prototype.setTheme = function (name) {
    this.themeName = name;
    document.documentElement.setAttribute("data-theme", name);
    try {
      global.localStorage.setItem(THEME_KEY, name);
    } catch (e) {
      /* ignore */
    }
  };

  /* ----- mobile quick-command bar ---------------------------------- */
  Terminal.prototype.buildQuickbar = function () {
    var self = this,
      bar = this.els.quickbar;
    if (!bar) {
      return;
    }
    QUICKBAR.forEach(function (item) {
      if (item.sep) {
        var s = document.createElement("span");
        s.className = "qsep";
        bar.appendChild(s);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qchip" + (item.key ? " qkey" : "");
      b.textContent = item.label || item.run || item.ins || "";
      b.setAttribute("aria-label", item.title || b.textContent.trim());
      if (item.key) {
        b.dataset.key = item.key;
      } else if (item.run !== undefined) {
        b.dataset.run = item.run;
      } else if (item.ins !== undefined) {
        b.dataset.ins = item.ins;
      }
      bar.appendChild(b);
    });

    // Keep the input focused so tapping a chip never closes the keyboard or
    // moves the caret; we act on the click instead.
    bar.addEventListener("mousedown", function (e) {
      if (e.target.closest(".qchip")) {
        e.preventDefault();
      }
    });
    bar.addEventListener("click", function (e) {
      var b = e.target.closest(".qchip");
      if (!b) {
        return;
      }
      self.focus();
      if (b.dataset.key) {
        self.quickKey(b.dataset.key);
      } else if ("run" in b.dataset) {
        self.quickRun(b.dataset.run);
      } else if ("ins" in b.dataset) {
        self.quickInsert(b.dataset.ins);
      }
    });
  };

  Terminal.prototype.quickRun = function (cmd) {
    if (!this.ready) {
      return;
    }
    this.els.input.value = cmd;
    this.renderInput();
    this.submit();
  };

  Terminal.prototype.quickInsert = function (text) {
    if (!this.ready) {
      return;
    }
    var input = this.els.input;
    var pos =
      input.selectionStart != null ? input.selectionStart : input.value.length;
    input.value = input.value.slice(0, pos) + text + input.value.slice(pos);
    this._caret(pos + text.length);
    this.renderInput();
    this.focus();
  };

  Terminal.prototype.quickKey = function (name) {
    if (!this.ready) {
      return;
    }
    if (name === "tab") {
      this._complete();
    } else if (name === "up") {
      this._history(-1);
    } else if (name === "down") {
      this._history(1);
    }
  };

  // Keep the layout glued to the *visible* viewport so the quick bar and prompt
  // stay above the on-screen keyboard instead of hiding behind it.
  Terminal.prototype._trackViewport = function () {
    var self = this,
      vv = global.visualViewport;
    if (!vv) {
      return;
    }
    function sync() {
      document.documentElement.style.setProperty("--vvh", vv.height + "px");
      self.scroll();
    }
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
  };

  /* ----- prompt ----------------------------------------------------- */
  Terminal.prototype.promptHtml = function () {
    return (
      c.green(FS.USER + "@" + FS.HOST) +
      c.dim(":") +
      c.blue(FS.displayPath(this.cwd)) +
      c.dim("$ ")
    );
  };

  Terminal.prototype.renderPrompt = function () {
    this.els.promptEl.innerHTML = this.promptHtml();
    this.els.titleText.textContent =
      FS.USER + "@" + FS.HOST + ": " + FS.displayPath(this.cwd);
  };

  Terminal.prototype.setCwd = function (abs) {
    this.cwd = abs;
    this.renderPrompt();
  };

  /* ----- output ----------------------------------------------------- */
  Terminal.prototype.write = function (html, cls) {
    var div = document.createElement("div");
    div.className = "block" + (cls ? " " + cls : "");
    div.innerHTML = html;
    this.els.output.appendChild(div);
    this.scroll();
    return div;
  };

  Terminal.prototype.clearScreen = function () {
    this.els.output.innerHTML = "";
  };

  Terminal.prototype.scroll = function () {
    this.els.screen.scrollTop = this.els.screen.scrollHeight;
  };

  Terminal.prototype.echoLine = function (line) {
    this.write(this.promptHtml() + U.esc(line), "cmd-echo");
  };

  /* ----- message of the day ---------------------------------------- */
  // The banner is ASCII art (must not wrap — it shrinks to fit on mobile).
  Terminal.prototype.motdBannerLines = function () {
    return FS.ART.whoami
      .replace(/^\n/, "")
      .split("\n")
      .map(function (l) {
        return c.accent(l);
      });
  };

  // The welcome text wraps normally. Rows are kept narrow so they fit phones.
  Terminal.prototype.motdTextLines = function () {
    var ts = new Date().toDateString() + " " + new Date().toLocaleTimeString();
    function row(cmd, desc) {
      return "  " + c.green(U.pad(cmd, 11)) + c.dim("->  " + desc);
    }
    return [
      c.dim("Last login: " + ts + " on ttyS0"),
      "",
      c.dim("Welcome — you've reached ") +
        U.wrap(c.accent(FS.PROFILE.name), "bold") +
        c.dim("'s terminal resume."),
      c.dim("Logged in as ") +
        c.green(FS.USER) +
        c.dim(". Look around — nothing bites."),
      "",
      row("whoami", "the short version of me"),
      row("ls / cd", "explore the filesystem"),
      row("cat <file>", "read anything you find"),
      row("help", "every command I know"),
      "",
      c.dim(
        "Tip: type a command and hit Enter. <Tab> completes, ↑/↓ = history.",
      ),
    ];
  };

  Terminal.prototype.printMotd = function () {
    this.write(this.motdBannerLines().join("\n"), "art");
    this.write(this.motdTextLines().join("\n"));
  };

  /* ----- keyboard --------------------------------------------------- */
  Terminal.prototype._onKeyDown = function (e) {
    if (!this.ready) {
      return;
    }
    var input = this.els.input;

    // Ctrl shortcuts
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      var k = e.key.toLowerCase();
      if (k === "l") {
        e.preventDefault();
        this.clearScreen();
        return;
      }
      if (k === "c") {
        e.preventDefault();
        this.echoLine(input.value + "^C");
        input.value = "";
        this.histIndex = this.history.length;
        this.renderInput();
        return;
      }
      if (k === "u") {
        e.preventDefault();
        input.value = input.value.slice(input.selectionStart);
        this._caret(0);
        this.renderInput();
        this.scroll();
        return;
      }
      if (k === "a") {
        e.preventDefault();
        this._caret(0);
        this.renderInput();
        this.scroll();
        return;
      }
      if (k === "e") {
        e.preventDefault();
        this._caret(input.value.length);
        this.renderInput();
        this.scroll();
        return;
      }
      if (k === "k") {
        e.preventDefault();
        input.value = input.value.slice(0, input.selectionStart);
        this.renderInput();
        this.scroll();
        return;
      }
    }

    switch (e.key) {
      case "Enter":
        e.preventDefault();
        this.submit();
        return;
      case "ArrowUp":
        e.preventDefault();
        this._history(-1);
        return;
      case "ArrowDown":
        e.preventDefault();
        this._history(1);
        return;
      case "Tab":
        e.preventDefault();
        this._complete();
        return;
      default:
        return; // normal typing handled by 'input' event
    }
  };

  Terminal.prototype._caret = function (n) {
    this.els.input.selectionStart = this.els.input.selectionEnd = n;
  };

  /* ----- input line rendering -------------------------------------- */
  Terminal.prototype.renderInput = function () {
    var input = this.els.input;
    var val = input.value;
    var pos = input.selectionStart;
    if (pos === null || pos === undefined) {
      pos = val.length;
    }
    var atChar = val.slice(pos, pos + 1);
    this.els.typed.innerHTML = U.esc(val.slice(0, pos));
    this.els.cursor.innerHTML = atChar ? U.esc(atChar) : "&nbsp;";
    this.els.rest.innerHTML = U.esc(val.slice(pos + 1));
  };

  /* ----- history nav ----------------------------------------------- */
  Terminal.prototype._history = function (dir) {
    var input = this.els.input;
    if (dir < 0) {
      if (this.histIndex === 0) {
        return;
      }
      if (this.histIndex === this.history.length) {
        this.draft = input.value;
      }
      this.histIndex--;
    } else {
      if (this.histIndex >= this.history.length) {
        return;
      }
      this.histIndex++;
    }
    input.value =
      this.histIndex === this.history.length
        ? this.draft
        : this.history[this.histIndex];
    this._caret(input.value.length);
    this.renderInput();
    this.scroll(); // keep the recalled command visible
  };

  /* ----- submit & dispatch ----------------------------------------- */
  Terminal.prototype.submit = function () {
    var input = this.els.input;
    var raw = input.value;
    input.value = "";
    this.renderInput();

    // bash-style history expansion: !n, !-n, !!, !prefix
    var ex = this._expandHistory(raw);
    if (ex && ex.error) {
      this.echoLine(raw);
      this.write(c.red("jsh: " + U.esc(ex.token) + ": event not found"));
      this.histIndex = this.history.length;
      this.draft = "";
      this.renderPrompt();
      this.scroll();
      return;
    }
    var line = ex ? ex.command : raw; // run (and record) the expanded command
    this.echoLine(line);

    if (line.trim() && this.history[this.history.length - 1] !== line.trim()) {
      this.history.push(line.trim());
    }
    this.histIndex = this.history.length;
    this.draft = "";
    this.run(line);
    this.renderPrompt();
    this.scroll();
  };

  // Expand a leading history reference. Returns:
  //   null                          -> no expansion (line doesn't start with !)
  //   { command: '...' }            -> the expanded command line
  //   { error: true, token: '!x' }  -> the reference didn't resolve
  Terminal.prototype._expandHistory = function (raw) {
    var line = raw.replace(/^\s+/, "");
    if (line.charAt(0) !== "!") {
      return null;
    }

    var m = line.match(/^(\S+)([\s\S]*)$/);
    var token = m[1],
      rest = m[2];
    if (token === "!") {
      return null;
    } // a lone '!' is literal

    var h = this.history,
      idx = -1,
      ref = token.slice(1);
    if (token === "!!") {
      idx = h.length - 1; // last command
    } else if (/^-?\d+$/.test(ref)) {
      var n = parseInt(ref, 10);
      if (n > 0) {
        idx = n - 1;
      } // !n  (1-based, as `history` shows)
      else if (n < 0) {
        idx = h.length + n;
      } // !-n (count back from the end)
    } else {
      for (var i = h.length - 1; i >= 0; i--) {
        // !prefix (most recent match)
        if (h[i].indexOf(ref) === 0) {
          idx = i;
          break;
        }
      }
    }

    if (idx < 0 || idx >= h.length) {
      return { error: true, token: token };
    }
    return { command: h[idx] + rest };
  };

  Terminal.prototype.run = function (line) {
    var tokens = U.tokenize(line);
    if (!tokens.length) {
      return;
    }
    var name = tokens[0];
    var spec = Commands[name];
    if (!spec) {
      this.write(
        c.red("jsh: command not found: " + U.esc(name)) +
          "\n" +
          c.dim("Type ") +
          c.green("help") +
          c.dim(" to see what I can do."),
      );
      return;
    }
    var ctx = {
      cmd: name,
      args: tokens.slice(1),
      rawArgs: tokens.slice(1).join(" "),
      term: this,
      print: this.write.bind(this),
    };
    var out;
    try {
      out = spec.run(ctx);
    } catch (err) {
      out = c.red("jsh: " + name + ": internal error");
      if (global.console) {
        console.error(err);
      }
    }
    if (out && typeof out === "object" && out.html !== undefined) {
      this.write(out.html, out.art ? "art" : undefined);
    } else if (out !== undefined && out !== null && out !== "") {
      this.write(out);
    } else if (out === "") {
      this.write(""); // preserve an intentional blank line of output
    }
  };

  /* ----- tab completion -------------------------------------------- */
  Terminal.prototype._complete = function () {
    var input = this.els.input;
    var pos = input.selectionStart;
    var left = input.value.slice(0, pos);
    var frag = left.slice(left.lastIndexOf(" ") + 1);
    // first word (=> complete a command) only if nothing but the fragment
    // precedes the caret; otherwise we're completing a path argument.
    var isFirstWord = left.slice(0, left.length - frag.length).trim() === "";

    var candidates, apply;
    if (isFirstWord) {
      candidates = Object.keys(Commands)
        .filter(function (n) {
          return !Commands[n].hidden && n.indexOf(frag) === 0;
        })
        .sort();
      apply = function (name, sole) {
        return name + (sole ? " " : "");
      };
    } else {
      var info = this._pathCandidates(frag);
      candidates = info.names;
      apply = function (name, sole) {
        var node = info.dirNode.children[name];
        var done = node && node.type === "dir" ? "/" : sole ? " " : "";
        return info.dirPrefix + name + done;
      };
    }

    if (!candidates.length) {
      return;
    }

    if (candidates.length === 1) {
      this._replaceFragment(frag, apply(candidates[0], true), pos);
      return;
    }

    var lcp = commonPrefix(candidates);
    if (lcp.length > (isFirstWord ? frag.length : baseName(frag).length)) {
      // we can extend the fragment a bit further
      this._replaceFragment(frag, apply2(isFirstWord, frag, lcp), pos);
    } else {
      // show the options, ls-style
      this.echoLine(input.value);
      this.write(
        candidates
          .map(
            function (n) {
              var node = isFirstWord
                ? null
                : this._pathCandidates(frag).dirNode.children[n];
              return isFirstWord
                ? c.green(n)
                : node && node.type === "dir"
                  ? c.blue(n + "/")
                  : U.esc(n);
            }.bind(this),
          )
          .join("   "),
      );
    }
  };

  Terminal.prototype._pathCandidates = function (frag) {
    var slash = frag.lastIndexOf("/");
    var dirPrefix = slash > -1 ? frag.slice(0, slash + 1) : "";
    var base = slash > -1 ? frag.slice(slash + 1) : frag;
    var r = FS.resolve(this.cwd, dirPrefix || ".");
    if (!r.ok || r.node.type !== "dir") {
      return { names: [], dirNode: { children: {} }, dirPrefix: dirPrefix };
    }
    var names = Object.keys(r.node.children)
      .filter(function (n) {
        if (n.indexOf(base) !== 0) {
          return false;
        }
        if (n.charAt(0) === "." && base.charAt(0) !== ".") {
          return false;
        }
        return true;
      })
      .sort();
    return { names: names, dirNode: r.node, dirPrefix: dirPrefix };
  };

  Terminal.prototype._replaceFragment = function (frag, replacement, pos) {
    var input = this.els.input;
    var start = pos - frag.length;
    input.value =
      input.value.slice(0, start) + replacement + input.value.slice(pos);
    this._caret(start + replacement.length);
    this.renderInput();
    this.scroll(); // keep the completed line visible
  };

  /* small completion helpers */
  function baseName(frag) {
    var s = frag.lastIndexOf("/");
    return s > -1 ? frag.slice(s + 1) : frag;
  }
  function apply2(isFirstWord, frag, lcp) {
    if (isFirstWord) {
      return lcp;
    }
    var s = frag.lastIndexOf("/");
    var dirPrefix = s > -1 ? frag.slice(0, s + 1) : "";
    return dirPrefix + lcp;
  }
  function commonPrefix(arr) {
    if (!arr.length) {
      return "";
    }
    var p = arr[0];
    for (var i = 1; i < arr.length; i++) {
      while (arr[i].indexOf(p) !== 0) {
        p = p.slice(0, -1);
      }
    }
    return p;
  }

  /* ----- boot ------------------------------------------------------- */
  // Reveal the MOTD line-by-line, then hand control to the user.
  Terminal.prototype.boot = function () {
    var self = this;
    this.loadTheme();
    this.renderPrompt();
    this.renderInput();
    this.focus();

    var banner = this.motdBannerLines();
    var lines = this.motdTextLines();
    var artBox = this.write("", "art"); // banner: doesn't wrap, fits to width
    var txtBox = this.write(""); // welcome text: wraps normally

    // a flat reveal timeline across both boxes
    var steps = [];
    banner.forEach(function (_, n) {
      steps.push({ box: artBox, html: banner.slice(0, n + 1).join("\n") });
    });
    lines.forEach(function (_, n) {
      steps.push({ box: txtBox, html: lines.slice(0, n + 1).join("\n") });
    });

    var i = 0,
      skipped = false;

    function dump() {
      artBox.innerHTML = banner.join("\n");
      txtBox.innerHTML = lines.join("\n");
      finish();
    }
    function finish() {
      if (self.ready) {
        return;
      }
      self.ready = true;
      // a key used to skip the intro shouldn't leak into the prompt
      self.els.input.value = "";
      self.renderInput();
      self.scroll();
      self.focus();
      global.removeEventListener("keydown", skip, true);
      self.els.root.removeEventListener("mousedown", skip, true);
    }
    function skip() {
      if (skipped) {
        return;
      }
      skipped = true;
      dump();
    }

    global.addEventListener("keydown", skip, true);
    this.els.root.addEventListener("mousedown", skip, true);

    (function tick() {
      if (skipped) {
        return;
      }
      if (i >= steps.length) {
        finish();
        return;
      }
      steps[i].box.innerHTML = steps[i].html;
      self.scroll();
      i++;
      setTimeout(tick, i <= banner.length ? 55 : 28); // banner a touch slower
    })();
  };

  // Start over as if the page had just been opened: clear everything, go home,
  // forget this session, restart the clock, and replay the boot animation.
  // (The saved theme is kept — that's what loads on a real fresh open.)
  Terminal.prototype.reset = function () {
    this.history = [];
    this.histIndex = 0;
    this.draft = "";
    this.cwd = FS.HOME;
    this.bootTime = Date.now();
    this.els.input.value = "";
    this.ready = false; // let boot() run its reveal again
    this.clearScreen();
    this.boot();
  };

  global.Terminal = Terminal;
})(window);
