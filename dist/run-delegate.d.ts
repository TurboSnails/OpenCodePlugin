import type { ParserName } from "./config";
export type SpawnOptions = {
    cwd?: string;
};
export type SpawnFn = (binary: string, args: string[], options?: SpawnOptions) => {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill: () => void;
};
export type RunDelegateResult = {
    finalText: string;
    externalId?: string;
    stderrText: string;
};
export declare const defaultSpawn: SpawnFn;
export declare function runDelegate(options: {
    binary: string;
    args: string[];
    parser: ParserName;
    onProgress: (text: string) => void;
    spawn?: SpawnFn;
    cwd?: string;
    timeoutMs?: number;
}): Promise<RunDelegateResult>;
//# sourceMappingURL=run-delegate.d.ts.map