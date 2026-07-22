import { getParser } from "./parse-events";
// Output caps (design D5): exceeding any cap fails the run with a
// "produced too much output" error instead of growing memory without bound.
export const MAX_LINE_CHARS = 1_000_000;
export const MAX_STDOUT_CHARS = 10_000_000;
export const MAX_STDERR_CHARS = 2_000_000;
export const STDERR_EXCERPT_CHARS = 2000;
// Grace period between SIGTERM and SIGKILL when terminating a hung delegate.
export const KILL_GRACE_MS = 2000;
// After process exit, pipes are drained for at most this long. A grandchild
// holding a pipe open must not hang a finished run (design D5).
export const DRAIN_GRACE_MS = 5000;
async function* readLines(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, newlineIndex);
                if (line.length > MAX_LINE_CHARS) {
                    throw new Error(`a single output line exceeded ${MAX_LINE_CHARS} characters`);
                }
                yield line;
                buffer = buffer.slice(newlineIndex + 1);
            }
            if (buffer.length > MAX_LINE_CHARS) {
                throw new Error(`a single output line exceeded ${MAX_LINE_CHARS} characters`);
            }
        }
        if (buffer.length > 0)
            yield buffer;
    }
    finally {
        reader.releaseLock();
    }
}
export const defaultSpawn = (binary, args, options) => {
    const proc = Bun.spawn([binary, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        // Own process group on POSIX so timeout/cancellation can kill the whole
        // tree with one group signal; Windows uses taskkill /T in killTree below.
        ...(process.platform === "win32" ? {} : { detached: true }),
        ...(options?.cwd ? { cwd: options.cwd } : {}),
    });
    const killTree = (signal = "SIGTERM") => {
        if (process.platform === "win32") {
            Bun.spawnSync(["taskkill", "/pid", String(proc.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])]);
            return;
        }
        try {
            process.kill(-proc.pid, signal);
        }
        catch {
            try {
                proc.kill(signal);
            }
            catch { }
        }
    };
    return { stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited, kill: (signal) => proc.kill(signal), killTree };
};
export async function runDelegate(options) {
    const spawn = options.spawn ?? defaultSpawn;
    const child = spawn(options.binary, options.args, options.cwd ? { cwd: options.cwd } : undefined);
    const parseLine = getParser(options.parser);
    let finalText = "";
    let externalId;
    let stderrText = "";
    let stdoutChars = 0;
    let timedOut = false;
    let cancelled = false;
    let capError;
    const killTree = (signal) => {
        if (child.killTree)
            child.killTree(signal);
        else
            child.kill(signal);
    };
    let killTimer;
    const terminateChild = () => {
        killTree("SIGTERM");
        killTimer = setTimeout(() => killTree("SIGKILL"), options.killGraceMs ?? KILL_GRACE_MS);
    };
    const onAbort = () => {
        cancelled = true;
        terminateChild();
    };
    if (options.signal) {
        if (options.signal.aborted)
            onAbort();
        else
            options.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            terminateChild();
        }, options.timeoutMs)
        : undefined;
    const stdoutTask = (async () => {
        try {
            for await (const line of readLines(child.stdout)) {
                stdoutChars += line.length;
                if (stdoutChars > MAX_STDOUT_CHARS) {
                    throw new Error(`stdout exceeded ${MAX_STDOUT_CHARS} characters`);
                }
                if (!line.trim())
                    continue;
                const parsed = parseLine(line);
                if (parsed.externalId)
                    externalId = parsed.externalId;
                if (parsed.finalText !== undefined) {
                    finalText = parsed.appendFinalText && finalText ? `${finalText}\n${parsed.finalText}` : parsed.finalText;
                }
                if (parsed.progressText)
                    options.onProgress(parsed.progressText);
            }
        }
        catch (err) {
            capError = `${options.binary} produced too much output: ${err instanceof Error ? err.message : String(err)}`;
            terminateChild();
        }
    })();
    const stderrTask = (async () => {
        try {
            for await (const line of readLines(child.stderr)) {
                if (stderrText.length + line.length > MAX_STDERR_CHARS) {
                    throw new Error(`stderr exceeded ${MAX_STDERR_CHARS} characters`);
                }
                stderrText += line + "\n";
            }
        }
        catch (err) {
            capError = `${options.binary} produced too much output: ${err instanceof Error ? err.message : String(err)}`;
            terminateChild();
        }
    })();
    // The source of truth for "the run is over" is process exit, not stream
    // EOF — grandchildren holding pipes open must not hang the run.
    const exitCode = await child.exited;
    if (timer)
        clearTimeout(timer);
    if (killTimer)
        clearTimeout(killTimer);
    options.signal?.removeEventListener("abort", onAbort);
    // Drain whatever the pipes still hold after exit, but never longer than
    // the grace period.
    await Promise.race([
        Promise.all([stdoutTask, stderrTask]),
        new Promise((resolve) => setTimeout(resolve, options.drainGraceMs ?? DRAIN_GRACE_MS)),
    ]);
    if (cancelled) {
        throw new Error(`${options.binary} cancelled by user`);
    }
    if (timedOut) {
        throw new Error(`${options.binary} timed out after ${options.timeoutMs}ms`);
    }
    if (capError) {
        throw new Error(capError);
    }
    // A non-zero exit is a failure even when final text was produced (D5).
    if (exitCode !== 0) {
        throw new Error(`${options.binary} exited with code ${exitCode}: ${stderrText.slice(0, STDERR_EXCERPT_CHARS)}`);
    }
    return { finalText, externalId, stderrText };
}
//# sourceMappingURL=run-delegate.js.map