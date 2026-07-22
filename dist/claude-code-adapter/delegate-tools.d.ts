import type { DelegateConfig } from "../config";
import { type RunDelegateFn } from "../delegate-turn";
export type { RunDelegateFn } from "../delegate-turn";
export type DelegateRunOptions = {
    run?: RunDelegateFn;
    cwd?: string;
    stateDir?: string;
    onProgress?: (text: string) => void;
};
export declare function startDelegate(name: string, cfg: DelegateConfig, claudeSessionId: string, prompt: string, options?: DelegateRunOptions): Promise<string>;
export declare function replyDelegate(name: string, cfg: DelegateConfig, claudeSessionId: string, prompt: string, options?: DelegateRunOptions): Promise<string>;
//# sourceMappingURL=delegate-tools.d.ts.map