import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, Min, ValidateNested } from 'class-validator';

/**
 * PUT /admin-api/v1/admin/boards/:id/members — bulk-replace the member roster.
 * Gated by `boards.manage_members` (or board owner).
 *
 * `owner` rows are accepted but the service guarantees at least one owner remains
 * on the board (the creator cannot be demoted by themselves).
 */
export class BoardMemberDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    user_id!: number;

    @IsIn(['owner', 'editor', 'viewer'])
    role!: 'owner' | 'editor' | 'viewer';
}

export class SetBoardMembersDto {
    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => BoardMemberDto)
    members!: BoardMemberDto[];
}
