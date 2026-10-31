import type { SessionContext, SourceInfo, ToolInfo } from "@earendil-works/pi-coding-agent";
import { collectRows, definitionText, extensionName } from "./inventory.ts";

type Messages = SessionContext["messages"];
export interface Contribution {
	label: string;
	kind: "definition" | "result" | "instructions" | "message";
	content: string;
	tokens: number | null;
	note: string;
}
export interface ContextSource {
	id: string;
	label: string;
	path: string;
	items: Contribution[];
}
export interface Inspection {
	scope: string;
	sources: ContextSource[];
}

export const tokenLabel = (tokens: number | null) => tokens === null ? "unavailable" : `≈${tokens.toLocaleString("en-US")}`;
export const subtotal = (items: Contribution[]) => items.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
export const estimate = (text: string) => Math.ceil(text.length / 4);

/** Show controls literally: inspected content must never send terminal commands. */
export function literalText(text: string): string {
	return text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function serialize(value: unknown): { content: string; tokens: number | null } {
	let images = false;
	try {
		const content = JSON.stringify(value, (_key, part) => {
			if (part && typeof part === "object" && part.type === "image") {
				images = true;
				return { type: "image", mimeType: part.mimeType, data: "[image data omitted; token cost unavailable]" };
			}
			return part;
		});
		return { content, tokens: images ? null : estimate(content) };
	} catch {
		return { content: "[Content cannot be serialized]", tokens: null };
	}
}

/** No provenance is inferred from text similarity or an extension's customType. */
export function inspectContext(options: {
	tools: ToolInfo[];
	active: string[];
	messages: Messages;
	systemPrompt: string;
	sources?: SourceInfo[];
	observed?: boolean;
	scope: string;
}): Inspection {
	const { tools, active, messages, observed } = options;
	const groups = new Map<string, ContextSource>();
	const group = (source: SourceInfo) => {
		let result = groups.get(source.path);
		if (!result) {
			result = { id: source.path, label: extensionName(source), path: source.path, items: [] };
			groups.set(source.path, result);
		}
		return result;
	};
	const shared: ContextSource = { id: "shared-context", label: "Unattributed / shared context", path: "System prompt, custom messages, core tools and conversation; ownership is not exposed.", items: [] };
	const isCore = (tool: ToolInfo) => tool.sourceInfo.path === `builtin:${tool.name}` &&
		["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"].includes(tool.name);
	for (const tool of tools) if (!isCore(tool)) group(tool.sourceInfo);
	for (const source of options.sources ?? []) group(source);
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const owner = (name: string) => {
		const tool = byName.get(name);
		return tool && !isCore(tool) ? group(tool.sourceInfo) : shared;
	};
	const add = (target: ContextSource, label: string, kind: Contribution["kind"], value: unknown, note: string) => {
		target.items.push({ label, kind, ...serialize(value), note });
	};

	if (!observed) {
		const visibleNames = new Set(collectRows(tools, active).flatMap((row) => row.tools));
		for (const tool of tools) {
			if (!visibleNames.has(tool.name)) continue;
			let content: string;
			try { content = definitionText(tool); } catch { content = "[Definition cannot be serialized]"; }
			const known = active.includes(tool.name) && content !== "[Definition cannot be serialized]";
			group(tool.sourceInfo).items.push({ label: tool.name, kind: "definition", content,
				tokens: known ? estimate(content) : null,
				note: known ? "Registered definition before loadout rewrites; not the final provider declaration." : "Catalog inclusion or definition cost unavailable; registered content only." });
		}
		if (options.systemPrompt) shared.items.push({ label: "System prompt", kind: "instructions", content: options.systemPrompt,
			tokens: estimate(options.systemPrompt), note: "Current effective prompt; base instructions and extension injections cannot be separated." });
	}

	messages.forEach((message, index) => {
		const prefix = `${index + 1}. `;
		const note = observed
			? "Observed at this extension's context_with_system hook; later handlers and provider conversion may change it."
			: "Resolved current branch, respecting compaction and context edits; transient context hooks may change it.";
		if (message.role === "system") {
			if (!observed) return; // The fallback displays the current effective prompt and registered definitions instead.
			if (message.content || message.sections || message.toolsRemoved?.length) {
				add(shared, `${prefix}System instructions / changes`, "instructions", {
					content: message.content, sections: message.sections, toolsRemoved: message.toolsRemoved,
				}, note);
			}
			for (const tool of message.toolsAdded ?? []) {
				add(owner(tool.name), `${prefix}${tool.name}`, "definition", tool,
					`${note} Source matched by current tool name, not historical provenance.`);
			}
		} else if (message.role === "toolResult") {
			add(owner(message.toolName), `${prefix}${message.toolName} result`, "result", {
				role: message.role, toolCallId: message.toolCallId, toolName: message.toolName,
				content: message.content, isError: message.isError,
			}, `${note} Source matched by current tool name. Nested results exist only inside the outer tool's content.`);
		} else if (message.role === "assistant") {
			const remaining = message.content.filter((part) => part.type !== "toolCall");
			if (remaining.length) add(shared, `${prefix}Assistant message`, "message", { role: message.role, content: remaining }, note);
			for (const part of message.content) if (part.type === "toolCall") {
				add(owner(part.name), `${prefix}${part.name} call`, "message", part, `${note} Source matched by current tool name.`);
			}
		} else {
			if (message.role === "bashExecution" && message.excludeFromContext) return;
			// Custom message details/display and timestamps are UI metadata, not model context.
			const value = message.role === "custom" ? { role: message.role, customType: message.customType, content: message.content }
				: message.role === "user" ? { role: message.role, content: message.content }
				: message.role === "bashExecution" ? { role: message.role, command: message.command, output: message.output,
					exitCode: message.exitCode, cancelled: message.cancelled, truncated: message.truncated }
				: { role: message.role, summary: message.summary };
			add(shared, `${prefix}${message.role === "custom" ? `Custom: ${message.customType}` : message.role}`, "message", value, note);
		}
	});

	const sources = [...groups.values()].sort((a, b) => subtotal(b.items) - subtotal(a.items) || a.label.localeCompare(b.label));
	sources.push(shared);
	return { scope: options.scope, sources };
}
