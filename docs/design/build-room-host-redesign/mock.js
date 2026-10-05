/* Scales each 1440x900 screen to the window width (never up). No other
   behaviour: the mockups are static.
   Add #s1, #s2 … to a page's URL to see one screen alone, fitted to the
   window (for full-screen review or a screenshot); #s1 is the first. */
(function () {
  function solo() {
    var m = /^#s(\d+)$/.exec(location.hash || '');
    return m ? Number(m[1]) : 0;
  }
  function fit() {
    var n = solo();
    var wraps = document.querySelectorAll('.fit');
    document.body.classList.toggle('is-solo', Boolean(n));
    wraps.forEach(function (wrap, i) {
      var box = wrap.querySelector('.fit-box');
      if (!box) return;
      wrap.style.display = n && i !== n - 1 ? 'none' : '';
      box.style.transform = '';
      var w = box.scrollWidth, h = box.scrollHeight;
      var k = n
        ? Math.min(window.innerWidth / w, window.innerHeight / h)
        : Math.min(1, (wrap.clientWidth - 40) / w);
      box.style.transform = 'scale(' + k + ')';
      wrap.style.height = Math.ceil(h * k + (n ? 0 : 8)) + 'px';
    });
  }
  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', fit);
  window.addEventListener('load', fit);
  document.addEventListener('DOMContentLoaded', fit);
})();
