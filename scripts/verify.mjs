#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];
const warnings = [];

function expectFile(relPath, label = relPath) {
  if (!fs.existsSync(path.join(root, relPath))) {
    failures.push(`Missing required file: ${label}`);
  }
}

for (const relPath of [
  'src/main.ts',
  'src/preload.ts',
  'src/gateway.ts',
  'renderer/status.html',
  'build/tray-icon.png',
  'docs/launch-readiness.md',
  'docs/windows-packaging.md',
]) {
  expectFile(relPath);
}

if (pkg.main !== 'dist/main.js') {
  failures.push(`package.json main should be dist/main.js, found ${pkg.main}`);
}

const scripts = pkg.scripts ?? {};
for (const name of ['build', 'typecheck', 'pack']) {
  if (!scripts[name]) {
    failures.push(`Missing npm script: ${name}`);
  }
}

const build = pkg.build ?? {};
const winTargets = build.win?.target ?? [];
if (!Array.isArray(winTargets) || !winTargets.includes('nsis')) {
  failures.push('electron-builder win.target should include nsis');
}

if (!build.win?.icon) {
  warnings.push('No build.win.icon configured; packaged app will fall back to the default Electron icon.');
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
if (readme.includes('renderer/dist/')) {
  failures.push('README references renderer/dist/, but package.json currently packages renderer/**/* directly.');
}

const launchReadiness = fs.readFileSync(path.join(root, 'docs/launch-readiness.md'), 'utf8');
for (const staleClaim of [
  'Start-minimized setting added',
  'Settings persistence added',
  'Notification helper added',
  'Auto-launch integration point added as a visible placeholder',
]) {
  if (launchReadiness.includes(staleClaim)) {
    failures.push(`launch-readiness.md contains stale claim: ${staleClaim}`);
  }
}

const packagingDoc = fs.readFileSync(path.join(root, 'docs/windows-packaging.md'), 'utf8');
if (packagingDoc.includes('portable')) {
  failures.push('windows-packaging.md references a portable target, but package.json currently only configures nsis.');
}

const result = { ok: failures.length === 0, failures, warnings };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
