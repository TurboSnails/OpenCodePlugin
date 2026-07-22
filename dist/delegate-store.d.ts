export type DelegateSession = {
    delegate: string;
    externalId: string;
};
export interface DelegateStore {
    getActiveDelegate(sessionKey: string): DelegateSession | undefined;
    setActiveDelegate(sessionKey: string, delegate: string, externalId: string): void;
    clearActiveDelegate(sessionKey: string): void;
    beginDelegateStart(sessionKey: string): number;
    setActiveDelegateIfLatest(sessionKey: string, delegate: string, externalId: string, sequence: number): boolean;
}
//# sourceMappingURL=delegate-store.d.ts.map