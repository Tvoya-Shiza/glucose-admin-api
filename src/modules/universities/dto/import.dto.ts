import { Transform, Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * Phase 17 — Excel import DTOs.
 *
 * Wire format: client uploads the .xlsx as multipart `file=...` to
 *   POST /admin-api/v1/admin/universities/import?kind=<kind>&mode=<mode>
 * The server parses the workbook with ExcelJS into `rows`, then runs the same
 * dry-run / commit pipeline used by the JSON DTO path below. The two paths
 * converge in `UniversitiesImportService.run(...)` — see that file for the
 * full classification algorithm.
 *
 * `kind` selects which template the rows match:
 *   • universities      — Universities.xlsx (UNIK + city_id + KK desc + flags)
 *   • specialties       — Specialties.xlsx  (specialty code + university_id + link KK desc)
 *   • admission_stats   — AdmissionStats.xlsx (university_id + specialty_code + year + grants/thresholds)
 *
 * `mode='dry_run'` runs the classifier without writes; `mode='commit'` runs the
 * SAME classifier and then chunk-commits per row.
 */

export type ImportKind = 'universities' | 'specialties' | 'admission_stats';

export class ImportUniversityRowDto {
    @IsString()
    @MaxLength(64)
    row_id!: string;

    @IsString()
    @MaxLength(32)
    unik!: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    city_name?: string;

    @IsOptional() @IsString() @MaxLength(255) website?: string;
    @IsOptional() @IsString() @MaxLength(64) phone?: string;
    @IsOptional() @IsString() @MaxLength(160) email?: string;
    @IsOptional() @IsString() @MaxLength(120) instagram?: string;
    @IsOptional() @IsString() @MaxLength(255) address?: string;

    @IsOptional()
    @IsBoolean()
    has_dormitory?: boolean;

    @IsOptional()
    @IsBoolean()
    has_military_department?: boolean;

    @IsString() @MaxLength(255) title_kk!: string;
    @IsOptional() @IsString() @MaxLength(1024) short_desc_kk?: string;
    @IsOptional() @IsString() @MaxLength(65535) full_desc_kk?: string;
}

export class ImportSpecialtyRowDto {
    @IsString() @MaxLength(64) row_id!: string;

    @IsString() @MaxLength(32) code!: string;
    @IsString() @MaxLength(255) title_kk!: string;

    @IsString() @MaxLength(32) university_unik!: string;

    @IsOptional() @IsBoolean() has_rural_quota?: boolean;
    @IsOptional() @IsString() @MaxLength(1024) short_desc_kk?: string;
    @IsOptional() @IsString() @MaxLength(65535) full_desc_kk?: string;
}

export class ImportAdmissionRowDto {
    @IsString() @MaxLength(64) row_id!: string;

    @IsString() @MaxLength(32) university_unik!: string;
    @IsString() @MaxLength(32) specialty_code!: string;
    @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;

    @IsOptional() @Transform(({ value }) => (value === '' || value === null || value === undefined ? null : Number(value))) @IsInt() @Min(0) grants_count?: number | null;
    @IsOptional() @Transform(({ value }) => (value === '' || value === null || value === undefined ? null : Number(value))) @IsInt() @Min(0) @Max(150) threshold?: number | null;
    @IsOptional() @Transform(({ value }) => (value === '' || value === null || value === undefined ? null : Number(value))) @IsInt() @Min(0) @Max(150) threshold_rural?: number | null;
}

export class ImportJsonDto {
    @IsIn(['universities', 'specialties', 'admission_stats'])
    kind!: ImportKind;

    @IsIn(['dry_run', 'commit'])
    mode!: 'dry_run' | 'commit';

    /** Parsed rows — see *Row DTOs above. Typed as any[] here because the kind
     *  discriminates the row shape at runtime; class-validator @Type wouldn't help
     *  without a discriminated union. Rows are validated per-kind by the service. */
    @ValidateNested({ each: true })
    rows!: Array<ImportUniversityRowDto | ImportSpecialtyRowDto | ImportAdmissionRowDto>;

    @IsOptional() @IsString() bulk_op_id?: string;

    @IsOptional() @Type(() => Number) @IsInt() confirmed_count?: number;
}
