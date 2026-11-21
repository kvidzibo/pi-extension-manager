import { dirname, relative } from "node:path";
import { DefaultPackageManager, SettingsManager, type PackageSource, type ResolvedResource } from "@earendil-works/pi-coding-agent";

export interface Toggles {
	/** User-scope extensions from Pi settings, including disabled ones. */
	resources: ResolvedResource[];
	/** Saves the state to user settings; it applies after /reload. */
	set(resource: ResolvedResource, enabled: boolean): Promise<void>;
}

const target = (entry: string) => /^[!+-]/.test(entry) ? entry.slice(1) : entry;

/** Same `+path` / `-path` entries that `pi config` writes, so both tools stay interchangeable. */
export async function loadToggles(cwd: string, agentDir: string): Promise<Toggles> {
	// Project settings are left to `pi config --local`: they need a trust decision.
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const resolved = await new DefaultPackageManager({ cwd, agentDir, settingsManager: settings }).resolve(async () => "skip");
	return {
		resources: resolved.extensions.filter((resource) => resource.metadata.scope === "user"),
		async set(resource, enabled) {
			const { metadata } = resource;
			const global = settings.getGlobalSettings();
			const withEntry = (entries: string[], pattern: string) =>
				[...entries.filter((entry) => target(entry) !== pattern), `${enabled ? "+" : "-"}${pattern}`];
			if (metadata.origin === "top-level") {
				settings.setExtensionPaths(withEntry(global.extensions ?? [], relative(metadata.baseDir ?? agentDir, resource.path)));
			} else {
				const packages: PackageSource[] = [...(global.packages ?? [])];
				const index = packages.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === metadata.source);
				if (index === -1) throw new Error(`Package ${metadata.source} is not in user settings`);
				const pkg = packages[index];
				const filters = typeof pkg === "string" ? { source: pkg } : { ...pkg };
				filters.extensions = withEntry(filters.extensions ?? [], relative(metadata.baseDir ?? dirname(resource.path), resource.path));
				packages[index] = filters;
				settings.setPackages(packages);
			}
			await settings.flush();
			const errors = settings.drainErrors();
			if (errors.length) throw errors[0].error;
			resource.enabled = enabled;
		},
	};
}
