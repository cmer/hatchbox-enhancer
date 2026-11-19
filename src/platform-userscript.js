// Userscript platform: settings live in Tampermonkey/Violentmonkey storage, with optional
// sync across machines through a private GitHub Gist. Falls back to localStorage and fetch
// when the GM_* APIs are missing, which makes it possible to test by pasting the built
// script into the DevTools console.

function createUserscriptPlatform() {
  const API = 'https://api.github.com';
  const GIST_FILE = 'hatchbox-enhancer.json';
  const PUSH_DELAY = 1500;
  const PULL_THROTTLE = 15000;

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function get(key, fallback) {
    try {
      if (hasGM) {
        const v = GM_getValue(key);
        return v === undefined ? fallback : v;
      }
      const raw = localStorage.getItem('hbo:' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      if (hasGM) GM_setValue(key, value);
      else localStorage.setItem('hbo:' + key, JSON.stringify(value));
    } catch (_) { /* storage unavailable */ }
  }

  function http({ method, url, headers, body }) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method, url, headers, data: body, timeout: 20000,
          onload: (r) => resolve({ status: r.status, text: r.responseText }),
          onerror: () => reject(new Error('Network error talking to GitHub.')),
          ontimeout: () => reject(new Error('GitHub request timed out.')),
        });
      } else {
        fetch(url, { method, headers, body })
          .then(async (r) => resolve({ status: r.status, text: await r.text() }))
          .catch(() => reject(new Error('Network error talking to GitHub.')));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Gist sync
  // ---------------------------------------------------------------------------

  let current = null;              // latest config known to this tab
  let applyExternal = () => {};    // hands a newer config to the organizer
  let setSyncStatus = () => {};
  let state = 'off';
  let timer = null;
  let pulling = null;
  let lastPullAt = 0;

  const token = () => get('gistToken', '');
  const gistId = () => get('gistId', '');
  const isOn = () => !!(token() && gistId());
  const serialize = () => JSON.stringify(current || {}, null, 2);

  function report(next, message) {
    state = next;
    const fallback = {
      off: 'Sync is off. Click to sync across machines with GitHub.',
      ok: 'Synced with GitHub.',
      pending: 'Waiting to sync…',
      syncing: 'Syncing with GitHub…',
    }[next];
    setSyncStatus(next, message || fallback || '');
  }

  async function req(method, path, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token(),
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await http({ method, url: API + path, headers, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) throw new Error('GitHub rejected the token. It may have expired or been revoked.');
    if (r.status === 404 && path.startsWith('/gists/')) throw new Error('The sync gist was not found. It may have been deleted. Disconnect and connect again.');
    if (r.status === 403 || r.status === 404) throw new Error('GitHub refused the request. Make sure the token has the Gists read and write permission.');
    if (r.status < 200 || r.status >= 300) throw new Error(`GitHub API error (${r.status}).`);
    return r.text ? JSON.parse(r.text) : null;
  }

  async function findGist() {
    for (let page = 1; page <= 10; page++) {
      const list = await req('GET', `/gists?per_page=100&page=${page}`);
      const hit = list.find((g) => g.files && g.files[GIST_FILE]);
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    return null;
  }

  async function readRemote() {
    const g = await req('GET', '/gists/' + gistId());
    const f = g.files && g.files[GIST_FILE];
    if (!f) throw new Error(`The sync gist no longer contains ${GIST_FILE}.`);
    let content = f.content;
    if (f.truncated && f.raw_url) content = (await http({ method: 'GET', url: f.raw_url })).text;
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') throw new Error('The sync gist contains invalid data.');
    return parsed;
  }

  function adopt(remote) {
    current = remote;
    set('config', remote);
    applyExternal(remote);
  }

  async function push() {
    if (!isOn()) return;
    clearTimeout(timer);
    report('syncing');
    try {
      await req('PATCH', '/gists/' + gistId(), { files: { [GIST_FILE]: { content: serialize() } } });
      set('lastSynced', Date.now());
      report('ok');
    } catch (e) {
      report('error', e.message);
    }
  }

  function schedulePush() {
    if (!isOn()) return;
    clearTimeout(timer);
    report('pending');
    timer = setTimeout(push, PUSH_DELAY);
  }

  function pull() {
    if (!isOn()) return Promise.resolve();
    if (pulling) return pulling;
    lastPullAt = Date.now();
    report('syncing');
    pulling = (async () => {
      try {
        const remote = await readRemote();
        const remoteAt = Number(remote.updatedAt) || 0;
        const localAt = Number(current?.updatedAt) || 0;
        if (remoteAt > localAt) adopt(remote);
        else if (remoteAt < localAt) { await push(); return; }
        set('lastSynced', Date.now());
        report('ok');
      } catch (e) {
        report('error', e.message);
      } finally {
        pulling = null;
      }
    })();
    return pulling;
  }

  async function connect(newToken) {
    set('gistToken', newToken.trim());
    set('gistId', '');
    report('syncing');
    try {
      const id = await findGist();
      if (id) {
        set('gistId', id);
        const remote = await readRemote();
        const strip = (c) => JSON.stringify({ ...(c || {}), updatedAt: 0 });
        const localHasData = !!current && Number(current.updatedAt) > 0 &&
          ((current.groups || []).length > 0 || Object.keys(current.order || {}).length > 0);
        const groups = (remote.groups || []).length;
        const useRemote = !localHasData || strip(remote) === strip(current) || window.confirm(
          `Found your synced setup on GitHub (${groups} group${groups === 1 ? '' : 's'}).\n\n` +
          'OK: use the GitHub version in this browser.\nCancel: replace the GitHub version with this browser\'s setup.');
        if (useRemote) {
          adopt(remote);
        } else {
          current = { ...current, updatedAt: Date.now() };
          set('config', current);
          await push();
          return;
        }
      } else {
        if (!current) current = { version: 1, updatedAt: Date.now() };
        const g = await req('POST', '/gists', {
          description: 'Hatchbox Enhancer settings (managed by the userscript)',
          public: false,
          files: { [GIST_FILE]: { content: serialize() } },
        });
        set('gistId', g.id);
      }
      set('lastSynced', Date.now());
      report('ok');
    } catch (e) {
      set('gistToken', '');
      set('gistId', '');
      report('error', e.message);
    }
  }

  function disconnect() {
    clearTimeout(timer);
    set('gistToken', '');
    set('gistId', '');
    report('off');
  }

  // ---------------------------------------------------------------------------
  // Platform interface
  // ---------------------------------------------------------------------------

  return {
    syncIndicator: true,

    init(api) { setSyncStatus = api.setSyncStatus; },

    async load() {
      current = get('config', null);
      return current;
    },

    start() {
      report(isOn() ? 'ok' : 'off');
      pull();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastPullAt > PULL_THROTTLE) pull();
      });
    },

    save(cfg) {
      current = JSON.parse(JSON.stringify(cfg));
      set('config', current);
      schedulePush();
    },

    async getEnabled() { return get('enabled', true); },
    setEnabled(on) { set('enabled', on); },

    onExternalChange(cb) {
      applyExternal = cb;
      // Keeps other open Hatchbox tabs in step.
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener('config', (_key, _old, value, remote) => {
          if (!remote) return;
          current = value;
          cb(value);
        });
      }
    },

    renderSyncInfo(body, { el, timeAgo }) {
      const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener', style: 'color:var(--hbo-blue)' }, text);
      body.append(el('p', { class: 'hbo-help' },
        'Your setup is saved in this browser. To use it on other machines, sync it through a private GitHub Gist. ',
        'Changes push a moment after you make them and are pulled whenever you open this page.'));

      if (isOn()) {
        const busy = state === 'syncing' || state === 'pending';
        body.append(
          el('div', { class: 'hbo-status' },
            el('span', { class: 'hbo-dot' + (busy ? ' is-deploying' : state === 'error' ? ' is-failed' : '') }),
            el('span', {}, busy ? 'Syncing… ' : 'Connected. ', 'Last synced ', timeAgo(get('lastSynced', 0)), '. '),
            link('https://gist.github.com/' + gistId(), 'View gist')),
          el('p', { class: 'hbo-help', text: 'On another machine, install the userscript and paste a token here. It finds this gist automatically.' }),
          el('div', { class: 'hbo-row-actions' },
            el('button', { type: 'button', class: 'hbo-btn', disabled: busy, onclick: () => pull() }, 'Sync now'),
            el('button', { type: 'button', class: 'hbo-btn is-ghost is-danger', onclick: () => {
              if (window.confirm('Stop syncing in this browser? Your settings stay here and the gist is kept on GitHub.')) disconnect();
            } }, 'Disconnect')));
        return;
      }

      const connecting = state === 'syncing';
      body.append(el('ol', { class: 'hbo-ol' },
        el('li', {}, 'Open ', link('https://github.com/settings/personal-access-tokens/new', 'GitHub → Fine-grained tokens → Generate new token'), '.'),
        el('li', {}, 'Under ', el('b', { text: 'Account permissions' }), ', set ', el('b', { text: 'Gists' }), ' to ', el('b', { text: 'Read and write' }), '. Nothing else is needed.'),
        el('li', {}, 'Paste the token below. Do the same on each machine. They all find the same gist.')));
      const input = el('input', { class: 'hbo-input', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'GitHub token', disabled: connecting });
      const button = el('button', {
        type: 'button', class: 'hbo-btn is-primary', disabled: connecting,
        onclick: () => { if (input.value.trim()) connect(input.value); else input.focus(); },
      }, connecting ? 'Connecting…' : 'Connect');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') button.click(); });
      body.append(
        el('label', { class: 'hbo-field' }, 'GitHub token', input),
        el('div', { class: 'hbo-row-actions' }, button),
        el('p', { class: 'hbo-note', text: 'The token stays in this browser\'s userscript storage and is only sent to api.github.com. It is never written to the gist or to exports.' }));
    },
  };
}
