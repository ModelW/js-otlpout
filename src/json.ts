/** Line-delimited JSON output. */

import type { Writable } from "node:stream";

/** Serialize one OTLP envelope to a single JSON line (no trailing newline). */
export function dumps(value: unknown): string {
    return JSON.stringify(value);
}

/** Write line-delimited JSON to a stream, defaulting to `stdout` at write time. */
export class LineWriter {
    private readonly stream?: Writable;

    constructor(stream?: Writable) {
        this.stream = stream;
    }

    /** Write one line, terminating it with a newline. */
    writeLine(line: string): void {
        const target = this.stream ?? process.stdout;
        target.write(line.endsWith("\n") ? line : `${line}\n`);
    }
}
