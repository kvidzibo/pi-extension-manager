import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("manifest loads through Pi and prints one non-context entry only at TUI startup", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-extension-manager-load-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const { loadExtensions } = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const result = await loadExtensions(manifest.pi.extensions.map((path: string) => join(root, path)), home);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 1);
	const extension = result.extensions[0];
	assert.equal(extension.tools.size, 0);
	assert.equal(extension.commands.size, 0);
	const entries: Array<{ type: string; data: unknown }> = [];
	result.runtime.getAllTools = () => [];
	result.runtime.getActiveTools = () => [];
	result.runtime.appendEntry = (type: string, data: unknown) => entries.push({ type, data });
	result.runtime.sendMessage = () => assert.fail("must not add model context");
	const start = extension.handlers.get("session_start")[0];
	const discover = extension.handlers.get("resources_discover")[0];
	for (const mode of ["print", "json", "rpc"]) {
		await start({ reason: "startup" }, { mode });
		await discover({}, { mode });
	}
	for (const reason of ["reload", "new", "resume", "fork"]) {
		await start({ reason }, { mode: "tui" });
		await discover({}, { mode: "tui" });
	}
	assert.equal(entries.length, 0);
	await start({ reason: "startup" }, { mode: "tui" });
	await discover({}, { mode: "tui" });
	await discover({}, { mode: "tui" });
	assert.equal(entries.length, 1);
	assert.equal(entries[0].type, "pi-extension-manager:startup");
	assert.deepEqual(entries[0].data, []);
	assert.ok(extension.entryRenderers.has(entries[0].type));
});
