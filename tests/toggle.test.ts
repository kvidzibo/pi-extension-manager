import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { showInspector } from "../src/inspector.ts";
import { loadToggles } from "../src/toggle.ts";

test("space disables and re-enables user extensions and package extensions in Pi settings", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-extension-manager-toggle-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const local = join(root, "local.ts");
	const pkg = join(root, "pkg");
	mkdirSync(agentDir);
	mkdirSync(pkg);
	writeFileSync(local, "export default () => {};\n");
	writeFileSync(join(pkg, "index.ts"), "export default () => {};\n");
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pkg", pi: { extensions: ["./index.ts"] } }));
	const settingsPath = join(agentDir, "settings.json");
	// A relative entry must survive as the discovery entry; `[]` cannot be narrowed to one sibling.
	const rel = join(agentDir, "rel.ts");
	const off = join(root, "off");
	mkdirSync(off);
	for (const file of [rel, join(off, "a.ts"), join(off, "b.ts")]) writeFileSync(file, "export default () => {};\n");
	writeFileSync(join(off, "package.json"), JSON.stringify({ name: "off", pi: { extensions: ["./a.ts", "./b.ts"] } }));
	writeFileSync(settingsPath, JSON.stringify({ theme: "dark", extensions: [local, "rel.ts"], packages: [pkg, { source: off, extensions: [] }] }));
	const saved = () => JSON.parse(readFileSync(settingsPath, "utf8"));
	const states = async () => Object.fromEntries((await loadToggles(root, agentDir)).resources.map((resource) => [resource.path, resource.enabled]));

	const toggles = await loadToggles(root, agentDir);
	const initial = { [local]: true, [rel]: true, [join(pkg, "index.ts")]: true, [join(off, "a.ts")]: false, [join(off, "b.ts")]: false };
	assert.deepEqual(await states(), initial);
	const before = saved();
	await assert.rejects(toggles.set(toggles.resources.find((resource) => resource.path === join(off, "a.ts"))!, true), /pi config/);
	assert.deepEqual(saved(), before);
	const on = toggles.resources.filter((resource) => resource.enabled);
	for (const resource of on) await toggles.set(resource, false);
	assert.deepEqual(await states(), Object.fromEntries(Object.keys(initial).map((path) => [path, false])));
	assert.equal(saved().theme, "dark");
	for (const resource of on) await toggles.set(resource, true);
	assert.deepEqual(await states(), initial);

	initTheme("dark");
	const notices: string[] = [];
	const tui = { mode: "regular", terminal: { rows: 45 }, requestRender() {} };
	const ctx = { ui: { notify: (message: string) => notices.push(message), custom: async (factory: Function) => {
		const menu = factory(tui, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, getKeybindings(), () => {});
		menu.focused = true;
		assert.match(menu.render(100).join("\n"), /\[x\] local/);
		menu.handleInput("\x1b[B"); // Past the leading "Context by tool" entry.
		menu.handleInput(" ");
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.match(menu.render(100).join("\n"), /\[ \] local +disabled; \/reload to apply/);
		menu.handleInput("\x1b");
	} } } as unknown as ExtensionCommandContext;
	await showInspector(ctx, { scope: "Current branch", sources: [{ id: "shared-context", label: "Shared", path: "", items: [] }] }, toggles);
	assert.equal((await states())[local], false);
	assert.deepEqual(notices, ["Extension changes saved. Run /reload to apply."]);
});
