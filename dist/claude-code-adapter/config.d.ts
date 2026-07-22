import { type DelegateConfig } from "../config";
export interface ClaudeCodeAdapterConfig {
    delegates: Record<string, DelegateConfig>;
    verifiedModels?: string[];
}
export declare function isValidModelPattern(entry: unknown): entry is string;
export declare function matchesModelPattern(model: string, patterns: string[]): boolean;
export declare function loadAdapterConfig(configPath?: string): ClaudeCodeAdapterConfig;
//# sourceMappingURL=config.d.ts.map