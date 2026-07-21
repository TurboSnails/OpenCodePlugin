import type { ParserName } from "./config";
export type SpawnOptions = {
    cwd?: string;
};
export type SpawnFn = (binary: string, args: string[], options?: SpawnOptions) => {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill: (signal?: "SIGTERM" | "SIGKILL") => void;
};
export type RunDelegateResult = {
    finalText: string;
    externalId?: string;
    stderrText: string;
};
export declare const defaultSpawn: SpawnFn;
export declare const KILL_GRACE_MS = 2000;
export declare function runDelegate(options: {
    binary: string;
    args: string[];
    parser: ParserName;
    onProgress: (text: string) => void;
    spawn?: SpawnFn;
    cwd?: string;
    timeoutMs?: number;
    killGraceMs?: number;
    signal?: AbortSignal;
}): Promise<RunDelegateResult>;
//# sourceMappingURL=run-delegate.d.ts.map