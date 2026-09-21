/* Design-notes rail. Not part of the product surface — nothing here becomes
   React. Toggle with the button or the N key, matching the other mockup sets
   in docs/design. The choice is remembered per browser. */
(function () {
  var btn = document.getElementById('mkAnno');
  if (!btn) return;
  function set(off) {
    document.body.classList.toggle('mk-anno-off', off);
    document.body.classList.toggle('mk-anno-on', !off);
    btn.textContent = off ? 'Show design notes' : 'Hide design notes';
    try { localStorage.setItem('mkAnno', off ? '0' : '1'); } catch (e) {}
  }
  try { if (localStorage.getItem('mkAnno') === '0') set(true); } catch (e) {}
  btn.addEventListener('click', function () {
    set(!document.body.classList.contains('mk-anno-off'));
  });
  addEventListener('keydown', function (e) {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    set(!document.body.classList.contains('mk-anno-off'));
  });
})();
