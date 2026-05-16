// lib/csv.js — Minimal RFC-4180-ish CSV parser and writer. No dependencies.
//
// Why hand-rolled: the dependency tree of csv libraries is larger than this
// file. Voter CSVs are small and well-formed in practice. If you hit edge
// cases (multiline quoted fields, unusual escapes), swap in 'papaparse' but
// note the change in the consumer's header comment.

export function parseCsv(text) {
  if (!text) return { headers: [], rows: [] };
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r') {
      // swallow; \n handles row break
    } else if (ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0];
  const rows = records.slice(1).map((r) => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] ?? '';
    return obj;
  });
  return { headers, rows };
}

export function writeCsv(rows, columns) {
  const cols = columns || (rows.length > 0 ? Object.keys(rows[0]) : []);
  const lines = [cols.map(escapeField).join(',')];
  for (const row of rows) {
    lines.push(cols.map((c) => escapeField(row[c] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function escapeField(value) {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
