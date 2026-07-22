import type { ParserName } from "./config";
export type SpawnOptions = {
    cwd?: string;
};
export type SpawnedProcess = {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill: (signal?: "SIGTERM" | "SIGKILL") => void;
    killTree?: (signal?: "SIGTERM" | "SIGKILL") => void;
};
export type SpawnFn = (binary: string, args: string[], options?: SpawnOptions) => SpawnedProcess;
export type RunDelegateResult = {
    finalText: string;
    externalId?: string;
    stderrText: string;
};
export declare const MAX_LINE_CHARS = 1000000;
export declare const MAX_STDOUT_CHARS = 10000000;
export declare const MAX_STDERR_CHARS = 2000000;
export declare const STDERR_EXCERPT_CHARS = 2000;
export declare const KILL_GRACE_MS = 2000;
export declare const DRAIN_GRACE_MS = 5000;
export declare const defaultSpawn: SpawnFn;
export declare function runDelegate(options: {
    binary: string;
    args: string[];
    parser: ParserName;
    onProgress: (text: string) => void;
    spawn?: SpawnFn;
    cwd?: string;
    timeoutMs?: number;
    killGraceMs?: number;
    drainGraceMs?: number;
    signal?: AbortSignal;
}): Promise<RunDelegateResult>;
//# sourceMappingURL=run-delegate.d.ts.map