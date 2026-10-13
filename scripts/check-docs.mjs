#!/usr/bin/env node
// Documentation gate: required docs exist and local Markdown links resolve.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const required = [
  'README.md',
  'AGENTS.md',
  'LICENSE.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'docs/README.md',
  'mise.toml',
  '.env.example',
];

const problems = [];

for (const file of required) {
  if (!existsSync(join(root, file))) problems.push(`missing required file: ${file}`);
}

const adrDir = join(root, 'docs', 'adr');
if (existsSync(adrDir)) {
  const adrs = readdirSync(adrDir).filter((name) => name.endsWith('.md'));
  if (adrs.length === 0) problems.push('docs/adr/ exists but contains no ADR files');
}

/** Collect Markdown files, skipping dependency trees, build output and tool state. */
function collectMarkdown(dir, acc = []) {
  const skip = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'out', '.serena']);
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) collectMarkdown(full, acc);
    else if (entry.endsWith('.md')) acc.push(full);
  }
  return acc;
}

const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
// Local links only: skip external URLs, anchors, and mail links.
const external = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

for (const file of collectMarkdown(root)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1].split('#')[0];
    if (!target || external.test(target)) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (!existsSync(resolved)) {
      problems.push(`${relative(root, file)}: broken local link -> ${target}`);
    }
  }
}

if (problems.length > 0) {
  console.error('Docs check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('Docs check passed.');
