import { dirname, relative } from "node:path";
import { DefaultPackageManager, SettingsManager, type PackageSource, type ResolvedResource } from "@earendil-works/pi-coding-agent";

export interface Toggles {
	/** User-scope extensions from Pi settings, including disabled ones. */
	resources: ResolvedResource[];
	/** Saves the state to user settings; it applies after /reload. */
	set(resource: ResolvedResource, enabled: boolean): Promise<void>;
}

const TYPES = ["extensions", "skills", "prompts", "themes"] as const;

/** Same `+path` / `-path` entries that `pi config` writes, so both tools stay interchangeable. */
export async function loadToggles(cwd: string, agentDir: string): Promise<Toggles> {
	// Project settings are left to `pi config --local`: they need a trust decision.
	const open = () => SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const resolve = async () => {
		const settings = open();
		const resolved = await new DefaultPackageManager({ cwd, agentDir, settingsManager: settings }).resolve(async () => "skip");
		const states = new Map(TYPES.flatMap((type) => resolved[type].map((resource) => [`${type}:${resource.path}`, resource.enabled] as const)));
		return { resolved, states };
	};
	let { states, resolved } = await resolve();
	return {
		resources: resolved.extensions.filter((resource) => resource.metadata.scope === "user"),
		async set(resource, enabled) {
			const { metadata } = resource;
			const settings = open();
			const global = settings.getGlobalSettings();
			const extensions = global.extensions ?? [];
			const packages: PackageSource[] = global.packages ?? [];
			const save = async (write: () => void) => {
				write();
				await settings.flush();
				const errors = settings.drainErrors();
				if (errors.length) throw errors[0].error;
			};
			let entries = extensions;
			let pattern = relative(metadata.baseDir ?? agentDir, resource.path);
			let write = (updated: string[]) => settings.setExtensionPaths(updated);
			let restore = () => settings.setExtensionPaths(extensions);
			if (metadata.origin === "package") {
				const index = packages.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === metadata.source);
				if (index === -1) throw new Error(`package ${metadata.source} is not in user settings`);
				const pkg = packages[index];
				const filters = typeof pkg === "string" ? { source: pkg } : pkg;
				entries = filters.extensions ?? [];
				pattern = relative(metadata.baseDir ?? dirname(resource.path), resource.path);
				restore = () => settings.setPackages(packages);
				write = (updated) => {
					const { extensions: _, ...rest } = filters;
					const next = updated.length || filters.extensions?.length === 0 ? { ...rest, extensions: updated } : rest;
					settings.setPackages(packages.with(index, Object.keys(next).length === 1 ? next.source : next));
				};
			}
			// Plain entries discover resources; only a previous override for this path is replaced.
			const cleared = entries.filter((entry) => !/^[!+-]/.test(entry) || entry.slice(1) !== pattern);
			// Pi's filters interact (allowlists, empty arrays, manifests): keep a change only if it did
			// exactly what was asked and nothing else. Enabling first tries just dropping the override.
			const key = `extensions:${resource.path}`;
			let next: Awaited<ReturnType<typeof resolve>> | undefined;
			try {
				for (const updated of enabled ? [cleared, [...cleared, `+${pattern}`]] : [[...cleared, `-${pattern}`]]) {
					await save(() => write(updated));
					const candidate = await resolve();
					if (candidate.states.size === states.size && [...candidate.states].every(([path, state]) =>
						path === key ? state === enabled : states.get(path) === state)) { next = candidate; break; }
				}
			} finally {
				if (!next) await save(restore);
			}
			if (!next) throw new Error("Pi cannot apply this without changing other resources; use pi config or edit settings.json");
			states = next.states;
			resource.enabled = enabled;
		},
	};
}
