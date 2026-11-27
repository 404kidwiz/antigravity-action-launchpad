# Antigravity Action Launchpad — Inline Chat UI Rules

## Inline Action Launchpad (`antigravity-deck_deck` -> `deck_actions`)
- **Proactive follow-up pills:** At the end of most completed tasks (builds, fixes, reviews, research, explanations, or proposals) whenever 2–3 clear, actionable next steps exist — or before destructive/high-stakes actions (deploy, send, delete, migration, restart) — call `deck_actions` so the user can click a row (or press `1`–`3` / `Enter`) instead of typing a follow-up manually.
- **When to skip:** Skip `deck_actions` on trivial one-line factual Q&A, pure acknowledgments, or interim progress updates while waiting on background tasks.
- **Flush Command List & decision rationale (`label` + `sublabel` + `hint` + `why`):**
  - Each active action renders as a **flush, single-line command row** (never nested boxes): give it a crisp title (`label`, 3–5 words, e.g. `Run unit test suite`) paired with a short muted inline scope cue (`sublabel`, 3–6 words, e.g. `Verify changed auth modules`), plus an optional short trust `badge` (`Read-only`, `Dry-run`) when helpful. Use at most 3 visible active rows (`primary` / `neutral` / `danger`) plus an optional quiet header exit (`tone: "ghost"`, e.g. `Wrap Up`); 4th+ active actions fold cleanly into a flush `+N more options` row.
  - **Always include both `hint` and `why` on active actions:**
    - `hint`: 1 concise plain-English sentence explaining **what** choosing this option will do, change, or verify.
    - `why`: 1 concise plain-English sentence explaining **why** you'd pick it right now (its benefit, tradeoff, or the situation where it's the smartest move).
    `why` and `hint` both appear cleanly in the fixed-height bottom Decision Inspector on hover/focus (defaulting to the primary row, keeping rows ultra-compact 1-line at rest) and expand inline under every row when `Details` / `d` is pinned.
  - Omit `summary` on routine 2–3 option suggestion cards so the card stays sleek inside chat; include `summary`, `toggles`, `choices` (A2UI-inspired single-select segmented controls or multi-select chips), and `inputs` (1–2 lightweight short text fields, never for secrets) only for parameter pickers, multi-option checklists, or Propose-Then-Apply approval gates.
- **Bottom placement (strict 2-step order — never put the card at the top):** Antigravity renders tool UIs chronologically.
  1. **Step A (prose + tool call together):** Write your **ENTIRE** visible answer (explanation, tables, verification, and file links) in the assistant text of the **same** turn step right before invoking `deck_actions`. **NEVER** invoke `deck_actions` with empty assistant text and write your report afterward — that renders the card at the top above your answer.
  2. **Step B (minimal closing after tool returns):** Once `deck_actions` returns, emit **only** a minimal closing line (zero prose, zero summary, zero tables below the card) so the clickable card stays anchored at the bottom of your response.
