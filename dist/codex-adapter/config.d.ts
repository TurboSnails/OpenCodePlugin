import { type DelegateConfig } from "../config";
export interface CodexAdapterConfig {
    delegates: Record<string, DelegateConfig>;
    verifiedModels?: string[];
}
export declare function isValidModelPattern(entry: unknown): entry is string;
export declare function matchesModelPattern(model: string, patterns: string[]): boolean;
export declare function getCodexConfigSearchPaths(configPath?: string, cwd?: string, homeDir?: string): string[];
export declare function loadCodexAdapterConfig(configPath?: string): CodexAdapterConfig;
//# sourceMappingURL=config.d.ts.map