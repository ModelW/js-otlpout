/** Trace/span id normalisation for the OTLP payloads. */

const TRACE_ID = /^[0-9a-f]{32}$/i;
const SPAN_ID = /^[0-9a-f]{16}$/i;

export const ZERO_TRACE_ID = "0".repeat(32);
export const ZERO_SPAN_ID = "0".repeat(16);

/** Return a valid 32-hex trace id, or the all-zero id. */
export function traceId(value: string | undefined): string {
    return typeof value === "string" && TRACE_ID.test(value)
        ? value.toLowerCase()
        : ZERO_TRACE_ID;
}

/** Return a valid 16-hex span id, or the all-zero id. */
export function spanId(value: string | undefined): string {
    return typeof value === "string" && SPAN_ID.test(value)
        ? value.toLowerCase()
        : ZERO_SPAN_ID;
}

/** Return a span id, or `undefined` for an empty/absent one. */
export function optionalSpanId(value: string | undefined): string | undefined {
    const id = spanId(value);
    return id === ZERO_SPAN_ID ? undefined : id;
}

/** Return a trace id, or `undefined` for an empty/absent one. */
export function optionalTraceId(value: string | undefined): string | undefined {
    const id = traceId(value);
    return id === ZERO_TRACE_ID ? undefined : id;
}
