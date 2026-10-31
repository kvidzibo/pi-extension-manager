import { DynamicBorder, getSelectListTheme, keyHint, keyText, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, Key, matchesKey, ScrollView, SelectList, Spacer, Text,
	truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { literalText, subtotal, tokenLabel, type Contribution, type Inspection } from "./context.ts";

const summary = (items: Contribution[]) => items.length
	? `${tokenLabel(subtotal(items))} known${items.some((item) => item.tokens === null) ? " + unavailable" : ""} · ${items.length} items`
	: "none observed; not proof of zero context";

/** Native selectors, borders, search, focus and scrolling; no model-facing messages. */
export async function showInspector(ctx: ExtensionCommandContext, inspection: Inspection): Promise<void> {
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

		function listPage(options: { title: string; description: string; items: { value: string; label: string; description: string; search: string }[];
			metadata: (id: string) => string; select: (id: string) => void }): Page {
			const input = new Input({ prompt: " Search: ", placeholder: "extension, tool or source" });
			let list: SelectList;
			let filtered = options.items;
			let limit = 8;
			const selected = () => list?.getSelectedItem()?.value ?? "";
			const listHost = new Container();
			const rebuild = (preselect = "") => {
				filtered = fuzzyFilter(options.items, input.getValue(), (item) => item.search);
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
			page.addChild(new Text(theme.fg("dim", ` Type to filter · ${keyHint("tui.select.confirm", "inspect")} · ${keyHint("tui.select.cancel", "back")}`), 0, 0));
			page.addChild(new DynamicBorder());
			rebuild();
			return page;
		}

		push(listPage({
			title: "Extensions · context inspector",
			description: `${inspection.scope}\n≈ Characters / 4; known subtotals, not billed or complete per-extension totals.`,
			items: inspection.sources.map((source) => ({ value: source.id, label: literalText(source.label), description: summary(source.items),
				search: `${source.label} ${source.path} ${source.items.map((item) => item.label).join(" ")}` })),
			metadata: (id) => inspection.sources.find((source) => source.id === id)?.path ?? "",
			select(id) {
				const source = inspection.sources.find((source) => source.id === id)!;
				push(listPage({
					title: source.label,
					description: `${summary(source.items)}\n${(["definition", "result", "message", "instructions"] as const)
						.filter((kind) => source.items.some((item) => item.kind === kind))
						.map((kind) => {
							const items = source.items.filter((item) => item.kind === kind);
							return `${kind} ${tokenLabel(subtotal(items))}${items.some((item) => item.tokens === null) ? " + unavailable" : ""}`;
						}).join(" · ")}\nInjection ownership / full total: unavailable. Select an exposed contribution.`,
					items: source.items.map((item, index) => ({ value: String(index), label: `${tokenLabel(item.tokens)}  ${literalText(item.label)}`,
						description: item.kind, search: `${item.label} ${item.kind}` })),
					metadata: (index) => source.items[Number(index)]?.note ?? source.path,
					select: (index) => showContent(source.items[Number(index)]),
				}));
			},
		}));
		return nav;
	});
}
