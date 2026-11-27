import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = __dirname;

function readAppHtml(filename: string): string {
  const full = path.join(DIST_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing built UI bundle: ${full}. Run npm run build first.`);
  }
  return fs.readFileSync(full, "utf8");
}

const server = new McpServer({
  name: "antigravity-action-launchpad",
  version: "1.0.0",
});

registerAppResource(
  server,
  "Action Launchpad UI",
  "ui://antigravity-action-launchpad/actions.html",
  { _meta: { ui: { prefersBorder: false } } },
  async () => ({
    contents: [
      {
        uri: "ui://antigravity-action-launchpad/actions.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: readAppHtml("actions.html"),
      },
    ],
  })
);

function cleanText(value?: string): string {
  return value ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeAction(a: {
  id: string;
  label: string;
  sublabel?: string;
  badge?: string;
  prompt: string;
  tone?: "primary" | "neutral" | "ghost" | "danger";
  hint?: string;
  why?: string;
  spawnNew?: boolean;
  appliesToggles?: boolean;
  requireToggles?: boolean;
}) {
  const label = cleanText(a.label) || a.id;
  const rawSub = cleanText(a.sublabel);
  const why = cleanText(a.why);
  const hint = cleanText(a.hint);
  const badge = cleanText(a.badge);
  // Drop redundant sublabel when it duplicates the label or the why copy verbatim.
  const sublabel =
    rawSub &&
    rawSub.toLowerCase() !== label.toLowerCase() &&
    rawSub.toLowerCase() !== why.toLowerCase()
      ? rawSub
      : undefined;

  return {
    ...a,
    label,
    ...(sublabel ? { sublabel } : {}),
    ...(badge ? { badge } : {}),
    ...(hint ? { hint } : {}),
    ...(why ? { why } : {}),
  };
}

function normalizeChoice(c: {
  id: string;
  label: string;
  multiple?: boolean;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  selected?: string[];
}) {
  const seen = new Set<string>();
  const options: Array<{ value: string; label: string }> = [];
  for (const opt of c.options ?? []) {
    const value = cleanText(opt.value);
    const label = cleanText(opt.label) || value;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label });
  }
  if (options.length === 0) return null;

  const valid = new Set(options.map((o) => o.value));
  const rawSel = (c.selected ?? []).map(cleanText).filter((v) => valid.has(v));
  const dedupSel = Array.from(new Set(rawSel));
  const multiple = Boolean(c.multiple);
  const selected = multiple ? dedupSel : dedupSel.slice(0, 1);

  return {
    id: cleanText(c.id) || c.id,
    label: cleanText(c.label) || c.id,
    multiple,
    required: Boolean(c.required),
    options,
    selected,
  };
}

function normalizeInput(i: {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  required?: boolean;
  maxLength?: number;
}) {
  const id = cleanText(i.id) || i.id;
  const label = cleanText(i.label) || id;
  const maxLength = Math.min(500, Math.max(1, Math.round(i.maxLength ?? 200)));
  const placeholder = cleanText(i.placeholder);
  const rawVal = cleanText(i.value);
  const value = rawVal ? rawVal.slice(0, maxLength) : "";
  return {
    id,
    label,
    ...(placeholder ? { placeholder } : {}),
    ...(value ? { value } : {}),
    required: Boolean(i.required),
    maxLength,
  };
}

registerAppTool(
  server,
  "deck_actions",
  {
    title: "Action Launchpad",
    description:
      "Render an inline Flush Command List Action Launchpad card (single-line flush rows with title + inline subtitle + zero-jump live hover What/Why inspector + optional checkboxes or Propose-Then-Apply approval gate) at the BOTTOM of your response. On each active action, provide a crisp `label` (3-5 words), a concise `sublabel` (3-6 words shown inline on the row), `hint` (what choosing it will do), and `why` (why to pick it in this situation / tradeoff). Avoid raw markdown backticks unless naming an exact key or command. CRITICAL PLACEMENT RULE: Antigravity renders tool UIs chronologically. You MUST write your ENTIRE visible answer (summary, tables, verification, and details) in the assistant text of the SAME step BEFORE calling deck_actions — NEVER call deck_actions with empty assistant text and write your report afterward (that puts the card at the top). After deck_actions returns, end with ONLY the minimal 1-line Next:/Skills: footer.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      mode: z
        .enum(["pills", "approval"])
        .optional()
        .describe("pills (default) for clickable next-action suggestions, or approval for a Propose-Then-Apply gate."),
      heading: z.string().optional().describe("Concise action bar title."),
      summary: z.string().optional().describe("Short context or blast-radius summary."),
      risk: z.enum(["low", "medium", "high"]).optional().describe("Risk badge for approval mode."),
      targets: z.array(z.string()).optional().describe("Affected files, services, or targets (for approval mode)."),
      toggles: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            checked: z.boolean().optional(),
          })
        )
        .optional()
        .describe("Optional parameter checkboxes attached to primary actions (or actions with appliesToggles: true)."),
      choices: z
        .array(
          z.object({
            id: z.string(),
            label: z
              .string()
              .describe("Short group label shown beside the chips (e.g. 'Target', 'Scope', 'Format')."),
            multiple: z
              .boolean()
              .optional()
              .describe("False (default) for mutually exclusive segmented choice; true for multi-select chips."),
            required: z
              .boolean()
              .optional()
              .describe("When true, blocks param-attached actions until at least one option is selected."),
            options: z
              .array(
                z.object({
                  value: z.string().describe("Stable option value."),
                  label: z.string().describe("Concise chip label."),
                })
              )
              .min(1),
            selected: z
              .array(z.string())
              .optional()
              .describe("Initially selected option value(s). For single-select, the first valid value is used."),
          })
        )
        .optional()
        .describe(
          "Optional A2UI-inspired ChoicePicker chip groups (single-select segmented control or multi-select chips) attached to primary actions (or actions with appliesToggles: true)."
        ),
      inputs: z
        .array(
          z.object({
            id: z.string(),
            label: z
              .string()
              .describe("Short label shown beside the text field (e.g. 'Branch', 'Commit note', 'Tag')."),
            placeholder: z.string().optional().describe("Concise placeholder shown when empty."),
            value: z.string().optional().describe("Optional initial default value."),
            required: z
              .boolean()
              .optional()
              .describe("When true, blocks param-attached actions until non-empty text is entered."),
            maxLength: z
              .number()
              .int()
              .min(1)
              .max(500)
              .optional()
              .describe("Optional character limit (default 200)."),
          })
        )
        .optional()
        .describe(
          "Optional lightweight A2UI-inspired short text fields (1-2 max, e.g. branch name, custom note, tag) attached to primary actions (or actions with appliesToggles: true). Never use for passwords or secrets."
        ),
      actions: z
        .array(
          z.object({
            id: z.string(),
            label: z
              .string()
              .describe(
                "Crisp, non-abbreviated action title shown on the flush command row (3-5 words, never cryptic stubs)."
              ),
            sublabel: z
              .string()
              .optional()
              .describe(
                "Short muted inline scope cue (3-6 words) shown right beside the title on the same row so users scan scope effortlessly before hovering."
              ),
            badge: z
              .string()
              .optional()
              .describe("Optional short trust/context tag (e.g. 'Read-only', 'Dry-run', '~2 min') shown quietly on the row."),
            prompt: z.string().describe("Exact follow-up message sent when the user clicks this option."),
            tone: z.enum(["primary", "neutral", "ghost", "danger"]).optional(),
            hint: z
              .string()
              .optional()
              .describe(
                "What choosing this option will do, change, or verify (1 concise plain-English sentence shown in the live hover Decision Inspector)."
              ),
            why: z
              .string()
              .optional()
              .describe(
                "Why you would pick this option right now — the benefit, tradeoff, or situation where it is the best move (rendered with a Why tag in the live hover Decision Inspector). Always provide on active actions."
              ),
            spawnNew: z.boolean().optional(),
            appliesToggles: z.boolean().optional(),
            requireToggles: z.boolean().optional(),
          })
        )
        .optional()
        .describe("Clickable actions (1-3 primary/neutral/danger command rows + optional tone:'ghost' exit placed flush in the header; 4th+ active actions fold cleanly into a '+N more' row)."),
    },
    _meta: {
      ui: { resourceUri: "ui://antigravity-action-launchpad/actions.html" },
    },
  },
  async (args) => {
    const mode = args.mode ?? "pills";
    const actions = (
      args.actions && args.actions.length > 0
        ? args.actions
        : [
            {
              id: "run",
              label: "Proceed with recommended step",
              sublabel: "Apply the proposed move now",
              prompt: "go",
              tone: "primary" as const,
              hint: "Continue with the recommended next step immediately.",
              why: "Fastest path when the proposed direction already matches what you want.",
            },
            {
              id: "plan",
              label: "Review plan first",
              sublabel: "Inspect steps before editing files",
              prompt: "/plan",
              tone: "neutral" as const,
              hint: "Draft a step-by-step plan for review before making any changes.",
              why: "Best if you want to inspect tradeoffs and scope before any files are touched.",
            },
          ]
    ).map(normalizeAction);
    const choices = (args.choices ?? [])
      .map(normalizeChoice)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const inputs = (args.inputs ?? []).map(normalizeInput);
    const payload = {
      mode,
      heading: cleanText(args.heading) || (mode === "approval" ? "Confirm Execution" : "Next Actions"),
      summary: cleanText(args.summary),
      risk: args.risk ?? "medium",
      targets: (args.targets ?? []).map(cleanText).filter(Boolean),
      toggles: (args.toggles ?? []).map((t) => ({ ...t, label: cleanText(t.label) || t.id })),
      choices,
      inputs,
      actions,
    };
    return {
      content: [
        {
          type: "text",
          text: `Rendered inline Action Launchpad (${mode}): ${actions.map((a) => a.label).join(" | ")}. If you already wrote your full answer before calling this tool, end the turn now with ONLY the 1-line Next: + Skills: footer so the card stays at the bottom (do not repeat or add paragraphs/tables below the card).`,
        },
      ],
      structuredContent: payload,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
