#!/usr/bin/env node
// Write site/precache.json: every file the app needs offline (code, styles, config, calibration,
// icons). The service worker caches this list on install. Run by the dev server and by the deploy
// workflow, so it never goes stale.
import { readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../site/', import.meta.url));
const INCLUDE = /\.(html|js|css|json|webmanifest|png|svg|woff2|ico)$/;
// Launch screens are read by iOS when the app is added to the Home Screen, never by the page;
// icon-1024 is the archive size, only for stores.
const EXCLUDE = /^(sw\.js|precache\.json|data\/brief\.|data\/ratings\/|data\/elo\/|icons\/splash-|icons\/icon-1024\.png)/;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(relative(ROOT, p).split('\\').join('/'));
  }
  return out;
}

export async function writePrecache() {
  const files = (await walk(ROOT)).filter((f) => INCLUDE.test(f) && !EXCLUDE.test(f)).sort();
  await writeFile(join(ROOT, 'precache.json'), `${JSON.stringify({ files }, null, 1)}\n`);
  return files.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writePrecache().then((n) => console.log(`precache.json: ${n} files`));
}
