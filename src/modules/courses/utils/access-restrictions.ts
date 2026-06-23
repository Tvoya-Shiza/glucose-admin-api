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
    const out = new Map<string, number[]>();
    if (keys.length === 0) return out;
    const rows = await db.lessonAccessRestriction.findMany({
        where: { OR: keys.map((k) => ({ kind: k.kind, ref_id: k.ref_id })) },
        select: { kind: true, ref_id: true, group_id: true },
    });
    for (const r of rows as Array<{ kind: RestrictionKind; ref_id: number; group_id: number }>) {
        const key = nodeKey(r.kind, r.ref_id);
        const list = out.get(key) ?? [];
        list.push(r.group_id);
        out.set(key, list);
    }
    return out;
}
