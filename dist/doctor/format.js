export function formatResults(results) {
    const lines = [];
    let firstFailure = true;
    for (const r of results) {
        lines.push(`${r.ok ? "✓" : "✗"} ${r.label} (${r.id}): ${r.detail}`);
        if (!r.ok && firstFailure && r.fixHint) {
            lines.push(`  → fix: ${r.fixHint}`);
            firstFailure = false;
        }
    }
    const failed = results.some((r) => !r.ok);
    if (!failed) {
        lines.push("", "All checks passed. Run `/claude hello` (or `/cc hello`) in opencode to verify end-to-end.");
    }
    return lines.join("\n");
}
//# sourceMappingURL=format.js.map