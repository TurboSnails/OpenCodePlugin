export type DelegateSession = {
    delegate: string;
    externalId: string;
};
export declare function getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined;
export declare function setActiveDelegate(opencodeSessionID: string, delegate: string, externalId: string): void;
export declare function clearActiveDelegate(opencodeSessionID: string): void;
export declare function getSessionAgent(opencodeSessionID: string): string | undefined;
export declare function setSessionAgent(opencodeSessionID: string, agent: string): void;
//# sourceMappingURL=session-store.d.ts.map