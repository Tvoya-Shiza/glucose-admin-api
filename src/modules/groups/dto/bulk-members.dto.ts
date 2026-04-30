import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Min,
} from 'class-validator';

/**
 * D-15 / D-16: bulk add/remove group members.
 *
 *   POST   /admin-api/v1/admin/groups/:id/members  — bulk add
 *   DELETE /admin-api/v1/admin/groups/:id/members  — bulk remove
 *
 * Both endpoints share this DTO. mode discriminates dry-run vs commit (Phase 3 pattern).
 * user_ids is capped at 1000 per call (mirrors Phase 3 Plan 05 cap; T-04-04 mitigation).
 *
 * Audit:
 *   add    -> @Audit('groups.members.add',    'group_user')
 *   remove -> @Audit('groups.members.remove', 'group_user')
 *
 * GroupUser has no @@unique([user_id, group_id]) in schema, so Plan 04 implements
 * idempotency in app code (findMany existing rows -> createMany only the deltas),
 * mirroring Phase 3 Plan 03 users-detail.service.ts patchMemberships.
 */
export class BulkMembersDto {
    @IsIn(['dry_run', 'commit'])
    mode!: 'dry_run' | 'commit';

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(1000)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    user_ids!: number[];

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    confirmed_count?: number;

    @IsOptional()
    @IsString()
    @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'bulk_op_id must be UUIDv4' })
    bulk_op_id?: string;

    @IsOptional()
    @IsString()
    reason?: string;
}

export class BulkMembersResultRowDto {
    row_id!: string; // "<user_id>"
    status!: 'insert' | 'skip' | 'error' | 'remove';
    reason!: string | null;
    user_id!: number;
}

export class BulkMembersResultDto {
    bulk_op_id!: string;
    mode!: 'dry_run' | 'commit';
    affected!: number;
    insert!: number;
    remove!: number;
    skip!: number;
    error!: number;
    rows!: BulkMembersResultRowDto[];
}
