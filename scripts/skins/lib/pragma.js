/**
 * Writing skin-allowance pragmas (the gate in __tests__/skinLiteralsPalette.test.js reads them).
 *
 *   stylesheet:  /* skin-allowance: colour=16 font=0 primary=3 *\/      line 1 of the file
 *   styles.css:  /* skin-allowance SC-03: colour=106 font=2 primary=44 *\/   the line above the unit banner
 *   .js/.jsx:    // skin-allowance: colour=4                            line 1 of the file
 *
 * A pragma is a comment: it never changes what a page paints. Values only ever go DOWN
 * (the codemod lowers them); raising one needs --allow-raise on seed-allowances.js.
 */
const S = require('./scan');
const { UNITS, unitRanges } = require('./units');

/** Set (or insert) a stylesheet's file pragma. */
function setFilePragma(css, fields) {
  const line = `/* skin-allowance: ${S.formatFields(fields)} */`;
  const first = css.match(/^\s*(\/\*[\s\S]*?\*\/)/);
  if (first && S.FILE_PRAGMA_RE.test(first[1])) {
    return css.replace(S.FILE_PRAGMA_RE, line);
  }
  return `${line}\n${css}`;
}

/** Remove a stylesheet's file pragma line (used when a file is clean and wants none). */
function dropFilePragma(css) {
  return css.replace(/^\/\*\s*skin-allowance:[^*]*\*\/\n/, '');
}

/** Set every styles.css unit marker; inserts missing markers above their banners. */
function setUnitPragmas(css, byUnit) {
  const marked = S.unitPragmas(css);
  if (marked.length) {
    let out = css;
    for (const m of marked) {
      if (!byUnit[m.unit]) continue;
      const re = new RegExp(`/\\*\\s*skin-allowance\\s+${m.unit}:[^*]*\\*/`);
      out = out.replace(re, `/* skin-allowance ${m.unit}: ${S.formatFields(byUnit[m.unit])} */`);
    }
    return out;
  }
  const lines = css.split('\n');
  const ranges = unitRanges(css);
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const r = ranges[i];
    const f = byUnit[r.id] || { colour: 0, font: 0, primary: 0 };
    lines.splice(r.from - 1, 0, `/* skin-allowance ${r.id}: ${S.formatFields(f)} */`);
  }
  return lines.join('\n');
}

function setJsxPragma(src, colour) {
  const line = `// skin-allowance: colour=${colour}`;
  if (S.JSX_PRAGMA_RE.test(src)) return src.replace(S.JSX_PRAGMA_RE, line);
  return `${line}\n${src}`;
}

module.exports = { setFilePragma, dropFilePragma, setUnitPragmas, setJsxPragma, UNITS };
