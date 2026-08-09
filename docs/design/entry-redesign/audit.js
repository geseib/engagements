/* ---------------------------------------------------------------------------
   Checks over a rendered entry-redesign page.

   Each check is a pure function of (document, window) and knows nothing about
   how the page got there, so they port into component tests unchanged — the
   same property the host set's audit.js was written for.

   Every check here exists because it can fail. E2/E8 were written first and
   caught a 13px input; E4 caught three tap targets under 44px; E6 caught a red
   border that had crept into an error state. A check that has never failed on
   this codebase is not evidence of anything.
   --------------------------------------------------------------------------- */
(function (root) {

  // ---- colour -------------------------------------------------------------
  function parse(c) {
    var m = /^rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function over(fg, bg) {                       // composite fg (with alpha) on bg
    var a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a),
             b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function lum(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function ratio(a, b) {
    var l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  // The effective background is whatever you would actually see through the
  // stack of translucent fills this design uses for its notices.
  function bgOf(el, win) {
    var stack = [], n = el;
    while (n && n.nodeType === 1) {
      var c = parse(win.getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      n = n.parentElement;
    }
    var out = { r: 15, g: 26, b: 46, a: 1 };     // --bg, the page floor
    for (var i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  }

  function textNodes(doc) {
    var out = [], w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    var t;
    while ((t = w.nextNode())) {
      if (!t.nodeValue.trim()) continue;
      var el = t.parentElement;
      if (!el || el.closest('[aria-hidden="true"]')) continue;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      if (!el.getClientRects().length) continue;
      out.push(el);
    }
    return out.filter(function (e, i, a) { return a.indexOf(e) === i; });
  }

  function label(el) {
    var t = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    var txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46);
    return t + id + (txt ? ' — "' + txt + (txt.length >= 46 ? '…' : '') + '"' : '');
  }

  // ---- checks -------------------------------------------------------------
  var CHECKS = {

    E1: { name: 'the page never scrolls sideways', run: function (doc, win) {
      var f = [];
      if (doc.documentElement.scrollWidth > win.innerWidth + 1)
        f.push('document scrollWidth ' + doc.documentElement.scrollWidth +
               ' > viewport ' + win.innerWidth);
      [].forEach.call(doc.querySelectorAll('*'), function (el) {
        var r = el.getBoundingClientRect();
        if (r.width && r.right > win.innerWidth + 1.5)
          f.push(label(el) + ' extends ' + Math.round(r.right - win.innerWidth) + 'px past the edge');
      });
      return f.slice(0, 6);
    }},

    E2: { name: 'no text below the 13px floor', run: function (doc) {
      var f = [];
      textNodes(doc).forEach(function (el) {
        var s = parseFloat(getComputedStyle(el).fontSize);
        if (s < 12.5) f.push(label(el) + ' at ' + s.toFixed(1) + 'px');
      });
      return f.slice(0, 6);
    }},

    E3: { name: 'every string clears WCAG AA against what is behind it', run: function (doc, win) {
      var f = [];
      textNodes(doc).forEach(function (el) {
        var cs = win.getComputedStyle(el);
        var fg = parse(cs.color); if (!fg) return;
        var bg = bgOf(el, win);
        var c = ratio(over(fg, bg), bg);
        var size = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight, 10) || 400;
        var large = size >= 24 || (size >= 18.66 && wt >= 700);
        var need = large ? 3 : 4.5;
        if (c < need - 0.01)
          f.push(label(el) + ' — ' + c.toFixed(2) + ':1, needs ' + need + ':1 at ' +
                 size.toFixed(0) + 'px/' + wt);
      });
      return f.slice(0, 8);
    }},

    E4: { name: 'every control is at least 44px tall', run: function (doc) {
      var f = [];
      var sel = 'button, .btn, .chip, input, select, textarea, summary, [role="button"]';
      [].forEach.call(doc.querySelectorAll(sel), function (el) {
        if (!el.getClientRects().length) return;
        if (getComputedStyle(el).opacity === '0') return;   // the hidden code field
        var r = el.getBoundingClientRect();
        if (r.height < 43.5) f.push(label(el) + ' is ' + r.height.toFixed(0) + 'px tall');
      });
      return f.slice(0, 6);
    }},

    E5: { name: 'every field has a name a screen reader can read', run: function (doc) {
      var f = [];
      [].forEach.call(doc.querySelectorAll('input, select, textarea'), function (el) {
        if (el.type === 'hidden' || el.hidden) return;
        var named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
          (el.id && doc.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
        if (!named) f.push(label(el) + ' has no label');
      });
      return f;
    }},

    E6: { name: 'red is used for destructive actions and nothing else', run: function (doc, win) {
      var f = [], red = /229,\s*100,\s*94/;
      [].forEach.call(doc.querySelectorAll('*'), function (el) {
        var cs = win.getComputedStyle(el);
        ['color', 'borderTopColor', 'borderLeftColor', 'backgroundColor'].forEach(function (p) {
          if (red.test(cs[p]) && cs[p] !== 'rgba(0, 0, 0, 0)')
            f.push(label(el) + ' uses --danger in ' + p);
        });
      });
      return f.slice(0, 5);
    }},

    E7: { name: 'one h1 per screen', run: function (doc) {
      var panels = doc.querySelectorAll('.panel');
      if (panels.length) {
        var f = [];
        [].forEach.call(panels, function (p, i) {
          var n = p.querySelectorAll('h1').length;
          if (n !== 1) f.push('panel ' + (i + 1) + ' has ' + n + ' h1');
        });
        return f;
      }
      var n = doc.querySelectorAll('h1').length;
      return n === 1 ? [] : ['page has ' + n + ' h1 elements'];
    }},

    E8: { name: 'no text input under 16px (iOS zooms the page under it)', run: function (doc, win) {
      var f = [];
      [].forEach.call(doc.querySelectorAll('input, textarea, select'), function (el) {
        if (el.type === 'hidden' || el.hidden) return;
        var s = parseFloat(win.getComputedStyle(el).fontSize);
        if (s < 16) f.push(label(el) + ' at ' + s.toFixed(1) + 'px');
      });
      return f;
    }},

    E9: { name: 'nothing is clipped without saying so', run: function (doc, win) {
      var f = [];
      [].forEach.call(doc.querySelectorAll('*'), function (el) {
        // A single-line form control is a scrollable viewport by specification
        // and the caret moves through it, so a long value inside one is not
        // silent clipping. It is still a real problem when we are asking the
        // user to check that value — the fix for that is copy (echo the string
        // as wrapping text next to the field), not a taller input, so it does
        // not belong to this check.
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
        var cs = win.getComputedStyle(el);
        if (cs.overflow === 'visible' && cs.overflowX === 'visible') return;
        if (!el.getClientRects().length) return;
        var declares = cs.textOverflow === 'ellipsis' ||
                       cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
        if (declares) return;
        if (el.scrollWidth > el.clientWidth + 1)
          f.push(label(el) + ' clips ' + (el.scrollWidth - el.clientWidth) + 'px horizontally');
        if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll')
          f.push(label(el) + ' clips ' + (el.scrollHeight - el.clientHeight) + 'px vertically');
      });
      return f.slice(0, 6);
    }}
  };

  root.ENTRY_AUDIT = {
    checks: CHECKS,
    run: function (doc, win) {
      var out = [];
      Object.keys(CHECKS).forEach(function (k) {
        var fails;
        try { fails = CHECKS[k].run(doc, win) || []; }
        catch (e) { fails = ['check threw: ' + e.message]; }
        out.push({ id: k, name: CHECKS[k].name, fails: fails });
      });
      return out;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
