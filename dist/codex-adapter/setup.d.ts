export type SetupOptions = {
    dryRun?: boolean;
    homeDir?: string;
    configPath?: string;
    mcpServerCommand?: string[];
    hooksCommand?: string[];
};
export declare function setupCodexAdapter(options?: SetupOptions): string[];
export declare function uninstallCodexAdapter(options?: SetupOptions): string[];
export declare function doctorCodexAdapter(options?: SetupOptions): string[];
//# sourceMappingURL=setup.d.ts.map