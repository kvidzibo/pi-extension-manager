import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { collectPromptRows, collectRows } from "../src/inventory.ts";
import { renderTable } from "../src/table.ts";

const source = (path: string) => ({ path, source: "local", scope: "user" as const, origin: "top-level" as const });
const tool = (name: string, path: string, extra: Partial<ToolInfo> = {}): ToolInfo => ({
	name, description: "Example tool", parameters: { type: "object", properties: {} },
	exposure: "direct", sourceInfo: source(path), ...extra,
});
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

test("startup inventory groups exposed extension tools and renders honest, width-safe estimates", () => {
	const tools = [
		tool("alpha", "/examples/web/index.ts"),
		tool("beta", "/examples/web/index.ts", { promptGuidelines: ["Use sparingly."] }),
		tool("inactive", "/examples/inactive.ts"),
		tool("hidden", "/examples/hidden.ts", { exposure: "hidden" }),
		tool("read", "builtin:read"),
		tool("search_later", "/examples/deferred.ts", { exposure: "deferred" }),
	];
	const active = ["alpha", "beta", "hidden", "read"];
	const rows = collectRows(tools, active);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].extension, "web");
	assert.deepEqual(rows[0].tools, ["alpha", "beta"]);
	const expected = tools.slice(0, 2).reduce((sum, t) => sum + Math.ceil(JSON.stringify({
		name: t.name, description: t.description, parameters: t.parameters, promptGuidelines: t.promptGuidelines,
	}).length / 4), 0);
	assert.equal(rows[0].tokens, expected);
	assert.deepEqual(collectRows(tools, []), []);

	const catalog = tool("catalog", "/examples/catalog.ts", { exposure: "codemode" });
	const codemode = tool("codemode", "builtin:codemode", { exposure: "model-only", reachesTools: () => "all" });
	const withCatalog = collectRows([...tools, catalog, codemode], [...active, "codemode"]);
	assert.equal(withCatalog.find((row) => row.extension === "catalog")?.tokens, null);
	assert.ok(!withCatalog.some((row) => row.extension === "deferred"));
	assert.ok(!collectRows([catalog], []).length);

	const circular: Record<string, unknown> = {};
	circular.self = circular;
	assert.equal(collectRows([tool("bad", "/examples/bad.ts", { parameters: circular })], ["bad"])[0].tokens, null);

	const display = [...withCatalog, { extension: "測試 extension with a long name", tools: ["wide_tool_name".repeat(8)], tokens: 99 }];
	for (const width of [0, 1, 20, 60, 70, 100, 160]) {
		const lines = renderTable(display, width, theme);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), `overflow at ${width}`);
	}
	assert.match(renderTable(rows, 100, theme).join("\n"), new RegExp(`Total tool tokens ≈ ${expected}`));
	assert.match(renderTable(withCatalog, 100, theme).join("\n"), /Known subtotal ≈ \d+ · 1 unknown source/);
	assert.match(renderTable([], 100, theme).join("\n"), /No active extension tools/);
});

test("startup prompt rows split context files, skills and core tools without double counting", () => {
	const global = `<project_instructions path="/home/u/.pi/agent/AGENTS.md">\n${"g".repeat(400)}\n</project_instructions>`;
	const project = `<project_instructions path="/work/app/AGENTS.md">\n<skills>\nnot skills\n</skills>\n</project_instructions>`;
	const skills = "<skills>\nUse skills.\n<available_skills>\n  <skill>\n    <name>a</name>\n  </skill>\n  <skill>\n    <name>b</name>\n  </skill>\n</available_skills>\n</skills>";
	const rest = ["Preamble\n\n<rules>\n- Use read.\n- Be concise\n</rules>\n\n<project_context>\nIntro\n\n", "\n\n", "\n</project_context>\n\n", "\n\n<cwd>\n/work/app\n</cwd>"];
	const systemPrompt = rest[0] + global + rest[1] + project + rest[2] + skills + rest[3];
	const read = tool("read", "builtin:read", { promptGuidelines: ["Use read."] });
	const rows = collectPromptRows(systemPrompt, [read, tool("bash", "builtin:bash"), tool("alpha", "/examples/web/index.ts")], ["read", "alpha"], "/work/app", "/home/u/.pi/agent");
	const tokens = (length: number) => Math.ceil(length / 4);
	assert.deepEqual(rows, [
		{ label: "Global AGENTS.md", tokens: tokens(global.length) },
		{ label: "Core tools (1)", tokens: tokens(JSON.stringify({ name: read.name, description: read.description, parameters: read.parameters, promptGuidelines: read.promptGuidelines }).length) },
		{ label: "Skills (2)", tokens: tokens(skills.length) },
		// The read rule is counted with the core tool definition.
		{ label: "Base prompt and rules", tokens: tokens(rest.join("").length - "- Use read.\n".length) },
		{ label: "Project AGENTS.md", tokens: tokens(project.length) },
	].sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label)));
	assert.deepEqual(collectPromptRows("", [], [], "/work/app", "/home/u/.pi/agent"), []);

	const extension = collectRows([tool("alpha", "/examples/web/index.ts")], ["alpha"]);
	const text = renderTable(extension, 100, theme, rows).join("\n");
	const promptTotal = rows.reduce((sum, row) => sum + row.tokens, 0);
	assert.match(text, new RegExp(`Total prompt context ≈ ${promptTotal}\n\nStartup context ≈ ${promptTotal + extension[0].tokens!}\n`));
	for (const width of [0, 1, 20, 60, 100]) {
		assert.ok(renderTable(extension, width, theme, rows).every((line) => visibleWidth(line) <= width), `overflow at ${width}`);
	}
});
