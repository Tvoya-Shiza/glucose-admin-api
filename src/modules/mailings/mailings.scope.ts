import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * MAILING_SCOPE_RULES — Phase 8 D-19.
 *
 * v1: mailings are admin-only (send + history). Curator/teacher default-denied
 * via `id: { in: [] }`. If Phase 9+ surfaces curator-mailing flows, narrow here.
 *
 * Send actions are also @Roles('admin')-gated at the controller layer.
 */
export const MAILING_SCOPE_RULES: ScopeRules = {
    curator: () => ({ id: { in: [] as bigint[] } }),
    teacher: () => ({ id: { in: [] as bigint[] } }),
};
