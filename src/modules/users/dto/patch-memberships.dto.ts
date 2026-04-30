import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, IsOptional, Min } from 'class-validator';

/**
 * USR-08 — PATCH /:id/memberships DTO. Supports add + remove arrays in a single call.
 *
 * Curator: server validates that every `add` group_id has `Group.supervisor_id === actor.id`
 * before write (T-03-22). Admin passthrough; teacher is denied at the controller level
 * (only admin/curator can mutate memberships).
 */
export class PatchMembershipsDto {
    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    add?: number[];

    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    remove?: number[];
}
