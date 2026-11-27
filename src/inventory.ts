import { basename, dirname, isAbsolute, relative } from "node:path";
import type { SourceInfo, ToolInfo } from "@earendil-works/pi-coding-agent";

export interface InventoryRow {
	extension: string;
	tools: string[];
	tokens: number | null;
}
export interface PromptRow {
	label: string;
	tokens: number;
}
export interface StartupSummary {
	rows: InventoryRow[];
	prompt: PromptRow[];
}

const CORE_TOOLS = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

// Labels and tool names are terminal text, not executable escape sequences.
export const cleanText = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

export function extensionName(source: SourceInfo): string {
	if (source.path.startsWith("builtin:") || source.path.startsWith("<")) return cleanText(source.path);
	if (source.origin === "package" && source.source.startsWith("npm:")) {
		return cleanText(source.source.slice(4).replace(/@[^/@]+$/, ""));
	}
	const path = source.origin === "package" && source.baseDir ? source.baseDir : source.path;
	const name = basename(path);
	return cleanText(/^index\.[cm]?[jt]s$/.test(name) ? basename(dirname(path)) : name.replace(/\.[cm]?[jt]s$/, ""));
}

export function definitionText(tool: ToolInfo): string {
	return JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters,
		promptGuidelines: tool.promptGuidelines });
}

function estimateDefinition(tool: ToolInfo): number | null {
	try {
		const text = definitionText(tool);
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

const FILE_OPEN = '<project_instructions path="';
const FILE_CLOSE = "\n</project_instructions>";
const CONTEXT_OPEN = `<project_context>\nProject-specific instructions and guidelines:\n\n${FILE_OPEN}`;
const CONTEXT_CLOSE = `${FILE_CLOSE}\n</project_context>`;
const SKILLS_CLOSE = "\n</available_skills>\n</skills>";

/**
 * Splits Pi's rendered startup prompt into context files, skills and the remainder, plus active
 * core tool definitions. Sections are located by Pi's own delimiters, so tag-like text inside a
 * context file is not mistaken for one. Text that does not parse stays in the remainder.
 */
export function collectPromptRows(systemPrompt: string, tools: ToolInfo[], activeNames: string[], cwd: string, agentDir: string): PromptRow[] {
	const rows: PromptRow[] = [];
	let rest = systemPrompt.length;
	const add = (label: string, length: number) => {
		rows.push({ label: cleanText(label), tokens: Math.ceil(length / 4) });
		rest -= length;
	};
	const contextStart = systemPrompt.indexOf(CONTEXT_OPEN);
	const contextEnd = contextStart < 0 ? -1 : systemPrompt.lastIndexOf(CONTEXT_CLOSE);
	let after = 0;
	if (contextEnd > contextStart) {
		after = contextEnd + CONTEXT_CLOSE.length;
		const files = systemPrompt.slice(contextStart + CONTEXT_OPEN.length, contextEnd).split(`${FILE_CLOSE}\n\n${FILE_OPEN}`)
			.map((block) => ({ path: block.slice(0, Math.max(0, block.indexOf('">\n'))), length: FILE_OPEN.length + block.length + FILE_CLOSE.length }));
		// Pi loads its global file from the agent directory itself; a project may live below it.
		const global = (path: string) => relative(agentDir, dirname(path)) === "";
		const projects = files.filter((file) => !global(file.path)).length;
		for (const { path, length } of files) {
			add(global(path) ? `Global ${basename(path)}` : `Project ${projects > 1 ? relative(cwd, path) : basename(path)}`, length);
		}
	}
	// Pi renders skills between project context and cwd; skill text is XML-escaped.
	const skillsEnd = systemPrompt.indexOf(`${SKILLS_CLOSE}\n\n<cwd>\n`, after);
	const skillsStart = skillsEnd < 0 ? -1 : systemPrompt.lastIndexOf("\n\n<skills>\n", skillsEnd) + 2;
	if (skillsStart >= Math.max(after, 2)) {
		const skills = systemPrompt.slice(skillsStart, skillsEnd + SKILLS_CLOSE.length);
		add(`Skills (${skills.split("\n  <skill>\n").length - 1})`, skills.length);
	}
	const rulesStart = systemPrompt.indexOf("\n\n<rules>\n");
	const rulesEnd = rulesStart < 0 ? -1 : systemPrompt.indexOf("\n</rules>\n\n<docs>\n", rulesStart);
	const rendered = rulesEnd < 0 ? "" : systemPrompt.slice(rulesStart + "\n\n<rules>".length, rulesEnd + 1);

	const active = new Set(activeNames);
	let core = 0;
	let coreTokens = 0;
	const rules = new Set<string>();
	for (const tool of tools) {
		if (!active.has(tool.name)) continue;
		// Rule bullets are part of each tool's definition estimate; do not count them again here.
		for (const rule of tool.promptGuidelines ?? []) if (rendered.includes(`\n- ${rule.trim()}\n`)) rules.add(rule.trim());
		if (tool.sourceInfo.path !== `builtin:${tool.name}` || !CORE_TOOLS.has(tool.name)) continue;
		core++;
		coreTokens += estimateDefinition(tool) ?? 0;
	}
	for (const rule of rules) rest -= rule.length + 3;
	if (systemPrompt) rows.push({ label: "Base prompt and rules", tokens: Math.ceil(Math.max(0, rest) / 4) });
	if (core) rows.push({ label: `Core tools (${core})`, tokens: coreTokens });
	return rows.sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
}
