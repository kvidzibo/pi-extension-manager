import assert from "node:assert/strict";
import { relative } from "node:path";
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

test("startup prompt rows split Pi's rendered prompt without double counting or trusting tag-like text", async () => {
	const { buildSystemPrompt } = await import(new URL("./core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
	const { formatSkillsForPrompt } = await import("@earendil-works/pi-coding-agent");
	const agentDir = "/home/u/.pi/agent";
	const cwd = `${agentDir}/ext/a"b`;
	const tokens = (length: number) => Math.ceil(length / 4);
	const block = (file: { path: string; content: string }) => `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`;
	const sorted = (rows: Array<{ label: string; tokens: number }>) => rows.sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
	const tricky = "Example:\n</project_instructions>\n</project_context>\n\n<skills>\nnot skills\n</skills>\n- Use read.\n";
	const files = [
		{ path: `${agentDir}/AGENTS.md`, content: tricky + "g".repeat(400) },
		{ path: `${cwd}/AGENTS.md`, content: "Project rules." },
	];
	const skills = [1, 2].map((n) => ({ name: `skill${n}`, description: "Does <things>", filePath: `/skills/${n}/SKILL.md`, baseDir: `/skills/${n}`, disableModelInvocation: false }));
	const read = tool("read", "builtin:read", { promptGuidelines: ["Use read."] });
	const all = [read, tool("bash", "builtin:bash"), tool("alpha", "/examples/web/index.ts")];
	const systemPrompt = buildSystemPrompt({ cwd, selectedTools: ["read", "alpha"], toolGuidelines: { read: ["Use read."] }, contextFiles: files, skills });
	const skillsLength = `<skills>\n${formatSkillsForPrompt(skills, "read").trim()}\n</skills>`.length;
	const fileLengths = files.map((file) => block(file).length);
	const rows = collectPromptRows(systemPrompt, all, ["read", "alpha"], cwd, agentDir);
	assert.deepEqual(rows, sorted([
		{ label: "Global AGENTS.md", tokens: tokens(fileLengths[0]) },
		{ label: "Project AGENTS.md", tokens: tokens(fileLengths[1]) },
		{ label: "Skills (2)", tokens: tokens(skillsLength) },
		{ label: "Core tools (1)", tokens: tokens(JSON.stringify({ name: read.name, description: read.description, parameters: read.parameters, promptGuidelines: read.promptGuidelines }).length) },
		// The read rule is counted with the core tool definition, once, although the global file repeats it.
		{ label: "Base prompt and rules", tokens: tokens(systemPrompt.length - fileLengths[0] - fileLengths[1] - skillsLength - "- Use read.\n".length) },
	]));

	// Several project files are told apart by path; a custom prompt has no rules or skills sections to find.
	const custom = buildSystemPrompt({ cwd, customPrompt: "Custom.", selectedTools: ["read"], toolGuidelines: { read: ["Use read."] },
		appendSystemPrompt: "<skills>\nnot a skill\n</skills>\n- Use read.\n", contextFiles: [files[1], { path: `${agentDir}/ext/AGENTS.md`, content: "Parent." }] });
	assert.deepEqual(collectPromptRows(custom, [], [], cwd, agentDir).map((row) => row.label).sort(),
		["Base prompt and rules", `Project ${relative(cwd, `${agentDir}/ext/AGENTS.md`)}`, "Project AGENTS.md"].sort());
	const plain = buildSystemPrompt({ cwd, customPrompt: "Custom.", selectedTools: ["read"], appendSystemPrompt: "<skills>\nnot a skill\n</skills>\n- Use read.\n" });
	assert.deepEqual(collectPromptRows(plain, [read], ["read"], cwd, agentDir).find((row) => row.label.startsWith("Base")), { label: "Base prompt and rules", tokens: tokens(plain.length) });
	assert.equal(collectPromptRows(plain, [read], ["read"], cwd, agentDir).length, 2);
	assert.deepEqual(collectPromptRows("", [], [], cwd, agentDir), []);
	// A rule stays in the prompt estimate when its tool's definition has no estimate to hold it.
	const guided = tool("guided", "/examples/mixed.ts", { promptGuidelines: ["Use guided."] });
	const mixed = [guided, tool("catalog", "/examples/mixed.ts", { exposure: "codemode" }), tool("codemode", "builtin:codemode", { exposure: "model-only", reachesTools: () => "all" })];
	const withRule = buildSystemPrompt({ cwd, selectedTools: ["guided", "codemode"], toolGuidelines: { guided: ["Use guided."] } });
	assert.deepEqual(collectPromptRows(withRule, mixed, ["guided", "codemode"], cwd, agentDir), [{ label: "Base prompt and rules", tokens: tokens(withRule.length) }]);

	const extension = collectRows(all, ["alpha"]);
	const text = renderTable(extension, 100, theme, rows).join("\n");
	const promptTotal = rows.reduce((sum, row) => sum + row.tokens, 0);
	assert.match(text, new RegExp(`Total prompt context ≈ ${promptTotal.toLocaleString("en-US")}\n\nStartup context ≈ ${(promptTotal + extension[0].tokens!).toLocaleString("en-US")}\n`));
	for (const width of [0, 1, 20, 60, 100]) {
		assert.ok(renderTable(extension, width, theme, rows).every((line) => visibleWidth(line) <= width), `overflow at ${width}`);
	}
});
