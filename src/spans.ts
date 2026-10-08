/**
 * Convert Sentry transaction events into OTLP `resourceSpans` payloads.
 *
 * Only the spans selected by the filter are emitted — by default HTTP spans,
 * which in practice means the `http.server` transaction root an access-log
 * consumer needs. Sentry keeps the full span tree, so child spans are not
 * duplicated here (which also keeps records under the container log-line limit).
 */

import type { Event, SpanJSON, TransactionEvent } from "@sentry/core";

import { attributes, conformValue } from "./attributes.js";
import { httpAttributes } from "./http.js";
import { optionalSpanId, spanId, traceId, ZERO_TRACE_ID } from "./ids.js";
import type { OtlpOut } from "./integration.js";
import { clientAddress } from "./ip.js";
import type { Span, TraceEnvelope } from "./otlp.js";
import { buildResource } from "./resource.js";
import { otlpStatus } from "./status.js";
import { toUnixNano } from "./time.js";

const ROOT_SCOPE = "sentry.transaction";
const CHILD_SCOPE = "sentry.span";

/** Predicate deciding whether a span (by its Sentry operation) is emitted. */
export type SpanFilter = (op: string | undefined) => boolean;

/** Default span filter: keep only HTTP spans (`http.server`/`http.client`). */
export function keepHttpSpans(op: string | undefined): boolean {
    return String(op ?? "")
        .toLowerCase()
        .startsWith("http");
}

/** Attributes kept when an oversized record is reduced to fit the line budget. */
export const CORE_ATTRIBUTE_KEYS = new Set([
    "sentry.op",
    "sentry.origin",
    "sentry.transaction",
    "http.request.method",
    "url.path",
    "url.full",
    "url.query",
    "url.scheme",
    "server.address",
    "server.port",
    "network.protocol.version",
    "http.response.status_code",
    "http.response.body.size",
    "error.type",
    "user_agent.original",
    "http.request.header.referer",
    "client.address",
]);

function spanKind(op: string | undefined): number {
    const value = String(op ?? "").toLowerCase();
    if (value.startsWith("http.server") || value.startsWith("server")) {
        return 2; // SERVER
    }
    if (value.startsWith("http.client") || value.startsWith("http")) {
        return 3; // CLIENT
    }
    if (
        value.startsWith("db") ||
        value.startsWith("cache") ||
        value.startsWith("rpc")
    ) {
        return 3; // CLIENT
    }
    if (
        value.startsWith("queue") ||
        value.startsWith("producer") ||
        value.startsWith("publish")
    ) {
        return 4; // PRODUCER
    }
    if (value.startsWith("consumer") || value.startsWith("receive")) {
        return 5; // CONSUMER
    }
    return 1; // INTERNAL
}

function structuralAttributes(
    source: Record<string, any>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (source["op"]) {
        result["sentry.op"] = source["op"];
    }
    if (source["origin"]) {
        result["sentry.origin"] = source["origin"];
    }
    for (const [key, value] of Object.entries(source["data"] ?? {})) {
        result[key] = conformValue(key, value);
    }
    return result;
}

function tagAttributes(tags: Event["tags"]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(tags ?? {})) {
        result[key] = conformValue(key, value);
    }
    return result;
}

interface BuildSpanInput {
    trace: string;
    span: string;
    parent?: string | undefined;
    name: string;
    kind: number;
    start: number | undefined;
    end: number | undefined;
    status: string | undefined;
    attrs: Record<string, unknown>;
}

function buildSpan(input: BuildSpanInput): Span {
    const result: Span = {
        traceId: input.trace,
        spanId: input.span,
        name: input.name || "span",
        kind: input.kind,
    };
    const start = toUnixNano(input.start);
    const end = toUnixNano(input.end);
    if (start !== undefined) {
        result.startTimeUnixNano = start;
    }
    if (end !== undefined) {
        result.endTimeUnixNano = end;
    }
    result.attributes = attributes(input.attrs);
    result.status = otlpStatus(input.status);
    if (input.parent) {
        result.parentSpanId = input.parent;
    }
    return result;
}

/**
 * Convert a Sentry transaction (root span + children) to a `resourceSpans`
 * envelope. Returns `undefined` when nothing survives the span filter.
 */
export function transactionToOtlp(
    event: TransactionEvent,
    adapter: OtlpOut,
): TraceEnvelope | undefined {
    const contexts = (event.contexts ?? {}) as Record<string, any>;
    const trace = (contexts.trace ?? {}) as Record<string, any>;
    const rootTrace = traceId(trace["trace_id"]);
    const rootSpan = spanId(trace["span_id"]);

    const scopeSpans: TraceEnvelope["resourceSpans"][number]["scopeSpans"] = [];

    if (adapter.spanFilter(trace["op"])) {
        const rootAttributes: Record<string, unknown> = {
            ...structuralAttributes(trace),
            ...tagAttributes(event.tags),
            ...httpAttributes(event),
        };
        const address = clientAddress(event, adapter.ipPrecedence);
        if (address) {
            rootAttributes["client.address"] = address;
        }
        if (event.transaction) {
            rootAttributes["sentry.transaction"] = event.transaction;
        }
        scopeSpans.push({
            scope: { name: ROOT_SCOPE },
            spans: [
                buildSpan({
                    trace: rootTrace,
                    span: rootSpan,
                    parent: optionalSpanId(trace["parent_span_id"]),
                    name:
                        event.transaction ??
                        trace["description"] ??
                        "transaction",
                    kind: spanKind(trace["op"]),
                    start: event.start_timestamp,
                    end: event.timestamp,
                    status: trace["status"],
                    attrs: rootAttributes,
                }),
            ],
        });
    }

    const children: Span[] = [];
    for (const child of (event.spans ?? []) as SpanJSON[]) {
        if (!adapter.spanFilter(child.op)) {
            continue;
        }
        const childTrace = traceId(child.trace_id);
        children.push(
            buildSpan({
                trace: childTrace === ZERO_TRACE_ID ? rootTrace : childTrace,
                span: spanId(child.span_id),
                parent: optionalSpanId(child.parent_span_id) ?? rootSpan,
                name: String(child.description ?? child.op ?? "span"),
                kind: spanKind(child.op),
                start: child.start_timestamp,
                end: child.timestamp,
                status: child.status,
                attrs: structuralAttributes(child as Record<string, any>),
            }),
        );
    }
    if (children.length > 0) {
        scopeSpans.push({ scope: { name: CHILD_SCOPE }, spans: children });
    }

    if (scopeSpans.length === 0) {
        return undefined;
    }

    return {
        resourceSpans: [
            { resource: buildResource(adapter, event), scopeSpans },
        ],
    };
}

/** Strip an envelope down so an oversized record can still be emitted. */
export function reduceEnvelope(envelope: TraceEnvelope): TraceEnvelope {
    for (const resourceSpans of envelope.resourceSpans) {
        for (const scopeSpans of resourceSpans.scopeSpans) {
            for (const span of scopeSpans.spans) {
                span.attributes = (span.attributes ?? []).filter((item) =>
                    CORE_ATTRIBUTE_KEYS.has(item.key),
                );
            }
        }
    }
    return envelope;
}
