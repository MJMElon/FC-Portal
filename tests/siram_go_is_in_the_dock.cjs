/* Siram Go is one of the FC Portal dock's fanned actions, and the Worker
   Portal keeps it as a pill in its header.

   Renders the REAL FloatingDock with the auth context stubbed, fans it
   open, and asks: is Siram Go there, does it open the watering log in a
   new tab, and does the FC Portal column of Portal View & Function switch
   it off. The header half is read off the shipped sources.

   SHOT=/path.png draws the fan as it opens. */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '-> ' + JSON.stringify(extra) : ''); }
}

const URL = 'https://mjmelon.github.io/watering-log/form.html';
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const STUBS = [
  [/context\/AuthContext\.jsx$/, 'export function useAuth() { return window.__AUTH; }'],
  [/lib\/nelos\.js$/, 'export async function pendingCases() { return { rows: [], failed: false }; }', /FloatingDock\.jsx$/],
  [/lib\/verifyCount\.js$/, 'export async function pendingVerifyCount() { return 0; }', /FloatingDock\.jsx$/],
  [/modules\/palms\/officeConfig\.js$/, 'export function applyCachedOfficeConfig() {} export async function refreshOfficeConfig() {}'],
  [/components\/(PalmsWindow|NelosWindow|VerifyWindow|CullingWindow)\.jsx$/, 'export default function W() { return <div id="win" />; }'],
];
const stubPlugin = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer || !args.importer.startsWith(path.join(ROOT, 'src'))) return null;
      for (const [re, contents, from] of STUBS) {
        if (from && !from.test(args.importer)) continue;
        if (re.test(args.path)) return { path: args.path, namespace: 'stub', pluginData: contents };
      }
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.pluginData, loader: 'jsx', resolveDir: path.join(ROOT, 'src', 'components'),
    }));
  },
};

const ENTRY = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import FloatingDock from './components/FloatingDock.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
ReactDOM.createRoot(document.getElementById('root')).render(
  <HashRouter><LanguageProvider><FloatingDock /></LanguageProvider></HashRouter>
);`;

(async () => {
  console.log('1. the headers');
  const top = strip(fs.readFileSync(path.join(ROOT, 'src/components/TopNav.jsx'), 'utf8'));
  const wnav = strip(fs.readFileSync(path.join(ROOT, 'src/worker/WorkerNav.jsx'), 'utf8'));
  ok('the FC Portal header no longer carries Siram Go', !/Siram|SiramGo/.test(top));
  ok('the Worker Portal header still does, behind its switch', /siramGoOn\(company\)\s*&&\s*<SiramGoButton/.test(wnav));

  const built = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: path.join(ROOT, 'src'), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx' },
    define: { 'import.meta.env': '{"MODE":"test","DEV":false,"PROD":true}', 'process.env.NODE_ENV': '"development"' },
    plugins: [stubPlugin], logLevel: 'silent',
  });
  const bundle = built.outputFiles[0].text;
  /* CSS=<built .css> styles the fan for SHOT; the checks do not need it. */
  const css = process.env.CSS ? fs.readFileSync(process.env.CSS, 'utf8') : '';
  const browser = await chromium.launch();

  async function open(company) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ctx.route('**/*', (route) => {
      if (route.request().url().startsWith('http://harness.test/')) {
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: '<!doctype html><meta charset="utf-8"><style>' + css + '</style><div id="root"></div><script>' +
            bundle.replace(/<\/script/g, '<\\/script') + '</script>' });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'watering log' });
    });
    await page.addInitScript((company) => {
      window.__AUTH = { mayEnter: true, permissions: {}, company };
    }, company);
    await page.goto('http://harness.test/#/');
    await page.waitForSelector('[data-dock-trigger]', { timeout: 5000 }).catch(() => {});
    await page.click('[data-dock-trigger]').catch(() => {});
    await page.waitForTimeout(300);
    return { ctx, page, errors };
  }

  console.log('2. nothing saved: Siram Go is in the fan');
  {
    const { ctx, page, errors } = await open(null);
    const btn = page.locator('button[aria-label="Siram Go"]');
    ok('the fan carries Siram Go', (await btn.count()) === 1);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    const popup = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
    await btn.click().catch(() => {});
    const p = await popup;
    ok('pressing it opens the watering log in a new tab', !!p && p.url() === URL, p && p.url());
    ok('no window opens over the portal', (await page.locator('#win').count()) === 0);
    ok('and the fan folds', (await page.locator('button[aria-label="Siram Go"]').count()) === 0);
    ok('no page error', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('3. the FC Portal column switched off');
  {
    const { ctx, page } = await open({ modules: { siram_go: false }, actions: {} });
    ok('the fan does not carry Siram Go', (await page.locator('button[aria-label="Siram Go"]').count()) === 0);
    ok('the rest of the fan is still there', (await page.locator('button[aria-label="Nelos"]').count()) === 1);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
