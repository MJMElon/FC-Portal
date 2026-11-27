/* ONE ADDRESS, TWO PORTALS: THE FRONT DOOR ASKS WHICH FIRST.

   scan.mjmnursery.com is the FC Portal and the Worker Portal. Somebody not
   signed in is asked first -- Field Conductor or Worker -- and only then
   shown that portal's own login: the blue e-mail and password cover, or the
   ochre PIN cover at #/worker. After login nothing changes. A reset link and
   a signed-in account the gate refused skip the question, being FC answers.

   The REAL App.jsx, AuthContext, AuthScreen, PortalChooser and i18n are
   bundled and drawn; the Worker Portal behind #/worker is a marker.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/the_front_door_asks_which_portal.cjs */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright'));

const ROOT = path.resolve(__dirname, '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '\n         ' + JSON.stringify(extra) : '')); }
};

const CUSTOMER_MSG = 'This is the MJM Nursery staff system. Customer accounts cannot sign in here. ' +
  'Please use the MJM Nursery shop at https://www.mjmnursery.com';
const UNCHECKED_MSG = 'We could not check your account just now. Please check your connection and try again.';

/* The supabase client, as far as the auth gate reaches it. Every answer is
   read off window.__S at the moment it is asked, so a scenario is just a
   value set before the page loads. */
const SUPABASE_STUB = `
const S = () => window.__S;
const listeners = [];
function fire(ev, sess) { setTimeout(() => listeners.forEach((cb) => cb(ev, sess)), 0); }
function chain(table) {
  const q = {
    select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; },
    limit() { return q; }, range() { return q; }, gte() { return q; }, lte() { return q; },
    maybeSingle() { return answer(table); }, single() { return answer(table); },
    then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
  };
  return q;
}
async function answer(table) {
  if (table !== 'shared_profiles') return { data: null, error: null };
  window.__profileReads = (window.__profileReads || 0) + 1;
  const p = S().profile;
  if (S().profileDelay) await new Promise((r) => setTimeout(r, S().profileDelay));
  if (p === 'throw') throw new Error('Failed to fetch');
  return typeof p === 'function' ? p(window.__profileReads) : p;
}
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: S().session } }),
    onAuthStateChange(cb) {
      listeners.push(cb);
      fire('INITIAL_SESSION', S().session);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signOut() {
      window.__signOuts = (window.__signOuts || 0) + 1;
      S().session = null;
      fire('SIGNED_OUT', null);
      return { error: null };
    },
    async signInWithPassword() { return { data: null, error: { message: 'stub' } }; },
    async signUp() { return { error: null }; },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser() { return { error: null }; },
  },
  from: (t) => chain(t),
  storage: { from: () => ({}) },
  rpc: async () => ({ data: null, error: null }),
};
export async function fetchAllRows() { return { data: [], error: null }; }
`;

const DASHBOARD_STUB = `
export default function Dashboard() {
  window.__dash = (window.__dash || 0) + 1;
  return <div id="dashboard">DASHBOARD</div>;
}`;

const STUBS = [
  [/lib\/supabase\.js$/, SUPABASE_STUB],
  [/components\/Dashboard\.jsx$/, DASHBOARD_STUB],
  [/components\/FloatingDock\.jsx$/, 'export default function FloatingDock() { return null; }'],
  [/lib\/syncAll\.js$/, 'export function startAutoSync() {}'],
  [/(modules\/|worker\/WorkerPortal)/, 'export default function Behind() { return <div id="behind" />; }'],
];

const stubPlugin = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer || !args.importer.startsWith(path.join(ROOT, 'src'))) return null;
      for (const [re, contents] of STUBS) {
        if (re.test(args.path)) return { path: args.path, namespace: 'stub', pluginData: contents };
      }
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.pluginData, loader: 'jsx', resolveDir: path.join(ROOT, 'src'),
    }));
  },
};

const ENTRY = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
ReactDOM.createRoot(document.getElementById('root')).render(
  <HashRouter><LanguageProvider><AuthProvider><App /></AuthProvider></LanguageProvider></HashRouter>
);`;

const USER = { id: 'u-1', email: 'someone@example.com', user_metadata: {} };
const SESSION = { access_token: 'tok', refresh_token: 'r', user: USER };
const STAFF_PERMS = { modules: { scan: 'normal' } };
const PERMS_KEY = 'mjm_fc_permissions_v1';
const TOKEN_KEY = 'sb-stub-auth-token';

(async () => {
  const built = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: path.join(ROOT, 'src'), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx' },
    define: {
      'import.meta.env': '{"VITE_GEMINI_KEY":"","MODE":"test","DEV":false,"PROD":true}',
      'process.env.NODE_ENV': '"development"',
    },
    plugins: [stubPlugin],
    logLevel: 'silent',
  });
  const bundle = built.outputFiles[0].text;

  const browser = await chromium.launch();
  async function open(S, storage = {}, hash = '#/') {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script>' + bundle.replace(/<\/script/g, '<\\/script') + '</script>' }));
    await page.addInitScript(({ storage, S }) => { for (const k in storage) localStorage.setItem(k, storage[k]); window.__S = S; }, { storage, S });
    await page.goto('http://harness.test/' + hash);
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);

  console.log('\nNot signed in: the chooser comes first');
  {
    const { ctx, page, errors } = await open({ session: null, profile: { data: null, error: null } });
    ok('both choices are offered', await has(page, '[data-pick="fc"]') && await has(page, '[data-pick="worker"]'));
    ok('no login form is drawn yet', !(await has(page, 'input[type="password"]')));
    await page.click('[data-pick="fc"]'); await page.waitForTimeout(200);
    ok('Field Conductor shows the FC e-mail and password login',
      await has(page, 'input[type="email"]') && await has(page, 'input[type="password"]'));
    ok('…on the same address', (await page.evaluate(() => location.hash)) === '#/');
    ok('…with a way back to the chooser', await has(page, '[data-back-to-chooser]'));
    await page.click('[data-back-to-chooser]'); await page.waitForTimeout(200);
    ok('back returns to the chooser', await has(page, '[data-pick="worker"]'));
    await page.click('[data-pick="worker"]'); await page.waitForTimeout(300);
    ok('Worker goes to the Worker Portal', (await page.evaluate(() => location.hash)) === '#/worker' && await has(page, '#behind'));
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\nEvery front-door cover can switch EN and BM');
  {
    const { ctx, page } = await open({ session: null, profile: { data: null, error: null } });
    ok('the chooser carries the switch', await has(page, '.bk-lang [data-lang="ms"]'));
    await page.click('.bk-lang [data-lang="ms"]'); await page.waitForTimeout(150);
    const txt = await page.evaluate(() => document.body.textContent);
    ok('BM changes the chooser words', /Portal yang mana\?/.test(txt) && /Pekerja/.test(txt), txt.slice(0, 200));
    ok('…and is remembered for after login', (await page.evaluate(() => localStorage.getItem('mjm.lang'))) === 'ms');
    await page.click('[data-pick="fc"]'); await page.waitForTimeout(150);
    ok('the FC login carries the switch too, still on BM',
      await has(page, '.bk-lang [data-lang="ms"].on') && /Portal FC/.test(await page.evaluate(() => document.body.textContent)));
    await page.click('.bk-lang [data-lang="en"]'); await page.waitForTimeout(150);
    ok('EN switches it back', /FC Portal/.test(await page.evaluate(() => document.body.textContent)));
    await ctx.close();
  }

  console.log('\nSigned in staff: straight in, no chooser');
  {
    const { ctx, page } = await open({ session: SESSION, profile: { data: { role: 'staff', user_type: 'staff', permissions: STAFF_PERMS }, error: null } },
      { [TOKEN_KEY]: JSON.stringify(SESSION) });
    ok('the dashboard opens', await has(page, '#dashboard'));
    ok('the chooser is never drawn', !(await has(page, '[data-pick]')));
    await ctx.close();
  }

  console.log('\nSigned in with no operations access: the FC cover and its note');
  {
    const { ctx, page } = await open({ session: SESSION, profile: { data: { role: 'user', user_type: 'staff', permissions: {} }, error: null } },
      { [TOKEN_KEY]: JSON.stringify(SESSION) });
    ok('the FC login is shown, not the chooser', await has(page, 'input[type="password"]') && !(await has(page, '[data-pick]')));
    await ctx.close();
  }

  console.log('\nThe source');
  const wc = fs.readFileSync(path.join(ROOT, 'src/worker/WorkerCover.jsx'), 'utf8');
  ok('the Worker PIN cover carries the language switch', /<CoverLang \/>/.test(wc));
  ok('the Worker PIN cover has a way back to the chooser', /data-back-to-chooser/.test(wc) && /navigate\('\/'\)/.test(wc));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
