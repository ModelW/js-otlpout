/**
 * Derive OTLP HTTP attributes from Sentry's request and response context.
 *
 * The names and value types follow the OpenTelemetry HTTP semantic conventions
 * for an HTTP **server** span — the required `http.request.method`, `url.path`,
 * `url.scheme`; the conditionally-required `url.query`, `http.response.status_code`
 * and `error.type`; the recommended `client.address`, `network.protocol.version`,
 * `server.address`/`server.port` and `user_agent.original`; and the opt-in
 * request/response headers, emitted as the single-item `string[]` the registry
 * requires. Bespoke spellings such as `http.request.origin` or
 * `http.request.referrer` are deliberately not emitted.
 */

import type { Event } from "@sentry/core";

/** Query parameter names whose values the OTel URL conventions require redacted. */
const SENSITIVE_QUERY_PARAMS = new Set([
    "X-Amz-Signature",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
    "sig",
    "X-Goog-Signature",
]);

/** Header already modelled as `user_agent.original`; not repeated as a header. */
const USER_AGENT = "user-agent";

function normaliseHeaders(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== "object") {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string") {
            result[key.toLowerCase()] = value;
        } else if (typeof value === "number" || typeof value === "boolean") {
            result[key.toLowerCase()] = String(value);
        }
    }
    return result;
}

/** Redact the OTel-sensitive query parameters from a query string. */
export function redactUrlQuery(query: string): string {
    if (!query) {
        return query;
    }
    return query
        .split("&")
        .map((pair) => {
            const separator = pair.indexOf("=");
            if (separator === -1) {
                return pair;
            }
            const key = pair.slice(0, separator);
            return SENSITIVE_QUERY_PARAMS.has(key) ? `${key}=REDACTED` : pair;
        })
        .join("&");
}

function hostWithRedactedCredentials(url: URL): string {
    if (!url.username && !url.password) {
        return url.host;
    }
    return `REDACTED:REDACTED@${url.host}`;
}

/** Return an absolute URL with credentials and sensitive query params redacted. */
export function redactUrlFull(value: string): string {
    const url = new URL(value);
    const path = url.pathname || "/";
    const query = redactUrlQuery(url.search.replace(/^\?/, ""));
    return (
        `${url.protocol}//${hostWithRedactedCredentials(url)}${path}` +
        `${query ? `?${query}` : ""}${url.hash}`
    );
}

function addUrl(result: Record<string, unknown>, url: URL): void {
    const path = url.pathname || "/";
    const query = redactUrlQuery(url.search.replace(/^\?/, ""));
    result["url.full"] =
        `${url.protocol}//${hostWithRedactedCredentials(url)}${path}` +
        `${query ? `?${query}` : ""}${url.hash}`;
    result["url.path"] = path;
    if (query) {
        result["url.query"] = query;
    }
    if (url.protocol) {
        result["url.scheme"] = url.protocol.replace(/:$/, "");
    }
}

function forwardedHost(headers: Record<string, string>): string | undefined {
    const forwarded = headers["forwarded"];
    if (!forwarded) {
        return undefined;
    }
    for (const element of forwarded.split(",")) {
        for (const pair of element.split(";")) {
            const [key, ...rest] = pair.split("=");
            if (key?.trim().toLowerCase() === "host") {
                return rest.join("=").trim().replace(/^"|"$/g, "");
            }
        }
    }
    return undefined;
}

function addServer(
    result: Record<string, unknown>,
    headers: Record<string, string>,
    url: URL,
): void {
    const candidate = forwardedHost(headers) ?? headers["x-forwarded-host"];
    let source: URL;
    try {
        source = candidate ? new URL(`http://${candidate}`) : url;
    } catch {
        source = url;
    }
    if (source.hostname) {
        result["server.address"] = source.hostname;
    }
    if (source.port) {
        result["server.port"] = Number(source.port);
    }
}

function bodySize(
    source: Record<string, unknown>,
    keys: string[],
): number | undefined {
    for (const key of keys) {
        const value = source[key];
        if (value === undefined || value === null) {
            continue;
        }
        const parsed = Number.parseInt(String(value), 10);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

function responseStatus(event: Event): number | undefined {
    const contexts = (event.contexts ?? {}) as Record<string, any>;
    const response = (contexts.response ?? {}) as Record<string, unknown>;
    const data = (contexts.trace?.data ?? {}) as Record<string, unknown>;
    const tags = (event.tags ?? {}) as Record<string, unknown>;
    const status =
        response["status_code"] ??
        data["http.response.status_code"] ??
        tags["http.status_code"];
    if (status === undefined || status === null) {
        return undefined;
    }
    const parsed = Number.parseInt(String(status), 10);
    return Number.isNaN(parsed) ? undefined : parsed;
}

function addHeaders(
    result: Record<string, unknown>,
    headers: Record<string, string>,
    prefix: string,
): void {
    for (const [name, value] of Object.entries(headers)) {
        result[`${prefix}.${name}`] = [value];
    }
}

/** Return the OTLP HTTP semantic-convention attributes for an event. */
export function httpAttributes(event: Event): Record<string, unknown> {
    const request = event.request;
    if (!request) {
        return {};
    }

    const result: Record<string, unknown> = {};
    const headers = normaliseHeaders(request.headers);
    let url: URL | undefined;
    try {
        url = request.url ? new URL(request.url) : undefined;
    } catch {
        url = undefined;
    }

    if (url) {
        addUrl(result, url);
        addServer(result, headers, url);
    }

    if (request.method) {
        result["http.request.method"] = request.method;
    }

    if (headers[USER_AGENT]) {
        result["user_agent.original"] = headers[USER_AGENT];
    }
    const requestHeaders = { ...headers };
    delete requestHeaders[USER_AGENT];
    addHeaders(result, requestHeaders, "http.request.header");

    const requestSize = bodySize(headers, ["content-length"]);
    if (requestSize !== undefined) {
        result["http.request.body.size"] = requestSize;
    }

    const contexts = (event.contexts ?? {}) as Record<string, any>;
    const response = (contexts.response ?? {}) as Record<string, unknown>;
    const responseHeaders = normaliseHeaders(response["headers"]);

    const status = responseStatus(event);
    if (status !== undefined) {
        result["http.response.status_code"] = status;
        if (status >= 500) {
            result["error.type"] = String(status);
        }
    }

    let responseSize = bodySize(response, ["body_size", "content_length"]);
    if (responseSize === undefined) {
        responseSize = bodySize(responseHeaders, ["content-length"]);
    }
    if (responseSize !== undefined) {
        result["http.response.body.size"] = responseSize;
    }
    addHeaders(result, responseHeaders, "http.response.header");

    return result;
}
