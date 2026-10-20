// Tiny dependency-free SVG charts.
import { esc, money0, money } from './util.js';

export function barChart(data, { height = 180, series = [] } = {}) {
  // data: [{label, values:{key:number}}], series: [{key,label,color}]
  const W = 600, H = height, pl = 44, pb = 22, pt = 10;
  const max = Math.max(1, ...data.flatMap(d => series.map(s => d.values[s.key] || 0)));
  const nice = niceMax(max);
  const groupW = (W - pl) / Math.max(1, data.length);
  const barW = Math.min(22, (groupW - 12) / series.length);
  const y = (v) => pt + (H - pt - pb) * (1 - v / nice);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = nice * i / 4; g += `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${money0(v)}</text>`; }
  data.forEach((d, i) => {
    const gx = pl + i * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, j) => {
      const v = d.values[s.key] || 0; const bh = (H - pt - pb) - (y(v) - pt);
      g += `<rect x="${gx + j * barW}" y="${y(v)}" width="${barW - 2}" height="${Math.max(0, bh)}" rx="3" fill="${s.color}" ${s.dashed ? 'fill-opacity="0.35"' : ''}><title>${esc(d.label)} · ${esc(s.label)}: ${money(v)}</title></rect>`;
    });
    g += `<text x="${pl + i * groupW + groupW / 2}" y="${H - 6}" text-anchor="middle" class="axis${d.current ? ' cur' : ''}">${esc(d.label)}</text>`;
  });
  const legend = series.map(s => `<span><i style="background:${s.color};${s.dashed ? 'opacity:.4' : ''}"></i>${esc(s.label)}</span>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${g}</svg><div class="legend">${legend}</div></div>`;
}

export function donut(parts, { size = 140, label = '' } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 52, c = 2 * Math.PI * r; let off = 0; let arcs = '';
  if (total > 0) for (const p of parts) {
    if (!p.value) continue;
    const len = c * p.value / total;
    arcs += `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${p.color}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(p.label)}: ${money(p.value)}</title></circle>`;
    off += len;
  } else arcs = `<circle r="${r}" cx="70" cy="70" fill="none" class="donut-empty" stroke-width="18"/>`;
  const legend = parts.map(p => `<div class="lg-row"><i style="background:${p.color}"></i><span>${esc(p.label)}</span><b>${money(p.value)}</b></div>`).join('');
  return `<div class="donut"><svg viewBox="0 0 140 140" width="${size}" height="${size}" role="img" aria-label="Income by invoice method">${arcs}<text x="70" y="66" text-anchor="middle" class="donut-total">${money0(total)}</text><text x="70" y="84" text-anchor="middle" class="axis">${esc(label)}</text></svg><div class="donut-legend">${legend}</div></div>`;
}

function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
