/**
 * Guard: every component that calls t() must have useTranslation().
 *
 * Adding a translation key to a component without the hook throws the moment
 * it renders — and because Toast and ConfirmDialog are mounted app-wide, that
 * took the ENTIRE app into the error boundary rather than breaking one screen.
 * Cheap to check, expensive to miss.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p) : /\.jsx$/.test(p) && files.push(p);
  }
})('src');

const broken = files.filter(f => {
  const s = readFileSync(f, 'utf8');
  const usesT = /[^a-zA-Z0-9_.]t\(['`"]/.test(s);
  return usesT && !/useTranslation\(\)/.test(s);
});

if (broken.length) {
  console.log(`FAIL  ${broken.length} component(s) call t() without useTranslation():`);
  broken.forEach(b => console.log('   ' + b));
  process.exit(1);
}

/**
 * Second guard: having the hook is not enough — `t` must still BE the hook's t
 * where it is called.
 *
 * Toast.jsx passed the check above and still crashed the whole app:
 *
 *     const { t } = useTranslation();
 *     toasts.map((t) => …  aria-label={t('common.dismiss')} )
 *
 * The callback parameter shadowed the translation function, so t() invoked a
 * toast object. Because Toast is mounted app-wide, every toast anywhere took
 * the entire app into the error boundary — presenting as the opaque
 * "t2 is not a function", `t2` being esbuild's rename of the shadowing binding.
 *
 * So: find callbacks that bind a parameter named `t`, and fail if a t('…')
 * call appears inside that callback's body.
 */
const shadowed = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  if (!/useTranslation\(\)/.test(s)) continue;

  // A callback whose parameter list binds exactly `t`: (t) => , t => , (t, i) =>
  const binder = /(?:\(\s*t\s*(?:,[^)]*)?\)|(?<![\w.$])t)\s*=>/g;
  let m;
  while ((m = binder.exec(s))) {
    // Walk from the arrow to the end of the callback body, tracking depth so we
    // stop at the callback's own close rather than guessing a character window.
    let i = binder.lastIndex, depth = 0, body = '';
    for (; i < s.length; i++) {
      const c = s[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
      body += c;
    }
    if (/[^a-zA-Z0-9_.$]t\(\s*['"`]/.test(body)) {
      shadowed.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
    }
  }
}

if (shadowed.length) {
  console.log(`FAIL  ${shadowed.length} callback(s) shadow the translation function \`t\` and then call it:`);
  [...new Set(shadowed)].forEach(b => console.log('   ' + b));
  console.log('\n   Rename the parameter — calling it invokes the callback argument, not i18n.');
  process.exit(1);
}

console.log(`PASS  ${files.length} components checked — every t() has its hook, and none is shadowed`);
