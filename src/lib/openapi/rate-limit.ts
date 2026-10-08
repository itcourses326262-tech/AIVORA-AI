/** The budget of `GET /openapi.json`, shared by the route and by its own entry in the document. */
export const OPENAPI_RATE_LIMIT = { name: 'openapi', limit: 60, windowSec: 60 } as const;
