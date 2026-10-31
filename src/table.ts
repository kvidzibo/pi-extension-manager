import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { InventoryRow } from "./inventory.ts";

const count = (tokens: number | null) => tokens === null ? "n/a" : tokens.toLocaleString("en-US");
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

export function renderTable(rows: InventoryRow[], width: number, theme: Pick<Theme, "fg" | "bold">): string[] {
	if (width < 1) return [""];
	const title = theme.bold(theme.fg("accent", "Extensions"));
	const lines = [title, theme.fg("dim", `${rows.length} contributors · ${rows.reduce((sum, row) => sum + row.tools.length, 0)} tools`)];
	if (!rows.length) {
		lines.push(theme.fg("dim", "No active extension tools."));
	} else if (width < 70) {
		for (const row of rows) {
			lines.push("", theme.fg("accent", row.extension));
			lines.push(...wrapTextWithAnsi(row.tools.join(", "), Math.max(1, width - 2)).map((line) => `  ${line}`));
			lines.push(theme.fg("muted", `  Tool tokens ≈ ${count(row.tokens)}`));
		}
	} else {
		const extensionWidth = Math.min(30, Math.max(18, ...rows.map((row) => visibleWidth(row.extension))));
		const tokenWidth = 13;
		const toolsWidth = width - extensionWidth - tokenWidth - 4;
		const columns = (extension: string, tools: string, tokens: string) =>
			`${pad(truncateToWidth(extension, extensionWidth), extensionWidth)}  ${pad(tools, toolsWidth)}  ${tokens.padStart(tokenWidth)}`;
		lines.push("", theme.fg("muted", columns("Extension", "Tools provided", "Tool tokens ≈")), theme.fg("borderMuted", "─".repeat(width)));
		for (const row of rows) {
			const toolLines = wrapTextWithAnsi(row.tools.join(", "), toolsWidth);
			toolLines.forEach((tools, index) => lines.push(columns(index ? "" : row.extension, tools, index ? "" : count(row.tokens))));
		}
	}
	if (rows.length) {
		const total = rows.some((row) => row.tokens === null) ? null : rows.reduce((sum, row) => sum + row.tokens!, 0);
		lines.push(theme.fg("borderMuted", "─".repeat(width)), theme.bold(`Total tool tokens ≈ ${count(total)}`));
	}
	lines.push("");
	for (const note of [
		"≈ Definition characters / 4, before loadout rewrites; not actual context usage.",
		"Prompt injections and tool results excluded. Catalog-only costs: n/a.",
	]) lines.push(...wrapTextWithAnsi(theme.fg("dim", note), width));
	return lines.map((line) => truncateToWidth(line, width));
}
