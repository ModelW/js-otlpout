/** js-otlpout — mirror everything Sentry traces to stdout as OTLP/JSON. */

export {
    OtlpOut,
    DEFAULT_MAX_LINE_BYTES,
    type OtlpOutOptions,
} from "./integration.js";
export { keepHttpSpans, type SpanFilter } from "./spans.js";
export type {
    AnyValue,
    Envelope,
    KeyValue,
    LogEnvelope,
    LogRecord,
    Resource,
    ResourceLogs,
    ResourceSpans,
    Scope,
    ScopeLogs,
    ScopeSpans,
    Span,
    Status,
    TraceEnvelope,
} from "./otlp.js";
