// Zero-dependency build: copy src → dist, stamp service-worker cache version and precache list.
import { readdirSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const SRC = 'src', OUT = 'dist';
rmSync(OUT, { recursive: true, force: true });
const files = [];
(function walk(dir) { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } })(SRC);
const hash = createHash('sha256');
for (const f of files.sort()) {
  const rel = relative(SRC, f); const dest = join(OUT, rel);
  mkdirSync(join(dest, '..'), { recursive: true });
  if (rel !== 'sw.js') { copyFileSync(f, dest); hash.update(rel); hash.update(readFileSync(f)); }
}
const version = hash.digest('hex').slice(0, 10);
const assets = ['./', ...files.map(f => './' + relative(SRC, f).split('\\').join('/')).filter(a => a !== './sw.js' && !a.endsWith('.LICENSE') && !a.endsWith('.md')).sort()];
const sw = readFileSync(join(SRC, 'sw.js'), 'utf8').replace('__BUILD_VERSION__', version).replace('__ASSET_LIST__', JSON.stringify(assets, null, 2));
writeFileSync(join(OUT, 'sw.js'), sw);
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`Built ${files.length} files → ${OUT}/ (cache version ${version}, ${assets.length} precached)`);
