#!/usr/bin/env node
/**
 * pnpm i18n:check — guard against EN ↔ UK locale drift.
 *
 * Two checks:
 *   1. Key parity. For every namespace under apps/webapp/src/locales,
 *      EN and UK must declare the exact same nested key set. Any
 *      divergence (key in one but not the other) fails CI.
 *   2. Referenced-key coverage. Every `t("ns:path.to.key")` call site
 *      under apps/webapp/src must resolve to a real EN key. Catches
 *      typos and rebases that miss locale updates.
 *
 * Intentionally no `i18next-parser` dep — that tool's value is when
 * you also want auto-extraction; we don't, and the dep tree is heavy.
 * This is ~120 lines and does the job for Stage A. Revisit if the
 * keyspace grows past ~1k entries.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const LOCALES_DIR = join(REPO_ROOT, "apps", "webapp", "src", "locales");
const SOURCE_DIR = join(REPO_ROOT, "apps", "webapp", "src");
const SUPPORTED = ["en", "uk"];

const failures = [];

function fail(msg) {
  failures.push(msg);
}

async function listNamespaces(locale) {
  const entries = await readdir(join(LOCALES_DIR, locale));
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

async function loadNamespace(locale, ns) {
  const text = await readFile(join(LOCALES_DIR, locale, `${ns}.json`), "utf8");
  return JSON.parse(text);
}

function flattenKeys(obj, prefix = "") {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix === "" ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const inner of flattenKeys(v, full)) keys.add(inner);
    } else {
      keys.add(full);
    }
  }
  return keys;
}

function diffKeys(label, expected, actual) {
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  for (const k of missing) fail(`[${label}] missing key: ${k}`);
  for (const k of extra) fail(`[${label}] extra key: ${k}`);
}

async function checkParity() {
  const sets = {};
  for (const locale of SUPPORTED) {
    const namespaces = await listNamespaces(locale);
    sets[locale] = { namespaces: new Set(namespaces), keys: {} };
    for (const ns of namespaces) {
      const data = await loadNamespace(locale, ns);
      sets[locale].keys[ns] = flattenKeys(data);
    }
  }
  // namespace parity
  diffKeys(
    "namespace parity",
    sets.en.namespaces,
    sets.uk.namespaces,
  );
  // per-namespace key parity
  const allNs = new Set([...sets.en.namespaces, ...sets.uk.namespaces]);
  for (const ns of allNs) {
    if (!sets.en.namespaces.has(ns) || !sets.uk.namespaces.has(ns)) continue;
    diffKeys(`${ns} (uk vs en)`, sets.en.keys[ns], sets.uk.keys[ns]);
  }
  return sets.en.keys; // english is the reference for referenced-key coverage
}

async function* walkSources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "locales" || entry.name === "__tests__") continue;
      yield* walkSources(path);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield path;
    }
  }
}

// Matches `t("ns:dotted.key")`, `t('ns:dotted.key', …)`.
const T_CALL_RE = /\bt\(\s*["']([a-z_]+):([a-zA-Z0-9_.]+)["']/g;
// Matches `t("dotted.key")` without an explicit namespace prefix — the
// namespace then comes from `useTranslation("ns")` (resolved at runtime).
// We don't try to track which namespace is in scope per file; instead a
// match here suppresses the unused-key warning for any namespace that
// owns that exact key path.
const T_BARE_RE = /\bt\(\s*["']([a-zA-Z0-9_][a-zA-Z0-9_.]*)["']/g;
// Matches *any* template literal with the shape `\`ns:prefix.${…}\`` —
// not just inside `t(…)`. Code occasionally builds the key into a
// variable first (`const k = \`room:errors.${code}\`; t(k)`); a strict
// "must be inside t()" match would miss those and falsely warn the
// downstream subtree as unused. The prefix is what we record.
const T_TEMPLATE_RE = /`([a-z_]+):([a-zA-Z0-9_.]*)\$\{/g;

async function checkReferencedKeys(enKeys) {
  const referenced = new Set();
  /** Keys referenced without an explicit `ns:` prefix. */
  const bareReferenced = new Set();
  /** Map of ns → Set of prefixes used dynamically (`t(`ns:prefix.${…}`)`). */
  const dynamicPrefixes = {};
  for await (const file of walkSources(SOURCE_DIR)) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(T_CALL_RE)) {
      const [, ns, key] = match;
      referenced.add(`${ns}:${key}`);
      const set = enKeys[ns];
      if (set === undefined) {
        fail(`[ref] unknown namespace "${ns}" referenced in ${rel(file)}`);
        continue;
      }
      if (!set.has(key)) {
        fail(`[ref] missing key "${ns}:${key}" referenced in ${rel(file)}`);
      }
    }
    for (const match of text.matchAll(T_BARE_RE)) {
      const [, key] = match;
      // Skip strings that are clearly something else: namespaced keys
      // already matched above, identifiers without dots, or non-locale
      // looking values. The regex still over-matches harmlessly.
      if (key.includes(":") || !key.includes(".")) continue;
      bareReferenced.add(key);
    }
    for (const match of text.matchAll(T_TEMPLATE_RE)) {
      const [, ns, prefix] = match;
      dynamicPrefixes[ns] ??= new Set();
      // Trailing-dot prefix means "everything under this subtree".
      // Empty prefix means "anything in this namespace" — also OK.
      dynamicPrefixes[ns].add(prefix.replace(/\.$/, ""));
    }
  }
  // Unused-key warning (not failure — dynamic builds can still slip
  // through if the static prefix is too coarse to match).
  for (const [ns, set] of Object.entries(enKeys)) {
    for (const k of set) {
      const fq = `${ns}:${k}`;
      if (referenced.has(fq)) continue;
      if (bareReferenced.has(k)) continue;
      if (isDynamicallyReferenced(ns, k, dynamicPrefixes)) continue;
      console.warn(`[ref] unused (maybe): ${fq}`);
    }
  }
}

function isDynamicallyReferenced(ns, key, dynamicPrefixes) {
  const prefixes = dynamicPrefixes[ns];
  if (prefixes === undefined) return false;
  for (const prefix of prefixes) {
    if (prefix === "" || key === prefix || key.startsWith(`${prefix}.`)) {
      return true;
    }
  }
  return false;
}

function rel(absPath) {
  return absPath.startsWith(REPO_ROOT)
    ? absPath.slice(REPO_ROOT.length + 1)
    : absPath;
}

const enKeys = await checkParity();
await checkReferencedKeys(enKeys);

if (failures.length > 0) {
  console.error(`\ni18n:check failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`);
  for (const msg of failures) console.error(`  ✗ ${msg}`);
  process.exit(1);
}
console.log(`i18n:check passed (${SUPPORTED.join(" + ")} parity + referenced-key coverage)`);
