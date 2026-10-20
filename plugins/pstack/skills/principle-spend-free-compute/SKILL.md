---
name: principle-spend-free-compute
description: "Apply when a read-only check, review, or exploration costs little money: ask instead of assume, check instead of trust, and use redundant or always-on cheap workers. Spend attention only on conflicts and surprises."
disable-model-invocation: true
---

# Spend Free Compute

**Why:** Token cost used to be the constraint, so the usual heuristics say to use fewer workers, skip the second opinion, and trust the first answer. For read-only work those heuristics no longer hold. Read-only exploration, review, and verification cost little money. The scarce things are the user's attention, the manager's context window, and trust in results. Spend the cheap thing to protect those.

**Pattern:**
- **Ask instead of assume.** A checkable fact (does X exist, how does Y behave, who calls Z) goes to a read-only scout. Asking is free. A wrong assumption costs the decision built on it.
- **Check instead of trust.** A claim from a worker, a summary, or your own memory gets re-opened at its cited file:line by a second worker before it drives a decision.
- **Redundant workers instead of one.** For a question that must be right, ask 3 to 5 workers from different starting points. Two independent finds beat one confident find.
- **Always-on lenses, silent when clean.** Run one reviewer per lens on every change that reaches review. A `Nothing found` result is dropped, not reported. Only the count appears.
- **Judge candidates by what they do.** When you cannot predict which design wins, build two or three candidates and compare by evidence: runs, tests, benchmarks, diff size, a panel verdict. Candidates are cheap evidence. Predicting the winner is expensive guessing.

**Limits:**
- Writes are not free. Each writer costs RAM, CPU, disk, and cleanup. Bound them, about 3 at a time, and remove worktrees when done.
- Same-family workers share blind spots. Agreement inside one family is weaker than it looks. Use a second family when one is available.
- Spend attention only on conflicts and surprises. A worker that agrees with you changes nothing, so do not report it. Show the user the disagreement.

This principle overrides scarcity heuristics like "prefer fewer workers" for read-only work only. Writes still follow the limits above. The workflow is the **sweep** skill, and the compression rule for what comes back is the **guard-the-context-window** principle skill.
