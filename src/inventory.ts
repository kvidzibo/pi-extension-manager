import { basename, dirname } from "node:path";
import type { SourceInfo, ToolInfo } from "@earendil-works/pi-coding-agent";

export interface InventoryRow {
	extension: string;
	tools: string[];
	tokens: number | null;
}

const CORE_TOOLS = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

// Labels and tool names are terminal text, not executable escape sequences.
export const cleanText = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

function extensionName(source: SourceInfo): string {
	if (source.path.startsWith("builtin:") || source.path.startsWith("<")) return cleanText(source.path);
	if (source.origin === "package" && source.source.startsWith("npm:")) {
		return cleanText(source.source.slice(4).replace(/@[^/@]+$/, ""));
	}
	const path = source.origin === "package" && source.baseDir ? source.baseDir : source.path;
	const name = basename(path);
	return cleanText(/^index\.[cm]?[jt]s$/.test(name) ? basename(dirname(path)) : name.replace(/\.[cm]?[jt]s$/, ""));
}

function estimateDefinition(tool: ToolInfo): number | null {
	try {
		const text = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters,
			promptGuidelines: tool.promptGuidelines });
		return Math.ceil(text.length / 4);
	} catch {
		return null;
	}
}

/** A pre-loadout tool-definition estimate, not a tokenizer or a full context audit. */
export function collectRows(tools: ToolInfo[], activeNames: string[]): InventoryRow[] {
	const active = new Set(activeNames);
	const codemode = tools.some((tool) => tool.name === "codemode" && active.has(tool.name) && tool.reachesTools);
	const groups = new Map<string, InventoryRow>();
	for (const tool of tools) {
		if (tool.exposure === "hidden") continue;
		const declared = active.has(tool.name);
		// Catalog-only tools may be included in codemode's budgeted description; its effective
		// catalog is not exposed by getAllTools, so do not invent a token count for them.
		const catalog = codemode && tool.exposure === "codemode";
		if (!declared && !catalog) continue;
		const source = tool.sourceInfo;
		if (source.path === `builtin:${tool.name}` && CORE_TOOLS.has(tool.name)) continue;
		const key = source.path;
		const row = groups.get(key) ?? { extension: extensionName(source), tools: [], tokens: 0 };
		row.tools.push(cleanText(tool.name));
		const tokens = declared ? estimateDefinition(tool) : null;
		row.tokens = row.tokens === null || tokens === null ? null : row.tokens + tokens;
		groups.set(key, row);
	}
	return [...groups.values()]
		.map((row) => ({ ...row, tools: row.tools.sort() }))
		.sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.extension.localeCompare(b.extension));
}
