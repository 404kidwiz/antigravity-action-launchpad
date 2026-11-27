# Antigravity Action Launchpad — Design System

## Direction
Compact first-party Google Antigravity inline chat component using a **Calm Warm-Neutral Ink** primary pill (`#1F2329` / `#FCFBF7` = `15.4:1` AAA in Light; `#E8EFF8` / `#10151E` = `15.6:1` AAA in Dark), crisp 1px hairlines, tight vertical rhythm, and uniform 16×16 (`1.5px` stroke) bespoke custom SVG iconography.

## Surface Polarity & Contrast
- Adapts automatically to Antigravity Warm Light (`#F7F2E2` canvas / `#FCFBF7` elevated card), Cool Light (`#F5F6F8` / `#FFFFFF`), and Dark (`#10151E` / `#161D29`) via host CSS variables with `light-dark()` fallbacks.
- All text, badges, keycaps, and buttons meet WCAG AA+ (`>= 4.5:1`), with `>= 12px` typography and `>= 26px` interactive targets.

## Flush Command List, Live Decision Inspector & Keyboard Contract
- **Zero nested cards & zero one-sided bars:** One crisp outer container (`max-width: 720px`) with edge-to-edge hairline-divided command rows (Linear / Raycast pattern). Quiet `tone: "ghost"` exit (`Wrap Up`, `Ship As-Is`, `Cancel`) sits flush in the card header beside `Details ⌄` — never orphaned on a dead bottom row.
- **Single-line scannable rows:** Keycap (`1`–`3`, `19×19px`, solid warm-ink on primary, soft abort tint on danger) + `13px` semibold `label` + single-line ellipsized muted `· sublabel` (never leaving an orphan middot) + quiet trailing badge (`Recommended`, `Destructive`, `New thread`, custom `badge`) + gliding `→` arrow. Inline backtick code spans render cleanly as styled `<code>` pills.
- **Ultra-compact 1-line rows + fixed-height `Why:` / `What:` inspector:** rows stay a crisp single line at rest (no stacked sub-paragraphs). A fixed-height bottom strip (`#al-inspector`, all items stacked in one grid cell and crossfaded at `110ms`) shows the hovered or focused row's `Why:` and `What:` beside its keycap, defaulting to the primary row. Hover never changes card height, so the chat frame never resizes and nothing flickers; the only delay is a `180ms` grace period on leaving the card. `Details ⌄` (or `d`) expands both `Why:` and `What:` inline under every row.
- **A2UI-inspired ChoicePicker chips (`choices`) & short text inputs (`inputs`):** Optional compact horizontal parameter rows (`26px` target height, unified label column) above toggles/actions supporting single-select segmented controls (`role="radiogroup"` with arrow-key roving focus and click-to-clear when optional), calm tinted-ink multi-select filter chips (`aria-pressed` + animated leading check icon), and lightweight short text fields (`Enter` advances/commits, `Esc` blurs, `required` pre-dispatch validation).
- **Inline 2-step danger confirmation:** First click/keypress on a `tone: "danger"` row arms it in-place (`Click to confirm` for `4.5s`, `Escape` disarms); second click/keypress dispatches.
- **Keyboard & WCAG 1.4.13:** `1`–`3` dispatch visible rows, `ArrowUp`/`ArrowDown`/`Home`/`End` rove across rows and update the inspector, `d` toggles Expand-All, `Enter` commits primary from card/checkboxes, and `Escape` disarms danger, collapses overflow, or dismisses hover details without moving the pointer.
