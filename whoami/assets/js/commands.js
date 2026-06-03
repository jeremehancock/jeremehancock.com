/* =========================================================================
 * commands.js — every command the shell understands.
 * Exposes a single global: window.Commands  (a name -> spec map)
 *
 * A command spec looks like:
 *   {
 *     group, summary, usage, description, examples?, see?, hidden?,
 *     run: function (ctx) { ... return htmlString|undefined }
 *   }
 *
 * ctx = { cmd, args[], rawArgs, term, print(html) }
 * ========================================================================= */
(function (global) {
  'use strict';

  var FS = global.FS;
  var U = global.U;
  var c = U.color;
  var P = FS.PROFILE;

  /* Mark output as ASCII art: it must not word-wrap (it shrinks / scrolls
   * to fit narrow screens instead). The terminal reads the `.art` flag. */
  function art(html) { return { html: html, art: true }; }

  /* ------------------------------------------------------------------ *
   * shared rendering helpers
   * ------------------------------------------------------------------ */

  // A line of plain text -> escaped + linkified (so URLs/emails are clickable)
  function text(line) { return U.linkify(U.esc(line)); }

  // An explicit clickable link with custom display text.
  function anchor(url, label) {
    return '<a href="' + U.esc(url) + '" target="_blank" rel="noopener noreferrer">' +
      U.esc(label) + '</a>';
  }

  // Colour a filesystem entry name based on what it is.
  function paintEntry(name, node, classify) {
    if (node.type === 'dir') {
      return c.blue(name) + (classify ? c.blue('/') : '');
    }
    if (/\.(md|sh)$/.test(name)) { return c.green(name); }
    if (name.charAt(0) === '.') { return c.dim(name); }
    return U.esc(name);
  }

  function notFound(cmd, path) {
    return c.red(cmd + ': ' + path + ': No such file or directory');
  }

  // Render an absolute uptime gap as "1h 2m 3s"
  function fmtUptime(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60);   s -= m * 60;
    var out = [];
    if (h) { out.push(h + 'h'); }
    if (m || h) { out.push(m + 'm'); }
    out.push(s + 's');
    return out.join(' ');
  }

  /* ------------------------------------------------------------------ *
   * the registry
   * ------------------------------------------------------------------ */
  var COMMANDS = {};
  function def(name, spec) { spec.name = name; COMMANDS[name] = spec; }

  /* ---- help -------------------------------------------------------- */
  def('help', {
    group: 'Getting around',
    summary: 'show this list of commands',
    usage: 'help',
    description: 'Print every command this shell knows, grouped by theme.\n' +
      'Run `man <command>` for the full manual on any one of them.',
    run: function () {
      var order = ['Getting around', 'Reading', 'About me', 'System', 'Fun'];
      var groups = {};
      Object.keys(COMMANDS).forEach(function (k) {
        var s = COMMANDS[k];
        if (s.hidden) { return; }
        (groups[s.group] = groups[s.group] || []).push(s);
      });
      var out = [c.dim('Commands — try ') + c.accent('man <command>') +
                 c.dim(' for details:'), ''];
      order.forEach(function (g) {
        if (!groups[g]) { return; }
        out.push(c.bold(g));
        groups[g].sort(function (a, b) { return a.name < b.name ? -1 : 1; })
          .forEach(function (s) {
            out.push('  ' + c.green(U.pad(s.name, 10)) + c.dim(s.summary));
          });
        out.push('');
      });
      out.push(c.dim('Tip: <Tab> completes names & paths, up/down replays history.'));
      return out.join('\n');
    }
  });

  /* ---- ls ---------------------------------------------------------- */
  def('ls', {
    group: 'Getting around',
    summary: 'list directory contents',
    usage: 'ls [-a] [-l] [path]',
    description: 'List the files and directories at PATH (default: here).\n\n' +
      '  -a   also show hidden entries (the ones starting with a dot)\n' +
      '  -l   long format, one entry per line with details',
    examples: 'ls\nls -la\nls projects',
    see: 'cd, cat, tree',
    run: function (ctx) {
      var all = false, long = false, target = null, i;
      for (i = 0; i < ctx.args.length; i++) {
        var a = ctx.args[i];
        if (a.charAt(0) === '-' && a.length > 1) {
          if (a.indexOf('a') > -1) { all = true; }
          if (a.indexOf('l') > -1) { long = true; }
        } else { target = a; }
      }
      var r = FS.resolve(ctx.term.cwd, target);
      if (!r.ok) { return notFound('ls', target); }
      if (r.node.type === 'file') {
        // ls on a file just prints its name
        return paintEntry(r.parts[r.parts.length - 1], r.node, false);
      }
      var names = Object.keys(r.node.children);
      if (all) { names = ['.', '..'].concat(names); }
      else { names = names.filter(function (n) { return n.charAt(0) !== '.'; }); }
      names.sort();
      if (!names.length) { return ''; }

      if (long) {
        return names.map(function (n) {
          var node = (n === '.' || n === '..')
            ? { type: 'dir' } : r.node.children[n];
          var isDir = node.type === 'dir';
          var perms = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
          var size = isDir ? 4096 : node.content.length;
          return c.dim(perms) + '  ' + c.dim(U.pad('' + size, 5)) + '  ' +
                 paintEntry(n, node, true);
        }).join('\n');
      }
      return names.map(function (n) {
        var node = (n === '.' || n === '..')
          ? { type: 'dir' } : r.node.children[n];
        return paintEntry(n, node, true);
      }).join('   ');
    }
  });

  /* ---- cd ---------------------------------------------------------- */
  def('cd', {
    group: 'Getting around',
    summary: 'change the current directory',
    usage: 'cd [path]',
    description: 'Move into PATH. With no argument, go home (~).\n' +
      'The usual tricks work: `cd ..`, `cd /`, `cd ~`, relative paths.',
    examples: 'cd projects\ncd ..\ncd ~',
    see: 'ls, pwd',
    run: function (ctx) {
      var target = ctx.args[0] || FS.HOME;
      var r = FS.resolve(ctx.term.cwd, target);
      if (!r.ok) { return c.red('cd: ' + target + ': No such file or directory'); }
      if (r.node.type !== 'dir') {
        return c.red('cd: ' + target + ': Not a directory');
      }
      ctx.term.setCwd(r.path);
      return undefined;
    }
  });

  /* ---- pwd --------------------------------------------------------- */
  def('pwd', {
    group: 'Getting around',
    summary: 'print the current directory',
    usage: 'pwd',
    description: 'Print the full path of the directory you are standing in.',
    run: function (ctx) { return U.esc(ctx.term.cwd); }
  });

  /* ---- tree -------------------------------------------------------- */
  def('tree', {
    group: 'Getting around',
    summary: 'show the directory tree',
    usage: 'tree [path]',
    description: 'Draw PATH (default: here) as a tree, the way the `tree`\n' +
      'command does on a real box.',
    see: 'ls',
    run: function (ctx) {
      var r = FS.resolve(ctx.term.cwd, ctx.args[0]);
      if (!r.ok) { return notFound('tree', ctx.args[0]); }
      if (r.node.type !== 'dir') { return paintEntry(r.parts[r.parts.length - 1], r.node, false); }
      var lines = [c.blue(FS.displayPath(r.path))];
      var nDirs = 0, nFiles = 0;
      (function walk(node, prefix) {
        var keys = Object.keys(node.children)
          .filter(function (n) { return n.charAt(0) !== '.'; }).sort();
        keys.forEach(function (n, idx) {
          var last = idx === keys.length - 1;
          var child = node.children[n];
          lines.push(prefix + (last ? '`-- ' : '|-- ') + paintEntry(n, child, false));
          if (child.type === 'dir') {
            nDirs++;
            walk(child, prefix + (last ? '    ' : '|   '));
          } else { nFiles++; }
        });
      })(r.node, '');
      lines.push('');
      lines.push(c.dim(nDirs + ' director' + (nDirs === 1 ? 'y' : 'ies') +
        ', ' + nFiles + ' file' + (nFiles === 1 ? '' : 's')));
      return art(lines.join('\n'));
    }
  });

  /* ---- cat --------------------------------------------------------- */
  def('cat', {
    group: 'Reading',
    summary: 'print the contents of a file',
    usage: 'cat <file> [file...]',
    description: 'Dump one or more files to the screen. This is how you read\n' +
      'everything on the site.',
    examples: 'cat README.md\ncat about/bio.txt',
    see: 'ls, cd',
    run: function (ctx) {
      if (!ctx.args.length) { return c.red('cat: missing file operand'); }
      var out = [];
      ctx.args.forEach(function (p) {
        var r = FS.resolve(ctx.term.cwd, p);
        if (!r.ok) { out.push(notFound('cat', p)); return; }
        if (r.node.type === 'dir') { out.push(c.red('cat: ' + p + ': Is a directory')); return; }
        out.push(U.linkify(U.esc(r.node.content)));
      });
      return out.join('\n');
    }
  });

  /* ---- man --------------------------------------------------------- */
  def('man', {
    group: 'Reading',
    summary: 'show the manual for a command',
    usage: 'man <command>',
    description: 'Display the manual page for COMMAND — what it does, how to\n' +
      'call it, and what it pairs well with.',
    examples: 'man ls\nman whoami',
    see: 'help, whatis',
    run: function (ctx) {
      var name = ctx.args[0];
      if (!name) { return c.red('What manual page do you want? (try: man ls)'); }
      var s = COMMANDS[name];
      if (!s) { return c.red('No manual entry for ' + name); }
      var L = [];
      function section(title, body) {
        L.push(c.bold(title));
        body.split('\n').forEach(function (ln) { L.push('       ' + text(ln)); });
        L.push('');
      }
      L.push(c.dim(name.toUpperCase() + '(1)') + U.pad('', 24) +
             c.dim('whoami shell manual'));
      L.push('');
      section('NAME', name + ' - ' + s.summary);
      section('SYNOPSIS', s.usage || name);
      if (s.description) { section('DESCRIPTION', s.description); }
      if (s.examples) { section('EXAMPLES', s.examples); }
      if (s.see) { section('SEE ALSO', s.see); }
      L.pop(); // trailing blank
      return L.join('\n');
    }
  });

  /* ---- whatis ------------------------------------------------------ */
  def('whatis', {
    group: 'Reading',
    summary: 'one-line description of a command',
    usage: 'whatis <command>',
    description: 'Print the short, one-line summary of COMMAND.',
    see: 'man, help',
    run: function (ctx) {
      var name = ctx.args[0];
      if (!name) { return c.red('whatis: missing command name'); }
      var s = COMMANDS[name];
      if (!s) { return name + ': nothing appropriate.'; }
      return c.green(U.pad(name, 12)) + c.dim('(1)  - ') + s.summary;
    }
  });

  /* ---- whoami ------------------------------------------------------ */
  def('whoami', {
    group: 'About me',
    summary: 'who is this site about?',
    usage: 'whoami',
    description: 'On a normal machine this prints your username. Here it\n' +
      'prints the short version of me — the person who built this.',
    see: 'neofetch, cat',
    run: function () {
      var bar = c.accent('|');
      var L = ['', bar + '  ' + U.wrap(c.accent(P.name), 'bold')];

      var roleLine = P.role || '';
      if (P.location) { roleLine += (roleLine ? '  ·  ' : '') + P.location; }
      if (roleLine) { L.push(bar + '  ' + c.dim(roleLine)); }

      if (P.tagline) { L.push('', '   ' + c.cyan('“' + P.tagline + '”')); }
      L.push('');

      // links: use profile.links if present, else fall back to github/email
      var links = Array.isArray(P.links) ? P.links.slice() : [];
      if (!links.length) {
        if (P.github) { links.push({ label: 'github', value: P.github, url: P.github }); }
        if (P.email) { links.push({ label: 'email', value: P.email, url: 'mailto:' + P.email }); }
      }
      links.forEach(function (ln) {
        L.push('   ' + c.dim(U.pad(ln.label, 10)) + anchor(ln.url, ln.value || ln.url));
      });
      if (P.shell) { L.push('   ' + c.dim(U.pad('shell', 10)) + P.shell + ' (this thing)'); }

      L.push('', '   ' + c.dim('more ->  ') + c.green('cat about/bio.txt') +
        c.dim('  ·  ') + c.green('ls projects'));
      return L.join('\n');
    }
  });

  /* ---- neofetch ---------------------------------------------------- */
  def('neofetch', {
    group: 'About me',
    summary: 'system info, the flashy way',
    usage: 'neofetch',
    description: 'The obligatory screenshot command: a little logo next to a\n' +
      'block of "system" info about this site.',
    see: 'whoami, uname',
    run: function (ctx) {
      var logo = FS.ART.logo;
      var width = logo.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
      function field(label, value) {
        return c.yellow(U.pad(label, 11)) + value;
      }
      var site = (P.links || []).filter(function (l) {
        return /^(site|blog|website)$/.test(l.label);
      })[0];
      var info = [
        c.green(FS.USER) + '@' + c.green(FS.HOST),
        c.dim('-----------------'),
        field('OS', 'whoami-web (pure JS)'),
        field('Host', P.name),
        site ? field('Web', site.value) : null,
        field('Kernel', '6.18.5-vanilla-js'),
        field('Shell', (P.shell || 'jsh') + ' 1.0'),
        field('Uptime', fmtUptime(Date.now() - ctx.term.bootTime)),
        field('Resolution', window.innerWidth + 'x' + window.innerHeight),
        field('Theme', ctx.term.themeName),
        field('Terminal', 'jsh'),
        field('CPU', 'Caffeine @ ' + (new Date().getHours() < 12 ? 'low' : 'high')),
        '',
        ['clr-red','clr-yellow','clr-green','clr-cyan','clr-blue','clr-magenta']
          .map(function (k) { return U.wrap('###', k); }).join('')
      ].filter(function (x) { return x !== null; });
      var rows = Math.max(logo.length, info.length), out = [], i;
      for (i = 0; i < rows; i++) {
        var l = logo[i] !== undefined ? c.accent(U.pad(logo[i], width)) : U.pad('', width);
        var r = info[i] !== undefined ? info[i] : '';
        out.push(l + '   ' + r);
      }
      return art(out.join('\n'));
    }
  });

  /* ---- clear ------------------------------------------------------- */
  def('clear', {
    group: 'System',
    summary: 'clear the screen',
    usage: 'clear',
    description: 'Wipe the terminal clean. (Ctrl+L does the same thing.)',
    run: function (ctx) { ctx.term.clearScreen(); return undefined; }
  });

  /* ---- reset ------------------------------------------------------- */
  def('reset', {
    group: 'System',
    summary: 'start fresh, like you just opened the page',
    usage: 'reset',
    description: 'Reset the terminal to a clean slate: clear the screen and\n' +
      'scrollback, return to the home directory, forget this session\'s\n' +
      'command history, and replay the welcome banner. Unlike `clear`, this\n' +
      'wipes your place and history too — exactly as if you had just opened\n' +
      'the page. (Your theme is kept.)',
    see: 'clear, motd',
    run: function (ctx) { ctx.term.reset(); return undefined; }
  });

  /* ---- echo -------------------------------------------------------- */
  def('echo', {
    group: 'System',
    summary: 'print a line of text',
    usage: 'echo [text...]',
    description: 'Print TEXT back out. Quotes are respected.',
    examples: 'echo hello world\necho "spaces  kept"',
    run: function (ctx) { return text(ctx.args.join(' ')); }
  });

  /* ---- date -------------------------------------------------------- */
  def('date', {
    group: 'System',
    summary: 'show the current date and time',
    usage: 'date',
    description: 'Print the current local date and time.',
    run: function () {
      var d = new Date();
      return U.esc(d.toDateString() + ' ' + d.toLocaleTimeString());
    }
  });

  /* ---- history ----------------------------------------------------- */
  def('history', {
    group: 'System',
    summary: 'show command history',
    usage: 'history',
    description: 'List the commands you have run this session, each with a\n' +
      'number. Re-run one with a "!" history expansion:\n\n' +
      '  !n       run command number n        (e.g. !3)\n' +
      '  !!       run the last command\n' +
      '  !-2      run the command two back\n' +
      '  !text    run the most recent command starting with "text"\n\n' +
      'You can also press up/down at the prompt to walk through history.',
    examples: 'history\n!1\n!!\n!cat',
    see: 'clear, reset',
    run: function (ctx) {
      var h = ctx.term.history;
      if (!h.length) { return c.dim('(no history yet)'); }
      return h.map(function (cmd, i) {
        return c.dim(U.pad('' + (i + 1), 4)) + U.esc(cmd);
      }).join('\n');
    }
  });

  /* ---- uname ------------------------------------------------------- */
  def('uname', {
    group: 'System',
    summary: 'print system information',
    usage: 'uname [-a]',
    description: 'Print the kernel string. With -a, print everything.',
    run: function (ctx) {
      var full = ctx.args.indexOf('-a') > -1;
      if (full) {
        return U.esc('whoami-web 6.18.5-vanilla-js #1 SMP PREEMPT ' +
          'x86_64 x86_64 x86_64 GNU/JavaScript');
      }
      return 'whoami-web';
    }
  });

  /* ---- uptime ------------------------------------------------------ */
  def('uptime', {
    group: 'System',
    summary: 'how long this session has been up',
    usage: 'uptime',
    description: 'Show how long this terminal has been open.',
    run: function (ctx) {
      var d = new Date();
      return ' ' + d.toLocaleTimeString() + '  up ' +
        fmtUptime(Date.now() - ctx.term.bootTime) +
        ',  1 user,  load average: 0.07, 0.05, 0.00';
    }
  });

  /* ---- theme ------------------------------------------------------- */
  def('theme', {
    group: 'System',
    summary: 'change the colour scheme',
    usage: 'theme [name]',
    description: 'Switch the terminal palette. Run with no name to list the\n' +
      'available themes. Your choice is remembered next time.',
    examples: 'theme\ntheme amber\ntheme matrix',
    run: function (ctx) {
      var themes = ctx.term.themes;
      var name = ctx.args[0];
      if (!name) {
        return c.dim('Available themes (current: ') + c.accent(ctx.term.themeName) +
          c.dim('):') + '\n  ' + themes.map(function (t) {
            return t === ctx.term.themeName ? c.accent(t) : c.green(t);
          }).join('   ') + '\n\n' + c.dim('Use:  theme <name>');
      }
      if (themes.indexOf(name) === -1) {
        return c.red('theme: unknown theme "' + name + '"') + '\n' +
          c.dim('try one of: ') + themes.join(', ');
      }
      ctx.term.setTheme(name);
      return c.dim('Theme set to ') + c.accent(name) + c.dim('.');
    }
  });

  /* ---- motd -------------------------------------------------------- */
  def('motd', {
    group: 'System',
    summary: 'reprint the welcome banner',
    usage: 'motd',
    description: 'Print the message of the day — the banner you saw on load.',
    run: function (ctx) { ctx.term.printMotd(); return undefined; }
  });

  /* ---- banner ------------------------------------------------------ */
  def('banner', {
    group: 'Fun',
    summary: 'print the big ASCII banner',
    usage: 'banner',
    description: 'Print the giant "whoami" ASCII banner, because why not.',
    run: function () { return art(c.accent(FS.ART.whoami)); }
  });

  /* ---- cowsay ------------------------------------------------------ */
  def('cowsay', {
    group: 'Fun',
    summary: 'a cow says something',
    usage: 'cowsay [text...]',
    description: 'An ASCII cow speaks your mind. A unix rite of passage.',
    examples: 'cowsay moo\ncowsay hire this developer',
    run: function (ctx) {
      var msg = ctx.args.join(' ') || 'mooo';
      var top = ' ' + '_'.repeat(msg.length + 2);
      var bot = ' ' + '-'.repeat(msg.length + 2);
      // escape the whole frame so the < > of the speech bubble are literal
      return art(U.esc([top, '< ' + msg + ' >', bot, FS.ART.cow].join('\n')));
    }
  });

  /* ---- sudo (easter egg) ------------------------------------------- */
  def('sudo', {
    group: 'Fun', hidden: true,
    summary: 'execute a command as the superuser',
    usage: 'sudo <command>',
    description: 'Nice try.',
    run: function (ctx) {
      if (/make me a sandwich/i.test(ctx.rawArgs)) {
        return c.green('Okay.') + '  🥪  ' + c.dim('(see: xkcd 149)');
      }
      return c.red(FS.USER + ' is not in the sudoers file.  ') +
        c.dim('This incident has been reported. 👀');
    }
  });

  /* ---- vim / nano (easter eggs) ------------------------------------ */
  function editorTrap(name) {
    return {
      group: 'Fun', hidden: true,
      summary: 'open the ' + name + ' editor',
      usage: name + ' [file]',
      description: 'Opens ' + name + '. Exiting is left as an exercise.',
      run: function () {
        return c.dim('Launching ' + name + '...') + '\n' +
          c.yellow('Just kidding — this is a read-only filesystem.') + '\n' +
          c.dim('(But yes, the trick is ') + c.green(':q!') +
          c.dim(' / ') + c.green('Ctrl-X') + c.dim('. You\'re welcome.)');
      }
    };
  }
  def('vim', editorTrap('vim'));
  def('vi', editorTrap('vi'));
  def('nano', editorTrap('nano'));
  def('emacs', editorTrap('emacs'));

  /* ---- rm (easter egg) --------------------------------------------- */
  def('rm', {
    group: 'Fun', hidden: true,
    summary: 'remove files',
    usage: 'rm [-rf] <path>',
    description: 'Pretends to delete things. It will not.',
    run: function (ctx) {
      if (/-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r/.test(ctx.args.join(' ')) &&
          /\s\/(\s|$)|\s\/\*/.test(' ' + ctx.rawArgs)) {
        return c.red('rm: it takes a brave soul to `rm -rf /` a stranger\'s site.') +
          '\n' + c.dim('Filesystem is read-only. Nothing happened. We\'re all fine.');
      }
      return c.dim('rm: this filesystem is read-only — nothing was removed.');
    }
  });

  /* ---- exit / logout (easter eggs) --------------------------------- */
  function exitTrap() {
    return {
      group: 'Fun', hidden: true,
      summary: 'leave the shell',
      usage: 'exit',
      description: 'Attempts to log out. There is no logging out of who you are.',
      run: function () {
        return c.dim('logout') + '\n' +
          c.yellow('There is no escape — this is whoami, after all.') + '\n' +
          c.dim('(Close the tab the old-fashioned way.)');
      }
    };
  }
  def('exit', exitTrap());
  def('logout', exitTrap());
  def('quit', exitTrap());

  /* ---- ping (easter egg) ------------------------------------------- */
  def('ping', {
    group: 'Fun', hidden: true,
    summary: 'are you there?',
    usage: 'ping [host]',
    description: 'Pong.',
    run: function (ctx) {
      var host = ctx.args[0] || 'localhost';
      return [
        'PING ' + U.esc(host) + ' (127.0.0.1): 56 data bytes',
        '64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.042 ms',
        '64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.038 ms',
        c.green('pong.') + c.dim('  (I\'m here. Try: whoami)')
      ].join('\n');
    }
  });

  global.Commands = COMMANDS;
})(window);
