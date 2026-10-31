import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { cleanText, type InventoryRow } from "./inventory.ts";

const count = (value: number) => value.toLocaleString("en-US");
const pad = (text: string, width: number, right = false) => {
	const spaces = " ".repeat(Math.max(0, width - visibleWidth(text)));
	return right ? spaces + text : text + spaces;
};
const STARTUP_ROWS = 8;

export function renderTable(rows: InventoryRow[], width: number, theme: Pick<Theme, "fg" | "bold">): string[] {
	width = Math.max(0, Math.floor(width));
	if (width < 1) return [""];
	const fit = (text: string, columns = width) => truncateToWidth(text, columns, "");
	const choose = (...options: string[]) => options.find((text) => visibleWidth(text) <= width) ?? options[options.length - 1];
	const shown = rows.slice(0, STARTUP_ROWS);
	const known = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
	const unknown = rows.filter((row) => row.tokens === null).length;
	const lines = [theme.bold(theme.fg("accent", "Extension tools"))];

	if (!rows.length) {
		lines.push(theme.fg("muted", "No active extension tools."));
	} else {
		// Reserve estimates first, then names; tool counts are secondary at narrow widths.
		const values = shown.map((row) => row.tokens === null ? "n/a" : count(row.tokens));
		const valueWidth = Math.max(...values.map(visibleWidth));
		const tokenWidth = Math.min(width, Math.max(valueWidth, width >= 24 ? 8 : width >= 12 ? 4 : 1));
		const toolsWidth = Math.max(5, ...shown.map((row) => visibleWidth(count(row.tools.length))));
		const showTools = width >= tokenWidth + toolsWidth + 14;
		const nameWidth = Math.max(0, Math.min(36, Math.max(9, ...shown.map((row) => visibleWidth(cleanText(row.extension)))),
			width - tokenWidth - (showTools ? toolsWidth + 2 : 0) - 2));
		const columns = (name: string, tools: string, tokens: string) => {
			const prefix = nameWidth ? `${pad(fit(name, nameWidth), nameWidth)}  ` : "";
			return prefix + (showTools ? `${pad(tools, toolsWidth, true)}  ` : "") + pad(fit(tokens, tokenWidth), tokenWidth, true);
		};
		const tokenLabel = tokenWidth >= 8 ? "≈ tokens" : tokenWidth >= 4 ? "≈tok" : "≈";
		lines.push(theme.fg("muted", columns("Extension", "Tools", tokenLabel)));
		shown.forEach((row, index) => {
			const name = nameWidth ? theme.fg("accent", pad(fit(cleanText(row.extension), nameWidth), nameWidth)) + "  " : "";
			const tools = showTools ? theme.fg("muted", pad(count(row.tools.length), toolsWidth, true)) + "  " : "";
			const tokens = theme.fg(row.tokens === null ? "warning" : "success", pad(fit(values[index], tokenWidth), tokenWidth, true));
			lines.push(name + tools + tokens);
		});
		if (rows.length > shown.length) lines.push(theme.fg("muted", `+${rows.length - shown.length} more`));

		const total = choose(`${unknown ? "Known subtotal" : "Total tool tokens"} ≈ ${count(known)}`, `≈ ${count(known)}`, count(known));
		const unknownLabel = `${unknown} unknown ${unknown === 1 ? "source" : "sources"}`;
		if (unknown && visibleWidth(`${total} · ${unknownLabel}`) <= width) {
			lines.push(theme.bold(total) + theme.fg("warning", ` · ${unknownLabel}`));
		} else {
			lines.push(theme.bold(total));
			if (unknown) lines.push(theme.fg("warning", unknownLabel));
		}
	}
	lines.push(theme.fg("muted", "/pi-extensions · inspect context"));
	lines.push(theme.fg("dim", choose(
		"≈ Definition chars / 4, pre-loadout; not context usage. n/a = unknown.",
		"≈ Definition chars / 4; not context usage.",
		"≈ chars/4; not context",
		"≈ chars/4",
	)));
	return lines.map((line) => fit(line));
}
