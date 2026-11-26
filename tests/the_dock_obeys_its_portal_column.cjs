/* The dock (the M coin) obeys the column of the portal it is drawn over.

   The office found Culling Calculator, NELOS and PALMS unticked in the
   Worker Portal column of System Setting and still on the dock in the
   Worker Portal. Renders the REAL FloatingDock with the auth context and
   the database stubbed, on the FC Portal and on the Worker Portal, and asks
   which actions the fan carries. */
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

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const STUBS = [
  [/context\/AuthContext\.jsx$/, 'export function useAuth() { return window.__AUTH; }'],
  [/lib\/supabase\.js$/, 'export const supabase = { from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: window.__WORKER_COL, error: null }) }; return q; } };', /FloatingDock\.jsx$/],
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


const LABELS = { palms: 'PALMS', nelos: 'Nelos', culling: null, verify: null, mata: 'Mata Malam', siram: 'Siram Go' };

(async () => {
  console.log('0. the keys');
  const ps = fs.readFileSync(path.join(ROOT, 'src/lib/portalSettings.js'), 'utf8');
  const office = path.resolve(ROOT, '..', 'mjm-ai-system', 'scan', 'scan_system_setting.html');
  if (fs.existsSync(office)) {
    const o = fs.readFileSync(office, 'utf8');
    const block = (ps.split('export const DOCK_ACTION_KEY')[1] || '').split('};')[0];
    const keys = [...block.matchAll(/^\s+\w+: '(\w+)',$/gm)].map((m) => m[1]);
    const cols = ['fc', 'worker'].map((c) => {
      const m = o.match(new RegExp('\\b' + c + ': \\[([\\s\\S]*?)\\n  \\]'));
      return m ? m[1] : '';
    });
    const missing = [];
    keys.forEach((k) => cols.forEach((c, i) => { if (!c.includes("key:'" + k + "'")) missing.push((i ? 'worker:' : 'fc:') + k); }));
    ok('every dock key is a row in both columns of System Setting', keys.length === 6 && !missing.length, { keys, missing });
  } else {
    console.log('  (office repository not beside this one, key check skipped)');
  }

  {
    const wnav = fs.readFileSync(path.join(ROOT, 'src/worker/WorkerNav.jsx'), 'utf8');
    ok('the Worker Portal header drops Mata Malam where the coin carries it',
      /worker && !inCoin && \(\s*<button\s+onClick=\{\(\) => openMataMalam/.test(wnav));
    ok('and Siram Go', /worker && !inCoin && siramGoOn\(company\) && <SiramGoButton/.test(wnav));
    ok('the coin is there exactly when a staff account is signed in', /const inCoin = !!mayEnter;/.test(wnav));
  }

  const built = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: path.join(ROOT, 'src'), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx' },
    define: { 'import.meta.env': '{"MODE":"test","DEV":false,"PROD":true}', 'process.env.NODE_ENV': '"development"' },
    plugins: [stubPlugin], logLevel: 'silent',
  });
  const bundle = built.outputFiles[0].text;
  const browser = await chromium.launch();

  async function fan(hash, company, workerCol) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ctx.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script>' +
        bundle.replace(/<\/script/g, '<\\/script') + '</script>' }));
    await page.addInitScript(([company, workerCol]) => {
      window.__AUTH = { mayEnter: true, permissions: {}, company };
      window.__WORKER_COL = workerCol;
    }, [company, workerCol]);
    await page.goto('http://harness.test/' + hash);
    await page.waitForTimeout(400);
    const trigger = (await page.locator('[data-dock-trigger]').count()) === 1;
    if (trigger) { await page.click('[data-dock-trigger]'); await page.waitForTimeout(300); }
    const labels = await page.$$eval('button[aria-label]:not([data-dock-trigger])', (bs) => bs.map((b) => b.getAttribute('aria-label')));
    await ctx.close();
    return { trigger, labels, errors };
  }
  const has = (r, l) => r.labels.includes(l);
  const OFF3 = { modules: { palms: false, culling: false, nelos: false }, actions: {} };

  console.log('1. FC Portal, nothing saved: the whole fan');
  const all = await fan('#/', null, OFF3);
  ok('six actions', all.labels.length === 6, all.labels);
  ok('no page error', !all.errors.length, all.errors);

  console.log('2. Worker Portal, PALMS, Culling and NELOS unticked for workers');
  const w = await fan('#/worker', null, OFF3);
  ok('no PALMS', !has(w, 'PALMS'), w.labels);
  ok('no NELOS', !has(w, 'Nelos'), w.labels);
  ok('no Culling Calculator', w.labels.length === 3, w.labels);
  ok('Mata Malam and Siram Go still there', has(w, 'Mata Malam') && has(w, 'Siram Go'), w.labels);

  console.log('3. the FC Portal does not read the worker column');
  const f = await fan('#/', null, OFF3);
  ok('all six still on the FC Portal', f.labels.length === 6, f.labels);

  console.log('4. the FC column unticked hides it on the FC Portal');
  const f2 = await fan('#/', { modules: { nelos: false, verify: false }, actions: {} }, null);
  ok('no NELOS', !has(f2, 'Nelos'), f2.labels);
  ok('four left', f2.labels.length === 4, f2.labels);

  console.log('5. everything unticked: no coin at all');
  const none = await fan('#/worker', null, { modules: { palms: false, culling: false, nelos: false, verify: false, mata_malam: false, siram_go: false }, actions: {} });
  ok('the coin is not drawn', !none.trigger);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
