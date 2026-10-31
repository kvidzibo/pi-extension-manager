import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectRows, type InventoryRow } from "./src/inventory.ts";
import { renderTable } from "./src/table.ts";

const ENTRY = "pi-extension-manager:startup";

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer<InventoryRow[]>(ENTRY, (entry, _options, theme) => ({
		render: (width) => renderTable(entry.data ?? [], width, theme),
		invalidate() {},
	}));

	let startup = false;
	pi.on("session_start", (event, ctx) => {
		startup = ctx.mode === "tui" && event.reason === "startup";
	});
	// All session_start handlers have finished, including late tool registrations.
	pi.on("resources_discover", () => {
		if (!startup) return;
		startup = false;
		pi.appendEntry(ENTRY, collectRows(pi.getAllTools(), pi.getActiveTools()));
	});
}
