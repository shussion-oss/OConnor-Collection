/* Extra features: binder view, trophies, chase list, set checklists, value history,
   AI "fill in from photos", and one-tap eBay listing. Hooks into app.js via window.DugoutExtras. */
(() => {
  const D = window.Dugout;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const { esc, money, toast, state } = D;
  const today = () => new Date().toISOString().slice(0, 10);

  const ex = {
    wants: [],
    sets: [],
    history: [],
    badges: null, // { id: dateUnlocked }
    binderPage: 0,
    ready: false,
  };

  // =====================================================================
  // Confetti 🎉
  // =====================================================================
  function confetti() {
    const c = $('#confetti');
    const ctx = c.getContext('2d');
    c.width = innerWidth * devicePixelRatio;
    c.height = innerHeight * devicePixelRatio;
    c.classList.add('on');
    // Re-open as a popover so it lands in the top layer, above any open dialog.
    if (c.showPopover) { try { c.hidePopover(); } catch { /* not open */ } c.showPopover(); }
    const colors = ['#f2c14e', '#d6332b', '#1f8a4c', '#3665f3', '#ffffff'];
    const parts = Array.from({ length: 160 }, () => ({
      x: c.width / 2 + (Math.random() - 0.5) * c.width * 0.3,
      y: c.height * 0.35,
      vx: (Math.random() - 0.5) * 22 * devicePixelRatio,
      vy: (Math.random() * -18 - 6) * devicePixelRatio,
      s: (Math.random() * 8 + 5) * devicePixelRatio,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      col: colors[(Math.random() * colors.length) | 0],
    }));
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.vy += 0.6 * devicePixelRatio;
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (now - start < 2800) requestAnimationFrame(frame);
      else {
        ctx.clearRect(0, 0, c.width, c.height);
        c.classList.remove('on');
        if (c.hidePopover) { try { c.hidePopover(); } catch { /* already closed */ } }
      }
    })(start);
  }

  // =====================================================================
  // Binder view (9-pocket pages)
  // =====================================================================
  const PER_PAGE = 9;
  const spread = () => (matchMedia('(min-width: 900px)').matches ? 2 : 1);

  function renderBinder(grid, list) {
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    const per = spread();
    const maxStart = Math.max(0, Math.floor((pages - 1) / per) * per);
    ex.binderPage = Math.min(Math.floor(ex.binderPage / per) * per, maxStart);

    const pageHtml = (pi) => {
      if (pi >= pages) return `<div class="binder-page">${'<div class="pocket pocket-empty"></div>'.repeat(PER_PAGE)}<div class="page-num"></div></div>`;
      const slots = Array.from({ length: PER_PAGE }, (_, i) => list[pi * PER_PAGE + i]);
      return `<div class="binder-page">
        ${slots
          .map((c) =>
            c
              ? `<button class="pocket" data-pocket="${c.id}" title="${esc(c.player)}">
                   <span class="pocket-img" data-img="${esc(c.frontImg || '')}">${c.frontImg ? '' : `<span class="noimg">⚾<br>${esc(c.player)}</span>`}</span>
                   ${c.favorite ? '<span class="pocket-fav">⭐</span>' : ''}
                   ${c.status === 'sold' ? '<span class="pocket-sold">SOLD</span>' : ''}
                 </button>`
              : `<div class="pocket pocket-empty"></div>`
          )
          .join('')}
        <div class="page-num">Page ${pi + 1}</div>
      </div>`;
    };

    const owner = state.filters.owner;
    grid.innerHTML = `
      <div class="binder-wrap">
        <div class="binder-title">${owner ? `${esc(owner)}'s Binder` : 'The Family Binder'} <small>${list.length} card${list.length === 1 ? '' : 's'}</small></div>
        <div class="binder ${per === 2 ? 'spread' : ''} turn">
          ${Array.from({ length: per }, (_, k) => pageHtml(ex.binderPage + k)).join('<div class="binder-rings"><i></i><i></i><i></i></div>')}
        </div>
        <div class="binder-nav">
          <button class="btn ghost" data-binder="prev" ${ex.binderPage === 0 ? 'disabled' : ''}>◀ Prev</button>
          <span>Page ${ex.binderPage + 1}${per === 2 && ex.binderPage + 2 <= pages ? `–${ex.binderPage + 2}` : ''} of ${pages}</span>
          <button class="btn ghost" data-binder="next" ${ex.binderPage + per >= pages ? 'disabled' : ''}>Next ▶</button>
        </div>
        <p class="help center">Tip: pick a collector above to see just their binder.</p>
      </div>`;
    D.hydrateImages(grid);
  }

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-binder]');
    if (nav) {
      ex.binderPage += (nav.dataset.binder === 'next' ? 1 : -1) * spread();
      ex.binderPage = Math.max(0, ex.binderPage);
      D.renderGrid();
      return;
    }
    const pocket = e.target.closest('[data-pocket]');
    if (pocket) D.openDetail(pocket.dataset.pocket);
  });
  // Swipe to turn pages on phones.
  let touchX = null;
  document.addEventListener('touchstart', (e) => { if (e.target.closest('.binder')) touchX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 60) return;
    const btn = $(`[data-binder="${dx < 0 ? 'next' : 'prev'}"]`);
    if (btn && !btn.disabled) btn.click();
  });

  // =====================================================================
  // Trophies
  // =====================================================================
  const owned = () => state.cards.filter((c) => c.status !== 'sold');
  const hasCat = (c, w) => (c.categories || []).some((x) => x.toLowerCase().includes(w));
  const countBy = (arr, key) => arr.reduce((m, c) => (c[key] ? ((m[c[key].toLowerCase()] = (m[c[key].toLowerCase()] || 0) + 1), m) : m), {});
  const maxCount = (arr, key) => Math.max(0, ...Object.values(countBy(arr, key)));

  const BADGES = [
    { id: 'first', icon: '🎉', name: 'Opening Day', hint: 'Add your first card', test: () => state.cards.length >= 1 },
    { id: 'ten', icon: '🔟', name: 'Double Digits', hint: 'Collect 10 cards', test: () => owned().length >= 10 },
    { id: 'quarter', icon: '🥉', name: 'Quarter Century', hint: 'Collect 25 cards', test: () => owned().length >= 25 },
    { id: 'fifty', icon: '🥈', name: 'Half Century', hint: 'Collect 50 cards', test: () => owned().length >= 50 },
    { id: 'hundred', icon: '💯', name: 'Century Club', hint: 'Collect 100 cards', test: () => owned().length >= 100 },
    { id: 'rookie', icon: '🌱', name: 'Rookie Scout', hint: 'Add a rookie card', test: () => state.cards.some((c) => hasCat(c, 'rookie')) },
    { id: 'hof', icon: '🏛️', name: 'Cooperstown Bound', hint: 'Add a Hall of Famer', test: () => state.cards.some((c) => hasCat(c, 'hall of fame')) },
    { id: 'auto', icon: '✍️', name: 'Signed & Sealed', hint: 'Add an autographed card', test: () => state.cards.some((c) => hasCat(c, 'autograph')) },
    { id: 'vintage', icon: '⏳', name: 'Time Traveler', hint: 'Own a card from before 1980', test: () => state.cards.some((c) => c.year && c.year < 1980) },
    { id: 'oldtimer', icon: '🎩', name: 'Old Timer', hint: 'Own a card from before 1960', test: () => state.cards.some((c) => c.year && c.year < 1960) },
    { id: 'decades', icon: '📅', name: 'Decade Hopper', hint: 'Own cards from 4 different decades', test: () => new Set(state.cards.filter((c) => c.year).map((c) => Math.floor(c.year / 10))).size >= 4 },
    { id: 'graded', icon: '🛡️', name: 'Slabbed', hint: 'Own a professionally graded card', test: () => state.cards.some((c) => c.gradeCompany) },
    { id: 'gem', icon: '💎', name: 'Gem Mint 10', hint: 'Own a card graded 10', test: () => state.cards.some((c) => c.gradeCompany && parseFloat(c.grade) === 10) },
    { id: 'team', icon: '🧢', name: 'Team Spirit', hint: 'Own 5 cards from the same team', test: () => maxCount(state.cards, 'team') >= 5 },
    { id: 'superfan', icon: '🙌', name: 'Superfan', hint: 'Own 3 cards of the same player', test: () => maxCount(state.cards, 'player') >= 3 },
    { id: 'photos', icon: '📸', name: 'Shutterbug', hint: 'Photograph front & back of 10 cards', test: () => state.cards.filter((c) => c.frontImg && c.backImg).length >= 10 },
    { id: 'favs', icon: '⭐', name: 'Fan Favorites', hint: 'Star 5 favorite cards', test: () => state.cards.filter((c) => c.favorite).length >= 5 },
    { id: 'family', icon: '👨‍👦‍👦', name: 'Family Affair', hint: 'Cards belong to 3 different collectors', test: () => new Set(state.cards.map((c) => c.owner).filter(Boolean)).size >= 3 },
    { id: 'smart', icon: '📈', name: 'Smart Buy', hint: 'A card worth more than you paid', test: () => state.cards.some((c) => (D.gain(c) || 0) > 0) },
    { id: 'double', icon: '🚀', name: 'Doubled Up', hint: 'A card worth 2× what you paid', test: () => state.cards.some((c) => c.purchasePrice > 0 && c.estValue >= 2 * c.purchasePrice) },
    { id: 'benjamin', icon: '💵', name: 'Benjamin', hint: 'Collection worth $100+', test: () => owned().reduce((s, c) => s + (c.estValue ?? c.purchasePrice ?? 0), 0) >= 100 },
    { id: 'bigleague', icon: '🏟️', name: 'Big League Collection', hint: 'Collection worth $1,000+', test: () => owned().reduce((s, c) => s + (c.estValue ?? c.purchasePrice ?? 0), 0) >= 1000 },
    { id: 'sale', icon: '🏷️', name: 'First Sale', hint: 'Sell a card on eBay', test: () => state.cards.some((c) => c.status === 'sold') },
    { id: 'bigsale', icon: '💰', name: 'Big Sale', hint: 'Sell a card for $100+', test: () => state.cards.some((c) => c.status === 'sold' && c.soldPrice >= 100) },
    { id: 'chase', icon: '🎯', name: 'Chase Complete', hint: 'Find a card from the Chase List', test: () => ex.wants.some((w) => w.found) },
    { id: 'halfset', icon: '🧩', name: 'Halfway Home', hint: 'Get halfway through a set', test: () => ex.sets.some((s) => setProgress(s).have >= s.total / 2) },
    { id: 'set', icon: '📚', name: 'Set Builder', hint: 'Complete a whole set', test: () => ex.sets.some((s) => setProgress(s).have >= s.total) },
  ];

  async function checkBadges({ silent = false } = {}) {
    if (!state.cards) return;
    const earned = BADGES.filter((b) => { try { return b.test(); } catch { return false; } });
    const fresh = earned.filter((b) => !ex.badges[b.id]);
    if (fresh.length) {
      fresh.forEach((b) => (ex.badges[b.id] = today()));
      await DB.putSetting('badges', ex.badges);
      if (!silent) {
        confetti();
        toast(`🏆 New trophy: ${fresh[0].icon} ${fresh[0].name}!${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`);
      }
    }
    const n = Object.keys(ex.badges).length;
    $('#trophyCount').textContent = n ? n : '';
  }

  function openTrophies() {
    const n = BADGES.filter((b) => ex.badges[b.id]).length;
    $('#trophySummary').textContent = `${n} of ${BADGES.length} trophies earned. Keep collecting to unlock the rest!`;
    $('#trophyList').innerHTML = BADGES.map((b) => {
      const got = ex.badges[b.id];
      return `<div class="trophy ${got ? 'got' : 'locked'}">
        <div class="trophy-icon">${got ? b.icon : '🔒'}</div>
        <div class="trophy-name">${b.name}</div>
        <div class="trophy-hint">${b.hint}</div>
        ${got ? `<div class="trophy-date">Earned ${new Date(got + 'T00:00').toLocaleDateString()}</div>` : ''}
      </div>`;
    }).join('');
    $('#trophyDialog').showModal();
  }

  // =====================================================================
  // Chase list (want list)
  // =====================================================================
  let wantOwner = '';
  const saveWants = () => DB.putSetting('wants', ex.wants);

  function renderWants() {
    const owners = [...new Set(ex.wants.map((w) => w.owner).filter(Boolean))].sort();
    $('#wantOwnerChips').innerHTML = owners.length
      ? [['', 'Everyone'], ...owners.map((o) => [o, o])]
          .map(([v, l]) => `<button type="button" class="chip ${wantOwner === v ? 'active' : ''}" data-want-owner="${esc(v)}">${esc(l)}</button>`)
          .join('')
      : '';
    const list = ex.wants.filter((w) => !wantOwner || w.owner === wantOwner);
    const hunting = list.filter((w) => !w.found);
    const found = list.filter((w) => w.found);
    const row = (w) => {
      const q = [w.year, w.brand, w.player, w.cardNumber ? `#${w.cardNumber}` : ''].filter(Boolean).join(' ');
      return `<div class="want ${w.found ? 'found' : ''}">
        <div class="want-main">
          <strong>${esc(w.player)}</strong>
          <span class="meta">${esc([w.year, w.brand, w.cardNumber ? '#' + w.cardNumber : ''].filter(Boolean).join(' · '))}</span>
          <span class="meta">${w.owner ? `For ${esc(w.owner)}` : ''}${w.maxPrice ? ` · up to ${money(w.maxPrice)}` : ''}${w.found ? ` · found ${new Date(w.found + 'T00:00').toLocaleDateString()} ✅` : ''}</span>
        </div>
        <div class="want-actions">
          ${w.found ? '' : `<a class="btn small ghost" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sacat=212">🔍 eBay</a>
          <button class="btn small primary" data-want-found="${w.id}">Found it!</button>`}
          <button class="icon-btn" title="Remove" data-want-del="${w.id}">🗑</button>
        </div>
      </div>`;
    };
    $('#wantList').innerHTML =
      (hunting.length ? hunting.map(row).join('') : `<p class="help center">Nothing on the chase list yet. Add a card you're hunting for above!</p>`) +
      (found.length ? `<h4 class="found-head">Found 🎉</h4>${found.map(row).join('')}` : '');
  }

  // =====================================================================
  // Set checklists
  // =====================================================================
  const saveSets = () => DB.putSetting('sets', ex.sets);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function setProgress(set) {
    const nums = new Set();
    for (const c of state.cards) {
      if (c.status === 'sold' || Number(c.year) !== Number(set.year)) continue;
      if (!norm(c.brand).includes(norm(set.brand))) continue;
      const n = parseInt(String(c.cardNumber || '').replace(/[^0-9]/g, ''), 10);
      if (n >= 1 && n <= set.total) nums.add(n);
    }
    return { have: nums.size, nums };
  }

  function renderSets() {
    $('#setList').innerHTML = ex.sets.length
      ? ex.sets
          .map((s) => {
            const { have, nums } = setProgress(s);
            const pct = Math.round((have / s.total) * 100);
            const cells = Array.from({ length: s.total }, (_, i) => `<span class="${nums.has(i + 1) ? 'have' : ''}" title="#${i + 1}">${i + 1}</span>`).join('');
            return `<div class="set ${have >= s.total ? 'complete' : ''}">
              <div class="set-head">
                <div><strong>${esc(s.name || `${s.year} ${s.brand}`)}</strong> <span class="meta">${s.name ? `${s.year} ${esc(s.brand)} · ` : ''}${have} of ${s.total}</span></div>
                <div class="set-actions">${have >= s.total ? '🏆 Complete!' : `${pct}%`}<button class="icon-btn" data-set-del="${s.id}" title="Remove">🗑</button></div>
              </div>
              <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
              <details><summary>Show checklist (green = got it)</summary><div class="set-grid">${cells}</div></details>
            </div>`;
          })
          .join('')
      : `<p class="help center">No sets yet. Add one above. For example: 1987, Topps, 792 cards.</p>`;
  }

  async function checkSetCompletions() {
    let changed = false;
    for (const s of ex.sets) {
      const done = setProgress(s).have >= s.total;
      if (done && !s.completedAt) {
        s.completedAt = today();
        changed = true;
        if (ex.ready) { confetti(); toast(`📚 You completed the ${s.name || `${s.year} ${s.brand}`} set!`); }
      } else if (!done && s.completedAt) { s.completedAt = null; changed = true; }
    }
    if (changed) await saveSets();
  }

  // =====================================================================
  // Value history
  // =====================================================================
  async function snapshot() {
    const own = owned();
    if (!own.length) return;
    const point = {
      date: today(),
      paid: Math.round(own.reduce((s, c) => s + (c.purchasePrice || 0), 0) * 100) / 100,
      value: Math.round(own.reduce((s, c) => s + (c.estValue ?? c.purchasePrice ?? 0), 0) * 100) / 100,
    };
    const last = ex.history[ex.history.length - 1];
    if (last && last.date === point.date) {
      if (last.paid === point.paid && last.value === point.value) return;
      ex.history[ex.history.length - 1] = point;
    } else ex.history.push(point);
    await DB.putSetting('history', ex.history);
  }

  function openStats() {
    const body = $('#statsBody');
    body.innerHTML = '';
    const chart = Charts.lineChart(
      [
        { name: 'Worth', color: '#1f8a4c', points: ex.history.map((h) => ({ date: h.date, value: h.value })) },
        { name: 'Paid', color: '#b8892a', dashed: true, points: ex.history.map((h) => ({ date: h.date, value: h.paid })) },
      ],
      { emptyText: 'Add some cards and the chart starts here. It saves a snapshot each day you use the app.' }
    );
    body.appendChild(chart);
    const movers = state.cards
      .filter((c) => c.status !== 'sold' && D.gain(c) != null)
      .sort((a, b) => D.gain(b) - D.gain(a));
    const top = movers.slice(0, 5);
    body.insertAdjacentHTML(
      'beforeend',
      `<p class="help">A snapshot is saved each day the app is opened. Update card values now and then (open a card → <strong>Update value</strong>) to watch the collection grow.</p>
      ${top.length ? `<h3 class="sub">Biggest winners</h3><ol class="movers">${top
        .map((c) => `<li data-pocket="${c.id}"><span>${esc(c.player)} <small class="meta">${esc([c.year, c.brand].filter(Boolean).join(' '))}</small></span><b class="${D.gain(c) >= 0 ? 'up' : 'down'}">${D.gain(c) >= 0 ? '+' : '−'}${money(Math.abs(D.gain(c)))}</b></li>`)
        .join('')}</ol>` : ''}`
    );
    $('#statsDialog').showModal();
  }

  function decorateDetail(card, root) {
    const box = $('.money-box', root);
    if (!box) return;
    const hist = card.valueHistory || [];
    const section = document.createElement('div');
    section.className = 'value-section';
    section.innerHTML = `<div class="value-head"><h4>Value over time</h4>
      <div>${Online.configured() ? `<button class="btn small ai" data-detail-price="${card.id}">💰 Check sold prices</button>` : ''}
      <button class="btn small ghost" data-update-value="${card.id}">💲 Update value</button>
      <a class="btn small ghost" target="_blank" rel="noopener" href="${Listing.soldSearchUrl(card, { highestFirst: true })}">📈 Recent sales</a></div></div>
      <div class="price-result" data-price-out="${card.id}">${lastResults[card.id]
        ? priceResultHtml(lastResults[card.id], card.id)
        : card.priceCheck?.highest ? lastCheckHtml(card.priceCheck) : ''}</div>`;
    if (hist.length) {
      const paidPts = card.purchasePrice != null
        ? [{ date: card.purchaseDate && card.purchaseDate < hist[0].date ? card.purchaseDate : hist[0].date, value: card.purchasePrice }, { date: hist[hist.length - 1].date, value: card.purchasePrice }]
        : [];
      section.appendChild(Charts.lineChart([
        { name: 'Worth', color: '#1f8a4c', points: hist },
        ...(paidPts.length ? [{ name: 'Paid', color: '#b8892a', dashed: true, points: paidPts }] : []),
      ]));
    } else {
      section.insertAdjacentHTML('beforeend', `<p class="help">Tap <strong>Update value</strong> to start tracking what this card is worth.</p>`);
    }
    box.after(section);
  }

  document.addEventListener('click', async (e) => {
    const up = e.target.closest('[data-update-value]');
    if (!up) return;
    const c = state.cards.find((x) => x.id === up.dataset.updateValue);
    const v = await D.ask({ title: `What's ${c.player} worth today?`, message: 'Tip: tap “Recent sales” to see what this card actually sold for on eBay.', input: { value: c.estValue ?? '' }, ok: 'Save value' });
    if (v === null) return;
    const value = Number(String(v).replace(/[$,]/g, ''));
    if (!isFinite(value) || value < 0) return toast('Please enter a dollar amount.');
    await setCardValue(c, value);
    toast('Value updated');
  });

  // Saves a new estimated value and adds it to the card's value history.
  async function setCardValue(c, value) {
    const hist = [...(c.valueHistory || [])];
    if (hist.length && hist[hist.length - 1].date === today()) hist.pop();
    hist.push({ date: today(), value });
    await D.updateCard(c.id, { estValue: value, valueHistory: hist });
    D.openDetail(c.id);
  }

  // =====================================================================
  // AI: fill in card details from photos
  // =====================================================================
  async function imageBlobFor(side) {
    const pending = state.pendingImages[side];
    if (pending) return pending;
    const key = state.editing?.[`${side}Img`];
    return key ? DB.getImage(key) : null;
  }

  function decorateEditor() {
    $('#aiRow').hidden = !Online.configured();
    $('#aiStatus').textContent = 'Add a front photo (back helps too), then let the computer read the card.';
    $('#priceCheckBtn').hidden = !Online.configured();
    const prev = state.editing?.priceCheck;
    $('#priceResult').innerHTML = prev?.highest ? lastCheckHtml(prev) : '';
    updateSoldLink();
  }

  // =====================================================================
  // Check sold prices (highest sale in the last 6 months)
  // =====================================================================
  const fmtDay = (d) => (d ? new Date(d + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  function formCard() {
    const f = $('#cardForm');
    const v = (n) => (f.elements[n]?.value || '').trim();
    return {
      sport: v('sport'), player: v('player'), year: v('year') ? Number(v('year')) : null, brand: v('brand'),
      cardNumber: v('cardNumber'), team: v('team'), gradeCompany: v('gradeCompany'), grade: v('grade'),
      condition: v('condition'), categories: $$('#formCategories input[name=cat]:checked').map((i) => i.value),
    };
  }

  function updateSoldLink() {
    $('#soldLink').href = Listing.soldSearchUrl(formCard(), { highestFirst: true });
  }

  const lastResults = {}; // card id -> latest full result, kept while the app is open

  const lastCheckHtml = (pc) =>
    `<p class="help">Last check (${fmtDay(pc.checkedOn)}): top sale ${money(pc.highest)}${pc.typical ? `, typical ${money(pc.typical)}` : ''}. Tap “Check sold prices” for fresh numbers.</p>`;

  // target: 'form' (Add/Edit screen) or a card id (detail page) — decides what "Use $X" updates.
  function priceResultHtml(r, target) {
    if (!r.count) {
      return `<p class="help">No sales of this exact card found in the last 6 months. ${esc(r.notes || '')}</p>
        <p class="help">Try the eBay sold listings link. eBay shows about the last 90 days.</p>`;
    }
    const h = r.highest;
    return `
      <div class="price-top">
        <div>
          <div class="price-label">🏆 Highest sale · last 6 months</div>
          <div class="price-big">${money(h.price)}</div>
          <div class="help">${fmtDay(h.date)} · ${esc(h.source)} · ${esc(h.condition)} · <a href="${esc(h.url)}" target="_blank" rel="noopener">see sale ↗</a></div>
        </div>
        <button type="button" class="btn small primary" data-use-price="${h.price}" data-use-for="${esc(target)}">Use ${money(h.price)}</button>
      </div>
      ${r.typical != null ? `<div class="price-typical"><span>Typical price: <strong>${money(r.typical)}</strong> <span class="help">(middle of ${r.count} sale${r.count === 1 ? '' : 's'})</span></span>
        <button type="button" class="btn small ghost" data-use-price="${r.typical}" data-use-for="${esc(target)}">Use ${money(r.typical)}</button></div>` : ''}
      <details class="price-sales"><summary>See all ${r.count} sale${r.count === 1 ? '' : 's'}</summary>
        <ul>${r.sales.map((s) => `<li><b>${money(s.price)}</b> · ${fmtDay(s.date)} · ${esc(s.source)} · ${esc(s.condition)} · <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title.slice(0, 70))}</a></li>`).join('')}</ul>
      </details>
      ${r.notes ? `<p class="help">ℹ️ ${esc(r.notes)}</p>` : ''}`;
  }

  const summaryOf = (r) => ({ checkedOn: r.checkedOn, highest: r.highest?.price ?? null, typical: r.typical, count: r.count, url: r.highest?.url || '' });

  // Runs a check and shows it in `out`. Returns the result, or null if it didn't run.
  async function runPriceCheck(card, out, btn, target) {
    if (!card.player) { toast('Enter the player name first (or use “Fill in from photos”).'); return null; }
    const code = state.settings.familyCode;
    if (!code) { toast('Enter the family code in Settings first.'); return null; }
    btn.disabled = true;
    out.innerHTML = `<p class="help">🔎 Searching sold listings for ${esc([card.year, card.brand, card.player].filter(Boolean).join(' '))}… this takes about 30–60 seconds.</p>`;
    try {
      const r = await Online.priceCheck(code, card);
      out.innerHTML = priceResultHtml(r, target);
      return r;
    } catch (err) {
      out.innerHTML = `<p class="help">⚠️ ${esc(err.message)} You can still check by hand with the eBay sold listings link.</p>`;
      return null;
    } finally {
      btn.disabled = false;
    }
  }

  // Add/Edit screen
  async function priceCheck() {
    const r = await runPriceCheck(formCard(), $('#priceResult'), $('#priceCheckBtn'), 'form');
    if (r) $('#cardForm').dataset.priceCheck = JSON.stringify(summaryOf(r));
  }

  document.addEventListener('click', async (e) => {
    // Card detail page
    const check = e.target.closest('[data-detail-price]');
    if (check) {
      const c = state.cards.find((x) => x.id === check.dataset.detailPrice);
      const out = document.querySelector(`[data-price-out="${c.id}"]`);
      const r = await runPriceCheck(c, out, check, c.id);
      if (r) {
        lastResults[c.id] = r;
        await D.updateCard(c.id, { priceCheck: summaryOf(r) }); // remembered on the card for everyone
      }
      return;
    }
    // "Use $X"
    const use = e.target.closest('[data-use-price]');
    if (!use) return;
    const value = Number(use.dataset.usePrice);
    if (use.dataset.useFor === 'form') {
      $('#cardForm').estValue.value = value.toFixed(2);
      toast(`Estimated value set to ${money(value)}`);
    } else {
      const c = state.cards.find((x) => x.id === use.dataset.useFor);
      if (!c) return;
      await setCardValue(c, value);
      toast(`${c.player} is now worth ${money(value)} 📈`);
    }
  });

  async function aiFill() {
    const code = state.settings.familyCode;
    if (!code) return toast('Enter the family code in Settings first.');
    const front = await imageBlobFor('front');
    const back = await imageBlobFor('back');
    if (!front) return toast('Add a photo of the front of the card first.');
    if (!/jpeg|png/.test(front.type)) return toast('That photo type can’t be read. Try a new photo.');
    const btn = $('#aiFillBtn');
    btn.disabled = true;
    $('#aiStatus').textContent = 'Reading the card… ⚾ (this takes a few seconds)';
    try {
      const r = await Online.identify(code, front, back && /jpeg|png/.test(back.type) ? back : null);
      const f = $('#cardForm');
      const set = (name, v) => { if (v != null && v !== '' && f.elements[name] && !f.elements[name].value) f.elements[name].value = v; };
      if (r.sport && f.sport && [...f.sport.options].some((o) => o.value === r.sport)) f.sport.value = r.sport;
      set('player', r.player); set('year', r.year); set('brand', r.brand); set('cardNumber', r.cardNumber);
      set('team', r.team); set('position', r.position); set('description', r.description);
      if (r.gradeCompany && !f.gradeCompany.value) { f.gradeCompany.value = r.gradeCompany; set('grade', r.grade); }
      if (r.condition && !f.condition.value && [...f.condition.options].some((o) => o.value === r.condition)) f.condition.value = r.condition;
      for (const cat of r.categories || []) {
        const box = $$('#formCategories input[name=cat]').find((i) => i.value.toLowerCase() === String(cat).toLowerCase());
        if (box) box.checked = true;
      }
      $('#aiStatus').textContent = r.player
        ? `✅ Looks like ${[r.year, r.brand, r.player].filter(Boolean).join(' ')}. Double-check the details below.`
        : 'Hmm, couldn’t read that card. Try a clearer, closer photo.';
    } catch (err) {
      $('#aiStatus').textContent = `⚠️ ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  // =====================================================================
  // eBay: connect account + list directly
  // =====================================================================
  async function onSettingsOpen() {
    const sec = $('#onlineSettings');
    if (!Online.configured()) {
      $('#ebayStatus').textContent = 'Online features aren’t set up yet (see README → “Online features”).';
      $('#ebayConnectBtn').hidden = true;
      return;
    }
    $('#ebayConnectBtn').hidden = false;
    const code = $('#settingsForm').familyCode.value.trim();
    if (!code) { $('#ebayStatus').textContent = 'eBay: enter the family code, then connect.'; return; }
    $('#ebayStatus').textContent = 'eBay: checking…';
    try {
      const s = await Online.ebayStatus(code);
      $('#ebayStatus').innerHTML = s.connected ? '✅ eBay account connected' : 'eBay: not connected yet';
      $('#ebayConnectBtn').textContent = s.connected ? '🔄 Reconnect eBay' : '🔗 Connect eBay account';
    } catch (err) {
      $('#ebayStatus').textContent = `eBay: ${err.message}`;
    }
    void sec;
  }

  async function connectEbay() {
    const code = $('#settingsForm').familyCode.value.trim();
    if (!code) return toast('Enter the family code first.');
    // Save the code so it is still there when eBay sends us back.
    state.settings.familyCode = code;
    await DB.putSetting('settings', state.settings);
    try {
      const { url } = await Online.ebayAuthUrl(code, location.href.split('?')[0].split('#')[0]);
      location.href = url;
    } catch (err) {
      toast(err.message);
    }
  }

  function decorateSell(card, root) {
    if (!Online.configured()) return;
    const foot = $('.dialog-foot', root);
    const box = document.createElement('div');
    box.className = 'direct-list';
    box.innerHTML = `
      <div><strong>⚡ One-tap listing</strong>
        <p class="help">Puts this card up for auction on his eBay account with the title, description, starting bid and both photos. Nothing to copy or paste.</p></div>
      <div class="direct-row">
        <label class="help">Auction length
          <select id="sellDuration"><option value="3">3 days</option><option value="5">5 days</option><option value="7" selected>7 days</option><option value="10">10 days</option></select>
        </label>
        <button class="btn ebay" id="directListBtn">List it on eBay now</button>
      </div>
      <div id="directResult" class="help"></div>`;
    foot.before(box);
    $('#directListBtn', box).onclick = () => directList(card);
  }

  async function directList(card) {
    const s = state.settings;
    if (!s.familyCode) return toast('Enter the family code in Settings first.');
    if (!s.zip) return toast('Add the ship-from ZIP code in Settings first.');
    const out = $('#directResult');
    const images = [];
    for (const side of ['front', 'back']) {
      const key = card[`${side}Img`];
      if (!key) continue;
      const blob = await DB.getImage(key);
      if (blob && /jpeg|png/.test(blob.type)) images.push({ media_type: blob.type, data: await Online.blobToBase64(blob) });
    }
    if (!images.length) return toast('Add real front/back photos before listing.');
    const title = $('#sellTitle').value.trim();
    const description = $('#sellDesc').value.trim();
    const startingBid = Number($('#sellBid').value);
    if (!(startingBid >= 0.99)) return toast('Starting bid must be at least $0.99.');
    if (!(await D.ask({ title: 'List it on eBay?', message: `"${title}" with a $${startingBid.toFixed(2)} starting bid.`, ok: 'List it' }))) return;
    const btn = $('#directListBtn');
    btn.disabled = true;
    out.textContent = 'Listing on eBay… this can take up to a minute.';
    try {
      const r = await Online.ebayList(s.familyCode, {
        sku: card.id,
        title, description, startingBid,
        durationDays: Number($('#sellDuration').value),
        zip: s.zip,
        card: {
          sport: card.sport || 'Baseball', player: card.player, year: card.year, brand: card.brand, cardNumber: card.cardNumber, team: card.team,
          position: card.position, condition: card.condition, gradeCompany: card.gradeCompany, grade: card.grade,
          categories: card.categories,
        },
        images,
      });
      await D.updateCard(card.id, {
        status: 'listed', listedAt: Date.now(),
        listing: { title, description, startingBid, ebayListingId: r.listingId, url: r.url },
      });
      out.innerHTML = `✅ Listed! <a href="${esc(r.url)}" target="_blank" rel="noopener">See it on eBay ↗</a>`;
      confetti();
    } catch (err) {
      out.textContent = `⚠️ ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  // =====================================================================
  // Wiring
  // =====================================================================
  async function onCardSaved(card, isNew) {
    if (isNew && card.wantId) {
      const w = ex.wants.find((x) => x.id === card.wantId);
      if (w && !w.found) { w.found = today(); w.cardId = card.id; await saveWants(); }
    }
    await afterRender();
  }

  let rendering = null;
  async function afterRender() {
    if (!ex.ready) return;
    // Serialize so overlapping renders don't double-award trophies.
    rendering = (rendering || Promise.resolve()).then(async () => {
      await snapshot();
      await checkSetCompletions();
      await checkBadges();
    });
    return rendering;
  }

  // Re-read the family lists (called after every load, which may have pulled newer data).
  async function reload() {
    ex.wants = (await DB.getSetting('wants')) || [];
    ex.sets = (await DB.getSetting('sets')) || [];
    ex.history = (await DB.getSetting('history')) || [];
    const saved = await DB.getSetting('badges');
    ex.badges = saved || {};
    if ($('#wantsDialog')?.open) renderWants();
    if ($('#setsDialog')?.open) renderSets();
    return saved;
  }

  async function init() {
    // Wait for the app's first load so we see the cards (and the family's latest data).
    await D.ready;
    const saved = await reload();
    // First run after this update: quietly award what was already earned.
    if (!saved) await checkBadges({ silent: true });
    for (const s of ex.sets) if (setProgress(s).have >= s.total) s.completedAt ||= today();
    ex.ready = true;
    await afterRender();

    $('#trophyBtn').onclick = openTrophies;
    $('#statsBtn').onclick = openStats;
    $('#wantsBtn').onclick = () => { renderWants(); $('#wantsDialog').showModal(); };
    $('#setsBtn').onclick = () => { renderSets(); $('#setsDialog').showModal(); };
    $('#aiFillBtn').onclick = aiFill;
    $('#priceCheckBtn').onclick = priceCheck;
    $('#cardForm').addEventListener('input', updateSoldLink);
    $('#cardForm').addEventListener('change', updateSoldLink);
    $('#soldLink').addEventListener('click', updateSoldLink); // fields filled by AI don't fire input events
    $('#ebayConnectBtn').onclick = connectEbay;

    $('#wantForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      ex.wants.unshift({
        id: D.uid(), player: fd.get('player').trim(), year: fd.get('year') ? Number(fd.get('year')) : null,
        brand: fd.get('brand').trim(), cardNumber: fd.get('cardNumber').trim(), owner: fd.get('owner').trim(),
        maxPrice: fd.get('maxPrice') ? Number(fd.get('maxPrice')) : null, addedAt: today(), found: null,
      });
      await saveWants();
      e.target.reset();
      renderWants();
      toast('Added to the chase list 🎯');
    });
    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      ex.sets.push({ id: D.uid(), year: Number(fd.get('year')), brand: fd.get('brand').trim(), total: Number(fd.get('total')), name: fd.get('name').trim() });
      await saveSets();
      e.target.reset();
      renderSets();
      afterRender();
    });

    document.addEventListener('click', async (e) => {
      const t = e.target;
      const wo = t.closest('[data-want-owner]');
      if (wo) { wantOwner = wo.dataset.wantOwner; renderWants(); return; }
      const del = t.closest('[data-want-del]');
      if (del) { ex.wants = ex.wants.filter((w) => w.id !== del.dataset.wantDel); await saveWants(); renderWants(); return; }
      const found = t.closest('[data-want-found]');
      if (found) {
        const w = ex.wants.find((x) => x.id === found.dataset.wantFound);
        $('#wantsDialog').close();
        D.openEditor(null, { player: w.player, year: w.year, brand: w.brand, cardNumber: w.cardNumber, owner: w.owner, wantId: w.id });
        toast('Nice find! Snap the photos and save it. 🎯');
        return;
      }
      const sd = t.closest('[data-set-del]');
      if (sd && (await D.ask({ title: 'Remove this set checklist?', message: 'Your cards stay put.', ok: 'Remove', danger: true }))) {
        ex.sets = ex.sets.filter((s) => s.id !== sd.dataset.setDel); await saveSets(); renderSets();
      }
      if (t.closest('#statsDialog [data-pocket]')) $('#statsDialog').close();
    });

    // Coming back from eBay's sign-in page.
    const q = new URLSearchParams(location.search);
    if (q.has('ebay')) {
      toast(q.get('ebay') === 'connected' ? '✅ eBay account connected!' : `eBay connection failed: ${q.get('reason') || 'unknown error'}`);
      history.replaceState(null, '', location.pathname);
    }
  }

  window.DugoutExtras = { renderBinder, decorateDetail, decorateSell, decorateEditor, onCardSaved, afterRender, onSettingsOpen, reload };
  init().catch((err) => console.error(err));
})();
