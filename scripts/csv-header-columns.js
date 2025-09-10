#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs';

if (process.argv.length < 3) {
  console.error('Usage: node scripts/csv-header-columns.js <csv_path>');
  process.exit(1);
}

const csvPath = process.argv[2];
const content = fs.readFileSync(csvPath, 'utf8');
let firstLine = content.split(/\r?\n/)[0] || '';
if (firstLine.charCodeAt(0) === 0xFEFF) firstLine = firstLine.slice(1);

const cols = [];
let cur = '';
let inQuotes = false;
for (let i = 0; i < firstLine.length; i++) {
  const ch = firstLine[i];
  if (ch === '"') {
    if (inQuotes && firstLine[i + 1] === '"') { cur += '"'; i++; }
    else { inQuotes = !inQuotes; }
  } else if (ch === ',' && !inQuotes) {
    cols.push(cur);
    cur = '';
  } else {
    cur += ch;
  }
}
cols.push(cur);

function quoteIdent(id) {
  return '"' + id.replace(/"/g, '""').trim() + '"';
}

const list = cols.map(c => quoteIdent(c || 'col')).join(',');
process.stdout.write(list);

