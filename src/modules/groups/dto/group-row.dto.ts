/**
 * Response shapes for the groups-list payload.
 *
 * These are NOT inbound DTOs — they're the canonical TypeScript shape for what
 * admin-api returns. The admin-client mirrors them in `src/lib/groups/types.ts`.
 *
 * Schema gap: Group has NO `created_at` column (verified against prisma/schema.prisma
 * 2026-04-30). GroupRowDto.created_at is ALWAYS null until the column lands. Sorting
 * by created_at is implemented as `orderBy: { id: order }` since id is autoincrement
 * monotonic.
 */
export interface SupervisorRefDto {
    id: number;
    full_name: string | null;
}

export class GroupRowDto {
    id!: number;
    name!: string;
    status!: 'active' | 'inactive';
    supervisor!: SupervisorRefDto | null;
    member_count!: number;
    created_at!: number | null; // ALWAYS null until schema gains created_at column
}

export class GroupListResponseDto {
    rows!: GroupRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
    next_cursor!: string | null;
}
