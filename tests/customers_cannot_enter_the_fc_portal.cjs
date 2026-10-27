/* ALL STAFF SYSTEM. A CUSTOMER ONLY SEES THE SALES WEB AND THE CUSTOMER PORTAL.

   A Sales Web customer signs in with an ordinary Supabase account -- the
   same project, the same auth -- so nothing about the ACCOUNT keeps them
   out of the FC Portal. The profile does: shared_profiles.user_type is
   'customer'. Such a login is refused, told where its shop is, and signed
   out, and no dashboard is ever drawn for it.

   The gate also used to fail OPEN on anything: `ok` started true and only a
   read that came back clean could make it false, so a read that RETURNED
   { error } -- which is how supabase-js reports nearly every failure --
   let anybody in. A returned error is now a thrown one, and either is
   answered from this phone's own copy of THIS person's staff access (a
   Field Conductor loses signal for hours and must still open the portal)
   or, with no such copy, not answered at all: the session is kept and the
   screen says the account could not be checked.

   The REAL App.jsx, AuthContext.jsx, AuthScreen.jsx and i18n are bundled
   through the esbuild that ships with Vite and drawn in a real browser.
   Only the supabase client is a stub, plus the screens behind the door
   (the dashboard is a marker that counts every time it is drawn), because
   what is being asked is whether the door opens, not what is behind it.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/customers_cannot_enter_the_fc_portal.cjs */
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

  /* One page per scenario. `storage` is what the phone already holds;
     `S` is how the stubbed server answers. */
  async function scenario(title, { storage = {}, S }, wait = 900) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script>' +
        bundle.replace(/<\/script/g, '<\\/script') + '</script>',
    }));
    await page.addInitScript(({ storage, S }) => {
      for (const k in storage) localStorage.setItem(k, storage[k]);
      window.__S = S;
    }, { storage, S });
    await page.goto('http://harness.test/#/');
    await page.waitForTimeout(wait);
    const state = await page.evaluate((keys) => ({
      dash: window.__dash || 0,
      signOuts: window.__signOuts || 0,
      reads: window.__profileReads || 0,
      text: document.body.innerText,
      hash: location.hash,
      token: localStorage.getItem(keys.TOKEN_KEY),
      perms: localStorage.getItem(keys.PERMS_KEY),
    }), { TOKEN_KEY, PERMS_KEY });
    console.log('\n' + title);
    if (errors.length) console.log('  (page errors: ' + errors.join(' | ') + ')');
    return { page, ctx, state };
  }

  const signedIn = { [TOKEN_KEY]: JSON.stringify(SESSION) };

  /* ── 1. A customer, signed in on this phone. The read is slow on purpose:
        the dashboard must not be drawn while it is out either. ── */
  {
    const { ctx, state } = await scenario('A Sales Web customer is refused and signed out', {
      storage: signedIn,
      S: { session: SESSION, profileDelay: 300,
           profile: { data: { role: 'user', user_type: 'customer', permissions: {} }, error: null } },
    });
    ok('the dashboard is never drawn', state.dash === 0, state.dash);
    ok('they are signed out', state.signOuts >= 1, state.signOuts);
    ok('…and the token is gone from this phone', state.token === null);
    ok('…and so is any remembered access', state.perms === null);
    ok('the refusal is on screen, word for word', state.text.includes(CUSTOMER_MSG), state.text);
    ok('…and nothing of the sign-in form is', !/Login|Password/.test(state.text), state.text);
    await ctx.close();
  }

  /* ── 2. A customer who left an OLD cached copy behind (written before this
        rule, when the cache was kept for everybody) -- still never drawn. ── */
  {
    const { ctx, state } = await scenario('A customer with an old cached copy is still refused', {
      storage: { ...signedIn, [PERMS_KEY]: JSON.stringify({ userId: USER.id, permissions: {} }) },
      S: { session: SESSION, profileDelay: 300,
           profile: { data: { role: 'user', user_type: 'customer', permissions: {} }, error: null } },
    });
    ok('the dashboard is never drawn', state.dash === 0, state.dash);
    ok('they are signed out and told', state.signOuts >= 1 && state.text.includes(CUSTOMER_MSG));
    await ctx.close();
  }

  /* ── 3. The read RETURNS an error and the phone holds nothing for them. ── */
  {
    const { page, ctx, state } = await scenario('A returned { error } with nothing cached does not let anybody in', {
      storage: signedIn,
      S: { session: SESSION, profile: { data: null, error: { message: 'permission denied', code: '42501' } } },
    });
    ok('the dashboard is never drawn', state.dash === 0, state.dash);
    ok('the could-not-check message is on screen', state.text.includes(UNCHECKED_MSG), state.text);
    ok('…with a way to try again', /Try again/.test(state.text), state.text);
    ok('nobody is signed out -- a failed check is not a sign-out', state.signOuts === 0, state.signOuts);
    ok('…and the session is still on the phone', state.token !== null);

    // The line comes back: Try again asks once more, and a staff answer opens the door.
    await page.evaluate((perms) => {
      window.__S.profile = { data: { role: 'staff', user_type: 'staff', permissions: perms }, error: null };
    }, STAFF_PERMS);
    await page.click('button:has-text("Try again")');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ dash: window.__dash || 0, hash: location.hash, reads: window.__profileReads, text: document.body.innerText }));
    ok('Try again, with a line, lets a staff account in', after.dash > 0 && after.hash === '#/dashboard', after);
    await ctx.close();
  }

  /* ── 4. A THROWN failure behaves the same. ── */
  {
    const { ctx, state } = await scenario('A thrown failure with nothing cached is the same answer', {
      storage: signedIn, S: { session: SESSION, profile: 'throw' },
    });
    ok('the dashboard is never drawn', state.dash === 0, state.dash);
    ok('the could-not-check message is on screen', state.text.includes(UNCHECKED_MSG), state.text);
    ok('nobody is signed out', state.signOuts === 0);
    await ctx.close();
  }

  /* ── 5. A returned error, but this phone holds THIS person's staff access. ── */
  {
    const { ctx, state } = await scenario('A returned { error } with this person’s cached staff access goes in', {
      storage: { ...signedIn, [PERMS_KEY]: JSON.stringify({ userId: USER.id, permissions: STAFF_PERMS }) },
      S: { session: SESSION, profile: { data: null, error: { message: 'Failed to fetch' } } },
    });
    ok('the dashboard is drawn', state.dash > 0 && state.hash === '#/dashboard', state);
    ok('no could-not-check message', !state.text.includes(UNCHECKED_MSG));
    ok('nobody is signed out', state.signOuts === 0);
    await ctx.close();
  }

  /* ── 6. …but SOMEBODY ELSE's cached access is no use to them. ── */
  {
    const { ctx, state } = await scenario('Another person’s cached access does not stand in', {
      storage: { ...signedIn, [PERMS_KEY]: JSON.stringify({ userId: 'u-other', permissions: STAFF_PERMS }) },
      S: { session: SESSION, profile: { data: null, error: { message: 'Failed to fetch' } } },
    });
    ok('the dashboard is never drawn', state.dash === 0, state.dash);
    ok('the could-not-check message is on screen', state.text.includes(UNCHECKED_MSG), state.text);
    await ctx.close();
  }

  /* ── 7. Staff, online, nothing cached. ── */
  {
    const { ctx, state } = await scenario('Staff go in', {
      storage: signedIn,
      S: { session: SESSION, profileDelay: 200,
           profile: { data: { role: 'staff', user_type: 'staff', permissions: STAFF_PERMS }, error: null } },
    });
    ok('the dashboard is drawn', state.dash > 0 && state.hash === '#/dashboard', state);
    ok('nobody is signed out', state.signOuts === 0);
    ok('…and their access is kept for the next offline start',
       !!state.perms && JSON.parse(state.perms).userId === USER.id);
    await ctx.close();
  }

  /* ── 8. Signed in, no staff access, not a customer: the old no-access
        answer, with no dashboard drawn first. ── */
  {
    const { ctx, state } = await scenario('No operations access: the old answer, and no dashboard first', {
      storage: signedIn,
      S: { session: SESSION, profileDelay: 300,
           profile: { data: { role: 'user', user_type: 'staff', permissions: {} }, error: null } },
    });
    ok('the dashboard is never drawn', state.dash === 0, state.dash);
    ok('the no-access note is on the sign-in screen',
       /does not yet have operations access/.test(state.text), state.text);
    ok('nobody is signed out (unchanged behaviour)', state.signOuts === 0);
    await ctx.close();
  }

  /* ── 9. Staff with cached access, read still out: offline-first, straight in. ── */
  {
    const { ctx, state } = await scenario('Cached staff access opens the portal before the read answers', {
      storage: { ...signedIn, [PERMS_KEY]: JSON.stringify({ userId: USER.id, permissions: STAFF_PERMS }) },
      S: { session: SESSION, profileDelay: 60000,
           profile: { data: { role: 'staff', user_type: 'staff', permissions: STAFF_PERMS }, error: null } },
    }, 600);
    ok('the dashboard is drawn without waiting', state.dash > 0 && state.hash === '#/dashboard', state);
    await ctx.close();
  }

  /* The source still says what the gate asks for. */
  const authSrc = fs.readFileSync(path.join(ROOT, 'src', 'context', 'AuthContext.jsx'), 'utf8');
  console.log('\nThe source');
  ok('the profile read asks for user_type', /\.select\('[^']*user_type[^']*'\)/.test(authSrc));
  ok('no gate starts on "allowed"', !/let ok = true/.test(authSrc));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
