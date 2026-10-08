/** Map Sentry span status strings onto the OTLP `Status` message. */

import type { Status } from "./otlp.js";

const UNSET = new Set([undefined, "", "unset"]);

/**
 * Return an OTLP `Status` for a Sentry status string.
 *
 * OTLP only distinguishes UNSET (0), OK (1) and ERROR (2). Every Sentry status
 * other than `ok`/`unset` — the canonical gRPC codes such as `internal_error`
 * or `unavailable` — is an error, and the original string is preserved as the
 * status message.
 */
export function otlpStatus(status: string | undefined | null): Status {
    if (status === undefined || status === null) {
        return { code: 0 };
    }
    const value = String(status).toLowerCase();
    if (UNSET.has(value)) {
        return { code: 0 };
    }
    if (value === "ok") {
        return { code: 1 };
    }
    return { code: 2, message: String(status) };
}
