---
name: sweep
description: "Dispatch many cheap read-only Haiku workers and merge their compressed results. Use for /sweep, 'sweep this', 'scout this before we decide', 'lens review', 'panel this question', or when a decision needs wide reading or redundant checks without bloating the main context."
disable-model-invocation: true
---

# Sweep

Read-only fan-out. The manager spawns several small workers, each on a different angle, and keeps only what they send back. A worker may read a lot and discard most of it. The filter is its return, so the manager's context grows by the compressed claims, not by the files read.

Three modes share one return contract. **Scout** gathers facts before a decision. **Lens** runs one always-on reviewer per concern. **Panel** asks one question of several redundant workers and merges the answers. The compression on the way back is the **guard-the-context-window** principle skill. The reason cheap workers are worth spending is the **spend-free-compute** principle skill.

## Scope

Read-only only. A sweep never writes, edits, commits, pushes, sends, or deletes. For parallel writes, use the **arena** skill (competing candidates) or the **swarm** skill (workers in their own worktrees). Write-side parallelism is bounded by machine RAM and CPU, with a default of at most about 3 concurrent writers. A read-only sweep can fan out to about 5 to 8 workers.

## Return contract

Paste this block into every worker brief, after the question and the worker's angle:

```
Inspect only. Change no file. Read as widely as you need, but return only what bears on the question.

Return at most 150 words:
- One line per claim. End each claim with its evidence: file:line or a URL.
- Label speculation "(speculation)". Label a claim you did not open "(unverified)".
- No raw dumps: no pasted file contents, and no code block over 3 lines.
- If nothing in your angle bears on the question, return exactly: Nothing found
```

Every brief carries three things: the full question, the worker's own angle, and the absolute paths it starts from. A child gets only its brief, never the manager's context.

## Dispatch on T3

Each worker is one `delegate_task` call with `mode: "async"`, its own `clientRequestId`, and `role: "research"` (or `role: "review"` for lenses and verifiers). The brief says to inspect only. Spawn every worker in one message. Their completions wake the thread, so end the turn instead of polling, and call `task_status` only when a result is needed mid-turn.

Workers run on the `fast` tier entry, which is Haiku 5.5 at effort high, through the role's model sheet entry when one exists. Use standard speed. Fast mode is for a person who is blocked right now.

TODO: role entry for sweep to be added to models.json in the config phase.

Record `git status --porcelain` before the first spawn and again after the last result. The two must match. That check is how the read-only rule is proven, not assumed.

## Ask before assuming

Asking is free, so the manager does not assume a checkable fact. Does X exist, how does Y behave, who calls Z: spawn a scout instead. One worker is enough for a plain fact. Use three when the answer shapes a decision. Questions only the user can answer (intent, priorities, product direction) still go to the user.

## Modes

### Scout (recall)

Use before a decision. Give each worker a different angle: existing code, docs and decision records, constraints, second and third-order effects, prior art. The goal is recall. A relevant fact missing from every return is worse than noise, because the verifier and the manager filter noise out.

```
Question: should the watcher poll with backoff?
Workers: A  existing pollers under plugins/pstack/skills/poteto-mode/scripts/watch-pr
         B  callers of the poll interval, and the tests that pin it
         C  CHANGES.md and docs that mention polling
         D  second-order effects: rate limits, retries, stacked PRs
Each returns Nothing found, or up to 150 words with evidence.
Verifier on the claims before any of them feeds the decision.
```

### Lens (always-on)

Use on every change that reaches review. One worker per lens, each given the diff and its lens question. Typical lenses: correctness, security, simplicity, tests, naming, blast radius. Add a lens only when it would catch something the others miss.

Each lens returns findings or exactly `Nothing found`. The manager drops every `Nothing found`. It is not relayed to the user, not summarized, and not counted in context. The only trace is one line with the count, such as "7 lenses, 0 findings" or "7 lenses, 2 findings", followed by the findings themselves.

```
Diff: sheet parser, 4 files.
Lenses: correctness, security, simplicity, tests, naming, blast radius, docs.
Returns: six Nothing found, one finding: tests, parser.test.ts:40, no case for an empty sheet.
Reply: "7 lenses, 1 finding." then that one finding, with its evidence.
```

Lens findings are claims too. The manager checks one with the verifier before acting when the fix is costly or changes the design.

### Panel (redundancy)

Use when one answer must be right and a single worker's read could be wrong. Ask the same question of 3 to 5 workers. Each starts from a different entry point, with its own disjoint set of files or docs, so two workers that raise the same point read it independently. Overlap then means something. If every worker started from the same path, they would agree for the wrong reason.

Merge the returns into one list:

- A finding raised by two or more workers is high signal. Match them on the same file:line or the same claim.
- The rest form the union. Keep them as lower-confidence additions, marked "(single)".
- Run the verifier on the merged list when the list feeds a decision.

```
Question: is the retry in fetch-run.ts safe to call twice?
Starts: the caller, the retry helper, the tests, the design doc.
Raised by 3: retry drops the idempotency key (fetch-run.ts:88, retry.ts:21). High signal.
Raised by 1: timeout clock is not reset (retry.ts:40). Kept as (single), verifier checks it.
```

## Verifier

Default on for scout and panel when the claims feed a decision. Skip it for a lens finding the manager can check with one read.

The verifier is a second Haiku worker. It receives only the claims and their cited evidence, never the workers' reasoning, so it cannot inherit their conclusions. Its brief:

```
Re-open each cited file:line or URL. For each claim answer one word, CONFIRMED, WRONG, or UNVERIFIABLE, and the line you checked.
Add no new claims. Return at most 150 words.
```

WRONG claims are dropped. UNVERIFIABLE claims stay, marked. CONFIRMED claims carry on.

## High-stakes check

If the decision is hard to reverse, touches security or data, or the user will act on it without reading the workers, add one fresh Opus worker on the `default` tier entry. Give it the question and the merged claims with their verifier verdicts, and ask it to attack the conclusion. Give it no earlier conclusion to confirm.

## Rules

- **Disjoint angles.** Each worker gets its own slice. Redundancy is deliberate in a panel. Accidental overlap is wasted spend.
- **The manager writes its own summary.** It never pastes worker output to the user. It states the merged result and names the evidence behind each claim.
- **Same-family blind spots.** Every worker and verifier here is one model family, so they can share a blind spot. Say so once per sweep, not per claim. A cross-family panel is the upgrade when a second family is in the model sheet. It is not required.
- **Drop and note.** A worker that returns nothing usable is dropped, and the sweep notes the dropout in its one-line count.

## When not to use

- A lookup the manager can answer in one tool call: one grep, one file read, one `gh` call. Briefing a sweep costs more than that answer.
- Anything that writes, edits, commits, pushes, sends, or deletes. Use the **arena** or **swarm** skill, within the write bound above.
- A question only the user can answer.
