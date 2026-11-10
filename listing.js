/* Builds an eBay listing (title, description, starting bid) from a card. */
const Listing = (() => {
  const TITLE_MAX = 80; // eBay's title limit

  const has = (card, word) =>
    (card.categories || []).some((c) => c.toLowerCase().includes(word));

  function gradeText(card) {
    if (!card.gradeCompany) return '';
    return `${card.gradeCompany} ${card.grade || ''}`.trim();
  }

  function title(card) {
    const parts = [
      card.year,
      card.brand,
      card.cardNumber ? `#${String(card.cardNumber).replace(/^#/, '')}` : '',
      card.player,
      has(card, 'rookie') ? 'RC Rookie' : '',
      has(card, 'auto') ? 'Auto' : '',
      gradeText(card),
      card.team,
      card.sport && card.sport !== 'Other' ? `${card.sport} Card` : card.sport === 'Other' ? 'Trading Card' : 'Baseball Card',
    ].filter(Boolean);

    // Add words one at a time so we never cut a word in half at 80 chars.
    let out = '';
    for (const p of parts) {
      const next = out ? `${out} ${p}` : String(p);
      if (next.length > TITLE_MAX) continue;
      out = next;
    }
    return out;
  }

  function conditionLine(card) {
    if (card.gradeCompany) {
      return `Professionally graded ${gradeText(card)}. The card stays sealed in the original slab.`;
    }
    if (card.condition) {
      return `Raw (ungraded) card in ${card.condition} condition. Please see the front and back photos. They are part of the description.`;
    }
    return 'Raw (ungraded) card. Please see the front and back photos. They are part of the description.';
  }

  function description(card, settings) {
    const lines = [];
    const name = [card.year, card.brand, card.player].filter(Boolean).join(' ');
    lines.push(`${name}${card.cardNumber ? ` #${String(card.cardNumber).replace(/^#/, '')}` : ''}`);
    lines.push('');

    const details = [
      ['Sport', card.sport || 'Baseball'],
      ['Player', card.player],
      ['Year', card.year],
      ['Manufacturer / Set', card.brand],
      ['Card Number', card.cardNumber],
      ['Team', card.team],
      ['Position', card.position],
      ['Grading', card.gradeCompany ? gradeText(card) : 'Ungraded'],
      ['Condition', card.gradeCompany ? '' : card.condition],
      ['Highlights', (card.categories || []).join(', ')],
    ].filter(([, v]) => v);
    for (const [k, v] of details) lines.push(`• ${k}: ${v}`);
    lines.push('');

    lines.push(conditionLine(card));
    if (card.description) {
      lines.push('');
      lines.push(card.description.trim());
    }
    lines.push('');
    lines.push('This card comes from our family collection. It has been kept with care and stored in a sleeve.');
    if (settings.shippingNote) {
      lines.push('');
      lines.push(settings.shippingNote);
    }
    lines.push('');
    lines.push('Thanks for looking, and please check out our other listings!');
    return lines.join('\n');
  }

  /** Price ending in .99 (or a whole dollar under $1), never below $0.99. */
  function niceBid(amount) {
    if (!amount || amount < 1.5) return 0.99;
    return Math.max(0.99, Math.floor(amount) - 0.01);
  }

  function startingBid(card, settings) {
    const pct = (Number(settings.bidPercent) || 70) / 100;
    const est = Number(card.estValue) || 0;
    const paid = Number(card.purchasePrice) || 0;
    let basis = est || paid;
    let reason;
    if (est) reason = `${Math.round(pct * 100)}% of the $${est.toFixed(2)} estimated value`;
    else if (paid) reason = `${Math.round(pct * 100)}% of the $${paid.toFixed(2)} you paid (add an estimated value for a better suggestion)`;
    else reason = 'No price info yet, so we start at the classic $0.99 to get bidding going';
    const bid = basis ? niceBid(basis * pct) : 0.99;
    return { bid, reason };
  }

  /** eBay sold listings for this card. highestFirst sorts by price, highest at the top. */
  function soldSearchUrl(card, { highestFirst = false } = {}) {
    const q = [card.year, card.brand, card.player, card.cardNumber ? `#${card.cardNumber}` : '', gradeText(card)]
      .filter(Boolean)
      .join(' ');
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sacat=212&LH_Sold=1&LH_Complete=1${highestFirst ? '&_sop=16' : ''}`;
  }

  const sellUrl = () => 'https://www.ebay.com/sl/sell';
  const storeUrl = (user) => (user ? `https://www.ebay.com/usr/${encodeURIComponent(user)}` : '');

  return { title, description, startingBid, soldSearchUrl, sellUrl, storeUrl, TITLE_MAX };
})();
