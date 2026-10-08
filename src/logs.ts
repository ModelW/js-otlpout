/**
 * Convert captured errors/messages and Sentry structured logs into OTLP
 * `resourceLogs` payloads.
 *
 * The logger name is recorded as the instrumentation scope name, as the OTel
 * Logs API prescribes.
 */

import type { Event, Log } from "@sentry/core";

import { attributes, conformValue } from "./attributes.js";
import { optionalSpanId, optionalTraceId } from "./ids.js";
import type { OtlpOut } from "./integration.js";
import { clientAddress } from "./ip.js";
import type { LogEnvelope, LogRecord } from "./otlp.js";
import { buildResource } from "./resource.js";
import { CORE_ATTRIBUTE_KEYS } from "./spans.js";
import { toUnixNano } from "./time.js";

const EVENT_SCOPE = "sentry.event";
const LOG_SCOPE = "sentry.log";

const LEVELS: Record<string, [number, string]> = {
    trace: [1, "TRACE"],
    debug: [5, "DEBUG"],
    info: [9, "INFO"],
    warn: [13, "WARN"],
    error: [17, "ERROR"],
    fatal: [21, "FATAL"],
};

/** Severity levels that are mirrored from structured logs (below `error`). */
export const DENIED_LOG_LEVELS = new Set(["error", "fatal"]);

function severityFromLevel(level: string | undefined): [number, string] {
    return LEVELS[String(level ?? "").toLowerCase()] ?? [17, "ERROR"];
}

function eventLogger(event: Event): string {
    return event.logger ?? EVENT_SCOPE;
}

function eventBody(event: Event): string {
    if (event.message) {
        return String(event.message);
    }
    const values = event.exception?.values ?? [];
    const last = values[values.length - 1];
    if (last) {
        return `${last.type ?? "Exception"}: ${last.value ?? ""}`.replace(
            /^: |: $/g,
            "",
        );
    }
    return String(event.transaction ?? "event");
}

function frameSummary(frame: Record<string, any>): string {
    return `${frame["filename"] ?? "?"}:${frame["lineno"] ?? "?"} in ${frame["function"] ?? "?"}`;
}

function eventAttributes(event: Event): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (event.event_id) {
        result["sentry.event_id"] = event.event_id;
    }
    const values = event.exception?.values ?? [];
    const last = values[values.length - 1];
    if (last) {
        if (last.type) {
            result["exception.type"] = last.type;
        }
        if (last.value) {
            result["exception.message"] = last.value;
        }
        const frames = (last.stacktrace?.frames ?? []) as Record<string, any>[];
        if (frames.length > 0) {
            result["exception.stacktrace"] = frames
                .map(frameSummary)
                .join("\n");
        }
    }
    for (const [key, value] of Object.entries(event.tags ?? {})) {
        result[key] ??= conformValue(key, value);
    }
    return result;
}

function envelope(
    adapter: OtlpOut,
    event: Event | undefined,
    scope: string,
    record: LogRecord,
): LogEnvelope {
    return {
        resourceLogs: [
            {
                resource: buildResource(adapter, event),
                scopeLogs: [{ scope: { name: scope }, logRecords: [record] }],
            },
        ],
    };
}

/** Convert a captured Sentry error/message into a `resourceLogs` envelope. */
export function eventToOtlp(event: Event, adapter: OtlpOut): LogEnvelope {
    const contexts = (event.contexts ?? {}) as Record<string, any>;
    const trace = (contexts.trace ?? {}) as Record<string, any>;
    const [severityNumber, severityText] = severityFromLevel(event.level);

    const attrs = eventAttributes(event);
    const address = clientAddress(event, adapter.ipPrecedence);
    if (address) {
        attrs["client.address"] = address;
    }

    const record: LogRecord = {
        timeUnixNano: toUnixNano(event.timestamp),
        severityNumber,
        severityText,
        body: { stringValue: eventBody(event) },
        attributes: attributes(attrs),
    };
    const traceValue = optionalTraceId(trace["trace_id"]);
    const spanValue = optionalSpanId(trace["span_id"]);
    if (traceValue) {
        record.traceId = traceValue;
    }
    if (spanValue) {
        record.spanId = spanValue;
    }

    return envelope(adapter, event, eventLogger(event), record);
}

/** Convert a Sentry structured log into a `resourceLogs` envelope. */
export function logToOtlp(log: Log, adapter: OtlpOut): LogEnvelope {
    const [severityNumber, severityText] = severityFromLevel(log.level);
    const attrs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(log.attributes ?? {})) {
        attrs[key] = conformValue(key, value);
    }

    const record: LogRecord = {
        timeUnixNano: toUnixNano(new Date(adapter.now())),
        severityNumber,
        severityText,
        body: { stringValue: String(log.message) },
        attributes: attributes(attrs),
    };

    return envelope(adapter, undefined, LOG_SCOPE, record);
}

/** Strip a log envelope down so an oversized record can still be emitted. */
export function reduceLogEnvelope(envelope: LogEnvelope): LogEnvelope {
    for (const resourceLogs of envelope.resourceLogs) {
        for (const scopeLogs of resourceLogs.scopeLogs) {
            for (const record of scopeLogs.logRecords) {
                record.attributes = (record.attributes ?? []).filter((item) =>
                    CORE_ATTRIBUTE_KEYS.has(item.key),
                );
                if (
                    record.body &&
                    "stringValue" in record.body &&
                    record.body.stringValue.length > 4096
                ) {
                    record.body.stringValue = record.body.stringValue.slice(
                        0,
                        4096,
                    );
                }
            }
        }
    }
    return envelope;
}
