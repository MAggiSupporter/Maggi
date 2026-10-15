// Points the loader at the app build inside one commit and records that build's
// SHA-256 fingerprint, then rebuilds Code.gs so pasting it picks up the change.
// Commit the built apps-script/Index.html first, then:
//
//   node tools/pin.mjs <commit>     (default: HEAD)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root });
const sha = git('rev-parse', process.argv[2] || 'HEAD').toString().trim();
const committed = git('show', sha + ':phantom-calendar/apps-script/Index.html');
const local = fs.readFileSync(path.join(root, 'apps-script', 'Index.html'));
if (!committed.equals(local)) console.warn('Note: apps-script/Index.html differs from the copy in ' + sha.slice(0, 7) + '. The loader will use the committed one.');
const fingerprint = crypto.createHash('sha256').update(committed).digest('hex');

const loaderPath = path.join(root, 'apps-script', 'loader', 'Index.html');
let loader = fs.readFileSync(loaderPath, 'utf8');
loader = loader.replace(/var PIN = '[0-9a-f]{40}';/, "var PIN = '" + sha + "';")
  .replace(/var FINGERPRINT = '[0-9a-f]{64}';/, "var FINGERPRINT = '" + fingerprint + "';");
if (!loader.includes(sha) || !loader.includes(fingerprint)) throw new Error('Could not find PIN / FINGERPRINT in the loader.');
fs.writeFileSync(loaderPath, loader);
console.log('Loader pinned to ' + sha + ' (fingerprint ' + fingerprint.slice(0, 16) + '…)');
execFileSync('node', [path.join(root, 'tools', 'build.mjs')], { stdio: 'inherit' });
