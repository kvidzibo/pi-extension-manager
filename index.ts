import { buildSessionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectRows, type InventoryRow } from "./src/inventory.ts";
import { renderTable } from "./src/table.ts";
import { inspectContext, type Inspection } from "./src/context.ts";
import { showInspector } from "./src/inspector.ts";

const ENTRY = "pi-extension-manager:startup";

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer<InventoryRow[]>(ENTRY, (entry, _options, theme) => ({
		render: (width) => renderTable(entry.data ?? [], width, theme),
		invalidate() {},
	}));

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
		description: "Inspect extension context and estimated tokens",
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
			await showInspector(ctx, inspection);
		},
	});
	// All session_start handlers have finished, including late tool registrations.
	pi.on("resources_discover", () => {
		if (!startup) return;
		startup = false;
		pi.appendEntry(ENTRY, collectRows(pi.getAllTools(), pi.getActiveTools()));
	});
}
