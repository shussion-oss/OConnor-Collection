/* The Dugout: family baseball card collection */
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const DEFAULT_SETTINGS = {
    title: 'The Dugout',
    tagline: 'Our family baseball card collection',
    ebayUser: '',
    shippingNote:
      'Ships fast in a penny sleeve and top loader inside a bubble mailer, with tracking.',
    bidPercent: 70,
    categories: [
      'Rookie Cards',
      'Hall of Famers',
      'Vintage (pre-1980)',
      'Superstars',
      'Autographs',
      'Inserts & Parallels',
      'Home Team',
      'Commons',
    ],
  };

  const EXTRA_KEYS = ['wants', 'sets', 'history', 'badges'];
  // Names suggested for "Belongs to" (plus anyone else already used in the collection).
  const FAMILY = ['Joe', 'Joey', 'Ethan'];

  // ---------- sport / era / grouping ----------
  const SPORT_ICON = {
    Baseball: '⚾', Football: '🏈', Basketball: '🏀', Hockey: '🏒', Soccer: '⚽',
    Golf: '⛳', Racing: '🏁', Wrestling: '🤼', Other: '🃏',
  };
  const sportOf = (c) => c.sport || 'Baseball';
  const sportIcon = (c) => SPORT_ICON[sportOf(c)] || '🃏';

  // Collecting "eras" the hobby talks about.
  const ERAS = [
    { id: 'prewar', label: 'Pre-War', range: 'before 1946', test: (y) => y < 1946 },
    { id: 'vintage', label: 'Post-War Vintage', range: '1946–1969', test: (y) => y <= 1969 },
    { id: 'seventies', label: 'The Seventies', range: '1970–1979', test: (y) => y <= 1979 },
    { id: 'junkwax', label: 'Junk Wax Era', range: '1980–1994', test: (y) => y <= 1994 },
    { id: 'modern', label: 'Modern', range: '1995–2009', test: (y) => y <= 2009 },
    { id: 'ultramodern', label: 'Ultra-Modern', range: '2010–today', test: () => true },
  ];
  const UNKNOWN_ERA = { id: 'unknown', label: 'Year Unknown', range: '' };
  const eraOf = (c) => (c.year ? ERAS.find((e) => e.test(c.year)) : UNKNOWN_ERA);
  const eraRank = (c) => (c.year ? ERAS.indexOf(eraOf(c)) : ERAS.length);

  const norm = (v) => String(v || '').trim().toLowerCase();
  // How each filter reads its value off a card (case-insensitive for typed-in fields).
  const FILTER_FIELDS = {
    sport: { label: 'All sports', get: (c) => sportOf(c) },
    player: { label: 'All players', get: (c) => c.player },
    team: { label: 'All teams', get: (c) => c.team },
    era: { label: 'All eras', get: (c) => eraOf(c).id },
    brand: { label: 'All makers', get: (c) => c.brand },
  };

  // Sorts that also group the grid under headings.
  const GROUPS = {
    sport: { key: (c) => sportOf(c), title: (c) => `${sportIcon(c)} ${sportOf(c)}`, rank: (c) => sportOf(c) },
    player: { key: (c) => norm(c.player), title: (c) => c.player, rank: (c) => norm(c.player) },
    team: { key: (c) => norm(c.team), title: (c) => c.team || 'No team listed', rank: (c) => (c.team ? norm(c.team) : '~') },
    era: { key: (c) => eraOf(c).id, title: (c) => `${eraOf(c).label}${eraOf(c).range ? ` <small>${eraOf(c).range}</small>` : ''}`, rank: (c) => String(eraRank(c)).padStart(2, '0') },
    brand: { key: (c) => norm(c.brand), title: (c) => c.brand || 'Unknown manufacturer', rank: (c) => (c.brand ? norm(c.brand) : '~') },
  };

  const STATUS = {
    collection: { label: 'In Collection', icon: '📒' },
    listed: { label: 'Listed on eBay', icon: '🏷️' },
    sold: { label: 'Sold', icon: '✅' },
  };

  const state = {
    cards: [],
    settings: { ...DEFAULT_SETTINGS },
    filters: { q: '', category: '', owner: '', status: '', sport: '', player: '', team: '', era: '', brand: '' },
    sort: 'newest',
    urls: new Map(), // image key -> object URL
    editing: null, // card being edited
    pendingImages: { front: null, back: null }, // Blobs picked in the form
    view: 'grid', // 'grid' | 'binder'
  };
  const X = () => window.DugoutExtras || {};

  // ---------- helpers ----------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) =>
    n === '' || n == null || isNaN(n)
      ? '—'
      : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /** In-page replacement for confirm()/prompt(): those are blocked in some embedded views
      and look out of place on phones. Resolves to true / the typed text, or null if cancelled. */
  function ask({ title, message = '', input = null, ok = 'OK', danger = false }) {
    let dlg = $('#askDialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'askDialog';
      dlg.className = 'dialog ask';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<form method="dialog" class="dialog-inner">
        <h2 class="ask-title">${esc(title)}</h2>
        ${message ? `<p class="help">${esc(message)}</p>` : ''}
        ${input ? `<div class="money-input ask-input"><span>$</span><input name="v" inputmode="decimal" value="${esc(input.value ?? '')}" /></div>` : ''}
        <div class="dialog-foot">
          <span class="spacer"></span>
          <button type="button" class="btn ghost" value="cancel" data-ask-cancel>Cancel</button>
          <button type="submit" class="btn ${danger ? 'danger-solid' : 'primary'}">${esc(ok)}</button>
        </div>
      </form>`;
    return new Promise((resolve) => {
      const form = dlg.querySelector('form');
      let result = null;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        result = input ? form.v.value : true;
        dlg.close();
      });
      dlg.querySelector('[data-ask-cancel]').onclick = () => dlg.close();
      dlg.addEventListener('close', () => resolve(result), { once: true });
      dlg.showModal();
      const field = form.v;
      if (field) { field.focus(); field.select(); }
    });
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  async function imageUrl(key) {
    if (!key) return '';
    if (state.urls.has(key)) return state.urls.get(key);
    const blob = await DB.getImage(key);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    state.urls.set(key, url);
    return url;
  }

  /** Shrink a photo so the collection stays small and fast. */
  function resizeImage(file, max = 1400, quality = 0.86) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const src = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(src);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read photo'))), 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Could not read photo'));
      img.src = src;
    });
  }

  const gain = (c) =>
    c.estValue != null && c.purchasePrice != null ? c.estValue - c.purchasePrice : null;

  // ---------- load ----------
  async function load() {
    // Cards first: when this phone is in the family collection, this also pulls the latest
    // family settings and lists from the server.
    state.cards = await DB.allCards();
    const saved = await DB.getSetting('settings');
    state.settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
    if (DB.temporary && !load.warned) {
      load.warned = true;
      setTimeout(() => toast('Preview mode: this browser blocks saving, so cards disappear when you close the page.'), 3500);
    }
    await X().reload?.();
    applySettingsToHeader();
    render();
  }

  function applySettingsToHeader() {
    $('#collectionTitle').textContent = state.settings.title || DEFAULT_SETTINGS.title;
    $('#collectionTagline').textContent = state.settings.tagline || '';
    document.title = `${state.settings.title || DEFAULT_SETTINGS.title}: Card Collection`;
  }

  // ---------- render ----------
  function render() {
    renderScoreboard();
    renderChips();
    renderGrid();
    renderDatalists();
    X().afterRender?.();
  }

  function renderScoreboard() {
    const owned = state.cards.filter((c) => c.status !== 'sold');
    const paid = owned.reduce((s, c) => s + (c.purchasePrice || 0), 0);
    const value = owned.reduce((s, c) => s + (c.estValue ?? c.purchasePrice ?? 0), 0);
    const g = value - paid;
    const soldTotal = state.cards
      .filter((c) => c.status === 'sold')
      .reduce((s, c) => s + (c.soldPrice || 0), 0);
    const players = new Set(owned.map((c) => c.player.toLowerCase())).size;
    const oldest = owned.filter((c) => c.year).sort((a, b) => a.year - b.year)[0];

    const tiles = [
      { label: 'Cards', value: owned.length, sub: `${players} player${players === 1 ? '' : 's'}` },
      { label: 'We Paid', value: money(paid) },
      { label: 'Worth Today', value: money(value), sub: 'estimated' },
      {
        label: 'Gain / Loss',
        value: (g >= 0 ? '+' : '−') + money(Math.abs(g)).replace('$', '$'),
        cls: g >= 0 ? 'up' : 'down',
      },
      { label: 'Oldest Card', value: oldest ? oldest.year : '—', sub: oldest ? esc(oldest.player) : '' },
      { label: 'Sold on eBay', value: money(soldTotal) },
    ];
    $('#scoreboard').innerHTML = tiles
      .map(
        (t) => `<div class="tile ${t.cls || ''}">
          <div class="tile-label">${t.label}</div>
          <div class="tile-value">${t.value}</div>
          ${t.sub ? `<div class="tile-sub">${t.sub}</div>` : ''}
        </div>`
      )
      .join('');
  }

  function chip(label, active, data) {
    return `<button type="button" class="chip ${active ? 'active' : ''}" ${data}>${esc(label)}</button>`;
  }

  function renderChips() {
    const counts = {};
    state.cards.forEach((c) => (c.categories || []).forEach((cat) => (counts[cat] = (counts[cat] || 0) + 1)));
    const cats = [...new Set([...state.settings.categories, ...Object.keys(counts)])];
    const f = state.filters;
    $('#categoryChips').innerHTML =
      chip('All', !f.category, 'data-cat=""') +
      chip('⭐ Favorites', f.category === '__fav', 'data-cat="__fav"') +
      cats
        .map((cat) => chip(`${cat}${counts[cat] ? ` · ${counts[cat]}` : ''}`, f.category === cat, `data-cat="${esc(cat)}"`))
        .join('');

    const owners = [...new Set(state.cards.map((c) => c.owner).filter(Boolean))].sort();
    $('#ownerChips').innerHTML =
      chip('Everyone', !f.owner, 'data-owner=""') +
      owners.map((o) => chip(o, f.owner === o, `data-owner="${esc(o)}"`)).join('');
    $('#ownerChips').closest('.filter-group').hidden = owners.length === 0;

    renderFilterSelects();

    $('#statusChips').innerHTML =
      chip('All', !f.status, 'data-status=""') +
      Object.entries(STATUS)
        .map(([k, v]) => chip(`${v.icon} ${v.label}`, f.status === k, `data-status="${k}"`))
        .join('');
  }

  function renderFilterSelects() {
    const f = state.filters;
    for (const sel of $$('[data-filter]')) {
      const field = sel.dataset.filter;
      const { label, get } = FILTER_FIELDS[field];
      const counts = new Map(); // normalized value -> { text, n }
      // Only offer choices that still make sense with the other dropdowns (e.g. Football → football teams).
      const base = state.cards.filter((c) =>
        Object.keys(FILTER_FIELDS).every((k) => k === field || !f[k] || norm(FILTER_FIELDS[k].get(c)) === f[k]));
      for (const c of base) {
        const v = get(c);
        if (!v) continue;
        const k = norm(v);
        const e = counts.get(k) || { text: v, n: 0 };
        e.n++;
        counts.set(k, e);
      }
      // Keep the current choice listed even if other filters now hide all its cards.
      if (f[field] && !counts.has(f[field])) {
        const any = state.cards.find((c) => norm(get(c)) === f[field]);
        counts.set(f[field], { text: any ? get(any) : f[field], n: 0 });
      }
      let opts;
      if (field === 'era') {
        opts = [...ERAS, UNKNOWN_ERA]
          .filter((e) => counts.has(e.id))
          .map((e) => [e.id, `${e.label}${e.range ? ` (${e.range})` : ''} · ${counts.get(e.id).n}`]);
      } else {
        opts = [...counts.entries()]
          .sort((a, b) => a[1].text.localeCompare(b[1].text))
          .map(([k, e]) => [k, `${field === 'sport' ? (SPORT_ICON[e.text] || '') + ' ' : ''}${e.text} · ${e.n}`]);
      }
      sel.innerHTML = `<option value="">${label}</option>` +
        opts.map(([v, t]) => `<option value="${esc(v)}" ${f[field] === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
      sel.classList.toggle('active', !!f[field]);
    }
    $('#resetFiltersBtn').hidden = !Object.keys(FILTER_FIELDS).some((k) => state.filters[k]);
  }

  function filteredCards() {
    const { q, category, owner, status } = state.filters;
    const needle = q.trim().toLowerCase();
    let list = state.cards.filter((c) => {
      if (category === '__fav' && !c.favorite) return false;
      if (category && category !== '__fav' && !(c.categories || []).includes(category)) return false;
      if (owner && c.owner !== owner) return false;
      if (status && (c.status || 'collection') !== status) return false;
      for (const k of Object.keys(FILTER_FIELDS)) {
        if (state.filters[k] && norm(FILTER_FIELDS[k].get(c)) !== state.filters[k]) return false;
      }
      if (needle) {
        const hay = [c.player, c.team, sportOf(c), eraOf(c).label, c.brand, c.year, c.cardNumber, c.position, c.owner, c.description, ...(c.categories || [])]
          .join(' ')
          .toLowerCase();
        if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const by = {
      newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      'year-asc': (a, b) => (a.year || 9999) - (b.year || 9999),
      'year-desc': (a, b) => (b.year || 0) - (a.year || 0),
      'value-desc': (a, b) => (b.estValue || 0) - (a.estValue || 0),
      'paid-desc': (a, b) => (b.purchasePrice || 0) - (a.purchasePrice || 0),
      'gain-desc': (a, b) => (gain(b) ?? -1e9) - (gain(a) ?? -1e9),
    }[state.sort];
    const group = GROUPS[state.sort];
    if (group) {
      // Group first, then player, then year inside each group.
      return list.sort((a, b) =>
        group.rank(a).localeCompare(group.rank(b)) ||
        norm(a.player).localeCompare(norm(b.player)) ||
        (a.year || 9999) - (b.year || 9999));
    }
    return list.sort(by);
  }

  function cardFaces(card, size = '') {
    return `<div class="flip ${size}" data-flip>
      <div class="flip-inner">
        <div class="face front" data-img="${esc(card.frontImg || '')}">
          ${card.frontImg ? '' : `<div class="noimg"><span>${sportIcon(card)}</span>${esc(card.player)}</div>`}
        </div>
        <div class="face back" data-img="${esc(card.backImg || '')}">
          ${card.backImg ? '' : `<div class="noimg"><span>📄</span>No back photo yet</div>`}
        </div>
      </div>
    </div>`;
  }

  async function hydrateImages(root) {
    for (const el of $$('[data-img]', root)) {
      const key = el.dataset.img;
      if (!key) continue;
      const url = await imageUrl(key);
      if (url) el.style.backgroundImage = `url("${url}")`;
    }
  }

  function renderGrid() {
    const list = filteredCards();
    const grid = $('#cardGrid');
    $('#emptyState').hidden = state.cards.length !== 0;
    $('#noResults').hidden = !(state.cards.length && !list.length);
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    grid.classList.toggle('binder-mode', state.view === 'binder');
    if (state.view === 'binder' && X().renderBinder) return X().renderBinder(grid, list);

    const group = GROUPS[state.sort];
    let lastKey = null;
    const heading = (c) => {
      if (!group) return '';
      const k = group.key(c);
      if (k === lastKey) return '';
      lastKey = k;
      const members = list.filter((x) => group.key(x) === k);
      const worth = members.reduce((s, x) => s + (x.estValue ?? x.purchasePrice ?? 0), 0);
      return `<h2 class="group-head">${group.title(c)}
        <span class="group-meta">${members.length} card${members.length === 1 ? '' : 's'}${worth ? ` · worth ${money(worth)}` : ''}</span></h2>`;
    };

    grid.innerHTML = list
      .map((c) => {
        const st = c.status || 'collection';
        const g = gain(c);
        return `${heading(c)}<article class="card-tile status-${st}" data-id="${c.id}" tabindex="0">
          ${cardFaces(c)}
          <button class="flip-btn" data-flip-btn title="Flip card" aria-label="Flip card">⟲</button>
          ${c.favorite ? '<span class="fav-badge" title="Favorite">⭐</span>' : ''}
          ${st !== 'collection' ? `<span class="status-badge">${STATUS[st].icon} ${STATUS[st].label}</span>` : ''}
          <div class="tile-info">
            <h3>${esc(c.player)}</h3>
            <p class="meta"><span title="${esc(sportOf(c))}">${sportIcon(c)}</span> ${esc([c.year, c.brand, c.cardNumber ? '#' + c.cardNumber : ''].filter(Boolean).join(' · '))}</p>
            <p class="meta team">${esc(c.team || '')}</p>
            <div class="price-row">
              <span>Paid <strong>${money(c.purchasePrice)}</strong></span>
              ${g != null ? `<span class="${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '▲' : '▼'} ${money(Math.abs(g))}</span>` : ''}
            </div>
          </div>
        </article>`;
      })
      .join('');
    hydrateImages(grid);
  }

  function renderDatalists() {
    const fill = (id, key) =>
      ($(id).innerHTML = [...new Set(state.cards.map((c) => c[key]).filter(Boolean))]
        .sort()
        .map((v) => `<option value="${esc(v)}"></option>`)
        .join(''));
    fill('#brandList', 'brand');
    fill('#teamList', 'team');
    const owners = [...new Set([...FAMILY, ...state.cards.map((c) => c.owner).filter(Boolean)])];
    $('#ownerList').innerHTML = owners.map((v) => `<option value="${esc(v)}"></option>`).join('');
    $('#ownerPicks').innerHTML = owners
      .map((v) => `<button type="button" class="chip" data-pick-owner="${esc(v)}">${esc(v)}</button>`)
      .join('');
    if (!$('#brandList').innerHTML)
      $('#brandList').innerHTML = ['Topps', 'Bowman', 'Fleer', 'Donruss', 'Upper Deck', 'Score', 'Panini', 'Leaf']
        .map((b) => `<option value="${b}"></option>`)
        .join('');
  }

  // ---------- detail ----------
  function openDetail(id) {
    const c = state.cards.find((x) => x.id === id);
    if (!c) return;
    const st = c.status || 'collection';
    const g = gain(c);
    const rows = [
      ['Year', c.year],
      ['Brand / Set', c.brand],
      ['Card #', c.cardNumber],
      ['Team', c.team],
      ['Sport', `${sportIcon(c)} ${sportOf(c)}`],
      ['Era', `${eraOf(c).label}${eraOf(c).range ? ` (${eraOf(c).range})` : ''}`],
      ['Position', c.position],
      ['Condition', c.condition],
      ['Graded', c.gradeCompany ? `${c.gradeCompany} ${c.grade || ''}` : ''],
      ['Belongs to', c.owner],
      ['Bought from', c.purchasedFrom],
      ['Date bought', c.purchaseDate ? new Date(c.purchaseDate + 'T00:00').toLocaleDateString() : ''],
    ].filter(([, v]) => v);

    $('#detailBody').innerHTML = `
      <div class="dialog-head">
        <h2>${esc(c.player)} ${c.favorite ? '⭐' : ''}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="detail">
        <div class="detail-card">
          ${cardFaces(c, 'large')}
          <div class="side-toggle">
            <button class="btn small ghost active" data-side="front">Front</button>
            <button class="btn small ghost" data-side="back">Back</button>
          </div>
          <p class="help center">Tap the card to flip it</p>
        </div>
        <div class="detail-info">
          <div class="cat-list">${(c.categories || []).map((x) => `<span class="pill">${esc(x)}</span>`).join('')}
            <span class="pill status">${STATUS[st].icon} ${STATUS[st].label}</span></div>

          <div class="money-box">
            <div><span>We paid</span><strong>${money(c.purchasePrice)}</strong></div>
            <div><span>Worth now</span><strong>${money(c.estValue)}</strong></div>
            ${
              st === 'sold'
                ? `<div><span>Sold for</span><strong class="up">${money(c.soldPrice)}</strong></div>`
                : `<div><span>Gain / Loss</span><strong class="${g == null ? '' : g >= 0 ? 'up' : 'down'}">${
                    g == null ? '—' : (g >= 0 ? '+' : '−') + money(Math.abs(g))
                  }</strong></div>`
            }
          </div>

          ${c.description ? `<div class="story"><h4>The story</h4><p>${esc(c.description).replace(/\n/g, '<br>')}</p></div>` : ''}

          <dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>

          <div class="detail-actions">
            ${st !== 'sold' ? `<button class="btn ebay" data-sell="${c.id}"><span class="ebay-logo"><b>e</b><b>b</b><b>a</b><b>y</b></span> Sell on eBay</button>` : ''}
            <button class="btn ghost" data-edit="${c.id}">✏️ Edit</button>
            ${
              st === 'listed'
                ? `<button class="btn ghost" data-mark-sold="${c.id}">✅ Mark as sold</button>
                   <button class="btn ghost" data-unlist="${c.id}">↩︎ Back to collection</button>`
                : ''
            }
            ${st === 'sold' ? `<button class="btn ghost" data-unlist="${c.id}">↩︎ Back to collection</button>` : ''}
          </div>
        </div>
      </div>`;
    hydrateImages($('#detailBody'));
    X().decorateDetail?.(c, $('#detailBody'));
    if (!$('#detailDialog').open) $('#detailDialog').showModal();
  }

  // ---------- add / edit ----------
  function openEditor(card, prefill) {
    state.editing = card || null;
    state.pendingImages = { front: null, back: null };
    const form = $('#cardForm');
    form.reset();
    $('#editTitle').textContent = card ? `Edit: ${card.player}` : 'Add a Card';
    $('#deleteCardBtn').hidden = !card;

    const cats = [...new Set([...state.settings.categories, ...(card?.categories || [])])];
    $('#formCategories').innerHTML = cats
      .map(
        (cat) =>
          `<label class="chip check"><input type="checkbox" name="cat" value="${esc(cat)}" ${
            card?.categories?.includes(cat) ? 'checked' : ''
          } /> ${esc(cat)}</label>`
      )
      .join('');

    if (card) {
      for (const el of form.elements) {
        if (!el.name || el.name === 'cat') continue;
        if (el.type === 'checkbox') el.checked = !!card[el.name];
        else if (card[el.name] != null) el.value = card[el.name];
      }
    }
    if (!card && prefill) {
      for (const [k, v] of Object.entries(prefill)) if (form.elements[k] && v != null) form.elements[k].value = v;
    }
    form.dataset.wantId = (!card && prefill?.wantId) || '';
    X().decorateEditor?.(card);
    setPreview('front', card?.frontImg);
    setPreview('back', card?.backImg);
    syncOwnerPicks();
    $('#editDialog').showModal();
  }

  // Highlight the name button that matches what's typed in "Belongs to".
  function syncOwnerPicks() {
    const v = $('#cardForm').owner.value.trim().toLowerCase();
    $$('#ownerPicks .chip').forEach((c) => c.classList.toggle('active', c.dataset.pickOwner.toLowerCase() === v));
  }

  async function setPreview(side, key, blob) {
    const img = $(`#${side}Preview`);
    const url = blob ? URL.createObjectURL(blob) : key ? await imageUrl(key) : '';
    img.hidden = !url;
    img.src = url || '';
    $(`#${side}Pick`).classList.toggle('has-img', !!url);
  }

  async function onPhotoPicked(side, file) {
    if (!file) return;
    try {
      const blob = await resizeImage(file);
      state.pendingImages[side] = blob;
      setPreview(side, null, blob);
    } catch (e) {
      toast('Sorry, that photo could not be read. Try another one.');
    }
  }

  async function saveCard(e) {
    e.preventDefault();
    const form = $('#cardForm');
    const fd = new FormData(form);
    const existing = state.editing;
    const card = {
      ...(existing || { id: uid(), createdAt: Date.now(), status: 'collection' }),
      player: fd.get('player').trim(),
      year: num(fd.get('year')),
      brand: fd.get('brand').trim(),
      cardNumber: fd.get('cardNumber').trim(),
      team: fd.get('team').trim(),
      position: fd.get('position').trim(),
      sport: fd.get('sport') || 'Baseball',
      condition: fd.get('condition'),
      gradeCompany: fd.get('gradeCompany'),
      grade: fd.get('grade').trim(),
      owner: fd.get('owner').trim(),
      categories: fd.getAll('cat'),
      wantId: existing?.wantId || form.dataset.wantId || undefined,
      purchasePrice: num(fd.get('purchasePrice')),
      purchaseDate: fd.get('purchaseDate'),
      purchasedFrom: fd.get('purchasedFrom').trim(),
      estValue: num(fd.get('estValue')),
      description: fd.get('description').trim(),
      favorite: fd.get('favorite') === 'on',
      updatedAt: Date.now(),
    };
    if (!card.player) return toast('Please enter the player name.');
    // Keep a history of the estimated value so we can chart it over time.
    const hist = [...(card.valueHistory || [])];
    const today = new Date().toISOString().slice(0, 10);
    if (card.estValue != null && (!hist.length || hist[hist.length - 1].value !== card.estValue)) {
      if (hist.length && hist[hist.length - 1].date === today) hist.pop();
      hist.push({ date: today, value: card.estValue });
    }
    card.valueHistory = hist;

    for (const side of ['front', 'back']) {
      const blob = state.pendingImages[side];
      if (!blob) continue;
      const oldKey = card[`${side}Img`];
      const key = `${card.id}-${side}-${Date.now()}`;
      await DB.putImage(key, blob);
      card[`${side}Img`] = key;
      if (oldKey) {
        await DB.deleteImage(oldKey);
        const u = state.urls.get(oldKey);
        if (u) URL.revokeObjectURL(u);
        state.urls.delete(oldKey);
      }
    }

    await DB.putCard(card);
    const i = state.cards.findIndex((c) => c.id === card.id);
    if (i >= 0) state.cards[i] = card;
    else state.cards.push(card);
    $('#editDialog').close();
    render();
    toast(existing ? 'Card updated' : `${card.player} added to the collection! ⚾`);
    if ($('#detailDialog').open) openDetail(card.id);
    X().onCardSaved?.(card, !existing);
  }

  async function deleteCard() {
    const c = state.editing;
    if (!c) return;
    if (!(await ask({ title: `Delete ${c.player}?`, message: "This removes the card and its photos. It can't be undone.", ok: 'Delete', danger: true }))) return;
    await DB.deleteCard(c.id);
    if (c.frontImg) await DB.deleteImage(c.frontImg);
    if (c.backImg) await DB.deleteImage(c.backImg);
    state.cards = state.cards.filter((x) => x.id !== c.id);
    $('#editDialog').close();
    if ($('#detailDialog').open) $('#detailDialog').close();
    render();
    toast('Card deleted');
  }

  async function updateCard(id, patch) {
    const c = state.cards.find((x) => x.id === id);
    Object.assign(c, patch, { updatedAt: Date.now() });
    await DB.putCard(c);
    render();
    X().onCardSaved?.(c, false);
    return c;
  }

  // ---------- sell on eBay ----------
  function openSell(id) {
    const c = state.cards.find((x) => x.id === id);
    const s = state.settings;
    const title = Listing.title(c);
    const desc = Listing.description(c, s);
    const { bid, reason } = Listing.startingBid(c, s);
    const store = Listing.storeUrl(s.ebayUser);

    $('#sellBody').innerHTML = `
      <div class="dialog-head">
        <h2><span class="ebay-logo"><b>e</b><b>b</b><b>a</b><b>y</b></span> Sell ${esc(c.player)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      ${
        s.ebayUser
          ? `<p class="help">Listing from eBay account <strong>${esc(s.ebayUser)}</strong>. Make sure you're signed in to this account on eBay.</p>`
          : `<p class="notice">Add his eBay username in <a href="#" data-open-settings>Settings</a> so the sell button opens his account.</p>`
      }
      <ol class="steps">
        <li><strong>Check the listing below.</strong> Change anything you like.</li>
        <li><strong>Tap “Copy &amp; open eBay”.</strong> We copy the title, and eBay opens to start a new listing.</li>
        <li><strong>Paste each part into eBay</strong> and upload the front and back photos.</li>
      </ol>

      <div class="sell-grid">
        <div class="sell-photos">
          <div class="mini-face" data-img="${esc(c.frontImg || '')}"></div>
          <div class="mini-face" data-img="${esc(c.backImg || '')}"></div>
          <button class="btn small ghost" data-download-photos="${c.id}">⬇️ Save photos for eBay</button>
        </div>
        <div class="sell-fields">
          <label>Listing title <small class="help"><span id="titleCount">${title.length}</span>/${Listing.TITLE_MAX}</small>
            <div class="copy-row">
              <input id="sellTitle" maxlength="${Listing.TITLE_MAX}" value="${esc(title)}" />
              <button class="btn small ghost" data-copy="#sellTitle">Copy</button>
            </div>
          </label>

          <label>Starting bid
            <div class="copy-row">
              <div class="money-input"><span>$</span><input id="sellBid" type="number" step="0.01" min="0.99" value="${bid.toFixed(2)}" /></div>
              <button class="btn small ghost" data-copy="#sellBid">Copy</button>
            </div>
            <small class="help">💡 ${esc(reason)}.</small>
          </label>

          <label>Description
            <textarea id="sellDesc" rows="12">${esc(desc)}</textarea>
            <button class="btn small ghost" data-copy="#sellDesc">Copy description</button>
          </label>
        </div>
      </div>

      <div class="dialog-foot wrap">
        <a class="btn ghost" href="${Listing.soldSearchUrl(c)}" target="_blank" rel="noopener">📈 See what similar cards sold for</a>
        ${store ? `<a class="btn ghost" href="${store}" target="_blank" rel="noopener">🏪 His eBay page</a>` : ''}
        <span class="spacer"></span>
        <a class="btn ebay" href="${Listing.sellUrl()}" target="_blank" rel="noopener" data-go-ebay="${c.id}">Copy &amp; open eBay ↗</a>
      </div>`;
    hydrateImages($('#sellBody'));
    X().decorateSell?.(c, $('#sellBody'));
    $('#sellTitle').addEventListener('input', (e) => ($('#titleCount').textContent = e.target.value.length));
    $('#sellDialog').showModal();
  }

  async function goToEbay(id) {
    const title = $('#sellTitle').value;
    // The button is a normal link, so eBay opens in a new tab on its own.
    const copied = await copy(title);
    const c = state.cards.find((x) => x.id === id);
    await updateCard(id, {
      status: 'listed',
      listedAt: Date.now(),
      listing: { title, description: $('#sellDesc').value, startingBid: Number($('#sellBid').value) },
    });
    toast(copied ? 'Title copied. Paste it into eBay! 🏷️' : 'eBay opened. Copy the title from here.');
    if ($('#detailDialog').open) openDetail(c.id);
  }

  async function downloadPhotos(id) {
    const c = state.cards.find((x) => x.id === id);
    const base = [c.year, c.brand, c.player].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
    for (const side of ['front', 'back']) {
      const key = c[`${side}Img`];
      if (!key) continue;
      const a = document.createElement('a');
      a.href = await imageUrl(key);
      a.download = `${base}-${side}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  // ---------- settings / backup ----------
  function openSettings() {
    const f = $('#settingsForm');
    const s = state.settings;
    f.title.value = s.title;
    f.tagline.value = s.tagline;
    f.ebayUser.value = s.ebayUser;
    f.shippingNote.value = s.shippingNote;
    f.bidPercent.value = s.bidPercent;
    f.categories.value = s.categories.join('\n');
    f.familyCode.value = s.familyCode || '';
    f.zip.value = s.zip || '';
    $('#settingsDialog').showModal();
    X().onSettingsOpen?.();
  }

  async function saveSettings(e) {
    e.preventDefault();
    const f = $('#settingsForm');
    state.settings = {
      ...state.settings,
      title: f.title.value.trim() || DEFAULT_SETTINGS.title,
      tagline: f.tagline.value.trim(),
      ebayUser: f.ebayUser.value.trim().replace(/^@/, ''),
      shippingNote: f.shippingNote.value.trim(),
      bidPercent: Number(f.bidPercent.value) || 70,
      categories: f.categories.value.split('\n').map((x) => x.trim()).filter(Boolean),
      familyCode: f.familyCode.value.trim(),
      zip: f.zip.value.trim(),
    };
    await DB.putSetting('settings', state.settings);
    applySettingsToHeader();
    $('#settingsDialog').close();
    render();
    toast('Settings saved');
  }

  const blobToDataUrl = (blob) =>
    new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });

  async function exportBackup() {
    toast('Preparing backup…');
    const images = {};
    for (const c of state.cards) {
      for (const key of [c.frontImg, c.backImg]) {
        if (!key) continue;
        const blob = await DB.getImage(key);
        if (blob) images[key] = await blobToDataUrl(blob);
      }
    }
    const extras = {};
    for (const k of EXTRA_KEYS) extras[k] = await DB.getSetting(k);
    const data = { app: 'the-dugout', version: 2, exportedAt: new Date().toISOString(), settings: state.settings, cards: state.cards, images, extras };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `card-collection-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast('Backup downloaded');
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'the-dugout' || !Array.isArray(data.cards)) throw new Error('bad file');
      if (!(await ask({ title: `Restore ${data.cards.length} cards?`, message: 'Cards that are already here will be replaced by the backup copy.', ok: 'Restore' }))) return;
      for (const [key, dataUrl] of Object.entries(data.images || {})) {
        const blob = await (await fetch(dataUrl)).blob();
        await DB.putImage(key, blob);
      }
      for (const c of data.cards) await DB.putCard(c);
      if (data.settings) await DB.putSetting('settings', { ...state.settings, ...data.settings });
      for (const k of EXTRA_KEYS) if (data.extras?.[k] != null) await DB.putSetting(k, data.extras[k]);
      if (data.extras) {
        // Reload so the chase list, sets, history and trophies pick up the restored data.
        setTimeout(() => location.reload(), 1200);
      }
      $('#settingsDialog').close();
      await load();
      toast(`Restored ${data.cards.length} cards`);
    } catch {
      toast("That doesn't look like a collection backup file.");
    }
  }

  // ---------- demo cards ----------
  function demoSvg({ player, team, year, brand, num, pos, c1, c2, back }) {
    const W = 500, H = 700;
    const svg = back
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <rect width="100%" height="100%" fill="#e9dcc0"/><rect x="20" y="20" width="460" height="660" fill="#f6edd8" stroke="${c1}" stroke-width="6"/>
        <rect x="20" y="20" width="460" height="90" fill="${c1}"/>
        <text x="40" y="78" font-family="Georgia" font-size="40" font-weight="bold" fill="#fff">${player.toUpperCase()}</text>
        <text x="460" y="78" text-anchor="end" font-family="Georgia" font-size="32" fill="#fff">#${num}</text>
        <text x="40" y="150" font-family="Courier New" font-size="22" fill="#333">${team} · ${pos}</text>
        <text x="40" y="190" font-family="Courier New" font-size="20" fill="#333">BATS: R  THROWS: R  HT: 6'1"</text>
        <line x1="40" y1="220" x2="460" y2="220" stroke="#333" stroke-width="2"/>
        <text x="40" y="255" font-family="Courier New" font-size="20" font-weight="bold" fill="#333">YR   G    AB   H    HR  AVG</text>
        ${[0, 1, 2, 3, 4].map((i) => `<text x="40" y="${290 + i * 32}" font-family="Courier New" font-size="20" fill="#333">${String(year - 4 + i).slice(2)}   ${140 + i * 3}  ${520 + i * 7}  ${150 + i * 6}  ${18 + i * 3}  .${280 + i * 5}</text>`).join('')}
        <rect x="40" y="470" width="420" height="160" fill="#fff8e6" stroke="#333" stroke-width="2"/>
        <text x="60" y="510" font-family="Georgia" font-size="20" fill="#333">SAMPLE CARD: this is a made-up</text>
        <text x="60" y="540" font-family="Georgia" font-size="20" fill="#333">player to show how the app works.</text>
        <text x="60" y="580" font-family="Georgia" font-size="20" fill="#333">Delete it whenever you like!</text>
        <text x="250" y="665" text-anchor="middle" font-family="Georgia" font-size="16" fill="#555">© ${year} ${brand}</text></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
        <rect width="100%" height="100%" fill="#fbfaf5"/><rect x="24" y="24" width="452" height="652" rx="10" fill="url(#g)"/>
        <circle cx="250" cy="300" r="120" fill="rgba(255,255,255,.18)"/>
        <circle cx="250" cy="250" r="70" fill="rgba(255,255,255,.85)"/>
        <path d="M150 470 Q250 330 350 470 L350 520 L150 520 Z" fill="rgba(255,255,255,.85)"/>
        <text x="250" y="120" text-anchor="middle" font-family="Georgia" font-size="34" font-weight="bold" fill="#fff" opacity=".9">${brand.toUpperCase()}</text>
        <rect x="24" y="560" width="452" height="116" fill="rgba(0,0,0,.55)"/>
        <text x="250" y="612" text-anchor="middle" font-family="Georgia" font-size="40" font-weight="bold" fill="#fff">${player.toUpperCase()}</text>
        <text x="250" y="650" text-anchor="middle" font-family="Georgia" font-size="22" fill="#ffd66b">${team} · ${pos}</text>
        <circle cx="420" cy="80" r="40" fill="#ffd66b"/><text x="420" y="92" text-anchor="middle" font-family="Georgia" font-size="32" font-weight="bold" fill="#333">'${String(year).slice(2)}</text></svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  async function loadDemo() {
    const demos = [
      { player: 'Sammy Fastball', team: 'River City Comets', year: 1989, brand: 'Diamond Classics', num: 116, pos: 'P', c1: '#0b3d91', c2: '#3a7bd5',
        cats: ['Rookie Cards', 'Superstars'], owner: 'Joe', paid: 12, est: 45, cond: 'Near Mint', story: 'Found this one in a shoebox at a garage sale. Best $12 ever spent!', fav: true },
      { player: 'Joe Homerun', team: 'Lakeside Lumberjacks', year: 1975, brand: 'Old Timer', num: 7, pos: '1B', c1: '#7a1f1f', c2: '#c0392b',
        cats: ['Vintage (pre-1980)', 'Hall of Famers'], owner: 'Joey', paid: 30, est: 22, cond: 'Very Good', story: 'Grandpa gave this to us. The corners are a little soft but it is a classic.', grade: '', company: '' },
      { player: 'Lefty Rivera', team: 'Desert Sun Sox', year: 2011, brand: 'Prime Picks', num: 42, pos: 'SS', c1: '#145a32', c2: '#27ae60',
        cats: ['Inserts & Parallels', 'Home Team'], owner: 'Ethan', paid: 8, est: 15, cond: '', story: 'Pulled from a pack on Ethan\'s birthday!', grade: '9', company: 'PSA' },
      { player: 'Dash Thompson', team: 'Metro Mustangs', year: 1992, brand: 'Gridiron Gold', num: 88, pos: 'QB', c1: '#5b2c83', c2: '#9b59b6', sport: 'Football',
        cats: ['Rookie Cards'], owner: 'Joey', paid: 3, est: 5, cond: 'Excellent', story: 'Our first football card! Traded two doubles for it at school.' },
    ];
    for (const d of demos) {
      const id = uid();
      const frontImg = `${id}-front`, backImg = `${id}-back`;
      await DB.putImage(frontImg, demoSvg({ ...d, back: false }));
      await DB.putImage(backImg, demoSvg({ ...d, back: true }));
      const card = {
        id, createdAt: Date.now(), status: 'collection', player: d.player, year: d.year, brand: d.brand, cardNumber: String(d.num),
        team: d.team, position: d.pos, condition: d.cond, gradeCompany: d.company || '', grade: d.grade || '', owner: d.owner,
        categories: d.cats, purchasePrice: d.paid, purchaseDate: '', purchasedFrom: '', estValue: d.est, description: d.story,
        favorite: !!d.fav, frontImg, backImg, sample: true, sport: d.sport || 'Baseball',
      };
      await DB.putCard(card);
    }
    await load();
    toast('Sample cards loaded. Tap one to explore!');
  }

  // ---------- events ----------
  function bind() {
    $('#addCardBtn').onclick = () => openEditor();
    $('#emptyAddBtn').onclick = () => openEditor();
    $('#demoBtn').onclick = loadDemo;
    $('#settingsBtn').onclick = openSettings;
    $('#cardForm').addEventListener('submit', saveCard);
    $('#cardForm').owner.addEventListener('input', syncOwnerPicks);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#deleteCardBtn').onclick = deleteCard;
    $('#frontInput').onchange = (e) => onPhotoPicked('front', e.target.files[0]);
    $('#backInput').onchange = (e) => onPhotoPicked('back', e.target.files[0]);
    $('#exportBtn').onclick = exportBackup;
    $('#importInput').onchange = (e) => importBackup(e.target.files[0]);

    $('#searchInput').addEventListener('input', (e) => {
      state.filters.q = e.target.value;
      renderGrid();
    });
    $('#sortSelect').onchange = (e) => {
      state.sort = e.target.value;
      renderGrid();
    };
    $$('[data-filter]').forEach((sel) =>
      sel.addEventListener('change', () => {
        state.filters[sel.dataset.filter] = sel.value;
        renderChips();
        renderGrid();
      })
    );
    $('#resetFiltersBtn').onclick = () => {
      for (const k of Object.keys(FILTER_FIELDS)) state.filters[k] = '';
      renderChips();
      renderGrid();
    };
    $$('[data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        state.view = b.dataset.view;
        renderGrid();
      })
    );
    $('#clearFiltersBtn').onclick = () => {
      state.filters = { q: '', category: '', owner: '', status: '', sport: '', player: '', team: '', era: '', brand: '' };
      $('#searchInput').value = '';
      render();
    };

    document.addEventListener('click', async (e) => {
      const t = e.target;
      const pick = t.closest('[data-pick-owner]');
      if (pick) {
        $('#cardForm').owner.value = pick.dataset.pickOwner;
        $$('#ownerPicks .chip').forEach((c) => c.classList.toggle('active', c === pick));
        return;
      }
      const chipEl = t.closest('.chip[data-cat], .chip[data-owner], .chip[data-status]');
      if (chipEl) {
        if ('cat' in chipEl.dataset) state.filters.category = chipEl.dataset.cat;
        if ('owner' in chipEl.dataset) state.filters.owner = chipEl.dataset.owner;
        if ('status' in chipEl.dataset) state.filters.status = chipEl.dataset.status;
        renderChips();
        renderGrid();
        return;
      }
      if (t.closest('[data-close]')) return t.closest('dialog').close();
      if (t.closest('[data-flip-btn]')) {
        t.closest('.card-tile').querySelector('[data-flip]').classList.toggle('flipped');
        return;
      }
      const side = t.closest('[data-side]');
      if (side) {
        const flip = $('#detailBody [data-flip]');
        flip.classList.toggle('flipped', side.dataset.side === 'back');
        $$('#detailBody [data-side]').forEach((b) => b.classList.toggle('active', b === side));
        return;
      }
      if (t.closest('#detailBody [data-flip]')) {
        const flip = t.closest('[data-flip]');
        flip.classList.toggle('flipped');
        const back = flip.classList.contains('flipped');
        $$('#detailBody [data-side]').forEach((b) => b.classList.toggle('active', (b.dataset.side === 'back') === back));
        return;
      }
      const tile = t.closest('.card-tile');
      if (tile) return openDetail(tile.dataset.id);

      const el = t.closest('[data-sell],[data-edit],[data-mark-sold],[data-unlist],[data-copy],[data-go-ebay],[data-download-photos],[data-open-settings]');
      if (!el) return;
      const d = el.dataset;
      if (d.sell) openSell(d.sell);
      else if (d.edit) openEditor(state.cards.find((c) => c.id === d.edit));
      else if (d.goEbay) goToEbay(d.goEbay);
      else if (d.downloadPhotos) downloadPhotos(d.downloadPhotos);
      else if ('openSettings' in d) {
        e.preventDefault();
        $('#sellDialog').close();
        openSettings();
      } else if (d.copy) {
        const ok = await copy($(d.copy).value);
        toast(ok ? 'Copied!' : 'Could not copy. Select the text and copy it yourself.');
      } else if (d.markSold) {
        const c = state.cards.find((x) => x.id === d.markSold);
        const v = await ask({ title: `What did ${c.player} sell for?`, input: { value: c.listing?.startingBid ?? '' }, ok: 'Mark as sold' });
        if (v === null) return;
        await updateCard(c.id, { status: 'sold', soldPrice: num(v.replace(/[$,]/g, '')), soldAt: Date.now() });
        toast(`Sold! 🎉 ${money(c.soldPrice)}`);
        openDetail(c.id);
      } else if (d.unlist) {
        await updateCard(d.unlist, { status: 'collection' });
        openDetail(d.unlist);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList?.contains('card-tile')) openDetail(e.target.dataset.id);
    });

    // Click on the dark backdrop closes a dialog.
    $$('dialog').forEach((dlg) =>
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
      })
    );
  }

  window.Dugout = {
    state, render, renderGrid, openEditor, openDetail, openSell, updateCard, toast, esc, money, uid,
    imageUrl, hydrateImages, cardFaces, filteredCards, gain, copy, resizeImage, STATUS, load, openSettings, ask, sportOf, eraOf,
  };

  bind();
  window.Dugout.ready = load().catch((err) => {
    console.error(err);
    toast('Could not open the collection on this browser.');
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
