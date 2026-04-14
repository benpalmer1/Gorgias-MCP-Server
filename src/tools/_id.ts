import { z } from "zod";

/**
 * Shared ID schema for resource identifiers across Gorgias tool
 * definitions. Uses `z.coerce.number()` so that LLM clients which emit
 * numeric arguments as JSON strings (e.g. `"12345"`) are accepted.
 *
 * `.int()` alone accepts 0, so the `.min(1)` floor is load-bearing.
 */
export const idSchema = z.coerce.number().int().min(1);

/**
 * Sentinel-allowing variant. Only used where the Gorgias API treats
 * `id=0` (or `id=null`) as a meaningful sentinel value:
 *
 *   - users.ts: get_user/update_user id=0 -> authenticated user
 *   - views.ts: search_view_items view_id=0 -> inline query
 *   - tickets.ts: assignee_user.id/assignee_team.id 0/null -> unassign
 */
export const idOrZeroSchema = z.coerce.number().int().min(0);

/**
 * Shared cursor schema with a max-length bound to prevent oversized
 * query strings from confused or malicious LLM callers.
 */
export const cursorSchema = z.string().max(512);
