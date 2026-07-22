export interface DoctorContext {
    cwd: string;
    homeDir: string;
    pathEnv: string;
    configPath?: string;
}
export declare function makeContext(overrides?: Partial<DoctorContext>): DoctorContext;
//# sourceMappingURL=context.d.ts.map