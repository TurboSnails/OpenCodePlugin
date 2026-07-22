export type DelegateSession = {
    delegate: string;
    externalId: string;
};
export declare function defaultStateDir(): string;
export declare function beginDelegateStart(sessionId: string, dir?: string): number;
export declare function isLatestDelegateStart(sessionId: string, sequence: number, dir?: string): boolean;
export declare function getActiveDelegate(sessionId: string, dir?: string): DelegateSession | undefined;
export declare function setActiveDelegate(sessionId: string, delegate: string, externalId: string, dir?: string): void;
export declare function clearActiveDelegate(sessionId: string, dir?: string): void;
//# sourceMappingURL=session-store.d.ts.map