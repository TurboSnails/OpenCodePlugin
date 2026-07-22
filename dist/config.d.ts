export type ParserName = "claude" | "codex" | "opencode" | "raw";
export interface DelegateConfig {
    binary: string;
    parser: ParserName;
    startArgs: string[];
    replyArgs: string[];
    timeoutMs?: number;
}
export interface CliDispatchConfig {
    delegates: Record<string, DelegateConfig>;
    verifiedModels?: string[];
}
export declare function isValidVerifiedModelEntry(entry: unknown): entry is string;
export declare function matchesVerifiedModel(model: {
    providerID: string;
    modelID: string;
}, patterns: string[]): boolean;
export declare const DEFAULT_CONFIG: CliDispatchConfig;
export declare function validateDelegates(delegates: Record<string, unknown>): string[];
export declare function getConfigSearchPaths(configPath?: string, homeDir?: string, cwd?: string): string[];
export declare function loadConfig(configPath?: string): CliDispatchConfig;
export declare function resolveArgs(args: string[], vars: Record<string, string>): string[];
//# sourceMappingURL=config.d.ts.map