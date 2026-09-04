import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const requiredFiles = ['dist/index.html', 'dist/favicon.svg'];
for (const file of requiredFiles) await access(file);

const html = await readFile('dist/index.html', 'utf8');
if (!html.includes('/favicon.svg')) throw new Error('dist/index.html is missing the favicon link.');
if (!html.includes('src="/assets/')) throw new Error('dist/index.html is missing the Vite asset entrypoint.');

const entrypoint = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
if (!entrypoint) throw new Error('dist/index.html is missing the JavaScript entrypoint.');
const bundle = await readFile(join('dist', entrypoint.slice(1)), 'utf8');
for (const forbidden of [/\blocalStorage\b/i, /\bsessionStorage\b/i, /cors[-_]?anywhere/i, /allorigins/i, /corsproxy/i]) {
  if (forbidden.test(bundle)) throw new Error(`Static bundle contains a forbidden browser integration: ${forbidden}`);
}

globalThis.console.log(`Static preflight passed: ${requiredFiles.length} required files verified.`);
