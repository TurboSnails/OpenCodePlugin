import type { DelegateStore } from "../delegate-store";
export declare function defaultCodexStateDir(): string;
export declare function codexFileDelegateStore(dir?: string): DelegateStore;
export declare function writeCurrentSession(sessionId: string, dir?: string): void;
export declare function readCurrentSession(dir?: string): string | undefined;
//# sourceMappingURL=session-store.d.ts.map