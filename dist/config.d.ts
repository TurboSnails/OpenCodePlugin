export type ParserName = "claude" | "codex" | "raw";
export interface DelegateConfig {
    binary: string;
    parser: ParserName;
    startArgs: string[];
    replyArgs: string[];
}
export interface CliDispatchConfig {
    delegates: Record<string, DelegateConfig>;
}
export declare function loadConfig(configPath?: string): CliDispatchConfig;
export declare function resolveArgs(args: string[], vars: Record<string, string>): string[];
//# sourceMappingURL=config.d.ts.map