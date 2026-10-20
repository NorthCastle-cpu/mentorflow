// Editable copy of the Guidewell invoice as .docx (opens in Pages, Word and Google Docs). Built on-device:
// a tiny "stored" ZIP writer + hand-written WordprocessingML, no libraries.
import { fmtQty, gbp2, gbpShort, gbpGrand } from './billing.js';
import { rowCells, totalCells } from './invoice-pdf.js';

// ---------- minimal ZIP (no compression) ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255]; const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name); const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data; const crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length)];
    const local = new Uint8Array([...u32(0x04034b50), ...common, ...u16(0)]);
    parts.push(local, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const csize = central.reduce((a, p) => a + p.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; } return out;
}

// ---------- WordprocessingML ----------
const x = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SZ = { title: 60, body: 24, table: 22 }; // half-points: 30pt / 12pt / 11pt (2pt larger than Sarah's originals)
const run = (t, { b = false, sz = SZ.body } = {}) => `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${b ? '<w:b/>' : ''}<w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const para = (runs, { align, after = 0, keep = false } = {}) => `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="${after}"/>${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runs}</w:p>`;
const cell = (t, w, { b = false, fill = null, align = null } = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${para(run(t, { b, sz: SZ.table }), { align })}</w:tc>`;
const table = (widths, rows) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="969696"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r}</w:tr>`).join('')}</w:tbl>`;
const GREY = 'D9D9D9';

/** @param inv invoice from buildGuidewellInvoice  @param widthsPt column widths in points (from the PDF layout) */
export function invoiceDocument(inv, widthsPt) {
  // Word/Pages measure text slightly wider than the PDF fonts: give the numeric columns a little slack from Description.
  const slack = 10; const adj = widthsPt.map((w, i) => (i >= 2 ? w + slack : i === 1 ? w - slack * (widthsPt.length - 2) : w));
  const tw = adj.map(w => Math.round(w * 20)); // points → twips
  const head = ['Date(s)', 'Description', 'Rate', 'Hours', 'Sub-total', 'Travel', 'Total'];
  const body = [];
  body.push(para(run('Invoice', { b: true, sz: SZ.title }), { after: 200 }));
  const left = [para(run('Invoice to:', { b: true })), ...inv.to.map(t => para(run(t)))].join('');
  const rightLines = [para(run('Invoice from:', { b: true }) + run(' ' + inv.from.name), { align: 'right' }),
    ...[inv.from.business, inv.from.address, inv.from.phone, inv.from.email].filter(Boolean).map(t => para(run(t), { align: 'right' })),
    para(run('Invoice #:', { b: true }) + run(' ' + inv.number), { align: 'right' }),
    para(run('Invoice date:', { b: true }) + run(' ' + inv.dateLabel), { align: 'right' })].join('');
  const half = Math.round(tw.reduce((a, b) => a + b, 0) / 2);
  body.push(`<w:tbl><w:tblPr><w:tblW w:w="${half * 2}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="nil"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${half}"/><w:gridCol w:w="${half}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr>${left}</w:tc><w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr>${rightLines}</w:tc></w:tr></w:tbl>`);
  body.push(para('', { after: 120 }), para(run(inv.intro), { after: 240 }));
  for (const sec of inv.sections) {
    body.push(para(run(sec.title + ':', { b: true }), { after: 80, keep: true }));
    const rows = [head.map((h, i) => cell(h, tw[i], { b: true, fill: GREY })).join('')];
    for (const r of sec.rows) rows.push(rowCells(r).map((c, i) => cell(c, tw[i])).join(''));
    rows.push(totalCells(sec).map((c, i) => cell(c, tw[i], { b: true, fill: GREY, align: i === 1 ? 'right' : null })).join(''));
    body.push(table(tw, rows), para('', { after: 240 }));
  }
  body.push(para(run('TOTALS:', { b: true }), { after: 80, keep: true }));
  const t2 = [3600, 2600];
  body.push(table(t2, [cell('Type', t2[0], { b: true, fill: GREY }) + cell('Total', t2[1], { b: true, fill: GREY }),
    ...inv.totals.map(t => cell(t.type, t2[0]) + cell(gbp2(t.total), t2[1])),
    cell('TOTAL', t2[0], { b: true, fill: GREY }) + cell(gbpGrand(inv.grand), t2[1], { b: true, fill: GREY })]), para('', { after: 240 }));
  for (const line of inv.footer) {
    const m = line.match(/^([^:]{1,40}:)\s*(.+)$/);
    body.push(para(m && !/^please\b/i.test(line) ? run(m[1] + ' ') + run(m[2], { b: true }) : run(line)));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export function invoiceDocx(inv, widthsPt) {
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(`Invoice ${inv.number} - ${inv.monthLabel}`)}</dc:title><dc:creator>MentorFlow</dc:creator></cp:coreProperties>` },
    { name: 'word/document.xml', data: invoiceDocument(inv, widthsPt) },
  ];
  return zipStore(files);
}
