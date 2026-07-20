const sessions = new Map();
const sessionAgents = new Map();
export function getActiveDelegate(opencodeSessionID) {
    return sessions.get(opencodeSessionID);
}
export function setActiveDelegate(opencodeSessionID, delegate, externalId) {
    sessions.set(opencodeSessionID, { delegate, externalId });
}
export function clearActiveDelegate(opencodeSessionID) {
    sessions.delete(opencodeSessionID);
}
export function getSessionAgent(opencodeSessionID) {
    return sessionAgents.get(opencodeSessionID);
}
export function setSessionAgent(opencodeSessionID, agent) {
    sessionAgents.set(opencodeSessionID, agent);
}
//# sourceMappingURL=session-store.js.map