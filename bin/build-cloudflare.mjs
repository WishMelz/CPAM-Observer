import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const staging = await mkdtemp(join(tmpdir(), 'cpam-observer-cf-'));
const environment = {
  ...process.env,
  CPA_MANAGER_URL: '',
  CPA_MANAGER_KEY: '',
  CPAM_VIEWER_KEY: '',
  CPAM_COOKIE_SECURE: '',
  CPAM_PUBLIC_ORIGIN: '',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  WRANGLER_SEND_METRICS: 'false',
};

try {
  console.log('Building in an isolated directory without local environment files.');
  for (const entry of [
    'package.json', 'package-lock.json', 'next.config.ts', 'open-next.config.ts',
    'wrangler.jsonc', 'tsconfig.json', 'src', 'public', 'node_modules',
  ]) {
    await cp(join(root, entry), join(staging, entry), { recursive: true, mode: constants.COPYFILE_FICLONE });
  }
  const adapter = JSON.parse(await readFile(join(staging, 'node_modules/@opennextjs/cloudflare/package.json'), 'utf8'));
  const cli = join(staging, 'node_modules/@opennextjs/cloudflare', adapter.bin['opennextjs-cloudflare']);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'build'], { cwd: staging, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Cloudflare build exited with ${code}`)));
  });
  const compiledEnvironment = await import(pathToFileURL(join(staging, '.open-next/cloudflare/next-env.mjs')));
  for (const mode of ['production', 'development', 'test']) {
    assert.equal(Object.keys(compiledEnvironment[mode]).length, 0, 'Build must not contain local environment values');
  }
  await rm(join(root, '.open-next'), { recursive: true, force: true });
  await cp(join(staging, '.open-next'), join(root, '.open-next'), { recursive: true });
  console.log('Worker ready in .open-next; configuration must be supplied at runtime.');
} finally {
  await rm(staging, { recursive: true, force: true });
}