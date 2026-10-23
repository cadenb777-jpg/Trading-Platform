/** Reads files attached to an AI question: spreadsheets become CSV text; PDFs and images are sent as they are. */

export interface Attachment {
  name: string;
  kind: 'text' | 'pdf' | 'image';
  mediaType?: string;
  data: string;
  /** Short description for the chip shown in the chat, e.g. "3 sheets, 120 rows". */
  info: string;
}

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 600_000;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Column letters (A, B, ..., AA) to a 0-based index. */
function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Converts an .xlsx workbook (a zip of XML files) into CSV text, one block per sheet. */
export async function xlsxToCsv(buffer: ArrayBuffer): Promise<{ text: string; sheets: number; rows: number }> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buffer));
  const xml = (path: string) => (files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml') : null);
  const shared = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? [])].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''));
  const workbook = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  const target = new Map([...(rels?.getElementsByTagName('Relationship') ?? [])].map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
  const sheets = [...(workbook?.getElementsByTagName('sheet') ?? [])].map((s, i) => {
    const rid = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const t = (rid && target.get(rid)) || `worksheets/sheet${i + 1}.xml`;
    return { name: s.getAttribute('name') ?? `Sheet${i + 1}`, path: t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}` };
  });
  let rows = 0;
  const blocks: string[] = [];
  for (const sheet of sheets) {
    const doc = xml(sheet.path);
    if (!doc) continue;
    const lines: string[] = [];
    for (const row of doc.getElementsByTagName('row')) {
      const values: string[] = [];
      for (const c of row.getElementsByTagName('c')) {
        const type = c.getAttribute('t');
        const raw = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let value = raw;
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        const idx = columnIndex(c.getAttribute('r') ?? '') ;
        if (idx >= 0) values[idx] = value;
        else values.push(value);
      }
      if (values.some((v) => v)) {
        lines.push(Array.from(values, (v) => csvCell(v ?? '')).join(','));
        rows++;
      }
    }
    blocks.push(`# Sheet: ${sheet.name}\n${lines.join('\n')}`);
  }
  return { text: blocks.join('\n\n'), sheets: sheets.length, rows };
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  const name = file.name;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'xls') throw new Error(`${name} is an old Excel format. In Excel, use File → Save As → .xlsx (or .csv) and attach that.`);
  if (ext === 'xlsx' || ext === 'xlsm') {
    const { text, sheets, rows } = await xlsxToCsv(await file.arrayBuffer());
    if (text.length > MAX_TEXT_CHARS) throw new Error(`${name} is too big to send in one go (${rows} rows). Delete columns you don't need or split it.`);
    return { name, kind: 'text', data: text, info: `${sheets} sheet${sheets === 1 ? '' : 's'}, ${rows} rows` };
  }
  if (ext === 'pdf' || file.type === 'application/pdf') return { name, kind: 'pdf', data: toBase64(await file.arrayBuffer()), info: 'PDF' };
  if (file.type.startsWith('image/')) {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error(`${name}: use a PNG, JPG, GIF or WebP image.`);
    return { name, kind: 'image', mediaType: file.type, data: toBase64(await file.arrayBuffer()), info: 'Image' };
  }
  const text = await file.text();
  if (text.length > MAX_TEXT_CHARS) throw new Error(`${name} is too big to send in one go. Split it into smaller files.`);
  const lines = text.split('\n').length;
  return { name, kind: 'text', data: text, info: `${lines} lines` };
}

export const ACCEPTED_FILES = '.csv,.xlsx,.xlsm,.xls,.txt,.json,.md,.tsv,.pdf,.png,.jpg,.jpeg,.gif,.webp';
