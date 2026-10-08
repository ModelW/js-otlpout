import * as Sentry from "@sentry/sveltekit";
import { json, type RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = ({ params }) => {
    Sentry.logger.warn("fetching pet", { petId: params.id });
    return json({ id: params.id, name: "Rex" });
};
