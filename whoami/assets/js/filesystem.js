/* =========================================================================
 * filesystem.js — the virtual-filesystem ENGINE.
 *
 * Site content no longer lives here — it lives in content.json (see the
 * README). This file just knows how to turn a content manifest into a tree
 * and resolve paths against it. Exposes a single global: window.FS
 *
 * Manifest shape (content.json):
 *   { user, host, home?, profile{...}, tree{ ... } }
 * A node in `tree` is:
 *   "text"                      -> a file (single string of content)
 *   ["line", "line", ...]       -> a file (lines joined with newlines)
 *   { "file": "path/to.md" }    -> a file whose content is fetched from a file
 *   { "content": "..."|[...] }  -> a file (explicit inline content)
 *   { "name": <node>, ... }     -> a directory (anything without file/content)
 * ========================================================================= */
(function (global) {
  "use strict";

  /* ----- engine state (populated by setManifest) ---------------------- */
  var USER = "guest",
    HOST = "whoami",
    HOME = "/home/guest";
  var PROFILE = {}; // mutated in place; others hold refs
  var ROOT = { type: "dir", children: {} };

  /* ----- ASCII art -----------------------------------------------------
   * IMPORTANT: keep this art pure ASCII. Unicode block / box-drawing glyphs
   * are not in the Google-Fonts subset of our web font, so on some devices
   * (e.g. Android) they fall back to a different-width font and the art
   * shears apart. Plain ASCII renders uniformly in every monospace font. */
  var ART = {
    // figlet "Standard"
    whoami: [
      "          _                           _",
      "__      _| |__   ___   __ _ _ __ ___ (_)",
      "\\ \\ /\\ / / '_ \\ / _ \\ / _` | '_ ` _ \\| |",
      " \\ V  V /| | | | (_) | (_| | | | | | | |",
      "  \\_/\\_/ |_| |_|\\___/ \\__,_|_| |_| |_|_|",
    ].join("\n"),

    // little terminal logo for `neofetch`
    logo: [
      " ______________ ",
      "|  o o o       |",
      "|--------------|",
      "| $ whoami     |",
      "| > jereme     |",
      "| $ _          |",
      "|______________|",
    ],

    cow: String.raw`        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||`,
  };

  /* ----- build a tree node from a manifest value ---------------------- */
  function file(content) {
    return { type: "file", content: String(content) };
  }
  function dir(children) {
    return { type: "dir", children: children || {} };
  }

  function buildNode(value) {
    if (typeof value === "string") {
      return file(value);
    }
    if (Array.isArray(value)) {
      return file(value.join("\n"));
    }
    if (value && typeof value === "object") {
      if ("content" in value) {
        return file(
          Array.isArray(value.content)
            ? value.content.join("\n")
            : value.content,
        );
      }
      if ("file" in value) {
        return file("");
      } // refs are resolved before this runs
      var children = {};
      Object.keys(value).forEach(function (k) {
        children[k] = buildNode(value[k]);
      });
      return dir(children);
    }
    return file("");
  }

  /* ----- apply a content manifest ------------------------------------- */
  function setManifest(m) {
    m = m || {};
    USER = m.user || "guest";
    HOST = m.host || "whoami";
    HOME = m.home || "/home/" + USER;

    // refresh the profile in place so existing references stay valid
    Object.keys(PROFILE).forEach(function (k) {
      delete PROFILE[k];
    });
    Object.assign(PROFILE, m.profile || {});

    // build the home directory, then nest it at the HOME path
    var homeNode = buildNode(m.tree || {});
    if (homeNode.type !== "dir") {
      homeNode = dir({});
    }
    ROOT = dir({});
    var node = ROOT;
    var parts = HOME.split("/").filter(function (s) {
      return s.length;
    });
    parts.forEach(function (seg, i) {
      if (i === parts.length - 1) {
        node.children[seg] = homeNode;
      } else {
        var d = dir({});
        node.children[seg] = d;
        node = d;
      }
    });
  }

  /* ----- path helpers (read live engine state) ------------------------ */
  function splitPath(p) {
    return p.split("/").filter(function (x) {
      return x.length > 0;
    });
  }

  function resolve(cwd, input) {
    // empty/no argument means "the current directory" (not home)
    if (input === undefined || input === null || input === "") {
      input = ".";
    }
    var parts;
    if (input.charAt(0) === "/") {
      parts = [];
    } else if (input === "~" || input.indexOf("~/") === 0) {
      parts = splitPath(HOME);
      input = input.slice(1);
    } else {
      parts = splitPath(cwd);
    }

    splitPath(input).forEach(function (seg) {
      if (seg === ".") {
        return;
      }
      if (seg === "..") {
        if (parts.length) {
          parts.pop();
        }
        return;
      }
      parts.push(seg);
    });

    var node = ROOT,
      i;
    for (i = 0; i < parts.length; i++) {
      if (node.type !== "dir" || !node.children[parts[i]]) {
        return { ok: false, path: "/" + parts.join("/"), parts: parts };
      }
      node = node.children[parts[i]];
    }
    return {
      ok: true,
      node: node,
      path: "/" + parts.join("/") || "/",
      parts: parts,
    };
  }

  function displayPath(abs) {
    if (abs === HOME) {
      return "~";
    }
    if (abs.indexOf(HOME + "/") === 0) {
      return "~" + abs.slice(HOME.length);
    }
    return abs || "/";
  }

  /* ----- fallback content (used when content.json can't be fetched, ---- *
   * e.g. when the page is opened directly as a file:// URL) ------------- */
  var FALLBACK = {
    user: "guest",
    host: "whoami",
    profile: {
      name: "Michael Jereme Hancock",
      role: "Software Developer",
      location: "Liquid Web",
      tagline: "I'm just a guy who likes to tinker",
      site: "https://jeremehancock.com",
      blog: "https://jereme.dev",
      github: "https://github.com/jeremehancock",
      linkedin: "https://linkedin.com/in/jeremehancock",
      email: "michael@jeremehancock.com",
      isfallback: true,
    },
    tree: {
      "README.md": [
        "Heads up — you're seeing the built-in fallback content.",
        "",
        "This site loads everything from content.json, which a browser can",
        "only fetch when the page is served over HTTP (not opened as a file).",
        "",
        "  • locally:  python3 -m http.server   then open http://localhost:8000",
        "  • or just visit the deployed site",
        "",
        "Then edit content.json to make it yours. Try: whoami · help",
      ],
    },
  };

  global.FS = {
    PROFILE: PROFILE,
    ART: ART,
    FALLBACK: FALLBACK,
    get USER() {
      return USER;
    },
    get HOST() {
      return HOST;
    },
    get HOME() {
      return HOME;
    },
    get ROOT() {
      return ROOT;
    },
    resolve: resolve,
    displayPath: displayPath,
    splitPath: splitPath,
    setManifest: setManifest,
  };
})(window);
