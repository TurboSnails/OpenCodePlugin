import { createCliDispatchPlugin } from "./index";
export function createLocalCliDispatchPlugin(configPath, options) {
    if (process.env.CLI_DISPATCH_DEV !== "1") {
        return async () => ({});
    }
    return createCliDispatchPlugin(configPath, options);
}
//# sourceMappingURL=local-plugin.js.map