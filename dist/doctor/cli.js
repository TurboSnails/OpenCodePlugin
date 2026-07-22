#!/usr/bin/env node
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
const isBun = typeof process.versions.bun !== "undefined";
function findBun() {
    const executable = process.platform === "win32" ? "bun.exe" : "bun";
    const paths = process.env.PATH?.split(process.platform === "win32" ? ";" : ":") ?? [];
    for (const dir of paths) {
        const full = join(dir, executable);
        if (existsSync(full))
            return full;
    }
    return null;
}
if (!isBun) {
    const bunPath = findBun();
    if (!bunPath) {
        console.error("cli-dispatch doctor requires Bun (https://bun.sh). Install it or run with: bunx opencode-cli-dispatch doctor");
        process.exit(1);
    }
    const script = fileURLToPath(import.meta.url);
    const args = process.argv.slice(2);
    const result = spawnSync(bunPath, [script, ...args], { stdio: "inherit" });
    process.exit(result.status ?? 1);
}
await import("./run-cli.js");
//# sourceMappingURL=cli.js.map