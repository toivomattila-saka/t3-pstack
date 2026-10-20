#!/usr/bin/env node
// The T3 override sheet: one `<role>: <entry>` line per role, or a
// comma-separated list for a panel role. An entry is
// `<providerInstanceId>/<modelId>` plus `<optionId>=<value>` pairs, or
// `inherit-parent` (alias `auto`). An entry maps one to one onto a
// `delegate_task` target, so this file is the only place the grammar lives:
// the generator checks the models.json tiers with it, and setup-pstack checks
// a sheet against the live `orchestrator_capabilities` catalog with it.
//
// `count=<n>` (1 to 8) is not a T3 option: it runs n independent workers on the
// entry, and no T3 option is named `count`, so the pair is reserved for it.
//
//   node t3-sheet.mjs <sheet.md> <catalog.json>
//
// prints one line per problem and exits 1 when there is any. A note, such as a
// panel whose workers share one model family, prints as `note: ...` and does
// not change the exit status.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INHERIT = ["inherit-parent", "auto"];
const HOOK_VALUES = ["on", "off"];
export const COUNT_OPTION = "count";
export const COUNT_RANGE = [1, 8];

// Throws on a malformed entry; returns null for an inherit alias. `count` is
// set only when the entry names one, so a role's default count can apply.
export function parseEntry(text) {
  const [target, ...pairs] = text.trim().split(/\s+/);
  if (INHERIT.includes(target)) {
    if (pairs.length) throw new Error(`"${text.trim()}": ${target} takes no options`);
    return null;
  }
  const match = target.match(/^([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)$/);
  if (!match) throw new Error(`"${text.trim()}" does not start with <providerInstanceId>/<modelId>`);
  const options = Object.create(null);
  let count;
  for (const pair of pairs) {
    const option = pair.match(/^([A-Za-z0-9_]+)=([A-Za-z0-9._-]+)$/);
    if (!option) throw new Error(`"${text.trim()}": "${pair}" is not <optionId>=<value>`);
    if (option[1] === COUNT_OPTION) {
      const value = Number(option[2]);
      if (count !== undefined) throw new Error(`"${text.trim()}" sets "${COUNT_OPTION}" twice`);
      if (!/^\d+$/.test(option[2]) || value < COUNT_RANGE[0] || value > COUNT_RANGE[1]) {
        throw new Error(`"${text.trim()}": ${COUNT_OPTION}=${option[2]} is not an integer from ${COUNT_RANGE[0]} to ${COUNT_RANGE[1]}`);
      }
      count = value;
      continue;
    }
    if (option[1] in options) throw new Error(`"${text.trim()}" sets "${option[1]}" twice`);
    options[option[1]] = option[2];
  }
  return { providerInstanceId: match[1], model: match[2], options, count };
}

// The family is the first segment (`claude`, `gpt`, `grok`) of the model ID's
// last `/` part, so a Claude model served by a Codex-driver pool still counts as
// Claude, and an OpenCode route prefix such as `openrouter/` decides nothing.
export const family = (model) => model.split("/").pop().split("-")[0];

// A panel's families among its concrete targets. An inherit entry does not
// count: one sheet serves every thread on the machine, so its family depends on
// the thread that dispatches.
export function panelFamilies(entries) {
  return new Set(entries.filter(Boolean).map((e) => family(e.model)));
}

// A panel fans out to redundant workers: a list-valued tier, or a role marked
// `panel` on one entry, such as `sweep panel`.
export const isPanelRole = (role) => role.tier === "panel" || role.panel === true;

// The note for a panel whose concrete targets all share one family. It is a
// note, not a problem: same-family workers share blind spots, and a second
// family is the upgrade.
export function sameFamilyNote(families) {
  if (families.size !== 1) return null;
  return `all workers are ${[...families][0]}, so they share blind spots; a second model family is the upgrade`;
}

// Every line but blank lines and `#` headings, as `{ line, key, value }`, with
// no key or value when the line is not exactly `<key>: <value>`. setup-pstack
// writes the sheet, so it holds no prose, and one strict rule leaves no shape a
// misspelled role line can slip through.
export function parseSheet(markdown) {
  return markdown
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .flatMap((line, i) => {
      if (line.trim() === "" || line.startsWith("#")) return [];
      const match = line.match(/^([a-z][a-z ,-]*[a-z]): (\S(?:.*\S)?)$/);
      return [{ line: i + 1, key: match?.[1], value: match?.[2] }];
    });
}

// Problems with a parsed sheet, for the role vocabulary of models.json (each
// role with its `tier`, its default `count`, and the `alias` a released sheet
// may still use), its tier defaults, and an `orchestrator_capabilities`
// catalog. A role with no line runs on its tier's default, so that default must
// dispatch here too. With no catalog, as in the installer's doctor, only the
// grammar is checked. Notes, which are not problems, are pushed onto `notes`.
export function checkSheet(sheet, { roles, defaults, catalog }, notes = []) {
  const problems = [];
  const byRole = new Map(roles.flatMap((r) => [[r.role, r], ...(r.alias ? [[r.alias, r]] : [])]));
  const seen = new Set();
  for (const { line, key, value } of sheet) {
    if (!key) {
      problems.push(`line ${line}: not a "<role>: <value>" line (lowercase role, one space after the colon, no indent or markup)`);
      continue;
    }
    const canonical = byRole.get(key)?.role ?? key;
    if (seen.has(canonical)) problems.push(`"${key}" appears twice; only one line may set it`);
    seen.add(canonical);
    if (key === "session hook") {
      if (!HOOK_VALUES.includes(value)) problems.push(`session hook: "${value}" is not on or off`);
      continue;
    }
    if (key === "default effort") {
      problems.push("default effort: T3 entries carry their own options; delete this line");
      continue;
    }
    const role = byRole.get(key);
    if (!role) {
      problems.push(`"${key}" is not a pstack role`);
      continue;
    }
    const texts = value.split(",");
    if (!isPanelRole(role) && texts.length > 1) problems.push(`${key}: takes one entry, not a list`);
    const entries = []; // an entry per text, null for an inherit alias
    for (const text of texts) {
      try {
        entries.push(parseEntry(text));
      } catch (err) {
        problems.push(`${key}: ${err.message}`);
      }
    }
    const runnable = [];
    for (const entry of entries.filter(Boolean)) {
      const found = checkTarget(entry, catalog);
      problems.push(...found.map((p) => `${key}: ${p}`));
      if (!found.length) runnable.push(entry);
    }
    const targets = texts.map((t) => t.trim()).filter((t) => !INHERIT.includes(t));
    if (new Set(targets).size < targets.length) problems.push(`${key}: lists the same target twice`);
    if (isPanelRole(role)) {
      // inherit-parent is one worker on the parent's model. A concrete entry runs
      // its own count, or the role's when the line sets none.
      const workers = entries.reduce(
        (sum, e) => sum + (e === null ? 1 : runnable.includes(e) ? (e.count ?? role.count ?? 1) : 0),
        0,
      );
      if (workers < 2) {
        problems.push(`${key}: a panel needs at least two workers among its targets (inherit-parent counts as one), got ${workers}`);
      }
      const note = sameFamilyNote(panelFamilies(entries));
      if (note) notes.push(`${key}: ${note}`);
    }
  }
  for (const role of roles.filter((r) => !seen.has(r.role))) {
    const concrete = [];
    for (const entry of [defaults[role.tier]].flat()) {
      const target = parseEntry(entry);
      concrete.push(target);
      problems.push(...checkTarget(target, catalog).map((p) => `${role.role} (no line, tier default): ${p}`));
    }
    const note = isPanelRole(role) && sameFamilyNote(panelFamilies(concrete));
    if (note) notes.push(`${role.role} (no line, tier default): ${note}`);
  }
  return problems;
}

function checkTarget({ providerInstanceId, model, options }, catalog) {
  if (!catalog) return [];
  const at = `${providerInstanceId}/${model}`;
  const provider = catalog.providers.find((p) => p.providerInstanceId === providerInstanceId);
  if (!provider) return [`${at}: no provider instance "${providerInstanceId}" in this T3`];
  if (!provider.canRunChildTask || provider.canRunCrossProviderChildTask === false) {
    const why = (provider.constraints ?? []).join(" ");
    return [`${at}: "${providerInstanceId}" cannot run child tasks${why ? ` (${why})` : ""}`];
  }
  const listed = provider.models.find((m) => m.id === model);
  if (!listed) return [`${at}: "${providerInstanceId}" does not list model "${model}"`];
  const known = listed.options ?? [];
  const problems = [];
  for (const [id, value] of Object.entries(options)) {
    const option = known.find((o) => o.id === id);
    const allowed = option?.type === "boolean" ? ["true", "false"] : (option?.options ?? []).map((o) => o.id);
    if (!option) problems.push(`${at}: no option "${id}" (has ${known.map((o) => o.id).join(", ") || "none"})`);
    else if (!allowed.includes(value)) problems.push(`${at}: ${id}=${value} is not one of ${allowed.join(", ")}`);
  }
  return problems;
}

const invoked = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  const [sheetPath, catalogPath] = process.argv.slice(2);
  if (!sheetPath || !catalogPath) {
    console.error("usage: t3-sheet.mjs <sheet.md> <catalog.json>");
    process.exit(2);
  }
  const { roles, tiers } = JSON.parse(readFileSync(new URL("../../../models.json", import.meta.url), "utf8"));
  const notes = [];
  const problems = checkSheet(
    parseSheet(readFileSync(sheetPath, "utf8")),
    { roles, defaults: tiers, catalog: JSON.parse(readFileSync(catalogPath, "utf8")) },
    notes,
  );
  for (const note of notes) console.log(`note: ${note}`);
  for (const problem of problems) console.log(problem);
  if (problems.length) process.exit(1);
  console.log("ok: every role line parses and dispatches on this T3");
}
