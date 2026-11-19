// Browser-extension platform: settings live in chrome.storage.sync, so they follow the
// user's browser account to every machine. Large values are split into chunks to stay
// under the per-item quota.

function createExtensionPlatform() {
  const SYNC_KEYS = ['groups', 'assignments', 'order', 'expanded', 'collapsedGroups'];
  const CHUNK_CHARS = 1800; // JSON-escaped, this stays well under QUOTA_BYTES_PER_ITEM (8192)
  const WRITE_DELAY = 800;

  const sync = chrome.storage.sync;
  const local = chrome.storage.local;
  let lastWritten = {};  // storage key -> JSON string we last wrote or read
  let pending = null;
  let timer = null;
  let setSyncStatus = () => {};

  function alive() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  function encode(cfg) {
    const out = { meta: { version: cfg.version, updatedAt: cfg.updatedAt, bannerDismissed: !!cfg.bannerDismissed } };
    for (const key of SYNC_KEYS) {
      const json = JSON.stringify(cfg[key] ?? {});
      if (json.length <= CHUNK_CHARS) {
        out[key] = cfg[key] ?? {};
        continue;
      }
      const parts = [];
      for (let i = 0; i < json.length; i += CHUNK_CHARS) parts.push(json.slice(i, i + CHUNK_CHARS));
      out[key] = { __chunks: parts.length };
      parts.forEach((part, i) => { out[`${key}.${i}`] = part; });
    }
    return out;
  }

  function decode(items) {
    if (!items || !items.meta) return null;
    const cfg = { ...items.meta };
    for (const key of SYNC_KEYS) {
      const v = items[key];
      if (v && typeof v === 'object' && typeof v.__chunks === 'number') {
        let json = '';
        for (let i = 0; i < v.__chunks; i++) json += items[`${key}.${i}`] ?? '';
        try { cfg[key] = JSON.parse(json); } catch (_) { cfg[key] = {}; }
      } else {
        cfg[key] = v;
      }
    }
    return cfg;
  }

  function remember(items) {
    for (const [k, v] of Object.entries(items)) lastWritten[k] = JSON.stringify(v);
  }

  async function readAll(area) {
    const items = await area.get(null);
    return items || {};
  }

  async function flush() {
    timer = null;
    if (!pending || !alive()) return;
    const cfg = pending;
    pending = null;
    const encoded = encode(cfg);
    const changed = {};
    for (const [k, v] of Object.entries(encoded)) {
      if (lastWritten[k] !== JSON.stringify(v)) changed[k] = v;
    }
    try {
      // Record before writing: onChanged can fire before the write promise resolves,
      // and it must recognize these as our own changes.
      remember(changed);
      if (Object.keys(changed).length) await sync.set(changed);
      const existing = (await sync.getKeys?.()) ?? Object.keys(await readAll(sync));
      const stale = existing.filter((k) => /^\w+\.\d+$/.test(k) && !(k in encoded));
      stale.forEach((k) => delete lastWritten[k]);
      if (stale.length) await sync.remove(stale);
      await local.remove('fallback');
      setSyncStatus('ok');
    } catch (err) {
      // Most likely the sync quota. Keep a local copy so nothing is lost, and forget
      // what we think is stored so the next save rewrites every key.
      lastWritten = {};
      await local.set({ fallback: cfg }).catch(() => {});
      setSyncStatus('error', `Couldn't save to browser sync (${err?.message || err}). Your changes are saved on this machine only.`);
    }
  }

  return {
    init(api) { setSyncStatus = api.setSyncStatus; },

    async load() {
      const items = await readAll(sync);
      remember(items);
      const fromSync = decode(items);
      const { fallback } = await local.get('fallback');
      if (fallback && (!fromSync || Number(fallback.updatedAt) > Number(fromSync.updatedAt))) return fallback;
      return fromSync;
    },

    save(cfg) {
      pending = JSON.parse(JSON.stringify(cfg));
      clearTimeout(timer);
      timer = setTimeout(flush, WRITE_DELAY);
    },

    async getEnabled() {
      const { enabled } = await local.get('enabled');
      return enabled !== false;
    },

    setEnabled(on) {
      local.set({ enabled: on }).catch(() => {});
    },

    onExternalChange(cb) {
      let debounce = null;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const foreign = Object.entries(changes).some(([k, c]) => lastWritten[k] !== JSON.stringify(c.newValue));
        if (!foreign) return;
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          if (!alive()) return;
          const items = await readAll(sync);
          remember(items);
          cb(decode(items));
        }, 250);
      });
    },

    renderSyncInfo(body, { el }) {
      body.append(
        el('p', { class: 'hbo-help' },
          'Your groups, prefix rules and ordering sync automatically through your browser account. ',
          'Install the extension on your other machines and they show up there. There is nothing to set up.'),
        el('p', { class: 'hbo-help' },
          'This needs the browser to be signed in with sync on, and ', el('b', { text: 'Extensions' }),
          ' included in what it syncs (in Chrome: ', el('code', { text: 'chrome://settings/syncSetup' }), '). ',
          'Whether you\'re in Original view is remembered per machine.'),
        el('p', { class: 'hbo-help', text: 'To move a setup between different browsers (say Chrome and Firefox), use Import / Export.' }));
    },
  };
}
