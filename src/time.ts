/**
 * Timestamp helpers: normalise Sentry timestamps to OTLP nanoseconds.
 *
 * Sentry's JavaScript SDK uses epoch **seconds** (a float) for
 * `start_timestamp`/`timestamp`; logs and some integrations use a `Date`. All
 * shapes are accepted and rendered as a decimal string of Unix nanoseconds,
 * which is how OTLP/JSON represents 64-bit integers.
 */

/** Convert a Sentry timestamp to a decimal string of Unix nanoseconds. */
export function toUnixNano(
    value: number | Date | string | undefined | null,
): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (value instanceof Date) {
        const millis = value.getTime();
        if (Number.isNaN(millis)) {
            return undefined;
        }
        const seconds = Math.floor(millis / 1000);
        const nanos = BigInt(millis - seconds * 1000) * 1_000_000n;
        return (BigInt(seconds) * 1_000_000_000n + nanos).toString();
    }

    if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (Number.isNaN(parsed)) {
            return undefined;
        }
        return toUnixNano(new Date(parsed));
    }

    if (!Number.isFinite(value)) {
        return undefined;
    }

    // Split seconds and fraction so the nanoseconds string keeps full precision
    // (Number cannot represent ~1.7e18 exactly).
    const seconds = Math.floor(value);
    const nanos = BigInt(Math.round((value - seconds) * 1e9));
    return (BigInt(seconds) * 1_000_000_000n + nanos).toString();
}
