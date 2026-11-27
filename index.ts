import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSessionContext, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectPromptRows, collectRows, type InventoryRow, type StartupSummary } from "./src/inventory.ts";
import { renderTable } from "./src/table.ts";
import { inspectContext, type Inspection } from "./src/context.ts";
import { showInspector } from "./src/inspector.ts";
import { loadToggles } from "./src/toggle.ts";

const ENTRY = "pi-extension-manager:startup";

export default function (pi: ExtensionAPI) {
	// Sessions saved before 1.3.0 hold the tool rows alone.
	pi.registerEntryRenderer<StartupSummary | InventoryRow[]>(ENTRY, (entry, _options, theme) => {
		const data = entry.data ?? [];
		const summary = Array.isArray(data) ? { rows: data, prompt: [] } : data;
		return { render: (width) => renderTable(summary.rows, width, theme, summary.prompt), invalidate() {} };
	});

	let startup = false;
	let observed: Inspection | undefined;
	const sources = () => pi.getCommands().filter((command) => command.source === "extension").map((command) => command.sourceInfo);
	pi.on("session_start", (event, ctx) => {
		observed = undefined;
		startup = ctx.mode === "tui" && event.reason === "startup";
	});
	pi.on("session_tree", () => { observed = undefined; });
	pi.on("session_compact", () => { observed = undefined; });
	pi.on("context_with_system", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		observed = inspectContext({ tools: pi.getAllTools(), active: pi.getActiveTools(), messages: event.messages,
			systemPrompt: "", sources: sources(), observed: true,
			scope: `Last observed request · ${new Date().toLocaleTimeString()} · later hooks may change it` });
	});
	pi.registerCommand("pi-extensions", {
		description: "Inspect extension context and enable or disable extensions",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/pi-extensions requires interactive TUI mode", "error");
				return;
			}
			await ctx.waitForIdle();
			const inspection = observed ?? inspectContext({ tools: pi.getAllTools(), active: pi.getActiveTools(),
				messages: buildSessionContext(ctx.sessionManager.getBranch()).messages,
				systemPrompt: ctx.getSystemPrompt(), sources: sources(),
				scope: "Current branch · registered definitions before loadout · no request observed since load/reset" });
			// Not offered for this extension: disabling it would remove the menu that re-enables it.
			const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };
			const self = real(fileURLToPath(import.meta.url));
			const toggles = await loadToggles(ctx.cwd, getAgentDir()).then((loaded) => ({ ...loaded,
				resources: loaded.resources.filter((resource) => real(resource.path) !== self) }), (error) => {
				ctx.ui.notify(`Extension toggles unavailable: ${error.message}`, "warning");
				return undefined;
			});
			await showInspector(ctx, inspection, toggles);
		},
	});
	// All session_start handlers have finished, including late tool registrations.
	pi.on("resources_discover", (_event, ctx) => {
		if (!startup) return;
		startup = false;
		const tools = pi.getAllTools();
		const active = pi.getActiveTools();
		// Only estimates are stored: the prompt text itself may be sensitive.
		pi.appendEntry(ENTRY, { rows: collectRows(tools, active),
			prompt: collectPromptRows(ctx.getSystemPrompt(), tools, active, ctx.cwd, getAgentDir()) } satisfies StartupSummary);
	});
}
