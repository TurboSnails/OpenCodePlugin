#!/usr/bin/env bun
import { runChecks, applyFixes } from "./checks";
import { makeContext } from "./context";
import { formatResults } from "./format";
import { runDelegate } from "../run-delegate";
const fix = process.argv.includes("--fix");
const ctx = makeContext();
const results = await runChecks(ctx, runDelegate);
const final = fix ? applyFixes(results, ctx) : results;
console.log(formatResults(final));
process.exit(final.some((r) => !r.ok) ? 1 : 0);
//# sourceMappingURL=run-cli.js.map