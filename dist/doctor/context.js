import { homedir } from "os";
export function makeContext(overrides = {}) {
    return {
        cwd: process.cwd(),
        homeDir: homedir(),
        pathEnv: process.env.PATH ?? "",
        ...overrides,
    };
}
//# sourceMappingURL=context.js.map