import { DynamicBorder, getSelectListTheme, keyHint, keyText, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, Key, matchesKey, ScrollView, SelectList, Spacer, Text,
	truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { literalText, subtotal, tokenLabel, usageByTool, type Contribution, type ContextSource, type Inspection, type Usage } from "./context.ts";
import { extensionName } from "./inventory.ts";
import type { Toggles } from "./toggle.ts";

const summary = (items: Contribution[]) => items.length
	? `${tokenLabel(subtotal(items))} known${items.some((item) => item.tokens === null) ? " + unavailable" : ""} · ${items.length} items`
	: "none observed; not proof of zero context";

/** Native selectors, borders, search, focus and scrolling; no model-facing messages. */
export async function showInspector(ctx: ExtensionCommandContext, inspection: Inspection, toggles?: Toggles): Promise<void> {
	const resources = new Map((toggles?.resources ?? []).map((resource) => [resource.path, resource]));
	const loaded = new Map([...resources].map(([path, resource]) => [path, resource.enabled]));
	// Disabled extensions and those without tools or commands stay listed so they can be toggled.
	const sources: ContextSource[] = [...inspection.sources];
	for (const [path, resource] of resources) {
		if (sources.some((source) => source.id === path)) continue;
		sources.splice(-1, 0, { id: path, label: extensionName({ path, ...resource.metadata }), path, items: [] });
	}
	const usage = usageByTool(sources);
	const known = usage.reduce((sum, row) => sum + row.total, 0);
	const top = Math.max(1, ...usage.map((row) => row.total));
	const usageName = (row: Usage) => row.group === "injected" ? `custom: ${row.label}` : row.label;
	const share = (row: Usage) => `${Math.round(row.total / (known || 1) * 100)}%`;
	const usageLine = (row: Usage) => {
		const filled = row.total ? Math.max(1, Math.round(row.total / top * 10)) : 0;
		const cell = (tokens: number) => (tokens ? tokenLabel(tokens) : "—").padStart(8);
		const head = `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${tokenLabel(row.total).padStart(9)} ${share(row).padStart(4)}`;
		const unavailable = row.items.some((item) => item.tokens === null) ? " + unavailable" : "";
		return row.group === "tool"
			? `${head} · def ${cell(row.definition)} · calls ${cell(row.calls)} · results ${cell(row.results)} · ×${row.count}${unavailable}`
			: `${head} · ×${row.count}${row.group === "injected" ? " custom messages" : ""}${unavailable}`;
	};
	// Repeats the row unpadded: narrow terminals cut or drop list descriptions.
	const usageDetail = (row?: Usage) => {
		if (!row) return "";
		const largest = row.items.reduce<Contribution | undefined>((best, item) => (item.tokens ?? 0) > (best?.tokens ?? 0) ? item : best, undefined);
		const parts = row.group === "tool"
			? `definition ${tokenLabel(row.definition)} · calls ${tokenLabel(row.calls)} · results ${tokenLabel(row.results)} · ×${row.count} calls`
			: `×${row.count} ${row.group === "injected" ? "custom messages" : "items"}`;
		return `${tokenLabel(row.total)} · ${share(row)} of known · ${parts}${row.items.some((item) => item.tokens === null) ? " + unavailable" : ""}${
			largest ? ` · largest ${tokenLabel(largest.tokens)} (${largest.label})` : ""}`;
	};
	const changed = () => [...resources].some(([path, resource]) => resource.enabled !== loaded.get(path));
	await ctx.ui.custom<void>((tui, theme, kb, done) => {
		const title = (text: string) => new Text(theme.bold(theme.fg("accent", literalText(text))), 1, 0);
		const muted = (text: string) => new Text(theme.fg("muted", literalText(text)), 1, 0);
		const singleLine = (text: () => string): Component => ({
			render: (width) => [truncateToWidth(theme.fg("dim", ` ${literalText(text()).replace(/\n/g, " ")}`), width)], invalidate() {},
		});
		type Page = Component & { handleInput(data: string): void; focused?: boolean };
		const stack: Page[] = [];
		class Navigator extends Container {
			private hasFocus = false;
			get focused() { return this.hasFocus; }
			set focused(value: boolean) { this.hasFocus = value; if (stack.length) stack.at(-1)!.focused = value; }
			handleInput(data: string) { stack.at(-1)?.handleInput(data); tui.requestRender(); }
		}
		const nav = new Navigator();
		const display = () => {
			nav.clear();
			nav.addChild(stack.at(-1)!);
			nav.focused = nav.focused;
			tui.requestRender();
		};
		const push = (page: Page) => { if (stack.length) stack.at(-1)!.focused = false; stack.push(page); display(); };
		const back = () => { if (stack.length === 1) done(); else { stack.pop(); display(); } };

		function showContent(item: Contribution) {
			let content = item.content;
			try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { /* Plain instruction text. */ }
			const text = new Text(literalText(content), 1, 0);
			const scroll = new ScrollView(text, { overscroll: "contain" });
			let height = 10;
			let total = 0;
			const viewport: Component = {
				render(width) {
					const lines = scroll.render(width);
					total = lines.length;
					scroll.updateLayout(total, height, () => tui.requestRender());
					return lines.slice(scroll.scrollTop, scroll.scrollTop + height);
				},
				invalidate() { scroll.invalidate(); },
				handleMouse(event: TuiMouseEvent) {
					if (event.type !== "wheel" || !event.wheelDelta) return;
					scroll.scrollBy(event.wheelDelta);
					return { handled: true, render: true };
				},
			};
			const page = new Container() as Container & Page;
			const header = new Container();
			header.addChild(new DynamicBorder());
			header.addChild(title(item.label));
			header.addChild(muted(`${item.kind} · ${tokenLabel(item.tokens)} tokens · characters / 4`));
			header.addChild(muted(item.note));
			header.addChild(new Spacer(1));
			page.addChild(header);
			page.addChild(viewport);
			page.addChild(new Spacer(1));
			page.addChild(singleLine(() => `Lines ${Math.min(total, scroll.scrollTop + 1)}–${Math.min(total, scroll.scrollTop + height)} of ${total} · controls escaped; images omitted`));
			const scrollHint = tui.mode === "fullscreen" ? "wheel scroll" : keyHint("tui.select.pageDown", "page");
			page.addChild(new Text(theme.fg("dim", ` ${keyText("tui.select.up")}/${keyText("tui.select.down")} scroll · ${scrollHint} · ${keyHint("tui.select.cancel", "back")}`), 0, 0));
			page.addChild(new DynamicBorder());
			const render = page.render.bind(page);
			page.render = (width) => {
				height = Math.max(1, Math.min(24, tui.terminal.rows - header.render(width).length - 9));
				return render(width).map((line) => truncateToWidth(line, width));
			};
			page.handleInput = (data) => {
				if (kb.matches(data, "tui.select.cancel")) back();
				else if (kb.matches(data, "tui.select.up")) scroll.scrollBy(-1);
				else if (kb.matches(data, "tui.select.down")) scroll.scrollBy(1);
				else if (kb.matches(data, "tui.select.pageUp")) scroll.scrollBy(-height);
				else if (kb.matches(data, "tui.select.pageDown")) scroll.scrollBy(height);
				else if (matchesKey(data, Key.home)) scroll.scrollToStart();
				else if (matchesKey(data, Key.end)) scroll.scrollToEnd();
			};
			push(page);
		}

		function listPage(options: { title: string; description: string; items: () => { value: string; label: string; description: string; search: string }[];
			metadata: (id: string) => string; select: (id: string) => void; toggle?: (id: string) => Promise<void> }): Page {
			const input = new Input({ prompt: " Search: ", placeholder: "extension, tool or source" });
			let list: SelectList;
			let filtered = options.items();
			let limit = 8;
			let busy = false;
			const selected = () => list?.getSelectedItem()?.value ?? "";
			const listHost = new Container();
			const rebuild = (preselect = "") => {
				filtered = fuzzyFilter(options.items(), input.getValue(), (item) => item.search);
				list = new SelectList(filtered, limit, getSelectListTheme(), { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 40 });
				list.setSelectedIndex(Math.max(0, filtered.findIndex((item) => item.value === preselect)));
				list.onSelect = (item) => options.select(item.value);
				list.onCancel = back;
				listHost.clear();
				listHost.addChild(filtered.length ? list : muted("No matching extensions or contributions."));
			};
			class ListPage extends Container {
				get focused() { return input.focused; }
				set focused(value: boolean) { input.focused = value; }
				handleInput(data: string) {
					if ((["tui.select.up", "tui.select.down", "tui.select.confirm", "tui.select.cancel"] as const).some((action) => kb.matches(data, action))) list.handleInput(data);
					else if (kb.matches(data, "tui.select.pageUp") || kb.matches(data, "tui.select.pageDown")) {
						const index = filtered.findIndex((item) => item.value === selected());
						list.setSelectedIndex(Math.max(0, index + (kb.matches(data, "tui.select.pageUp") ? -limit : limit)));
					} else if (options.toggle && data === " ") {
						// Space toggles, as in `pi config`.
						const id = selected();
						if (busy) return; // One settings write at a time.
						busy = true;
						void options.toggle(id).then(() => { busy = false; rebuild(id); tui.requestRender(); });
					} else {
						input.handleInput(data);
						rebuild();
					}
				}
				render(width: number) {
					const nextLimit = Math.max(1, Math.min(10, tui.terminal.rows - 18));
					if (nextLimit !== limit) { limit = nextLimit; rebuild(selected()); }
					return super.render(width).map((line) => truncateToWidth(line, width));
				}
			}
			const page = new ListPage();
			page.addChild(new DynamicBorder());
			page.addChild(title(options.title));
			page.addChild(muted(options.description));
			page.addChild(new Spacer(1));
			page.addChild(input);
			page.addChild(new Spacer(1));
			page.addChild(listHost);
			page.addChild(new Spacer(1));
			page.addChild(singleLine(() => options.metadata(selected())));
			page.addChild(new Text(theme.fg("dim", `Type to filter · ${keyHint("tui.select.confirm", "inspect")}${options.toggle ? " · space enable/disable" : ""} · ${keyHint("tui.select.cancel", "back")}`), 1, 0));
			page.addChild(new DynamicBorder());
			rebuild();
			return page;
		}

		const itemsPage = (name: string, description: string, items: Contribution[], fallback: string) => listPage({
			title: name,
			description,
			items: () => items.map((item, index) => ({ value: String(index), label: `${tokenLabel(item.tokens)}  ${literalText(item.label)}`,
				description: item.kind, search: `${item.label} ${item.kind}` })),
			metadata: (index) => items[Number(index)]?.note ?? fallback,
			select: (index) => showContent(items[Number(index)]),
		});
		const byTool = () => listPage({
			title: "Extensions · context by tool",
			description: `${inspection.scope}\n${tokenLabel(known)} known in total · bar relative to the largest row · share of that total · × calls or messages in context.\nCustom messages are grouped by type; the injecting extension is not exposed.`,
			items: () => usage.map((row) => ({ value: row.id, label: literalText(usageName(row)), description: usageLine(row),
				search: `${usageName(row)} ${row.group}` })),
			metadata: (id) => usageDetail(usage.find((row) => row.id === id)),
			select(id) {
				const row = usage.find((row) => row.id === id)!;
				push(itemsPage(usageName(row), `${usageDetail(row)}\nSelect an exposed contribution.`, row.items, ""));
			},
		});

		push(listPage({
			title: "Extensions · context inspector",
			description: `${inspection.scope}\n≈ Characters / 4; known subtotals, not billed or complete per-extension totals.`,
			items: () => [{ value: "by-tool", label: `${toggles ? "    " : ""}Context by tool`,
				description: `${tokenLabel(known)} known · ${usage.filter((row) => row.group === "tool").length} tools · ${usage.filter((row) => row.group === "injected").length} custom message types`,
				search: "context by tool" }, ...sources.map((source) => {
				const resource = resources.get(source.id);
				const pending = resource && resource.enabled !== loaded.get(source.id);
				const box = !toggles ? "" : !resource ? "    " : resource.enabled ? "[x] " : "[ ] ";
				return { value: source.id, label: box + literalText(source.label),
					description: pending ? `${resource.enabled ? "enabled" : "disabled"}; /reload to apply`
						: resource && !resource.enabled ? "disabled" : summary(source.items),
					search: `${source.label} ${source.path} ${source.items.map((item) => item.label).join(" ")}` };
			})],
			metadata: (id) => id === "by-tool" ? "Definitions, calls and results per tool; custom messages per type." : !toggles || resources.has(id) || id === "shared-context" ? sources.find((source) => source.id === id)?.path ?? ""
				: `${id} · toggle with pi config`,
			toggle: toggles && (async (id) => {
				const resource = resources.get(id);
				if (!resource) return;
				try { await toggles.set(resource, !resource.enabled); }
				catch (error) { ctx.ui.notify(`Could not save extension setting: ${(error as Error).message}`, "error"); }
			}),
			select(id) {
				if (id === "by-tool") return push(byTool());
				const source = sources.find((source) => source.id === id)!;
				push(itemsPage(source.label, `${summary(source.items)}\n${(["definition", "result", "message", "instructions"] as const)
						.filter((kind) => source.items.some((item) => item.kind === kind))
						.map((kind) => {
							const items = source.items.filter((item) => item.kind === kind);
							return `${kind} ${tokenLabel(subtotal(items))}${items.some((item) => item.tokens === null) ? " + unavailable" : ""}`;
						}).join(" · ")}\nInjection ownership / full total: unavailable. Select an exposed contribution.`, source.items, source.path));
			},
		}));
		return nav;
	});
	if (changed()) ctx.ui.notify("Extension changes saved. Run /reload to apply.", "info");
}
