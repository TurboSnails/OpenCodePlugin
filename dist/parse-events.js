function isEventObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseClaudeLine(line) {
    let obj;
    try {
        obj = JSON.parse(line);
    }
    catch {
        return { progressText: line };
    }
    if (!isEventObject(obj))
        return {};
    if (obj.type === "assistant") {
        const text = (obj.message?.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");
        return text ? { progressText: text } : {};
    }
    if (obj.type === "result") {
        return { finalText: obj.result };
    }
    return {};
}
function parseCodexLine(line) {
    let obj;
    try {
        obj = JSON.parse(line);
    }
    catch {
        return { progressText: line };
    }
    if (!isEventObject(obj))
        return {};
    if (obj.type === "thread.started") {
        return { externalId: obj.thread_id };
    }
    if (obj.type === "item.started" && obj.item?.type === "command_execution") {
        return { progressText: `running: ${obj.item.command}` };
    }
    if (obj.type === "item.completed" && obj.item?.type === "command_execution") {
        return { progressText: `finished: ${obj.item.command}` };
    }
    if (obj.type === "item.completed" && obj.item?.type === "agent_message") {
        return { finalText: obj.item.text, progressText: obj.item.text };
    }
    return {};
}
function parseRawLine(line) {
    return { progressText: line, finalText: line, appendFinalText: true };
}
const PARSERS = {
    claude: parseClaudeLine,
    codex: parseCodexLine,
    raw: parseRawLine,
};
export function getParser(name) {
    return PARSERS[name] ?? PARSERS.raw;
}
//# sourceMappingURL=parse-events.js.map