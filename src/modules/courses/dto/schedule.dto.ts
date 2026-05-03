import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

/**
 * CRS-08 per-stream schedule payloads.
 *
 * Phase 5 Plan 01 locked contract surface (D-17 / D-18 from CONTEXT).
 *
 * SCHEMA-TRUTH RECONCILIATION:
 *
 *   - WebinarChapterSchedule.id is BigInt (schema line 1146 @db.UnsignedBigInt).
 *     On the wire (admin-api → admin-client) it is serialized as STRING via
 *     BigIntStringInterceptor. Path params accept the string and parse to BigInt.
 *
 *   - WebinarChapterSchedule does NOT have webinar_id or chapter_id columns.
 *     Schedules link via webinar_chapter_item_id ONLY (schema line 1149).
 *     Plan 06 service derives course/chapter scope by joining
 *     WebinarChapterItem → WebinarChapter → Webinar.
 *
 *   - WebinarChapterSchedule.teacher_id is NOT NULL (schema line 1147).
 *     Plan 06 service fills it from the joined Webinar.teacher_id at the
 *     time of create — NOT taken from the request body.
 *
 *   - end_date >= start_date enforced by class-level @ValidateIf (Plan 06
 *     adds a 400 with i18n key admin.courses.schedule.end_before_start).
 *
 *   - Conflict key: (group_id, webinar_chapter_item_id). Schema has NO
 *     @@unique — Plan 06 enforces 409 in service code via find-then-create.
 *
 *   - created_at and updated_at are DateTime (Timestamp) on schema — managed
 *     by Prisma defaults (@default(now()), @updatedAt). NOT in this DTO.
 */

export class ScheduleListQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;
}

export class ScheduleDto {
    /**
     * BigInt on schema, string on the wire. Omit on create; required on update.
     * Validation as integer-string handled at service layer (parse to BigInt).
     */
    @IsOptional()
    id?: string;

    @IsInt()
    @Min(1)
    webinar_chapter_item_id!: number;

    @IsInt()
    @Min(1)
    group_id!: number;

    /** Unix seconds. */
    @IsInt()
    @Min(0)
    start_date!: number;

    /** Unix seconds. Must be >= start_date (class-level guard below). */
    @IsInt()
    @Min(0)
    end_date!: number;

    @IsBoolean()
    is_before_start!: boolean;

    @IsBoolean()
    expiration_check!: boolean;

    /** Class-level guard: end_date must be >= start_date. */
    @ValidateIf((o: ScheduleDto) => typeof o.end_date === 'number' && typeof o.start_date === 'number' && o.end_date < o.start_date)
    @IsInt({ message: 'end_date must be greater than or equal to start_date' })
    private __end_after_start?: number;
}
