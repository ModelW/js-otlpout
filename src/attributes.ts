/**
 * Conversion of JavaScript values into OTLP `AnyValue` attributes.
 *
 * Attribute names and value types follow the OpenTelemetry semantic
 * conventions; a few keys Sentry surfaces as strings are coerced back to the
 * integer type the registry declares.
 */

import type { AnyValue, KeyValue } from "./otlp.js";

/**
 * Sentry surfaces these as strings although the OTel registry declares them as
 * integers; they are parsed back so the emitted attribute stays type-conformant.
 */
const INTEGER_KEYS = new Set([
    "client.port",
    "http.request.body.size",
    "http.response.body.size",
    "http.response.status_code",
    "http.status_code",
    "server.port",
    "thread.id",
]);

/** Coerce a Sentry value to the type the OTel registry declares for `key`. */
export function conformValue(key: string, value: unknown): unknown {
    if (
        INTEGER_KEYS.has(key) &&
        typeof value === "string" &&
        /^-?\d+$/.test(value.trim())
    ) {
        return Number.parseInt(value, 10);
    }
    return value;
}

/** Encode a JavaScript value as an OTLP `AnyValue`, or `undefined` to skip it. */
export function toAnyValue(value: unknown): AnyValue | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === "boolean") {
        return { boolValue: value };
    }
    if (typeof value === "bigint") {
        return { intValue: value.toString() };
    }
    if (typeof value === "number") {
        if (Number.isInteger(value) && Number.isSafeInteger(value)) {
            return { intValue: value.toString() };
        }
        return { doubleValue: value };
    }
    if (typeof value === "string") {
        return { stringValue: value };
    }
    if (value instanceof Date) {
        return { stringValue: value.toISOString() };
    }
    if (value instanceof Uint8Array) {
        return { bytesValue: Buffer.from(value).toString("base64") };
    }
    if (Array.isArray(value)) {
        const values = value.map(toAnyValue).filter(isPresent);
        return { arrayValue: { values } };
    }
    if (typeof value === "object") {
        const values = Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => keyValue(key, item))
            .filter(isPresent);
        return { kvlistValue: { values } };
    }
    return { stringValue: String(value) };
}

/** Build an OTLP `KeyValue`, or `undefined` when the value is null-ish. */
export function keyValue(key: string, value: unknown): KeyValue | undefined {
    const anyValue = toAnyValue(value);
    if (anyValue === undefined) {
        return undefined;
    }
    return { key, value: anyValue };
}

/** Build an OTLP attribute list from a mapping, dropping null-ish values. */
export function attributes(
    mapping: Record<string, unknown> | undefined,
): KeyValue[] {
    if (!mapping) {
        return [];
    }
    return Object.entries(mapping)
        .map(([key, value]) => keyValue(key, value))
        .filter(isPresent);
}

function isPresent<T>(value: T | undefined): value is T {
    return value !== undefined;
}
