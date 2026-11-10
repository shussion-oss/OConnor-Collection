/* Small, dependency-free SVG line chart with a hover crosshair + tooltip.
   series: [{ name, color, dashed?, points: [{ date: 'YYYY-MM-DD', value: number }] }] */
const Charts = (() => {
  const W = 640, H = 240, PAD = { t: 18, r: 96, b: 30, l: 56 };
  const fmt$ = (v) => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 2 : 0 });
  const fmtDate = (d) => new Date(d + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  const t = (d) => new Date(d + 'T00:00').getTime();

  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
  }

  function lineChart(series, { emptyText = 'Not enough history yet.' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'chart';
    const all = series.flatMap((s) => s.points);
    if (!all.length) {
      wrap.innerHTML = `<p class="help center">${emptyText}</p>`;
      return wrap;
    }
    const dates = [...new Set(all.map((p) => p.date))].sort();
    let x0 = t(dates[0]), x1 = t(dates[dates.length - 1]);
    if (x0 === x1) { x0 -= 86400000 * 3; x1 += 86400000 * 3; }
    const yMax = niceMax(Math.max(...all.map((p) => p.value)) * 1.08);
    const X = (d) => PAD.l + ((t(d) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const Y = (v) => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b);

    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => {
        const v = yMax * f, y = Y(v);
        return `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" class="grid"/>
                <text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" class="axis">${fmt$(v)}</text>`;
      })
      .join('');
    const xTicks = (dates.length <= 4 ? dates : [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]])
      .map((d) => `<text x="${X(d)}" y="${H - 8}" text-anchor="middle" class="axis">${fmtDate(d)}</text>`)
      .join('');

    // Direct labels at the end of each line, nudged apart so they never collide.
    const ends = series
      .filter((s) => s.points.length)
      .map((s) => ({ s, p: s.points[s.points.length - 1], y: Y(s.points[s.points.length - 1].value) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;

    const lines = series
      .map((s) => {
        if (!s.points.length) return '';
        const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
        const dots = s.points
          .map((p) => `<circle cx="${X(p.date)}" cy="${Y(p.value)}" r="4" fill="${s.color}" class="dot"/>`)
          .join('');
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="6 5"' : ''}/>${dots}`;
      })
      .join('');
    const labels = ends
      .map(({ s, p, y }) => `<text x="${X(p.date) + 10}" y="${y + 4}" class="dlabel"><tspan class="dname">${s.name}</tspan> ${fmt$(p.value)}</text>`)
      .join('');

    wrap.innerHTML = `
      ${series.length > 1 ? `<div class="legend">${series
        .map((s) => `<span><svg width="22" height="10"><line x1="1" x2="21" y1="5" y2="5" stroke="${s.color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/></svg>${s.name}</span>`)
        .join('')}</div>` : ''}
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s.name).join(' and ')} over time">
        ${grid}${xTicks}
        <line class="crosshair" y1="${PAD.t}" y2="${H - PAD.b}" x1="0" x2="0" visibility="hidden"/>
        ${lines}${labels}
        <rect class="hit" x="${PAD.l}" y="${PAD.t}" width="${W - PAD.l - PAD.r}" height="${H - PAD.t - PAD.b}" fill="transparent"/>
      </svg>
      <div class="tip" hidden></div>
      <details class="table-view"><summary>Show as a table</summary>
        <table><thead><tr><th>Date</th>${series.map((s) => `<th>${s.name}</th>`).join('')}</tr></thead><tbody>
        ${dates
          .map((d) => `<tr><td>${fmtDate(d)}</td>${series
            .map((s) => { const p = s.points.find((q) => q.date === d); return `<td>${p ? fmt$(p.value) : '—'}</td>`; })
            .join('')}</tr>`)
          .join('')}
        </tbody></table></details>`;

    // Hover: snap to the nearest date, show every series' value there.
    const svg = wrap.querySelector('svg'), tip = wrap.querySelector('.tip'), cross = wrap.querySelector('.crosshair');
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      const d = dates.reduce((best, cur) => (Math.abs(X(cur) - px) < Math.abs(X(best) - px) ? cur : best), dates[0]);
      const x = X(d);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<strong>${fmtDate(d)}</strong>${series
        .map((s) => {
          const p = [...s.points].reverse().find((q) => q.date <= d);
          return p ? `<div><i style="background:${s.color}"></i>${s.name}: <b>${fmt$(p.value)}</b></div>` : '';
        })
        .join('')}`;
      const left = (x / W) * r.width;
      tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
    };
    const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    const hit = wrap.querySelector('.hit');
    hit.addEventListener('mousemove', move);
    hit.addEventListener('touchstart', move, { passive: true });
    hit.addEventListener('touchmove', move, { passive: true });
    hit.addEventListener('mouseleave', leave);
    return wrap;
  }

  return { lineChart };
})();
