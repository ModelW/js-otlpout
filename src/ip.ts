/**
 * Resolve the originating client address from Sentry's request context.
 *
 * The real client is usually behind a CDN/reverse proxy. The JS SDK already
 * resolves it from a CDN-aware header list into `user.ip_address`; the address
 * is also resolved here from the request headers so a header Sentry did not
 * recognise still wins. There is no socket address on the event (unlike WSGI's
 * `REMOTE_ADDR`), so the headers and `user.ip_address` are the only sources.
 */

import type { Event } from "@sentry/core";

export const DEFAULT_IP_PRECEDENCE: readonly string[] = [
    "do-connecting-ip",
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
];

function normaliseHeaders(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== "object") {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string") {
            result[key.toLowerCase()] = value;
        }
    }
    return result;
}

/** Return the originating client IP, or `undefined` when it cannot be found. */
export function clientAddress(
    event: Event,
    precedence: readonly string[] = DEFAULT_IP_PRECEDENCE,
): string | undefined {
    const headers = normaliseHeaders(event.request?.headers);

    for (const name of precedence) {
        const raw = headers[name];
        if (!raw) {
            continue;
        }
        const value =
            name === "x-forwarded-for"
                ? (raw.split(",")[0] ?? "").trim()
                : raw.trim();
        if (value) {
            return value;
        }
    }

    const forwarded = headers["forwarded"];
    if (forwarded) {
        const match = /for=("?\[?[^;,"]+)/i.exec(forwarded);
        if (match?.[1]) {
            return match[1].replace(/^"|"$/g, "");
        }
    }

    const known = event.user?.ip_address;
    return known ? String(known) : undefined;
}
