const sessions = new Map();
const sessionAgents = new Map();
const sessionModels = new Map();
const startSequences = new Map();
export function getActiveDelegate(opencodeSessionID) {
    return sessions.get(opencodeSessionID);
}
export function setActiveDelegate(opencodeSessionID, delegate, externalId) {
    sessions.set(opencodeSessionID, { delegate, externalId });
}
export function clearActiveDelegate(opencodeSessionID) {
    sessions.delete(opencodeSessionID);
}
// Monotonic per-session sequence for `*_start` calls. When concurrent starts
// race, only the latest initiated start may register its delegation — an
// earlier start that finishes later must not overwrite it.
export function beginDelegateStart(opencodeSessionID) {
    const next = (startSequences.get(opencodeSessionID) ?? 0) + 1;
    startSequences.set(opencodeSessionID, next);
    return next;
}
export function isLatestDelegateStart(opencodeSessionID, sequence) {
    return startSequences.get(opencodeSessionID) === sequence;
}
export function getSessionAgent(opencodeSessionID) {
    return sessionAgents.get(opencodeSessionID);
}
export function setSessionAgent(opencodeSessionID, agent) {
    sessionAgents.set(opencodeSessionID, agent);
}
export function getSessionModel(opencodeSessionID) {
    return sessionModels.get(opencodeSessionID);
}
export function setSessionModel(opencodeSessionID, model) {
    sessionModels.set(opencodeSessionID, model);
}
//# sourceMappingURL=session-store.js.map