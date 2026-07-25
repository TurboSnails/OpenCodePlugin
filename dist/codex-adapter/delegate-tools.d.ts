import type { DelegateConfig } from "../config";
import { type RunDelegateFn } from "../delegate-turn";
export type { RunDelegateFn } from "../delegate-turn";
export type CodexDelegateRunOptions = {
    run?: RunDelegateFn;
    cwd?: string;
    stateDir?: string;
    onProgress?: (text: string) => void;
};
export declare function startDelegate(name: string, cfg: DelegateConfig, prompt: string, options?: CodexDelegateRunOptions): Promise<string>;
export declare function replyDelegate(name: string, cfg: DelegateConfig, prompt: string, options?: CodexDelegateRunOptions): Promise<string>;
//# sourceMappingURL=delegate-tools.d.ts.map