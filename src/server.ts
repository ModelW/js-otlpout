/**
 * Request-span capture from the Node HTTP layer.
 *
 * `beforeSendSpan` (and integration `processSpan`/`processSegmentSpan`) only run
 * for traces Sentry actually records — i.e. with a DSN and a sampled trace — so
 * hanging the access log on it means a sampling change silently drops every
 * `resourceSpans`. Instead this integration subscribes to the client's
 * `httpServerRequest` event, which the Node HTTP integration emits for every
 * inbound request **regardless of trace sampling**, and emits one server span
 * per request.
 *
 * A DSN is still required: without one the SDK never sets up the HTTP
 * integration, so no `httpServerRequest` is emitted.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Integration } from "@sentry/core";

import { attributes } from "./attributes.js";
import { httpAttributes } from "./http.js";
import type { OtlpOut } from "./integration.js";
import { clientAddress } from "./ip.js";
import type { Span, TraceEnvelope } from "./otlp.js";
import { buildResource } from "./resource.js";
import { otlpStatus } from "./status.js";
import { toUnixNano } from "./time.js";

/** Everything the OTLP server span needs, decoupled from the Sentry types. */
export interface ServerRequestInput {
    method: string;
    /** Absolute URL or request target, as Sentry normalised it. */
    url: string;
    headers: Record<string, string | string[] | undefined>;
    /** The HTTP version, e.g. `"1.1"` (from `request.httpVersion`). */
    protocolVersion?: string | undefined;
    statusCode: number;
    responseHeaders?: Record<string, unknown> | undefined;
    startedAt: Date;
    finishedAt: Date;
}

function randomTraceId(): string {
    return randomBytes(16).toString("hex");
}

function randomSpanId(): string {
    return randomBytes(8).toString("hex");
}

/** Default id factory: random 16-byte trace ids and 8-byte span ids. */
export function randomIds(): { traceId: string; spanId: string } {
    return { traceId: randomTraceId(), spanId: randomSpanId() };
}

/** Build the OTLP `resourceSpans` envelope for one inbound server request. */
export function serverRequestToOtlp(
    input: ServerRequestInput,
    adapter: OtlpOut,
): TraceEnvelope {
    const event = {
        request: {
            url: input.url,
            method: input.method,
            headers: input.headers,
        },
        contexts: {
            response: {
                status_code: input.statusCode,
                headers: input.responseHeaders,
            },
        },
    } as never;

    const attrs: Record<string, unknown> = { ...httpAttributes(event) };
    const address = clientAddress(event, adapter.ipPrecedence);
    if (address) {
        attrs["client.address"] = address;
    }
    if (input.protocolVersion) {
        attrs["network.protocol.version"] = input.protocolVersion;
    }
    attrs["sentry.op"] = "http.server";

    const path =
        typeof attrs["url.path"] === "string" ? attrs["url.path"] : "/";
    const { traceId, spanId } = adapter.idFactory();
    const span: Span = {
        traceId,
        spanId,
        name: `${input.method || "GET"} ${path}`,
        kind: 2, // SERVER
        startTimeUnixNano: toUnixNano(input.startedAt),
        endTimeUnixNano: toUnixNano(input.finishedAt),
        attributes: attributes(attrs),
        status: otlpStatus(input.statusCode >= 500 ? "internal_error" : "ok"),
    };

    return {
        resourceSpans: [
            {
                resource: buildResource(adapter),
                scopeSpans: [
                    { scope: { name: "sentry.transaction" }, spans: [span] },
                ],
            },
        ],
    };
}

/**
 * A Sentry integration that mirrors every inbound request as an OTLP server
 * span, independent of `tracesSampleRate`.
 */
export function otlpOutIntegration(adapter: OtlpOut): Integration {
    return {
        name: "OtlpOut",
        setup(client: unknown): void {
            const httpClient = client as {
                on: (
                    event: string,
                    listener: (
                        request: IncomingMessage,
                        response: ServerResponse,
                        normalizedRequest: {
                            url?: string;
                            method?: string;
                            headers?: Record<string, string>;
                        },
                    ) => void,
                ) => void;
            };

            httpClient.on(
                "httpServerRequest",
                (request, response, normalizedRequest) => {
                    const startedAt = new Date();

                    response.on("finish", () => {
                        adapter.emitRequest({
                            method: (
                                normalizedRequest.method ??
                                request.method ??
                                "GET"
                            ).toUpperCase(),
                            url: normalizedRequest.url ?? request.url ?? "/",
                            headers:
                                normalizedRequest.headers ??
                                (request.headers as never),
                            protocolVersion: request.httpVersion,
                            statusCode: response.statusCode,
                            responseHeaders: response.getHeaders() as Record<
                                string,
                                unknown
                            >,
                            startedAt,
                            finishedAt: new Date(),
                        });
                    });
                },
            );
        },
    } as Integration;
}
