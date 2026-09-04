import { readFile, writeFile } from 'node:fs/promises';
import { argv, env } from 'node:process';
import { URL } from 'node:url';

const [, , templatePath, outputPath] = argv;
if (!templatePath || !outputPath) {
  throw new Error('Usage: node scripts/render-nginx.mjs <template> <output>');
}

const allowedOrigins = env.IPT_BMS_ALLOWED_ORIGINS?.trim() || 'https://hosxp.net https://had-api.moph.go.th';
const isOrigin = (value) => {
  try {
    const origin = new URL(value);
    return (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/';
  } catch {
    return false;
  }
};

if (!allowedOrigins.split(/\s+/).every(isOrigin)) {
  throw new Error('BMS_ALLOWED_ORIGINS must contain only space-separated http(s) origins.');
}

const template = await readFile(templatePath, 'utf8');
await writeFile(outputPath, template.replaceAll('__BMS_ALLOWED_ORIGINS__', allowedOrigins), 'utf8');
