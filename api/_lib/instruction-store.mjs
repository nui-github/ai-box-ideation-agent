import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, '..', '..', 'data', 'instruction-prompt.json');
const defaultFile = path.join(__dirname, 'default-instruction-prompt.md');

export const MAX_INSTRUCTION_LENGTH = 20000;

export function getDefaultInstruction() {
  return fs.readFileSync(defaultFile, 'utf-8').trim();
}

function readCustom() {
  try {
    const { prompt } = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : null;
  } catch {
    return null;
  }
}

/** The prompt the AI actually uses: the saved custom one, else the default. */
export function getInstruction() {
  const defaultPrompt = getDefaultInstruction();
  const custom = readCustom();
  return { prompt: custom ?? defaultPrompt, defaultPrompt, isCustom: custom !== null };
}

/** Saves a custom prompt. Saving text identical to the default clears the override. */
export function setInstruction(prompt) {
  const text = String(prompt).trim();
  if (text === getDefaultInstruction()) return resetInstruction();
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify({ prompt: text }, null, 2));
  return getInstruction();
}

export function resetInstruction() {
  try {
    fs.rmSync(dataFile, { force: true });
  } catch {
    // nothing to remove
  }
  return getInstruction();
}
