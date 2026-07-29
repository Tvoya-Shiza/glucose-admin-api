/**
 * Phase 33 — admin-side helpers for the lesson/module group whitelist
 * (`lesson_access_restrictions`). Read side resolves per-node `allowed_group_ids`
 * for the course-detail payload (lesson editor + schedule-grid indicator); write
 * side diffs a desired group set against the existing rows.
 *
 * Polymorphic addressing mirrors `lesson_schedule_items`:
 *   - kind='lesson'                  → ref_id = WebinarChapter.id (module)
 *   - kind ∈ quiz | assignment | file → ref_id = the resource id (lesson)
 */

export type RestrictionKind = 'lesson' | 'quiz' | 'assignment' | 'file';

/** WebinarChapterItem.type → item-level restriction kind (file covers session/text_lesson). */
export function itemTypeToRestrictionKind(type: string): Exclude<RestrictionKind, 'lesson'> {
    if (type === 'quiz') return 'quiz';
    if (type === 'assignment') return 'assignment';
    return 'file';
}

export interface NodeKey {
    kind: RestrictionKind;
    ref_id: number;
}

export function nodeKey(kind: RestrictionKind, refId: number): string {
    return `${kind}:${refId}`;
}

/**
 * Loads the whitelisted group ids per node for the given (kind, ref_id) keys.
 * `db` is a PrismaService or a $transaction client. Returns a map keyed by
 * `${kind}:${ref_id}`; nodes with no rows are simply absent (caller defaults to []).
 */
export async function loadAllowedGroupsByNode(db: any, keys: NodeKey[]): Promise<Map<string, number[]>> {
    const { groups } = await loadAllowedTargetsByNode(db, keys);
    return groups;
}

/** Персональный доступ (phase-44): ученик + подпись для чипа в форме. */
export interface AllowedUserRef {
    id: number;
    full_name: string | null;
    email: string | null;
}

/**
 * Phase 44 — адресаты узла: группы и поимённо указанные ученики.
 *
 * Читаются одним запросом: форма урока показывает оба списка сразу, и делить
 * это на два похода в базу незачем. Имена учеников подтягиваются здесь же,
 * чтобы чипы в форме не пришлось дозапрашивать по одному.
 */
export async function loadAllowedTargetsByNode(
    db: any,
    keys: NodeKey[],
): Promise<{ groups: Map<string, number[]>; users: Map<string, AllowedUserRef[]> }> {
    const groups = new Map<string, number[]>();
    const users = new Map<string, AllowedUserRef[]>();
    if (keys.length === 0) return { groups, users };

    const rows = await db.lessonAccessRestriction.findMany({
        where: { OR: keys.map((k) => ({ kind: k.kind, ref_id: k.ref_id })) },
        select: {
            kind: true,
            ref_id: true,
            group_id: true,
            user_id: true,
            user: { select: { id: true, full_name: true, email: true } },
        },
    });

    for (const r of rows as Array<{
        kind: RestrictionKind;
        ref_id: number;
        group_id: number | null;
        user_id: number | null;
        user: AllowedUserRef | null;
    }>) {
        const key = nodeKey(r.kind, r.ref_id);
        if (r.group_id != null) {
            const list = groups.get(key) ?? [];
            list.push(r.group_id);
            groups.set(key, list);
        }
        if (r.user_id != null) {
            const list = users.get(key) ?? [];
            list.push(r.user ?? { id: r.user_id, full_name: null, email: null });
            users.set(key, list);
        }
    }
    return { groups, users };
}
