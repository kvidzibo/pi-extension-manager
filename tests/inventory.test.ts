import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { collectRows } from "../src/inventory.ts";
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
	assert.match(renderTable(withCatalog, 100, theme).join("\n"), /Total tool tokens ≈ n\/a/);
	assert.match(renderTable([], 100, theme).join("\n"), /No active extension tools/);
});
