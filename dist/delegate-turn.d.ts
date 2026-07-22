import type { DelegateConfig } from "./config";
import { runDelegate } from "./run-delegate";
import type { DelegateStore } from "./delegate-store";
export type RunDelegateFn = typeof runDelegate;
export declare const DEFAULT_DELEGATE_TIMEOUT_MS: number;
export type DelegateTurnOptions = {
    name: string;
    cfg: DelegateConfig;
    store: DelegateStore;
    sessionKey: string;
    prompt: string;
    homeCommand: string;
    onProgress: (text: string) => void;
    signal?: AbortSignal;
    cwd?: string;
    run?: RunDelegateFn;
};
export declare function startDelegateTurn(options: DelegateTurnOptions): Promise<string>;
export declare function replyDelegateTurn(options: DelegateTurnOptions): Promise<string>;
//# sourceMappingURL=delegate-turn.d.ts.map