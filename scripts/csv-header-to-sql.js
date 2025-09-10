#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs';

if (process.argv.length < 4) {
  console.error('Usage: node scripts/csv-header-to-sql.js <schema.table> <csv_path>');
  process.exit(1);
}

const tableName = process.argv[2];
const csvPath = process.argv[3];

const content = fs.readFileSync(csvPath, 'utf8');
// Extraire la première ligne (en-tête), gérer BOM et fin de ligne
let firstLine = content.split(/\r?\n/)[0] || '';
if (firstLine.charCodeAt(0) === 0xFEFF) firstLine = firstLine.slice(1);

// Parse CSV simple (ligne d'en-tête) avec gestion des guillemets et virgules internes
const cols = [];
let cur = '';
let inQuotes = false;
for (let i = 0; i < firstLine.length; i++) {
  const ch = firstLine[i];
  if (ch === '"') {
    // gérer les guillemets doublés ""
    if (inQuotes && firstLine[i + 1] === '"') {
      cur += '"';
      i++;
    } else {
      inQuotes = !inQuotes;
    }
  } else if (ch === ',' && !inQuotes) {
    cols.push(cur);
    cur = '';
  } else {
    cur += ch;
  }
}
cols.push(cur);

// Nettoyage, trimming et déduplication
const seen = new Map();
function makeUnique(name) {
  const base = name.length ? name : 'col';
  let key = base;
  let n = 1;
  while (seen.has(key)) {
    n++;
    key = `${base}_${n}`;
  }
  seen.set(key, true);
  return key;
}

function quoteIdent(id) {
  return '"' + id.replace(/"/g, '""') + '"';
}

const defs = cols.map((raw) => {
  const name = makeUnique((raw || '').trim());
  return `${quoteIdent(name)} text`;
}).join(',\n  ');

const sql = `CREATE UNLOGGED TABLE ${tableName} (\n  ${defs}\n);\n`;
process.stdout.write(sql);
