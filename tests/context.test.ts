import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, type ExtensionCommandContext, type ToolInfo } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { inspectContext, literalText } from "../src/context.ts";
import { showInspector } from "../src/inspector.ts";

test("inspector separates exposed definitions/results from unattributed content and safely drills down", async () => {
	const tool: ToolInfo = { name: "alpha", description: "Registered description", parameters: { type: "object" }, exposure: "direct",
		sourceInfo: { path: "/one/same.ts", source: "local", scope: "user", origin: "top-level" } };
	const other = { ...tool, name: "beta", sourceInfo: { ...tool.sourceInfo, path: "/two/same.ts" } };
	const fallback = inspectContext({ tools: [tool, other], active: ["alpha"], messages: [], systemPrompt: "shared injected prompt",
		scope: "Current branch" });
	assert.equal(fallback.sources.filter((source) => source.label === "same").length, 2);
	assert.match(fallback.sources.find((source) => source.id === tool.sourceInfo.path)!.items[0].content, /Registered description/);
	assert.equal(fallback.sources.find((source) => source.id === other.sourceInfo.path)!.items.length, 0);
	assert.equal(fallback.sources.at(-1)!.items[0].content, "shared injected prompt");

	const observed = inspectContext({ tools: [tool, other], active: ["alpha"], systemPrompt: "must not duplicate", observed: true,
		scope: "Last observed request", messages: [
			{ role: "system", content: "injected\u001b[31m text", toolsAdded: [{ name: "alpha", description: "Rewritten description", parameters: { type: "object" } }], timestamp: 1 },
			{ role: "toolResult", toolName: "alpha", toolCallId: "call", content: [{ type: "text", text: "result ".repeat(3000) }], details: { private: "excluded metadata" }, isError: false, timestamp: 2 },
			{ role: "custom", customType: "same", content: "cannot infer source from customType", display: false, details: "excluded metadata", timestamp: 3 },
			{ role: "user", content: [{ type: "image", data: "sensitive-base64", mimeType: "image/png" }], timestamp: 4 },
		] });
	const attributed = observed.sources.find((source) => source.id === tool.sourceInfo.path)!;
	assert.deepEqual(attributed.items.map((item) => item.kind), ["definition", "result"]);
	assert.match(attributed.items[0].content, /Rewritten description/);
	assert.ok(attributed.items.every((item) => item.tokens !== null));
	const shared = observed.sources.at(-1)!;
	assert.equal(shared.items.length, 3);
	assert.match(shared.items[1].content, /cannot infer source/);
	assert.equal(shared.items[2].tokens, null);
	assert.doesNotMatch(JSON.stringify(observed), /excluded metadata|sensitive-base64|must not duplicate/);
	assert.equal(literalText("x\u001b[31m\u009by\u202e\n"), "x\\u001b[31m\\u009by\\u202e\n");

	initTheme("dark");
	let closed = false;
	const tui = { mode: "regular", terminal: { rows: 45 }, requestRender() {} };
	const ctx = { ui: { custom: async (factory: Function) => {
		const menu = factory(tui, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, getKeybindings(), () => { closed = true; });
		menu.focused = true;
		const render = (width: number) => {
			const lines = menu.render(width);
			assert.ok(lines.every((line: string) => visibleWidth(line) <= width), `overflow at ${width}`);
			return lines.join("\n");
		};
		assert.match(render(100), /context inspector/);
		menu.handleInput("alpha");
		assert.match(render(100), /same/);
		menu.handleInput("\r");
		assert.match(render(100), /Injection ownership/);
		menu.handleInput("\r");
		assert.match(render(100), /Rewritten description/);
		menu.handleInput("\x1b");
		menu.handleInput("result");
		menu.handleInput("\r");
		const firstPage = render(100);
		menu.handleInput("\x1b[6~"); // Regular-mode paging; fullscreen reserves these keys for the transcript.
		assert.notEqual(render(100), firstPage);
		for (const width of [1, 20, 60, 100]) render(width);
		tui.terminal.rows = 22;
		render(50);
		menu.handleInput("\x1b");
		menu.handleInput("\x1b");
		assert.match(render(100), /alpha/); // Search survives drill-down/back.
		menu.handleInput("\x1b");
		assert.ok(closed);
	} } } as unknown as ExtensionCommandContext;
	await showInspector(ctx, observed);
});
