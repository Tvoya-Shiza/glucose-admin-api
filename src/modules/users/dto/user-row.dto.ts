/**
 * Response shapes for the users-list + detail-row payloads.
 *
 * These are NOT inbound DTOs — they're the canonical TypeScript shape for what
 * admin-api returns. The admin-client mirrors them in `src/lib/users/types.ts`.
 *
 * BigInt note: User.id in this Prisma schema is `Int`, not `BigInt`, so plain
 * `number` is safe here. If the column ever migrates to BigInt, the
 * `BigIntStringInterceptor` will serialize as string and the admin-client
 * mirror types must switch to `string`.
 */
export class UserRowDto {
    id!: number;
    full_name!: string | null;
    email!: string | null;
    mobile!: string | null;
    role_id!: number;
    role_name!: string;
    status!: 'active' | 'inactive' | 'pending';
    group_count!: number;
    last_activity!: number | null;
    created_at!: number;
}

export class UserListResponseDto {
    rows!: UserRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
    next_cursor!: string | null;
}
