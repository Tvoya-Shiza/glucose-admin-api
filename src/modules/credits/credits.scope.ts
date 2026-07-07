import { ForbiddenException } from '@nestjs/common';
import type { ScopeActor, ScopeRules } from '../../common/scoping/scope.types';

/**
 * Credits («Зачёт») data-visibility rules (contract §scoping, Phase 34).
 *
 *   CREDIT_SCOPE_RULES         → Credit rows (list/detail/mutations/launch wizard)
 *   CREDIT_SESSION_SCOPE_RULES → CreditSession rows (conduct console reads)
 *
 *   admin   → omitted → buildScopeWhere returns {} → sees all
 *   curator → narrows to credits of the groups the actor supervises
 *   teacher → FAIL-CLOSED (impossible predicate) — teachers have no credits surface
 *
 * The question bank + topics tree are shared content — NO scope rules there
 * (permission gating via credits.view / credits.questions_manage only).
 *
 * Conduct WRITE ownership is stricter than visibility: any curator of the group
 * may VIEW a session, but only the launch owner (launch.curator_id) may mutate
 * it — enforced in-service via assertLaunchOwnership below.
 */
export const CREDIT_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({ group: { supervisor_id: actor.id } }),
    // teacher → fail-closed: impossible predicate returns zero rows.
    teacher: () => ({ id: { in: [] as bigint[] } }),
};

export const CREDIT_SESSION_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({ credit: { group: { supervisor_id: actor.id } } }),
    teacher: () => ({ id: { in: [] as bigint[] } }),
};

/**
 * Conduct-mutation ownership (contract §conduct): non-admin actors must own the
 * launch (launch.curator_id === actor.id). Admin may everything.
 */
export function assertLaunchOwnership(actor: ScopeActor, launchCuratorId: number): void {
    if (actor.role_name === 'admin') return;
    if (launchCuratorId !== actor.id) {
        throw new ForbiddenException({ code: 'credits.not_launch_owner', message: 'credits.not_launch_owner' });
    }
}
