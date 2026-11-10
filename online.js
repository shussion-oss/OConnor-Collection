/* Talks to the Supabase Edge Functions (AI card reading + eBay listing). */
const Online = (() => {
  const cfg = () => window.DUGOUT_CONFIG || {};
  const configured = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);

  const blobToBase64 = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });

  async function call(fn, { familyCode, body, query } = {}) {
    if (!configured()) throw new Error('Online features are not set up yet.');
    const url = `${cfg().supabaseUrl.replace(/\/$/, '')}/functions/v1/${fn}${query ? `?${new URLSearchParams(query)}` : ''}`;
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        apikey: cfg().supabaseAnonKey,
        'x-family-code': familyCode || '',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error */ }
    if (!res.ok || data.error) throw new Error(data.error || `Server error (${res.status})`);
    return data;
  }

  /** Images must be JPEG/PNG blobs. Returns suggested card fields. */
  async function identify(familyCode, frontBlob, backBlob) {
    const images = [];
    for (const b of [frontBlob, backBlob]) {
      if (b) images.push({ media_type: b.type === 'image/png' ? 'image/png' : 'image/jpeg', data: await blobToBase64(b) });
    }
    return call('identify-card', { familyCode, body: { images } });
  }

  const ebayStatus = (familyCode) => call('ebay', { familyCode, query: { action: 'status' } });
  const ebayAuthUrl = (familyCode, returnTo) => call('ebay', { familyCode, query: { action: 'auth-url', return_to: returnTo } });
  const ebayList = (familyCode, payload) => call('ebay', { familyCode, query: { action: 'list' }, body: payload });

  return { configured, identify, ebayStatus, ebayAuthUrl, ebayList, blobToBase64 };
})();
