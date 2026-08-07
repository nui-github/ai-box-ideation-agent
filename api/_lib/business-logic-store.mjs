import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, '..', '..', 'data', 'business-logic.json');

const defaultEntries = [
  {
    id: 'default-api',
    title: 'API หลัก',
    content: '/eSignature/save, /search, /getByTracking, /download, /void, /delete, /sharing/owner/esignature/get'
  },
  {
    id: 'default-status',
    title: 'สถานะเอกสาร (Status)',
    content: 'ALL, DRAFT, INPROCESS, VOID, SUCCESS, REVISING, RETURNED, REJECTED'
  },
  {
    id: 'default-status-recipient',
    title: 'สถานะผู้รับ (StatusRecipient)',
    content: 'PENDING, INPROCESS, COMPLETE, RETURNED, REJECTED, VOID'
  },
  {
    id: 'default-roles',
    title: 'สิทธิ์การใช้งาน (Roles)',
    content: 'ESIG_CREATE, ESIG_VIEWER, ESIG_ACCESS, ADMIN'
  }
];

function readEntries() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return defaultEntries;
  }
}

function writeEntries(entries) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(entries, null, 2));
}

export function getEntries() {
  return readEntries();
}

export function addEntry({ title, content }) {
  const entries = readEntries();
  const entry = { id: crypto.randomUUID(), title: String(title).trim(), content: String(content).trim() };
  entries.push(entry);
  writeEntries(entries);
  return entry;
}

export function deleteEntry(id) {
  const entries = readEntries();
  const next = entries.filter(e => e.id !== id);
  writeEntries(next);
  return next;
}
