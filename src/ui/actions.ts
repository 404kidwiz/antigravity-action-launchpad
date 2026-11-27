import { connectDeckApp, DeckBridge, esc, ICONS } from "./shared";

interface ToggleItem {
  id: string;
  label: string;
  checked?: boolean;
}

interface ChoiceOption {
  value: string;
  label: string;
}

interface ChoicePickerItem {
  id: string;
  label: string;
  multiple?: boolean;
  required?: boolean;
  options: ChoiceOption[];
  selected?: string[];
}

interface TextInputItem {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  required?: boolean;
  maxLength?: number;
}

interface ActionItem {
  id: string;
  label: string;
  sublabel?: string;
  subtitle?: string;
  badge?: string;
  prompt: string;
  tone?: "primary" | "neutral" | "ghost" | "danger";
  hint?: string;
  detail?: string;
  why?: string;
  reason?: string;
  spawnNew?: boolean;
  appliesToggles?: boolean;
  requireToggles?: boolean;
}

interface ActionsPayload {
  mode: "pills" | "approval";
  heading: string;
  summary?: string;
  risk?: "low" | "medium" | "high";
  targets?: string[];
  toggles?: ToggleItem[];
  choices?: ChoicePickerItem[];
  inputs?: TextInputItem[];
  actions: ActionItem[];
}

interface RowEntry {
  action: ActionItem;
  descId: string;
  subText: string;
  detailText: string;
  whyText: string;
  shortcutNum?: number;
  isExit: boolean;
  isOverflow: boolean;
}

const EXIT_LABEL_RE = /\b(wrap up|all set|dismiss|skip|close|cancel|not now|later|ship as-is|looks good)\b/i;
const GENERIC_GO_RE = /^(go|proceed|continue|yes|ok|okay|run|apply)$/i;
const GENERIC_EXIT_RE = /^(done|wrap up|all set|dismiss|skip|close|cancel|stop|none|no)$/i;

const root = document.getElementById("root")!;
document.body.classList.add("inline-mode");

// Persistent AT live region outside #root so replacing card innerHTML never drops announcements
const liveRegion = document.createElement("div");
liveRegion.id = "al-live";
liveRegion.className = "sr-only";
liveRegion.setAttribute("role", "status");
liveRegion.setAttribute("aria-live", "polite");
liveRegion.setAttribute("aria-atomic", "true");
document.body.appendChild(liveRegion);

function announceStatus(msg: string) {
  liveRegion.textContent = "";
  requestAnimationFrame(() => {
    liveRegion.textContent = msg;
  });
}

let bridge: DeckBridge | null = null;
let payload: ActionsPayload | null = null;
const toggleState = new Map<string, boolean>();
const choiceState = new Map<string, Set<string>>();
const inputState = new Map<string, string>();
let dispatched: { label: string; spawnNew?: boolean } | null = null;
let overflowOpen = false;
let busy = false;
let busyActionId: string | null = null;
let errorText = "";
let pendingFocusSelector: string | null = null;

// Inline 2-step arming confirmation for destructive actions
let armedDangerId: string | null = null;
let armedDangerTimer: number | null = null;

// Live Hover Inspector & Pinned All-Details state (mutated in-place for silky transitions)
let allDetailsPinned = false;
let activeInspectId: string | null = null;
let lastInputWasKeyboard = false;
let closeTimer: number | null = null;
let currentEntries = new Map<string, RowEntry>();

function clearHoverTimers() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function clearArmedDanger(shouldSync = false) {
  if (armedDangerTimer !== null) {
    window.clearTimeout(armedDangerTimer);
    armedDangerTimer = null;
  }
  if (armedDangerId !== null) {
    armedDangerId = null;
    if (shouldSync) syncArmedUI();
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Escape HTML and format inline `code` backtick spans cleanly instead of showing raw backticks. */
function formatRichText(text: string): string {
  return esc(text).replace(/`([^`]+)`/g, '<code class="al-code">$1</code>');
}

function formatActionDetail(action: ActionItem, isExit: boolean): string {
  const explicit = normalizeWhitespace(action.hint || action.detail || "");
  if (explicit) return explicit;

  const prompt = normalizeWhitespace(action.prompt || "");
  if (!prompt) {
    return isExit ? "Close out here without running another action." : "";
  }
  if (/^\/\S+$/.test(prompt)) {
    return `Runs \`${prompt}\` in this conversation.`;
  }
  if (isExit && GENERIC_EXIT_RE.test(prompt)) {
    return "Close out here without running another step.";
  }
  if (GENERIC_GO_RE.test(prompt)) {
    return `Continues immediately with "${action.label}".`;
  }
  if (prompt.toLowerCase() === normalizeWhitespace(action.label).toLowerCase()) {
    return isExit ? "Close out here without running another step." : "";
  }
  return prompt.length > 220 ? `${prompt.slice(0, 217).trimEnd()}…` : prompt;
}

function activeToggleList(): ToggleItem[] {
  return (payload?.toggles ?? []).filter((t) => toggleState.get(t.id));
}

function selectedChoiceEntries(): Array<{ choice: ChoicePickerItem; labels: string[] }> {
  const out: Array<{ choice: ChoicePickerItem; labels: string[] }> = [];
  for (const c of payload?.choices ?? []) {
    const sel = choiceState.get(c.id);
    if (!sel || sel.size === 0) continue;
    const labels = c.options.filter((o) => sel.has(o.value)).map((o) => o.label);
    if (labels.length > 0) out.push({ choice: c, labels });
  }
  return out;
}

function firstMissingRequiredChoice(): ChoicePickerItem | null {
  for (const c of payload?.choices ?? []) {
    if (!c.required) continue;
    const sel = choiceState.get(c.id);
    if (!sel || sel.size === 0) return c;
  }
  return null;
}

function filledInputEntries(): Array<{ input: TextInputItem; value: string }> {
  const out: Array<{ input: TextInputItem; value: string }> = [];
  for (const inp of payload?.inputs ?? []) {
    const val = normalizeWhitespace(inputState.get(inp.id) ?? "");
    if (val) out.push({ input: inp, value: val });
  }
  return out;
}

function firstMissingRequiredInput(): TextInputItem | null {
  for (const inp of payload?.inputs ?? []) {
    if (!inp.required) continue;
    if (!normalizeWhitespace(inputState.get(inp.id) ?? "")) return inp;
  }
  return null;
}

function shouldAttachToggles(action: ActionItem): boolean {
  if (typeof action.appliesToggles === "boolean") return action.appliesToggles;
  return action.tone === "primary";
}

function requiresSelection(action: ActionItem): boolean {
  if (typeof action.requireToggles === "boolean") return action.requireToggles;
  return shouldAttachToggles(action) && /\bselected\b/i.test(action.label);
}

function buildPrompt(action: ActionItem): string {
  if (!shouldAttachToggles(action)) return action.prompt;
  const sections: string[] = [];
  const choices = selectedChoiceEntries();
  if (choices.length > 0) {
    const summary = choices.map(({ choice, labels }) => `${choice.label}: ${labels.join(", ")}`).join("; ");
    sections.push(`Selected choices: ${summary}`);
  }
  const inputs = filledInputEntries();
  if (inputs.length > 0) {
    const summary = inputs.map(({ input, value }) => `${input.label}: ${value}`).join("; ");
    sections.push(`Provided inputs: ${summary}`);
  }
  const active = activeToggleList();
  if (active.length > 0) {
    const opts = active.map((t) => t.label).join("; ");
    sections.push(`Selected options: ${opts}`);
  }
  if (sections.length === 0) return action.prompt;
  return `${action.prompt}\n\n${sections.join("\n")}`;
}

function partitionActions(actions: ActionItem[], isApproval: boolean) {
  let exitAction: ActionItem | null = null;
  const remaining: ActionItem[] = [];

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const isTrailingDismiss =
      !exitAction &&
      i === actions.length - 1 &&
      EXIT_LABEL_RE.test(a.label) &&
      (isApproval || (actions.length >= 3 && (a.tone === undefined || a.tone === "neutral")));
    if (!exitAction && (a.tone === "ghost" || isTrailingDismiss)) {
      exitAction = a;
    } else {
      remaining.push(a);
    }
  }

  const visibleRows = remaining.length <= 3 ? remaining : remaining.slice(0, 3);
  const overflowRows = remaining.length <= 3 ? [] : remaining.slice(3);
  return { visibleRows, overflowRows, exitAction };
}

function syncArmedUI() {
  root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
    const id = btn.dataset.action ?? "";
    const isArmed = armedDangerId !== null && id === armedDangerId;
    btn.classList.toggle("is-armed", isArmed);
    const confirmTag = btn.querySelector<HTMLElement>("[data-confirm-tag]");
    if (confirmTag) confirmTag.toggleAttribute("hidden", !isArmed);
    const normalBadge = btn.querySelector<HTMLElement>("[data-danger-badge]");
    if (normalBadge) normalBadge.toggleAttribute("hidden", isArmed);
  });
}

/** Default inspector target: the primary row, else the first visible row. Keeps the slot never empty. */
function defaultInspectId(): string | null {
  for (const e of currentEntries.values()) {
    if (!e.isExit && !e.isOverflow && e.action.tone === "primary") return e.action.id;
  }
  for (const e of currentEntries.values()) {
    if (!e.isExit && !e.isOverflow) return e.action.id;
  }
  return null;
}

function syncInspectorUI() {
  const card = root.querySelector<HTMLElement>(".al-card");
  const inspector = document.getElementById("al-inspector");
  const detailsToggle = document.getElementById("al-details-toggle");

  card?.classList.toggle("is-all-expanded", allDetailsPinned && !dispatched);

  // The inspector slot has a FIXED height (all items stacked in one grid cell, crossfaded),
  // so hovering never changes the card height -> no iframe resize -> no pointer feedback loop.
  const showId = activeInspectId ?? defaultInspectId();
  if (inspector) {
    inspector.classList.toggle("is-hidden", allDetailsPinned);
    inspector.querySelectorAll<HTMLElement>(".al-insp-item").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.inspFor === showId);
    });
  }

  if (detailsToggle) {
    detailsToggle.setAttribute("aria-expanded", allDetailsPinned ? "true" : "false");
    detailsToggle.classList.toggle("is-pinned", allDetailsPinned);
    const labelSpan = detailsToggle.querySelector<HTMLElement>("[data-toggle-label]");
    if (labelSpan) {
      labelSpan.textContent = allDetailsPinned ? "Compact" : "Details";
    }
  }

  root.querySelectorAll<HTMLButtonElement>(".al-row[data-action]").forEach((row) => {
    const id = row.dataset.action ?? "";
    row.classList.toggle("is-inspected", activeInspectId !== null && id === activeInspectId);
  });
}

async function handleAction(action: ActionItem) {
  if (!bridge || busy) return;
  if (!bridge.canMessage) {
    overflowOpen = false;
    errorText = "Messaging is unavailable on this surface.";
    pendingFocusSelector = `button[data-action="${CSS.escape(action.id)}"]`;
    render();
    return;
  }
  const toggles = payload?.toggles ?? [];
  if (shouldAttachToggles(action)) {
    const missingChoice = firstMissingRequiredChoice();
    if (missingChoice) {
      errorText = `Select an option for "${missingChoice.label}" before continuing.`;
      pendingFocusSelector = `button[data-choice="${CSS.escape(missingChoice.id)}"]`;
      render();
      return;
    }
    const missingInput = firstMissingRequiredInput();
    if (missingInput) {
      errorText = `Enter a value for "${missingInput.label}" before continuing.`;
      pendingFocusSelector = `input[data-text-input="${CSS.escape(missingInput.id)}"]`;
      render();
      return;
    }
  }
  if (toggles.length > 0 && requiresSelection(action) && activeToggleList().length === 0) {
    errorText = "Select at least one option above before continuing.";
    pendingFocusSelector = "input[data-toggle]";
    render();
    return;
  }

  // Two-step inline arming confirmation on destructive actions (prevents accidental clicks/keypresses)
  if (action.tone === "danger" && armedDangerId !== action.id) {
    clearArmedDanger(false);
    armedDangerId = action.id;
    activeInspectId = action.id;
    syncArmedUI();
    syncInspectorUI();
    announceStatus(`Press again to confirm destructive action: ${action.label}. Press Escape to cancel.`);
    armedDangerTimer = window.setTimeout(() => {
      clearArmedDanger(true);
    }, 4500);
    return;
  }

  clearArmedDanger(false);
  clearHoverTimers();
  busy = true;
  busyActionId = action.id;
  errorText = "";
  render();
  try {
    await bridge.sendMessage(buildPrompt(action), Boolean(action.spawnNew));
    overflowOpen = false;
    allDetailsPinned = false;
    activeInspectId = null;
    dispatched = { label: action.label, spawnNew: action.spawnNew };
    pendingFocusSelector = "#reset-dispatch";
    announceStatus(`Sent${action.spawnNew ? " to new thread" : ""}: ${action.label}`);
  } catch (err: any) {
    errorText = err?.message ? String(err.message) : "Failed to send action.";
    pendingFocusSelector = `button[data-action="${CSS.escape(action.id)}"]`;
  } finally {
    busy = false;
    busyActionId = null;
    render();
  }
}

function renderCommandRow(
  entry: RowEntry,
  isApproval: boolean,
  togglesLen: number,
  checkedCount: number
): string {
  const a = entry.action;
  const isSendingThis = busy && busyActionId === a.id;
  const isPrimary = a.tone === "primary";
  const isDanger = a.tone === "danger";
  const isArmed = isDanger && armedDangerId === a.id;

  const rowClasses = [
    "al-row",
    isPrimary ? "is-primary" : "",
    isDanger ? "is-danger" : "",
    isArmed ? "is-armed" : "",
    entry.isOverflow ? "is-overflow-row" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const leadingHtml = isSendingThis
    ? `<span class="al-row-lead">${ICONS.statusRunning}</span>`
    : entry.shortcutNum
    ? `<kbd class="al-kbd al-row-kbd" aria-hidden="true">${entry.shortcutNum}</kbd>`
    : `<span class="al-row-lead al-row-dot" aria-hidden="true"></span>`;

  const badges: string[] = [];
  if (isDanger) {
    badges.push(
      `<span class="al-badge is-danger" data-danger-badge${isArmed ? " hidden" : ""}>Destructive</span>`
    );
    badges.push(
      `<span class="al-badge is-confirm" data-confirm-tag${isArmed ? "" : " hidden"}>Click to confirm</span>`
    );
  } else if (isPrimary && !isApproval && !a.badge) {
    badges.push(`<span class="al-badge is-recommended">Recommended</span>`);
  }
  if (a.badge) {
    badges.push(`<span class="al-badge">${formatRichText(a.badge)}</span>`);
  }
  if (a.spawnNew) {
    badges.push(`<span class="al-badge">${ICONS.launch}<span>New thread</span></span>`);
  }
  if (shouldAttachToggles(a) && togglesLen > 0 && !isSendingThis) {
    badges.push(
      `<span class="al-badge is-count" data-primary-count-wrap${
        checkedCount === 0 ? " hidden" : ""
      }><span data-primary-count>${checkedCount}</span> selected</span>`
    );
  }

  const subHtml = entry.subText
    ? `<span class="al-row-sep" aria-hidden="true">·</span><span class="al-row-sub" title="${esc(
        entry.subText
      )}">${formatRichText(entry.subText)}</span>`
    : "";

  // Ultra-compact at rest: both Why and What live in the fixed-height hover/focus inspector
  // and expand inline under each row only when Details (key D) is pinned.
  const inlineLines: string[] = [];
  if (entry.whyText) {
    inlineLines.push(
      `<div class="al-inline-line"><span class="al-why-pill">Why</span><span class="al-why-copy">${formatRichText(
        entry.whyText
      )}</span></div>`
    );
  }
  if (entry.detailText) {
    inlineLines.push(
      `<div class="al-inline-line"><span class="al-what-pill">What</span><span class="al-why-copy">${formatRichText(
        entry.detailText
      )}</span></div>`
    );
  }
  const inlineDrawerHtml =
    inlineLines.length > 0
      ? `<div class="al-row-inline-wrap" aria-hidden="true"><div class="al-row-inline-inner"><div class="al-row-inline">${inlineLines.join(
          ""
        )}</div></div></div>`
      : "";

  const trailingIcon = isSendingThis ? "" : a.spawnNew ? ICONS.launch : ICONS.arrowRight;

  return `<button type="button" class="${rowClasses}" data-action="${esc(a.id)}" ${
    entry.shortcutNum ? `data-shortcut="${entry.shortcutNum}"` : ""
  } ${entry.descId ? `aria-describedby="${esc(entry.descId)}"` : ""} ${busy ? "disabled" : ""}>
    <span class="al-row-top">
      ${leadingHtml}
      <span class="al-row-main">
        <span class="al-row-title">${formatRichText(isSendingThis ? `Sending: ${a.label}…` : a.label)}</span>
        ${subHtml}
      </span>
      <span class="al-row-end">
        ${badges.join("")}
        ${trailingIcon ? `<span class="al-row-arrow" aria-hidden="true">${trailingIcon}</span>` : ""}
      </span>
    </span>
    ${inlineDrawerHtml}
  </button>`;
}

function render() {
  clearHoverTimers();
  currentEntries = new Map();

  if (!payload) {
    root.innerHTML = `<div class="deck-shell"><div class="al-card al-card-skel"><div class="skeleton skel-w-220"></div></div></div>`;
    return;
  }

  const isApproval = payload.mode === "approval";
  const riskClass =
    payload.risk === "high" ? "abort" : payload.risk === "low" ? "nominal" : "caution";
  const toggles = payload.toggles ?? [];
  const choices = payload.choices ?? [];
  const inputs = payload.inputs ?? [];
  const checkedCount = activeToggleList().length;

  const { visibleRows, overflowRows, exitAction } = partitionActions(payload.actions, isApproval);

  const allEntries: RowEntry[] = [];
  let descCounter = 0;

  const registerEntry = (
    action: ActionItem,
    shortcutNum: number | undefined,
    isExit: boolean,
    isOverflow: boolean
  ): RowEntry => {
    const subText = normalizeWhitespace(action.sublabel || action.subtitle || "");
    const detailText = formatActionDetail(action, isExit);
    const whyText = normalizeWhitespace(action.why || action.reason || "");
    const hasDistinctDesc =
      Boolean(whyText) ||
      (Boolean(detailText) && detailText.toLowerCase() !== normalizeWhitespace(action.label).toLowerCase());
    const descId = hasDistinctDesc ? `al-desc-${descCounter++}` : "";
    const entry: RowEntry = {
      action,
      descId,
      subText,
      detailText,
      whyText,
      shortcutNum,
      isExit,
      isOverflow,
    };
    currentEntries.set(action.id, entry);
    allEntries.push(entry);
    return entry;
  };

  const visibleEntries = visibleRows.map((a, idx) => registerEntry(a, idx + 1, false, false));
  const overflowEntries = overflowRows.map((a, idx) => {
    const num = visibleRows.length + idx + 1;
    return registerEntry(a, num <= 9 ? num : undefined, false, true);
  });
  const exitEntry = exitAction ? registerEntry(exitAction, undefined, true, false) : null;

  const hasAnyDetails = allEntries.some((e) => Boolean(e.detailText || e.whyText));
  const canInspect = !dispatched && hasAnyDetails;

  const exitHeaderHtml =
    !dispatched && exitEntry
      ? `<button type="button" class="al-head-exit" data-action="${esc(exitEntry.action.id)}" ${
          exitEntry.descId ? `aria-describedby="${esc(exitEntry.descId)}"` : ""
        } ${busy ? "disabled" : ""}>${formatRichText(
          busy && busyActionId === exitEntry.action.id ? "Sending…" : exitEntry.action.label
        )}</button>`
      : "";

  const detailsToggleHtml = canInspect
    ? `<button type="button" class="al-details-toggle${allDetailsPinned ? " is-pinned" : ""}" id="al-details-toggle" aria-expanded="${
        allDetailsPinned ? "true" : "false"
      }" aria-label="${allDetailsPinned ? "Collapse option details" : "Expand all option details"}" title="Toggle all details (Key D)">
        <span data-toggle-label>${allDetailsPinned ? "Compact" : "Details"}</span>${ICONS.chevronDown}
      </button>`
    : "";

  const riskHtml = isApproval
    ? `<span class="tag ${riskClass}">${esc((payload.risk || "medium").toUpperCase())} RISK</span>`
    : "";

  const toggleMetaHtml =
    toggles.length > 0
      ? isApproval
        ? `<span class="sr-only" id="al-sel-meta" role="status" aria-live="polite" aria-atomic="true">${checkedCount} of ${toggles.length} selected</span>`
        : `<span class="al-meta" id="al-sel-meta" role="status" aria-live="polite" aria-atomic="true">${checkedCount}/${toggles.length}</span>`
      : "";

  const metaParts = [riskHtml, toggleMetaHtml, detailsToggleHtml, exitHeaderHtml].filter(Boolean);
  const metaHtml = metaParts.length > 0 ? `<div class="al-head-meta">${metaParts.join("")}</div>` : "";

  const targetsHtml =
    isApproval && payload.targets && payload.targets.length > 0
      ? `<div class="al-targets">
          ${payload.targets.map((t) => `<span class="tag">${ICONS.file}${esc(t)}</span>`).join("")}
        </div>`
      : "";

  const togglesLocked = busy || Boolean(dispatched);
  const choicesHtml =
    choices.length > 0
      ? `<div class="al-choices">
          ${choices
            .map((c, cIdx) => {
              const labelId = `al-choice-lbl-${cIdx}`;
              const sel = choiceState.get(c.id) ?? new Set<string>();
              const isMulti = Boolean(c.multiple);
              const firstSelectedIdx = !isMulti
                ? Math.max(
                    0,
                    c.options.findIndex((o) => sel.has(o.value))
                  )
                : 0;
              const chipsHtml = c.options
                .map((o, oIdx) => {
                  const isSel = sel.has(o.value);
                  const ariaAttr = isMulti
                    ? `aria-pressed="${isSel ? "true" : "false"}"`
                    : `role="radio" aria-checked="${isSel ? "true" : "false"}" tabindex="${
                        oIdx === firstSelectedIdx ? "0" : "-1"
                      }"`;
                  const checkIcon = isMulti
                    ? `<span class="al-chip-check" aria-hidden="true">${ICONS.check}</span>`
                    : "";
                  return `<button type="button" class="al-chip${isSel ? " is-selected" : ""}" data-choice="${esc(
                    c.id
                  )}" data-choice-val="${esc(o.value)}" ${ariaAttr} ${
                    togglesLocked ? "disabled" : ""
                  }>${checkIcon}<span>${formatRichText(o.label)}</span></button>`;
                })
                .join("");
              return `<div class="al-choice-row${togglesLocked ? " is-locked" : ""}">
                <span class="al-choice-label" id="${labelId}">${formatRichText(c.label)}${
                  c.required ? `<span class="al-choice-req" aria-hidden="true">*</span>` : ""
                }</span>
                <div class="al-chip-group ${isMulti ? "is-multi" : "is-single"}" role="${
                  isMulti ? "group" : "radiogroup"
                }" aria-labelledby="${labelId}" data-choice-group="${esc(c.id)}">${chipsHtml}</div>
              </div>`;
            })
            .join("")}
        </div>`
      : "";
  const inputsHtml =
    inputs.length > 0
      ? `<div class="al-inputs">
          ${inputs
            .map((inp, iIdx) => {
              const fieldId = `al-input-${iIdx}`;
              const val = inputState.get(inp.id) ?? "";
              const maxLen = inp.maxLength ?? 200;
              return `<div class="al-input-row${togglesLocked ? " is-locked" : ""}">
                <label class="al-choice-label" for="${fieldId}">${formatRichText(inp.label)}${
                  inp.required ? `<span class="al-choice-req" aria-hidden="true">*</span>` : ""
                }</label>
                <input id="${fieldId}" type="text" class="al-input" data-text-input="${esc(
                  inp.id
                )}" value="${esc(val)}" ${
                  inp.placeholder ? `placeholder="${esc(inp.placeholder)}"` : ""
                } maxlength="${maxLen}" ${inp.required ? 'aria-required="true"' : ""} autocomplete="off" spellcheck="false" ${
                  togglesLocked ? "disabled" : ""
                } />
              </div>`;
            })
            .join("")}
        </div>`
      : "";
  const togglesHtml =
    toggles.length > 0
      ? `<div class="al-options" role="group" aria-label="Selectable options">
          ${toggles
            .map((t) => {
              const checked = Boolean(toggleState.get(t.id));
              return `<label class="al-option ${checked ? "is-checked" : ""}${togglesLocked ? " is-locked" : ""}" data-opt-row="${esc(t.id)}">
                <input type="checkbox" data-toggle="${esc(t.id)}" ${checked ? "checked" : ""} ${togglesLocked ? "disabled" : ""} />
                <span class="al-check-box" aria-hidden="true">${ICONS.check}</span>
                <span class="al-option-label">${formatRichText(t.label)}</span>
              </label>`;
            })
            .join("")}
        </div>`
      : "";

  let bodyHtml = "";
  let inspectorHtml = "";

  if (dispatched) {
    bodyHtml = `<div class="al-dispatched-bar">
      <span class="al-dispatched-msg">
        ${ICONS.statusDone}<span>Sent${dispatched.spawnNew ? " to new thread" : ""}: ${formatRichText(
          dispatched.label
        )}</span>
      </span>
      <button type="button" class="btn ghost" id="reset-dispatch">Choose another</button>
    </div>`;
  } else {
    const visibleHtml = visibleEntries
      .map((e) => renderCommandRow(e, isApproval, toggles.length, checkedCount))
      .join("");

    const overflowRowsHtml =
      overflowOpen && overflowEntries.length > 0
        ? overflowEntries
            .map((e) => renderCommandRow(e, isApproval, toggles.length, checkedCount))
            .join("")
        : "";

    const overflowToggleHtml =
      overflowEntries.length > 0
        ? `<button type="button" class="al-more-row" id="al-overflow-toggle" aria-expanded="${
            overflowOpen ? "true" : "false"
          }" ${busy ? "disabled" : ""}>
            <span class="al-more-left">${ICONS.more}<span>${
              overflowOpen
                ? "Show fewer options"
                : `+${overflowEntries.length} more option${overflowEntries.length === 1 ? "" : "s"}`
            }</span></span>
            <span class="al-more-chev${overflowOpen ? " is-open" : ""}" aria-hidden="true">${ICONS.chevronDown}</span>
          </button>`
        : "";

    bodyHtml = `<div class="al-list" role="group" aria-label="Suggested actions">
      ${visibleHtml}
      ${overflowRowsHtml}
      ${overflowToggleHtml}
    </div>`;

    if (canInspect) {
      const items = allEntries
        .filter((e) => Boolean(e.detailText || e.whyText))
        .map((e) => {
          const kbdHtml = e.shortcutNum
            ? `<kbd class="al-kbd al-insp-kbd${
                e.action.tone === "primary"
                  ? " is-primary"
                  : e.action.tone === "danger"
                  ? " is-danger"
                  : ""
              }">${e.shortcutNum}</kbd>`
            : "";
          const lines: string[] = [];
          if (e.whyText) {
            lines.push(
              `<div class="al-insp-line"><span class="al-why-pill">Why</span><span class="al-why-copy">${formatRichText(
                e.whyText
              )}</span></div>`
            );
          }
          if (e.detailText) {
            lines.push(
              `<div class="al-insp-line is-what"><span class="al-what-pill">What</span><span class="al-why-copy">${formatRichText(
                e.detailText
              )}</span></div>`
            );
          }
          return `<div class="al-insp-item${e.action.tone === "danger" ? " is-danger" : ""}" data-insp-for="${esc(
            e.action.id
          )}">${kbdHtml}<div class="al-insp-body">${lines.join("")}</div></div>`;
        })
        .join("");
      // aria-hidden: screen readers already get full text via aria-describedby on each row.
      inspectorHtml = `<div class="al-inspector" id="al-inspector" aria-hidden="true"><div class="al-insp-stack">${items}</div></div>`;
    }
  }

  const srDescsHtml = !dispatched
    ? allEntries
        .filter((e) => Boolean(e.descId))
        .map((e) => {
          const combined = [e.detailText, e.whyText ? `Why: ${e.whyText}` : ""].filter(Boolean).join(" ");
          return `<span id="${esc(e.descId)}" class="sr-only">${esc(combined)}</span>`;
        })
        .join("")
    : "";

  const hasSummary = Boolean(payload.summary && payload.summary.trim());

  root.innerHTML = `
    <div class="deck-shell">
      <section class="al-card ${isApproval ? `is-approval risk-${riskClass}` : ""}${
        allDetailsPinned && !dispatched ? " is-all-expanded" : ""
      }" tabindex="-1" aria-label="${esc(payload.heading)}">
        <header class="al-head${hasSummary ? " has-summary" : ""}">
          <div class="al-title-wrap">
            <span class="al-icon" aria-hidden="true">${isApproval ? ICONS.shield : ICONS.brandActions}</span>
            <div class="min-w-0">
              <h2 class="al-title">${formatRichText(payload.heading)}</h2>
              ${hasSummary ? `<div class="al-summary">${formatRichText(payload.summary ?? "")}</div>` : ""}
            </div>
          </div>
          ${metaHtml}
        </header>
        ${targetsHtml}
        ${choicesHtml}
        ${inputsHtml}
        ${togglesHtml}
        ${bodyHtml}
        ${inspectorHtml}
        ${errorText ? `<div role="alert" class="al-error">${esc(errorText)}</div>` : ""}
        ${srDescsHtml}
      </section>
    </div>
  `;

  // ChoicePicker chip click & radio keyboard navigation (in-place DOM updates preserve focus)
  const syncChoiceGroup = (choiceId: string) => {
    const c = (payload?.choices ?? []).find((item) => item.id === choiceId);
    if (!c) return;
    const sel = choiceState.get(choiceId) ?? new Set<string>();
    const isMulti = Boolean(c.multiple);
    const groupEl = root.querySelector<HTMLElement>(`[data-choice-group="${CSS.escape(choiceId)}"]`);
    if (!groupEl) return;
    const btns = Array.from(groupEl.querySelectorAll<HTMLButtonElement>("button[data-choice]"));
    const firstSelIdx = !isMulti
      ? Math.max(
          0,
          btns.findIndex((b) => sel.has(b.dataset.choiceVal ?? ""))
        )
      : 0;
    btns.forEach((b, idx) => {
      const val = b.dataset.choiceVal ?? "";
      const isSel = sel.has(val);
      b.classList.toggle("is-selected", isSel);
      if (isMulti) {
        b.setAttribute("aria-pressed", isSel ? "true" : "false");
      } else {
        b.setAttribute("aria-checked", isSel ? "true" : "false");
        b.tabIndex = idx === firstSelIdx ? 0 : -1;
      }
    });
    const errEl = root.querySelector(".al-error");
    if (errEl) {
      errorText = "";
      errEl.remove();
    }
  };

  root.querySelectorAll<HTMLElement>("[data-choice-group]").forEach((groupEl) => {
    const choiceId = groupEl.dataset.choiceGroup ?? "";
    const choiceObj = (payload?.choices ?? []).find((item) => item.id === choiceId);
    if (!choiceObj) return;
    const isMulti = Boolean(choiceObj.multiple);
    const btns = Array.from(groupEl.querySelectorAll<HTMLButtonElement>("button[data-choice]"));

    const selectBtn = (btn: HTMLButtonElement, allowClear = true) => {
      const val = btn.dataset.choiceVal ?? "";
      if (!val) return;
      let sel = choiceState.get(choiceId);
      if (!sel) {
        sel = new Set<string>();
        choiceState.set(choiceId, sel);
      }
      if (isMulti) {
        if (sel.has(val)) sel.delete(val);
        else sel.add(val);
      } else if (allowClear && sel.has(val) && !choiceObj.required) {
        sel.clear();
      } else {
        sel.clear();
        sel.add(val);
      }
      syncChoiceGroup(choiceId);
    };

    btns.forEach((btn, idx) => {
      btn.addEventListener("click", () => selectBtn(btn, true));
      if (!isMulti) {
        btn.addEventListener("keydown", (e) => {
          if (btns.length < 2) return;
          let next = -1;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % btns.length;
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + btns.length) % btns.length;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = btns.length - 1;
          if (next >= 0) {
            e.preventDefault();
            const target = btns[next];
            if (target && !target.disabled) {
              selectBtn(target, false);
              target.focus();
            }
          }
        });
      }
    });
  });

  const textInputEls = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-text-input]"));
  textInputEls.forEach((inp, idx) => {
    inp.addEventListener("input", () => {
      const id = inp.dataset.textInput;
      if (!id) return;
      inputState.set(id, inp.value);
      const errEl = root.querySelector(".al-error");
      if (errEl) {
        errorText = "";
        errEl.remove();
      }
    });
    inp.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        inp.blur();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const nextInput = textInputEls[idx + 1];
        if (nextInput && !nextInput.disabled) {
          nextInput.focus();
          return;
        }
        const primary = payload?.actions.find((a) => a.tone === "primary") ?? payload?.actions[0];
        if (primary) void handleAction(primary);
      }
    });
  });

  root.querySelectorAll<HTMLInputElement>("input[data-toggle]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const id = inp.dataset.toggle;
      if (!id) return;
      toggleState.set(id, inp.checked);
      errorText = "";
      const row = inp.closest(".al-option");
      if (row) row.classList.toggle("is-checked", inp.checked);
      const count = activeToggleList().length;
      const meta = document.getElementById("al-sel-meta");
      if (meta) {
        meta.textContent = isApproval ? `${count} of ${toggles.length} selected` : `${count}/${toggles.length}`;
      }
      root.querySelectorAll<HTMLElement>("[data-primary-count]").forEach((badge) => {
        badge.textContent = String(count);
      });
      root.querySelectorAll<HTMLElement>("[data-primary-count-wrap]").forEach((wrap) => {
        wrap.toggleAttribute("hidden", count === 0);
      });
      const errEl = root.querySelector(".al-error");
      if (errEl) errEl.remove();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = payload?.actions.find((a) => a.id === btn.dataset.action);
      if (target) void handleAction(target);
    });
  });

  // Crossfading inspector: fixed-height slot, so rows NEVER shift and the iframe NEVER resizes on hover.
  const cardEl = root.querySelector<HTMLElement>(".al-card");
  if (cardEl && canInspect) {
    const setActive = (id: string | null) => {
      if (closeTimer !== null) {
        window.clearTimeout(closeTimer);
        closeTimer = null;
      }
      if (activeInspectId === id) return;
      activeInspectId = id;
      syncInspectorUI();
    };

    cardEl.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
      const id = btn.dataset.action ?? null;
      btn.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "touch") return;
        setActive(id);
      });
      btn.addEventListener("focus", () => {
        if (!lastInputWasKeyboard) return;
        setActive(id);
      });
    });

    cardEl.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch") return;
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      // Short grace period so crossing hairlines between rows never flickers back to default.
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        if (!cardEl.contains(document.activeElement) || !lastInputWasKeyboard) {
          activeInspectId = null;
          syncInspectorUI();
        }
      }, 180);
    });

    cardEl.addEventListener("focusout", (e) => {
      const next = e.relatedTarget as HTMLElement | null;
      if (!next || !cardEl.contains(next)) {
        if (!cardEl.matches(":hover")) {
          activeInspectId = null;
          syncInspectorUI();
        }
      }
    });
  }

  document.getElementById("al-details-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    clearHoverTimers();
    allDetailsPinned = !allDetailsPinned;
    syncInspectorUI();
  });

  document.getElementById("al-overflow-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    overflowOpen = !overflowOpen;
    pendingFocusSelector = overflowOpen ? ".al-row.is-overflow-row" : "#al-overflow-toggle";
    render();
  });

  root.querySelector("#reset-dispatch")?.addEventListener("click", () => {
    dispatched = null;
    errorText = "";
    pendingFocusSelector = ".al-row[data-action]";
    render();
  });

  // ArrowUp / ArrowDown / Home / End navigation across flush command rows
  const rowBtns = Array.from(root.querySelectorAll<HTMLButtonElement>(".al-list .al-row:not(:disabled)"));
  rowBtns.forEach((btn, idx) => {
    btn.addEventListener("keydown", (e) => {
      if (rowBtns.length < 2) return;
      let next = -1;
      if (e.key === "ArrowDown") next = (idx + 1) % rowBtns.length;
      else if (e.key === "ArrowUp") next = (idx - 1 + rowBtns.length) % rowBtns.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = rowBtns.length - 1;
      if (next >= 0) {
        e.preventDefault();
        rowBtns[next]?.focus();
      }
    });
  });

  syncArmedUI();
  syncInspectorUI();

  if (pendingFocusSelector) {
    const sel = pendingFocusSelector;
    pendingFocusSelector = null;
    root.querySelector<HTMLElement>(sel)?.focus();
  }
}

document.addEventListener(
  "pointerdown",
  () => {
    lastInputWasKeyboard = false;
  },
  true
);

document.addEventListener(
  "keydown",
  (e) => {
    if (
      e.key === "Tab" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      lastInputWasKeyboard = true;
    }
  },
  true
);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (armedDangerId !== null) {
      e.preventDefault();
      clearArmedDanger(true);
      announceStatus("Cancelled destructive action confirmation.");
      return;
    }
    if (overflowOpen) {
      e.preventDefault();
      overflowOpen = false;
      pendingFocusSelector = "#al-overflow-toggle";
      render();
      return;
    }
    if (allDetailsPinned) {
      e.preventDefault();
      clearHoverTimers();
      allDetailsPinned = false;
      activeInspectId = null;
      syncInspectorUI();
      return;
    }
  }

  if (!payload || busy || dispatched || e.metaKey || e.ctrlKey || e.altKey) return;

  const active = document.activeElement as HTMLElement | null;
  const isTextInput =
    active &&
    ((active.tagName === "INPUT" && (active as HTMLInputElement).type !== "checkbox") ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.isContentEditable);
  if (isTextInput) return;

  // Press 'd' to toggle pinned all-details view
  if ((e.key === "d" || e.key === "D") && document.getElementById("al-details-toggle")) {
    e.preventDefault();
    clearHoverTimers();
    allDetailsPinned = !allDetailsPinned;
    syncInspectorUI();
    return;
  }

  // Number keys 1–9 trigger the corresponding command row immediately (auto-expands overflow if needed; danger still arms first)
  if (/^[1-9]$/.test(e.key)) {
    const num = Number(e.key);
    const matchedEntry = Array.from(currentEntries.values()).find((en) => en.shortcutNum === num);
    if (matchedEntry) {
      e.preventDefault();
      if (matchedEntry.isOverflow && !overflowOpen) {
        overflowOpen = true;
        render();
      }
      void handleAction(matchedEntry.action);
    }
    return;
  }

  // Pressing Enter on the card or on a checkbox row commits the primary action
  if (
    e.key === "Enter" &&
    (!active ||
      active === document.body ||
      active.classList.contains("al-card") ||
      (active.tagName === "INPUT" && (active as HTMLInputElement).type === "checkbox"))
  ) {
    const primary = payload.actions.find((a) => a.tone === "primary") ?? payload.actions[0];
    if (primary) {
      e.preventDefault();
      void handleAction(primary);
    }
  }
});

render();
bridge = await connectDeckApp("Action Launchpad", {
  onToolResult: (data) => {
    payload = data as ActionsPayload;
    toggleState.clear();
    for (const t of payload.toggles ?? []) {
      toggleState.set(t.id, Boolean(t.checked));
    }
    choiceState.clear();
    for (const c of payload.choices ?? []) {
      const valid = new Set(c.options.map((o) => o.value));
      const initial = (c.selected ?? []).filter((v) => valid.has(v));
      choiceState.set(c.id, new Set(c.multiple ? initial : initial.slice(0, 1)));
    }
    inputState.clear();
    for (const inp of payload.inputs ?? []) {
      inputState.set(inp.id, inp.value ?? "");
    }
    clearArmedDanger(false);
    dispatched = null;
    overflowOpen = false;
    allDetailsPinned = false;
    activeInspectId = null;
    busy = false;
    busyActionId = null;
    errorText = "";
    render();
  },
});
if (payload) render();
