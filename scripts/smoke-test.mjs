import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--no-warnings=ExperimentalWarning", path.join(ROOT, "dist", "server.mjs")],
});

const client = new Client({ name: "deck-smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`Tools registered (${tools.length}):`, tools.map((t) => t.name).join(", "));

if (tools.length !== 1 || tools[0].name !== "deck_actions") {
  throw new Error(`Expected only deck_actions tool, got: ${tools.map((t) => t.name).join(", ")}`);
}
const uri = tools[0]._meta?.ui?.resourceUri;
if (uri !== "ui://antigravity-action-launchpad/actions.html") {
  throw new Error(`Unexpected resourceUri: ${uri}`);
}
if (tools[0]._meta?.["com.google.antigravity/ui"]?.entrypoints) {
  throw new Error("deck_actions should stay inline-only (no sidebar or side pane entrypoints)");
}

const { resources } = await client.listResources();
console.log(`Resources registered (${resources.length}):`, resources.map((r) => r.uri).join(", "));
if (resources.length !== 1 || resources[0].uri !== "ui://antigravity-action-launchpad/actions.html") {
  throw new Error(`Expected only actions.html resource, got: ${resources.map((r) => r.uri).join(", ")}`);
}

const read = await client.readResource({ uri: resources[0].uri });
const content = read.contents[0];
if (content.mimeType !== "text/html;profile=mcp-app") {
  throw new Error(`Bad MIME type: ${content.mimeType}`);
}
if (!content.text || content.text.length < 500 || content.text.length > 10 * 1024 * 1024) {
  throw new Error(`Invalid HTML size: ${content.text?.length}`);
}
if (
  !content.text.includes("al-list") ||
  !content.text.includes("al-inspector") ||
  !content.text.includes("al-insp-kbd") ||
  !content.text.includes("al-details-toggle") ||
  !content.text.includes("al-why-pill") ||
  !content.text.includes("al-row-sub") ||
  !content.text.includes("al-choices") ||
  !content.text.includes("al-chip-group") ||
  !content.text.includes("al-inputs") ||
  !content.text.includes("al-input")
) {
  throw new Error("Built actions.html is missing Flush Command List, ChoicePicker, TextInput, or Live Inspector hooks");
}
console.log(`  OK resource ${resources[0].uri} (${(content.text.length / 1024).toFixed(1)} KB, ${content.mimeType})`);

const ghostCheck = await client.callTool({
  name: "deck_actions",
  arguments: {
    heading: "Next Steps",
    choices: [
      {
        id: "target",
        label: "Target",
        required: true,
        options: [
          { value: "local", label: "Local Mac" },
          { value: "remote", label: "Both Macs" },
        ],
        selected: ["local", "remote"],
      },
      {
        id: "checks",
        label: "Checks",
        multiple: true,
        options: [
          { value: "smoke", label: "Smoke tests" },
          { value: "detect", label: "Design lint" },
        ],
        selected: ["smoke", "unknown"],
      },
    ],
    inputs: [
      {
        id: "branch",
        label: "Branch",
        placeholder: "feat/my-branch",
        value: "  feat/deck-inputs  ",
        required: true,
        maxLength: 40,
      },
    ],
    toggles: [{ id: "a", label: "Check option A", checked: true }],
    actions: [
      {
        id: "go",
        label: "Run selected checks",
        sublabel: "Apply checked options & verify",
        badge: "Safe",
        prompt: "go",
        tone: "primary",
        hint: "Applies the checked options and runs verification.",
        why: "Best when you want to confirm everything passes before moving on.",
        appliesToggles: true,
      },
      {
        id: "alt",
        label: "Review plan first",
        sublabel: "Inspect steps before editing files",
        badge: "Read-only",
        prompt: "/plan",
        tone: "neutral",
        hint: "Walks through each step before touching files.",
        why: "Safer if you want to check scope and tradeoffs before editing.",
      },
      {
        id: "exit",
        label: "Wrap Up",
        prompt: "done",
        tone: "ghost",
        hint: "Closes out here without running another step.",
        appliesToggles: false,
      },
    ],
  },
});
if (
  ghostCheck.isError ||
  ghostCheck.structuredContent?.actions?.[2]?.tone !== "ghost" ||
  ghostCheck.structuredContent?.actions?.[0]?.sublabel !== "Apply checked options & verify" ||
  ghostCheck.structuredContent?.actions?.[0]?.badge !== "Safe" ||
  ghostCheck.structuredContent?.actions?.[0]?.hint !== "Applies the checked options and runs verification." ||
  ghostCheck.structuredContent?.actions?.[0]?.why !== "Best when you want to confirm everything passes before moving on." ||
  ghostCheck.structuredContent?.choices?.length !== 2 ||
  ghostCheck.structuredContent?.choices?.[0]?.selected?.length !== 1 ||
  ghostCheck.structuredContent?.choices?.[0]?.selected?.[0] !== "local" ||
  ghostCheck.structuredContent?.choices?.[1]?.selected?.length !== 1 ||
  ghostCheck.structuredContent?.choices?.[1]?.selected?.[0] !== "smoke" ||
  ghostCheck.structuredContent?.inputs?.length !== 1 ||
  ghostCheck.structuredContent?.inputs?.[0]?.value !== "feat/deck-inputs" ||
  ghostCheck.structuredContent?.inputs?.[0]?.maxLength !== 40
) {
  throw new Error(`deck_actions ghost/choices/inputs/sublabel/badge/hint/why/appliesToggles check failed: ${JSON.stringify(ghostCheck)}`);
}
console.log("  OK deck_actions supports choices, inputs (sanitization/maxLength), tone:'ghost', sublabel, badge, hint, why, and appliesToggles");

const emptyCheck = await client.callTool({ name: "deck_actions", arguments: {} });
if (emptyCheck.isError) throw new Error(`deck_actions({}) failed: ${JSON.stringify(emptyCheck)}`);
console.log(`  OK deck_actions({}) -> ${emptyCheck.content?.[0]?.text ?? ""}`);

await client.close();
console.log("ALL MCP SMOKE TESTS PASSED.");
