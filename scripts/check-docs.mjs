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

/**
 * The endpoint table of the operations screen must match the contract: an endpoint that is
 * missing there is an endpoint nobody operating the system can find, and a path that the
 * contract no longer has is a lie on a screen.
 */
const openapiPath = join(root, 'apps/api/openapi/openapi.yaml');
const settingsPath = join(root, 'apps/web/app/(workspace)/settings/page.tsx');

if (existsSync(openapiPath) && existsSync(settingsPath)) {
  const openapi = readFileSync(openapiPath, 'utf8').split('\n');
  const contract = new Set();
  let current = null;
  for (const line of openapi) {
    const path = /^ {2}(\/\S*):\s*$/.exec(line);
    if (path) {
      current = path[1];
      continue;
    }
    const method = /^ {4}(get|post|put|delete|patch):\s*$/.exec(line);
    if (method && current) {
      contract.add(`${method[1].toUpperCase()} ${current}`);
    }
  }

  const settings = readFileSync(settingsPath, 'utf8');
  const listed = new Set(
    [...settings.matchAll(/method:\s*'([A-Z]+)',\s*path:\s*'([^']+)'/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    ),
  );

  for (const operation of contract) {
    if (!listed.has(operation)) {
      problems.push(`settings endpoint table: missing ${operation}`);
    }
  }
  for (const operation of listed) {
    if (!contract.has(operation)) {
      problems.push(`settings endpoint table: unknown ${operation}`);
    }
  }
}

if (problems.length > 0) {
  console.error('Docs check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('Docs check passed.');
