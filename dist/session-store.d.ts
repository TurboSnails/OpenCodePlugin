import type { DelegateStore } from "./delegate-store";
export type { DelegateSession } from "./delegate-store";
import type { DelegateSession } from "./delegate-store";
export type SessionModel = {
    providerID: string;
    modelID: string;
};
export declare function getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined;
export declare function setActiveDelegate(opencodeSessionID: string, delegate: string, externalId: string): void;
export declare function clearActiveDelegate(opencodeSessionID: string): void;
export declare function beginDelegateStart(opencodeSessionID: string): number;
export declare function isLatestDelegateStart(opencodeSessionID: string, sequence: number): boolean;
export declare function setActiveDelegateIfLatest(opencodeSessionID: string, delegate: string, externalId: string, sequence: number): boolean;
export declare const memoryDelegateStore: DelegateStore;
export declare function getSessionAgent(opencodeSessionID: string): string | undefined;
export declare function setSessionAgent(opencodeSessionID: string, agent: string): void;
export declare function getSessionModel(opencodeSessionID: string): SessionModel | undefined;
export declare function setSessionModel(opencodeSessionID: string, model: SessionModel): void;
//# sourceMappingURL=session-store.d.ts.map