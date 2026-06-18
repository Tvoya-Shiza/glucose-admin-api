import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * GRP-07 — Excel bulk-import resolution (matching) for group members.
 *
 *   POST /admin-api/v1/admin/groups/:id/members/resolve  — read-only matching
 *
 * The admin-client parses the uploaded .xlsx CLIENT-side (exceljs) into rows of
 * { name?, phone? } where at least one field is filled, and posts them here. The
 * server matches each row against existing learners (User.role_name='user') and
 * returns candidates plus their group membership, WITHOUT mutating anything. The
 * actual add then re-uses the existing POST /:id/members (bulkAdd, dry_run+commit).
 *
 * Matching rules (locked with product):
 *   - Phone is the authoritative key. Stored phones come in mixed formats
 *     (`+77...`, `77...`), so the service derives variants from the normalized
 *     +7XXXXXXXXXX form and queries `mobile IN (variants)`.
 *   - Name: exact match (MySQL utf8mb4_general_ci is case-insensitive) with
 *     whitespace collapsed; we additionally try the reversed word order
 *     ("Имя Фамилия" <-> "Фамилия Имя").
 *   - When both fields are present, phone wins; a disagreeing name is flagged
 *     (`name_mismatch`) rather than rejected.
 *
 * "At least one field per row" is enforced in the service (rows with neither name
 * nor phone are returned with status='invalid') so one bad row never 400s the batch.
 *
 * Audit: this is a read masquerading as POST (body too large for a query string),
 * so the controller carries @SkipAudit — no mutation occurs.
 */
export class ResolveRowInput {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    phone?: string;
}

export class ResolveMembersDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2000)
    @ValidateNested({ each: true })
    @Type(() => ResolveRowInput)
    rows!: ResolveRowInput[];
}

/** A single existing learner that matched (or could match) an imported row. */
export class StudentCandidateDto {
    user_id!: number;
    full_name!: string | null;
    mobile!: string | null;
    email!: string | null;
    status!: 'active' | 'inactive' | 'pending';
    /** Whether the student is already a member of the target group. */
    in_this_group!: boolean;
    /** Every group the student currently belongs to (id + name). */
    groups!: Array<{ id: number; name: string }>;
}

export class ResolveResultRowDto {
    /** 0-based index of the row in the uploaded sheet (data rows only). */
    index!: number;
    input!: { name: string | null; phone: string | null };
    status!: 'matched' | 'ambiguous' | 'unmatched' | 'invalid';
    /** Set only when status='matched'. */
    matched_user_id!: number | null;
    /** True when matched by phone but the supplied name disagrees. */
    name_mismatch!: boolean;
    /** True when this row resolves to a user already matched by an earlier row. */
    duplicate_in_file!: boolean;
    /** Candidates: one for 'matched', many for 'ambiguous', empty otherwise. */
    candidates!: StudentCandidateDto[];
}

export class ResolveMembersResultDto {
    rows!: ResolveResultRowDto[];
}
