/* Shared family collection.
 *
 * Wraps the local DB so the rest of the app doesn't change:
 *  - Every phone keeps a full local copy (works offline, opens instantly).
 *  - Changes are queued and uploaded to the family collection on Supabase.
 *  - On open, on return to the app, and every minute, the phone pulls what others changed.
 * A phone joins by entering the family code in Settings. Without a code it works on its own as before.
 */
(() => {
  const Local = LocalDB;
  const SHARED = ['settings', 'wants', 'sets', 'history', 'badges'];
  const META = '__sync';
  let photoLinks = {}; // image key -> signed link for photos stored on the server
  let status = { state: 'local', detail: '' };
  let queue = Promise.resolve();
  let pulling = null;
  let joining = false;

  // ---------- helpers ----------
  const localCode = async () => (await Local.getSetting('settings'))?.familyCode || '';
  const meta = async () => ({ cards: [], deleted: [], kv: [], joined: '', version: null, ...((await Local.getSetting(META)) || {}) });
  const saveMeta = (m) => Local.putSetting(META, m);
  const joined = async () => {
    if (!Online.configured()) return false;
    const code = await localCode();
    return !!code && (await meta()).joined === code;
  };
  const call = async (action, body, code) =>
    Online.call('collection', { familyCode: code || (await localCode()), query: { action }, body });
  const isWrongCode = (err) => /family code/i.test(err?.message || '');
  const D = () => window.Dugout;

  function setStatus(state, detail = '') {
    status = { state, detail, at: Date.now() };
    renderStatus();
  }

  async function renderStatus() {
    const badge = document.getElementById('syncBadge');
    const footer = document.getElementById('syncFooter');
    if (!badge || !footer) return;
    if (!Online.configured()) { badge.hidden = true; return; }
    const m = await meta();
    const waiting = m.cards.length + m.deleted.length + m.kv.length;
    const views = {
      local: ['📱 Not shared yet · tap to share', 'Cards you add are only on this phone. Tap the badge at the top (or open Settings) and enter the family code so the whole family sees one collection.'],
      syncing: ['🔄 Syncing…', 'Syncing with the family collection…'],
      synced: ['☁️ Family collection', 'Everyone in the family sees this collection. It updates by itself.'],
      offline: [`⚠️ Offline${waiting ? ` · ${waiting} waiting` : ''}`, `Can't reach the family collection right now. ${waiting ? 'Your changes are saved on this phone and will upload when you are back online.' : 'Showing the copy saved on this phone.'}`],
      error: ['⚠️ Sync problem', status.detail || 'Something went wrong syncing.'],
    };
    const [b, f] = views[status.state] || views.local;
    badge.hidden = false;
    badge.textContent = b;
    badge.dataset.state = status.state;
    footer.textContent = f;
  }

  // ---------- pushing local changes ----------
  async function mark(kind, id) {
    const m = await meta();
    if (!m[kind].includes(id)) m[kind].push(id);
    if (kind === 'deleted') m.cards = m.cards.filter((x) => x !== id);
    if (kind === 'cards') m.deleted = m.deleted.filter((x) => x !== id);
    await saveMeta(m);
  }

  async function pushNow() {
    if (!(await joined())) return;
    const m = await meta();
    if (!m.cards.length && !m.deleted.length && !m.kv.length) return;
    setStatus('syncing');
    for (const id of [...m.deleted]) {
      await call('delete-card', { id });
      m.deleted = m.deleted.filter((x) => x !== id);
      await saveMeta(m);
    }
    const local = new Map((await Local.allCards()).map((c) => [c.id, c]));
    for (const id of [...m.cards]) {
      const card = local.get(id);
      if (card) {
        const images = {};
        for (const key of [card.frontImg, card.backImg]) {
          if (!key || photoLinks[key]) continue; // already on the server
          const blob = await Local.getImage(key);
          if (blob) images[key] = { media_type: blob.type || 'image/jpeg', data: await Online.blobToBase64(blob) };
        }
        const r = await call('put-card', { card, images });
        Object.assign(photoLinks, r.images || {});
      }
      m.cards = m.cards.filter((x) => x !== id);
      await saveMeta(m);
    }
    for (const key of [...m.kv]) {
      await call('put-kv', { key, value: await Local.getSetting(key) });
      m.kv = m.kv.filter((x) => x !== key);
      await saveMeta(m);
    }
  }

  // Runs pushes one at a time; never throws (status shows problems instead).
  function push() {
    queue = queue.then(pushNow).then(
      () => { if (status.state === 'syncing' || status.state === 'offline') setStatus('synced'); },
      (err) => setStatus(isWrongCode(err) ? 'error' : 'offline', err.message),
    );
    return queue;
  }

  // ---------- pulling the family collection ----------
  async function pullNow() {
    await push();
    setStatus('syncing');
    const r = await call('sync');
    photoLinks = r.images || {};
    const m = await meta();
    const pending = new Set(m.cards);
    const deleted = new Set(m.deleted);
    const remote = new Map(r.cards.map((c) => [c.id, c]));

    // Cards: the family collection wins, except for this phone's not-yet-uploaded changes.
    for (const c of await Local.allCards()) {
      if (remote.has(c.id) || pending.has(c.id)) continue;
      await Local.deleteCard(c.id);
      for (const key of [c.frontImg, c.backImg]) if (key) await Local.deleteImage(key);
    }
    for (const c of r.cards) if (!pending.has(c.id) && !deleted.has(c.id)) await Local.putCard(c);

    // Family-wide settings and lists.
    for (const key of SHARED) {
      if (m.kv.includes(key)) continue; // local change still waiting to upload
      if (key in (r.kv || {})) {
        let value = r.kv[key];
        if (key === 'settings') value = { ...((await Local.getSetting('settings')) || {}), ...(value || {}), familyCode: await localCode() };
        await Local.putSetting(key, value);
      } else if ((await Local.getSetting(key)) != null) {
        if (!m.kv.includes(key)) m.kv.push(key); // first phone to join seeds the family copy
      }
    }
    m.version = r.version;
    await saveMeta(m);
    if (m.kv.length) push();
    setStatus('synced');
  }

  async function pull() {
    if (!pulling) pulling = pullNow().catch((err) => setStatus(isWrongCode(err) ? 'error' : 'offline', err.message)).finally(() => (pulling = null));
    return pulling;
  }

  // Cheap check for changes made on other phones.
  async function checkForChanges() {
    if (!(await joined()) || document.visibilityState !== 'visible' || joining) return;
    await push();
    try {
      const { version } = await call('version');
      if (version && version !== (await meta()).version) await D()?.load();
      else if (status.state !== 'synced') setStatus('synced');
    } catch (err) {
      setStatus(isWrongCode(err) ? 'error' : 'offline', err.message);
    }
  }

  // ---------- joining ----------
  const unionBy = (a = [], b = [], key) => {
    const seen = new Map();
    for (const x of [...(a || []), ...(b || [])]) if (x && !seen.has(x[key])) seen.set(x[key], x);
    return [...seen.values()];
  };

  async function join(code) {
    if (joining) return;
    joining = true;
    try {
      setStatus('syncing');
      let family;
      try {
        family = await call('sync', undefined, code);
      } catch (err) {
        setStatus(isWrongCode(err) ? 'error' : 'offline', err.message);
        D()?.toast(isWrongCode(err) ? 'That family code didn’t work. Check it and try again.' : 'Couldn’t reach the family collection. Try again with internet.');
        return;
      }
      const mine = await Local.allCards();
      const onServer = new Set(family.cards.map((c) => c.id));
      const newHere = mine.filter((c) => !onServer.has(c.id));
      let addMine = true;
      if (newHere.length) {
        addMine = !!(await D().ask({
          title: `Add this phone's ${newHere.length} card${newHere.length === 1 ? '' : 's'} to the family collection?`,
          message: family.cards.length
            ? `The family collection already has ${family.cards.length} card${family.cards.length === 1 ? '' : 's'}. Adding puts this phone's cards in with them. If you choose Cancel, this phone switches to the family collection and its own cards are removed (download a backup first if you want to keep them).`
            : 'They will show up on every phone in the family.',
          ok: 'Add them',
        }));
      }
      const m = await meta();
      m.joined = code;
      m.version = null;
      m.deleted = [];
      m.cards = addMine ? newHere.map((c) => c.id) : [];
      m.kv = [];
      if (addMine) {
        // Merge this phone's lists into the family's.
        const kv = family.kv || {};
        const merged = {
          wants: unionBy(kv.wants, await Local.getSetting('wants'), 'id'),
          sets: unionBy(kv.sets, await Local.getSetting('sets'), 'id'),
          history: unionBy(kv.history, await Local.getSetting('history'), 'date').sort((a, b) => a.date.localeCompare(b.date)),
          badges: { ...((await Local.getSetting('badges')) || {}), ...(kv.badges || {}) },
        };
        for (const [k, v] of Object.entries(merged)) {
          await Local.putSetting(k, v);
          m.kv.push(k);
        }
      }
      await saveMeta(m);
      await D()?.load();
      D()?.toast('🎉 You’re in! Everyone in the family now sees the same collection.');
    } finally {
      joining = false;
    }
  }

  // ---------- the DB the app uses ----------
  DB = {
    get temporary() { return Local.temporary; },
    async allCards() {
      if (await joined()) await pull();
      else setStatus('local');
      return Local.allCards();
    },
    async putCard(card) {
      await Local.putCard(card);
      if (await joined()) { await mark('cards', card.id); push(); }
    },
    async deleteCard(id) {
      await Local.deleteCard(id);
      if (await joined()) { await mark('deleted', id); push(); }
    },
    async getImage(key) {
      const blob = await Local.getImage(key);
      if (blob || !photoLinks[key]) return blob;
      try {
        const res = await fetch(photoLinks[key]);
        if (!res.ok) return undefined;
        const fetched = await res.blob();
        await Local.putImage(key, fetched); // keep a copy for offline viewing
        return fetched;
      } catch {
        return undefined;
      }
    },
    putImage: (key, blob) => Local.putImage(key, blob), // uploaded together with its card
    deleteImage: (key) => Local.deleteImage(key), // the server removes unused photos itself
    getSetting: (key) => Local.getSetting(key),
    async putSetting(key, value) {
      await Local.putSetting(key, value);
      if (key === 'settings') {
        const code = value?.familyCode || '';
        const m = await meta();
        if (Online.configured() && code && code !== m.joined) { setTimeout(() => join(code), 0); return; }
        if (!code && m.joined) { m.joined = ''; await saveMeta(m); setStatus('local'); return; }
      }
      if (SHARED.includes(key) && (await joined())) { await mark('kv', key); push(); }
    },
  };

  // ---------- start-up ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('#syncBadge')) {
      if (status.state === 'local') D()?.openSettings();
      else { D()?.toast('Checking for changes…'); D()?.load(); }
    }
  });
  addEventListener('online', () => checkForChanges());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForChanges(); });
  setInterval(checkForChanges, 60_000);

  // A phone that saved a family code but never finished joining (e.g. went to eBay mid-way) joins now.
  addEventListener('load', async () => {
    await window.Dugout?.ready;
    const code = await localCode();
    if (Online.configured() && code && (await meta()).joined !== code) join(code);
    renderStatus();
  });

  window.Sync = { pull, push, join, get status() { return status; } };
})();
