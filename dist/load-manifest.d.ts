import type { CliDispatchConfig } from "./config";
export interface LoadManifest {
    version: string;
    pid: number;
    cwd: string;
    loadedAt: string;
    cliDispatchDev: boolean;
    configPath?: string;
    delegates: string[];
    tools: string[];
    commandsDir: string;
}
export interface LoadManifestContext {
    cwd: string;
    homeDir: string;
}
export declare function manifestDir(homeDir?: string): string;
export declare function manifestPath(cwd: string, homeDir?: string): string;
export declare function writeLoadManifest(input: {
    config: CliDispatchConfig;
    tools: string[];
    commandsDir: string;
    configPath?: string;
    cwd?: string;
    homeDir?: string;
}): LoadManifest;
export declare function readLoadManifest(ctx: LoadManifestContext): LoadManifest | undefined;
export declare function isManifestFresh(manifest: LoadManifest | undefined, ctx: LoadManifestContext): manifest is LoadManifest;
//# sourceMappingURL=load-manifest.d.ts.map