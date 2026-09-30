'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { resolvePuppeteerCacheDir, resolveChromeExecutable } = require('../exporter');

test('resolvePuppeteerCacheDir ignores an empty sandbox cache and uses ~/.cache/puppeteer', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pup-empty-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pup-home-'));
  fs.mkdirSync(path.join(home, 'chrome'));
  const resolved = resolvePuppeteerCacheDir({ envCache: tmp, homeCache: home });
  assert.equal(resolved, home);
});

test('resolvePuppeteerCacheDir keeps a cache that already has Chrome', () => {
  const env = fs.mkdtempSync(path.join(os.tmpdir(), 'pup-env-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pup-home2-'));
  fs.mkdirSync(path.join(env, 'chrome'));
  fs.mkdirSync(path.join(home, 'chrome'));
  const resolved = resolvePuppeteerCacheDir({ envCache: env, homeCache: home });
  assert.equal(resolved, env);
});

test('resolveChromeExecutable finds the cached Chrome for Testing binary', () => {
  const exe = resolveChromeExecutable(path.join(os.homedir(), '.cache', 'puppeteer'));
  assert.ok(exe);
  assert.match(exe, /Google Chrome for Testing$/);
  assert.equal(fs.existsSync(exe), true);
});
