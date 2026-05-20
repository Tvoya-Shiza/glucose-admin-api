import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import {
    AdmissionDataRow,
    ExcelTemplateBuilder,
    ParsedRow,
    SpecialtyDataRow,
    UniversityDataRow,
} from './utils/excel-template';

/**
 * Phase 17 — universities/specialties/admission-stats import + template + export service.
 *
 * Three kinds share the same dry-run / commit pipeline:
 *   1. Parse Excel buffer → typed rows (parseUniversities / parseSpecialties / parseAdmissionStats).
 *   2. Normalize + look up FKs in bulk (city_id / university_id / specialty.code).
 *   3. Classify each row as insert / update / skip / error.
 *   4. If mode='commit', write in chunks of TX_CHUNK_SIZE inside prisma.$transaction.
 *      All chunks share one bulk_op_id (AuditInterceptor groups).
 *
 * Idempotent keys:
 *   - universities      → `unik`
 *   - specialties       → `(code)` for the directory, then `(university_id, specialty_id)` for the link
 *   - admission_stats   → `(university_specialty_id, year)` (upsert)
 *
 * Per-row errors are returned in `rows[]` with `status='error'` + `reason`; no throws on the batch.
 */

export type ImportKind = 'universities' | 'specialties' | 'admission_stats';

export interface ImportResultRow {
    row_id: string;
    row_index: number;
    status: 'insert' | 'update' | 'skip' | 'error';
    reason: string | null;
    entity_id: number | null;
}

export interface ImportResult {
    kind: ImportKind;
    bulk_op_id: string;
    mode: 'dry_run' | 'commit';
    affected: number;
    insert: number;
    update: number;
    skip: number;
    error: number;
    rows: ImportResultRow[];
}

interface ImportOpts {
    kind: ImportKind;
    mode: 'dry_run' | 'commit';
    bulk_op_id?: string;
    confirmed_count?: number;
}

@Injectable()
export class UniversitiesImportService {
    private readonly logger = new Logger(UniversitiesImportService.name);
    public static readonly CONFIRM_THRESHOLD = 50;
    public static readonly TX_CHUNK_SIZE = 500;

    private readonly builder = new ExcelTemplateBuilder();

    constructor(private readonly prisma: PrismaService) {}

    // ---------- references for template generation ----------

    public async getCityRefs() {
        const cities: any[] = await this.prisma.region.findMany({
            where: { type: 'city' },
            select: { id: true, translations: { where: { locale: 'kk' }, select: { title: true } } },
            orderBy: { id: 'asc' },
        });
        return cities.map((c) => ({
            id: Number(c.id),
            title_kk: c.translations?.[0]?.title ?? `#${c.id}`,
        }));
    }

    public async getUniversityRefs() {
        const us: any[] = await this.prisma.university.findMany({
            where: { deleted_at: null },
            select: { id: true, unik: true, title_kk: true },
            orderBy: { unik: 'asc' },
        });
        return us.map((u) => ({ id: Number(u.id), unik: u.unik, title_kk: u.title_kk }));
    }

    public async getSpecialtyRefs() {
        const ss: any[] = await this.prisma.specialty.findMany({
            where: { deleted_at: null },
            select: { code: true, title_kk: true },
            orderBy: { code: 'asc' },
        });
        return ss.map((s) => ({ code: s.code, title_kk: s.title_kk }));
    }

    // ---------- template buffers ----------

    public async buildTemplate(kind: ImportKind): Promise<Buffer> {
        if (kind === 'universities') {
            const cities = await this.getCityRefs();
            return this.builder.buildUniversitiesTemplate({ cities, rows: [] });
        }
        if (kind === 'specialties') {
            const universities = await this.getUniversityRefs();
            return this.builder.buildSpecialtiesTemplate({ universities, rows: [] });
        }
        const [universities, specialties] = await Promise.all([this.getUniversityRefs(), this.getSpecialtyRefs()]);
        return this.builder.buildAdmissionStatsTemplate({ universities, specialties, rows: [] });
    }

    // ---------- export buffers (template shape + current rows) ----------

    public async buildExport(kind: ImportKind): Promise<Buffer> {
        if (kind === 'universities') {
            const cities = await this.getCityRefs();
            const cityNameById = new Map(cities.map((c) => [c.id, c.title_kk] as const));
            const all: any[] = await this.prisma.university.findMany({
                where: { deleted_at: null },
                select: {
                    unik: true,
                    city_id: true,
                    website: true,
                    phone: true,
                    email: true,
                    instagram: true,
                    address: true,
                    has_dormitory: true,
                    has_military_department: true,
                    title_kk: true,
                    short_desc_kk: true,
                    full_desc_kk: true,
                },
                orderBy: { unik: 'asc' },
            });
            return this.builder.buildUniversitiesTemplate({
                cities,
                rows: all.map((u) => ({
                    unik: u.unik,
                    city_name: u.city_id === null ? null : cityNameById.get(Number(u.city_id)) ?? null,
                    website: u.website,
                    phone: u.phone,
                    email: u.email,
                    instagram: u.instagram,
                    address: u.address,
                    has_dormitory: u.has_dormitory,
                    has_military_department: u.has_military_department,
                    title_kk: u.title_kk,
                    short_desc_kk: u.short_desc_kk,
                    full_desc_kk: u.full_desc_kk,
                })),
            });
        }
        if (kind === 'specialties') {
            const universities = await this.getUniversityRefs();
            const links: any[] = await this.prisma.universitySpecialty.findMany({
                where: { deleted_at: null },
                select: {
                    has_rural_quota: true,
                    short_desc_kk: true,
                    full_desc_kk: true,
                    university: { select: { unik: true } },
                    specialty: { select: { code: true, title_kk: true } },
                },
                orderBy: [{ specialty: { code: 'asc' } }, { university_id: 'asc' }],
            });
            return this.builder.buildSpecialtiesTemplate({
                universities,
                rows: links.map((l) => ({
                    code: l.specialty?.code,
                    title_kk: l.specialty?.title_kk,
                    university_unik: l.university?.unik ?? '',
                    has_rural_quota: l.has_rural_quota,
                    short_desc_kk: l.short_desc_kk,
                    full_desc_kk: l.full_desc_kk,
                })),
            });
        }
        const [universities, specialties] = await Promise.all([this.getUniversityRefs(), this.getSpecialtyRefs()]);
        const stats: any[] = await this.prisma.admissionStat.findMany({
            select: {
                year: true,
                grants_count: true,
                threshold: true,
                threshold_rural: true,
                link: {
                    select: {
                        university: { select: { unik: true } },
                        specialty: { select: { code: true } },
                    },
                },
            },
            orderBy: [{ year: 'desc' }, { id: 'asc' }],
        });
        return this.builder.buildAdmissionStatsTemplate({
            universities,
            specialties,
            rows: stats.map((s) => ({
                university_unik: s.link?.university?.unik ?? '',
                specialty_code: s.link?.specialty?.code ?? '',
                year: Number(s.year),
                grants_count: s.grants_count,
                threshold: s.threshold,
                threshold_rural: s.threshold_rural,
            })),
        });
    }

    // ---------- import ----------

    public async importFromBuffer(actor: ScopeActor, buf: Buffer, opts: ImportOpts): Promise<ImportResult> {
        if (opts.kind === 'universities') {
            const { rows } = await this.builder.parseUniversities(buf);
            return this.runUniversities(actor, rows, opts);
        }
        if (opts.kind === 'specialties') {
            const { rows } = await this.builder.parseSpecialties(buf);
            return this.runSpecialties(actor, rows, opts);
        }
        const { rows } = await this.builder.parseAdmissionStats(buf);
        return this.runAdmissionStats(actor, rows, opts);
    }

    // ---------- per-kind pipelines ----------

    private async runUniversities(
        actor: ScopeActor,
        rows: ParsedRow<UniversityDataRow>[],
        opts: ImportOpts,
    ): Promise<ImportResult> {
        const bulk_op_id = this.resolveBulkOpId(opts.bulk_op_id);

        // Pre-flight: bulk lookups.
        // city_name → city_id via Region + RegionTranslation (locale='kk' or fallback to 'ru').
        const allCityNames = Array.from(
            new Set(rows.map((r) => r.data.city_name).filter((x): x is string => typeof x === 'string' && x.length > 0)),
        );
        const allUniks = Array.from(new Set(rows.map((r) => r.data.unik).filter(Boolean) as string[]));

        const cityIdByName = new Map<string, number>();
        if (allCityNames.length) {
            const trans: any[] = await this.prisma.regionTranslation.findMany({
                where: {
                    title: { in: allCityNames },
                    region: { type: 'city' },
                },
                select: { title: true, region_id: true, locale: true },
            });
            // Prefer locale='kk' over others on collision (deterministic).
            const sorted = [...trans].sort((a, b) =>
                a.locale === 'kk' && b.locale !== 'kk' ? -1 : a.locale !== 'kk' && b.locale === 'kk' ? 1 : 0,
            );
            for (const t of sorted) {
                if (!cityIdByName.has(t.title)) cityIdByName.set(t.title, Number(t.region_id));
            }
        }

        const existingUnis = allUniks.length
            ? await this.prisma.university.findMany({
                  where: { unik: { in: allUniks }, deleted_at: null },
                  select: { id: true, unik: true },
              })
            : [];
        const idByUnik = new Map(existingUnis.map((u: any) => [u.unik, Number(u.id)]));

        // Classify.
        const out: ImportResultRow[] = [];
        let insert = 0,
            update = 0,
            error = 0;
        const skip = 0;
        const seenUniksInBatch = new Set<string>();

        for (const r of rows) {
            const d = r.data;
            const rowId = `r${r.row_index}`;

            const validation = this.validateUniversityRow(d, cityIdByName);
            if (validation) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: validation, entity_id: null });
                error++;
                continue;
            }
            if (seenUniksInBatch.has(d.unik!)) {
                out.push({
                    row_id: rowId,
                    row_index: r.row_index,
                    status: 'error',
                    reason: 'duplicate_unik_in_batch',
                    entity_id: null,
                });
                error++;
                continue;
            }
            seenUniksInBatch.add(d.unik!);

            const matchedId = idByUnik.get(d.unik!) ?? null;
            if (matchedId) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'update', reason: null, entity_id: matchedId });
                update++;
            } else {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'insert', reason: null, entity_id: null });
                insert++;
            }
        }

        const result: ImportResult = {
            kind: 'universities',
            bulk_op_id,
            mode: opts.mode,
            affected: insert + update,
            insert,
            update,
            skip,
            error,
            rows: out,
        };

        if (opts.mode === 'dry_run') return result;

        this.assertConfirmation(result.affected, opts.confirmed_count);
        if (result.affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < rows.length; i += UniversitiesImportService.TX_CHUNK_SIZE) {
            const sliceEnd = Math.min(i + UniversitiesImportService.TX_CHUNK_SIZE, rows.length);
            await this.prisma
                .$transaction(async (tx) => {
                    for (let j = i; j < sliceEnd; j++) {
                        const r = rows[j];
                        const rr = out[j];
                        if (rr.status !== 'insert' && rr.status !== 'update') continue;
                        const d = r.data;
                        const resolvedCityId = d.city_name ? cityIdByName.get(d.city_name) ?? null : null;
                        try {
                            if (rr.status === 'insert') {
                                const created: any = await tx.university.create({
                                    data: {
                                        unik: d.unik!,
                                        city_id: resolvedCityId,
                                        website: d.website ?? null,
                                        phone: d.phone ?? null,
                                        email: d.email ?? null,
                                        instagram: d.instagram ?? null,
                                        address: d.address ?? null,
                                        has_dormitory: d.has_dormitory ?? false,
                                        has_military_department: d.has_military_department ?? false,
                                        title_kk: d.title_kk!,
                                        short_desc_kk: d.short_desc_kk ?? null,
                                        full_desc_kk: d.full_desc_kk ?? null,
                                        created_at: now,
                                    },
                                    select: { id: true },
                                });
                                rr.entity_id = Number(created.id);
                            } else if (rr.entity_id != null) {
                                await tx.university.update({
                                    where: { id: rr.entity_id },
                                    data: {
                                        city_id: resolvedCityId,
                                        website: d.website ?? undefined,
                                        phone: d.phone ?? undefined,
                                        email: d.email ?? undefined,
                                        instagram: d.instagram ?? undefined,
                                        address: d.address ?? undefined,
                                        has_dormitory: d.has_dormitory ?? undefined,
                                        has_military_department: d.has_military_department ?? undefined,
                                        title_kk: d.title_kk ?? undefined,
                                        short_desc_kk: d.short_desc_kk ?? undefined,
                                        full_desc_kk: d.full_desc_kk ?? undefined,
                                        updated_at: now,
                                    },
                                });
                            }
                        } catch (e: any) {
                            if (e?.code === 'P2002') {
                                rr.status = 'error';
                                rr.reason = 'conflict_runtime';
                                rr.entity_id = null;
                                error++;
                                if (rr.status === 'insert' as any) insert--;
                                else update--;
                                throw e;
                            }
                            throw e;
                        }
                    }
                })
                .catch((e: any) => {
                    this.logger.warn(
                        `import chunk rollback kind=universities bulk_op_id=${bulk_op_id} chunk=${i} err=${e?.message ?? String(e)}`,
                    );
                });
        }

        result.insert = insert;
        result.update = update;
        result.error = error;
        result.affected = insert + update;
        this.logger.log(
            `import committed kind=universities bulk_op_id=${bulk_op_id} actor=${actor.id} role=${actor.role_name} affected=${result.affected}`,
        );
        return result;
    }

    private async runSpecialties(
        actor: ScopeActor,
        rows: ParsedRow<SpecialtyDataRow>[],
        opts: ImportOpts,
    ): Promise<ImportResult> {
        const bulk_op_id = this.resolveBulkOpId(opts.bulk_op_id);

        // Resolve university unik → id in bulk.
        const allUniks = Array.from(
            new Set(rows.map((r) => r.data.university_unik).filter((x): x is string => typeof x === 'string' && x.length > 0)),
        );
        const allCodes = Array.from(new Set(rows.map((r) => r.data.code).filter(Boolean) as string[]));

        const validUnis = allUniks.length
            ? await this.prisma.university.findMany({
                  where: { unik: { in: allUniks }, deleted_at: null },
                  select: { id: true, unik: true },
              })
            : [];
        const uniIdByUnik = new Map(validUnis.map((u: any) => [u.unik, Number(u.id)]));

        const specialties: any[] = allCodes.length
            ? await this.prisma.specialty.findMany({
                  where: { code: { in: allCodes }, deleted_at: null },
                  select: { id: true, code: true },
              })
            : [];
        const specialtyIdByCode = new Map(specialties.map((s: any) => [s.code, Number(s.id)]));

        // Existing links by (university_id, specialty_id).
        const linkKey = (u: number, s: number) => `${u}:${s}`;
        const knownUniIds = Array.from(uniIdByUnik.values());
        const knownSpecialtyIds = new Set<number>(specialties.map((s: any) => Number(s.id)));
        const existingLinks: any[] = knownSpecialtyIds.size && knownUniIds.length
            ? await this.prisma.universitySpecialty.findMany({
                  where: {
                      university_id: { in: knownUniIds },
                      specialty_id: { in: Array.from(knownSpecialtyIds) },
                      deleted_at: null,
                  },
                  select: { id: true, university_id: true, specialty_id: true },
              })
            : [];
        const linkIdByKey = new Map<string, number>(
            existingLinks.map((l: any) => [linkKey(Number(l.university_id), Number(l.specialty_id)), Number(l.id)]),
        );

        // Classify.
        const out: ImportResultRow[] = [];
        let insert = 0,
            update = 0,
            error = 0;
        const skip = 0;

        const seenInBatch = new Set<string>();

        for (const r of rows) {
            const d = r.data;
            const rowId = `r${r.row_index}`;

            const validation = this.validateSpecialtyRow(d, uniIdByUnik);
            if (validation) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: validation, entity_id: null });
                error++;
                continue;
            }

            const uniId = uniIdByUnik.get(d.university_unik!)!;
            const finalKey = `${uniId}:${d.code}`;
            if (seenInBatch.has(finalKey)) {
                out.push({
                    row_id: rowId,
                    row_index: r.row_index,
                    status: 'error',
                    reason: 'duplicate_link_in_batch',
                    entity_id: null,
                });
                error++;
                continue;
            }
            seenInBatch.add(finalKey);

            const sid = specialtyIdByCode.get(d.code!) ?? null;
            if (sid !== null) {
                const lid = linkIdByKey.get(linkKey(uniId, sid)) ?? null;
                if (lid !== null) {
                    out.push({ row_id: rowId, row_index: r.row_index, status: 'update', reason: null, entity_id: lid });
                    update++;
                } else {
                    out.push({ row_id: rowId, row_index: r.row_index, status: 'insert', reason: null, entity_id: null });
                    insert++;
                }
            } else {
                // Specialty will be created during commit — count as insert.
                out.push({ row_id: rowId, row_index: r.row_index, status: 'insert', reason: null, entity_id: null });
                insert++;
            }
        }

        const result: ImportResult = {
            kind: 'specialties',
            bulk_op_id,
            mode: opts.mode,
            affected: insert + update,
            insert,
            update,
            skip,
            error,
            rows: out,
        };

        if (opts.mode === 'dry_run') return result;

        this.assertConfirmation(result.affected, opts.confirmed_count);
        if (result.affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < rows.length; i += UniversitiesImportService.TX_CHUNK_SIZE) {
            const sliceEnd = Math.min(i + UniversitiesImportService.TX_CHUNK_SIZE, rows.length);
            await this.prisma
                .$transaction(async (tx) => {
                    for (let j = i; j < sliceEnd; j++) {
                        const r = rows[j];
                        const rr = out[j];
                        if (rr.status !== 'insert' && rr.status !== 'update') continue;
                        const d = r.data;
                        try {
                            // 1. Upsert Specialty by code (title_kk refreshed).
                            const specialty: any = await tx.specialty.upsert({
                                where: { code: d.code! },
                                create: { code: d.code!, title_kk: d.title_kk!, created_at: now },
                                update: { title_kk: d.title_kk!, updated_at: now },
                                select: { id: true },
                            });

                            // 2. Upsert UniversitySpecialty by (university_id, specialty_id).
                            const uniId = uniIdByUnik.get(d.university_unik!)!;
                            const link: any = await tx.universitySpecialty.upsert({
                                where: {
                                    uniq_university_specialty: {
                                        university_id: uniId,
                                        specialty_id: Number(specialty.id),
                                    },
                                },
                                create: {
                                    university_id: uniId,
                                    specialty_id: Number(specialty.id),
                                    has_rural_quota: d.has_rural_quota ?? false,
                                    short_desc_kk: d.short_desc_kk ?? null,
                                    full_desc_kk: d.full_desc_kk ?? null,
                                    created_at: now,
                                },
                                update: {
                                    has_rural_quota: d.has_rural_quota ?? undefined,
                                    short_desc_kk: d.short_desc_kk ?? undefined,
                                    full_desc_kk: d.full_desc_kk ?? undefined,
                                    deleted_at: null,
                                    updated_at: now,
                                },
                                select: { id: true },
                            });
                            rr.entity_id = Number(link.id);
                        } catch (e: any) {
                            if (e?.code === 'P2002') {
                                rr.status = 'error';
                                rr.reason = 'conflict_runtime';
                                rr.entity_id = null;
                                error++;
                                throw e;
                            }
                            throw e;
                        }
                    }
                })
                .catch((e: any) => {
                    this.logger.warn(
                        `import chunk rollback kind=specialties bulk_op_id=${bulk_op_id} chunk=${i} err=${e?.message ?? String(e)}`,
                    );
                });
        }

        result.error = error;
        return result;
    }

    private async runAdmissionStats(
        actor: ScopeActor,
        rows: ParsedRow<AdmissionDataRow>[],
        opts: ImportOpts,
    ): Promise<ImportResult> {
        const bulk_op_id = this.resolveBulkOpId(opts.bulk_op_id);

        const allUniks = Array.from(
            new Set(rows.map((r) => r.data.university_unik).filter((x): x is string => typeof x === 'string' && x.length > 0)),
        );
        const allCodes = Array.from(new Set(rows.map((r) => r.data.specialty_code).filter(Boolean) as string[]));

        const validUnis = allUniks.length
            ? await this.prisma.university.findMany({
                  where: { unik: { in: allUniks }, deleted_at: null },
                  select: { id: true, unik: true },
              })
            : [];
        const uniIdByUnik = new Map(validUnis.map((u: any) => [u.unik, Number(u.id)]));

        const specialties: any[] = allCodes.length
            ? await this.prisma.specialty.findMany({
                  where: { code: { in: allCodes }, deleted_at: null },
                  select: { id: true, code: true },
              })
            : [];
        const specialtyIdByCode = new Map(specialties.map((s: any) => [s.code, Number(s.id)]));

        // Resolve links (university_id, specialty_id) → link_id.
        const knownUniIds = Array.from(uniIdByUnik.values());
        const knownSpecialtyIds = Array.from(new Set(specialties.map((s: any) => Number(s.id))));
        const links: any[] = knownSpecialtyIds.length && knownUniIds.length
            ? await this.prisma.universitySpecialty.findMany({
                  where: {
                      university_id: { in: knownUniIds },
                      specialty_id: { in: knownSpecialtyIds },
                      deleted_at: null,
                  },
                  select: { id: true, university_id: true, specialty_id: true },
              })
            : [];
        const linkIdByKey = new Map<string, number>(
            links.map((l: any) => [`${Number(l.university_id)}:${Number(l.specialty_id)}`, Number(l.id)]),
        );

        // Existing stats by (us_id, year).
        const linkIds = Array.from(linkIdByKey.values());
        const years = Array.from(new Set(rows.map((r) => r.data.year).filter((x): x is number => typeof x === 'number')));
        const statRows: any[] = linkIds.length && years.length
            ? await this.prisma.admissionStat.findMany({
                  where: { university_specialty_id: { in: linkIds }, year: { in: years } },
                  select: { id: true, university_specialty_id: true, year: true },
              })
            : [];
        const statIdByKey = new Map<string, number>(
            statRows.map((s: any) => [`${Number(s.university_specialty_id)}:${Number(s.year)}`, Number(s.id)]),
        );

        // Classify.
        const out: ImportResultRow[] = [];
        let insert = 0,
            update = 0,
            error = 0;
        const skip = 0;
        const seenInBatch = new Set<string>();

        for (const r of rows) {
            const d = r.data;
            const rowId = `r${r.row_index}`;

            if (!d.university_unik) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: 'university_unik_missing', entity_id: null });
                error++;
                continue;
            }
            const uniId = uniIdByUnik.get(d.university_unik);
            if (!uniId) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: 'university_not_found', entity_id: null });
                error++;
                continue;
            }
            if (!d.specialty_code) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: 'specialty_code_missing', entity_id: null });
                error++;
                continue;
            }
            const sid = specialtyIdByCode.get(d.specialty_code);
            if (!sid) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: 'specialty_not_found', entity_id: null });
                error++;
                continue;
            }
            const linkId = linkIdByKey.get(`${uniId}:${sid}`);
            if (!linkId) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: 'university_specialty_link_not_found', entity_id: null });
                error++;
                continue;
            }
            if (!d.year) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: 'year_missing', entity_id: null });
                error++;
                continue;
            }
            const key = `${linkId}:${d.year}`;
            if (seenInBatch.has(key)) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'error', reason: 'duplicate_year_in_batch', entity_id: null });
                error++;
                continue;
            }
            seenInBatch.add(key);

            const existingId = statIdByKey.get(key);
            if (existingId) {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'update', reason: null, entity_id: existingId });
                update++;
            } else {
                out.push({ row_id: rowId, row_index: r.row_index, status: 'insert', reason: null, entity_id: null });
                insert++;
            }
        }

        const result: ImportResult = {
            kind: 'admission_stats',
            bulk_op_id,
            mode: opts.mode,
            affected: insert + update,
            insert,
            update,
            skip,
            error,
            rows: out,
        };

        if (opts.mode === 'dry_run') return result;

        this.assertConfirmation(result.affected, opts.confirmed_count);
        if (result.affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < rows.length; i += UniversitiesImportService.TX_CHUNK_SIZE) {
            const sliceEnd = Math.min(i + UniversitiesImportService.TX_CHUNK_SIZE, rows.length);
            await this.prisma
                .$transaction(async (tx) => {
                    for (let j = i; j < sliceEnd; j++) {
                        const r = rows[j];
                        const rr = out[j];
                        if (rr.status !== 'insert' && rr.status !== 'update') continue;
                        const d = r.data;
                        const sid = specialtyIdByCode.get(d.specialty_code!)!;
                        const uniId = uniIdByUnik.get(d.university_unik!)!;
                        const linkId = linkIdByKey.get(`${uniId}:${sid}`)!;
                        try {
                            const upserted: any = await tx.admissionStat.upsert({
                                where: {
                                    uniq_admission_us_year: {
                                        university_specialty_id: linkId,
                                        year: d.year!,
                                    },
                                },
                                create: {
                                    university_specialty_id: linkId,
                                    year: d.year!,
                                    grants_count: d.grants_count ?? null,
                                    threshold: d.threshold ?? null,
                                    threshold_rural: d.threshold_rural ?? null,
                                    created_at: now,
                                },
                                update: {
                                    grants_count: d.grants_count ?? undefined,
                                    threshold: d.threshold ?? undefined,
                                    threshold_rural: d.threshold_rural ?? undefined,
                                    updated_at: now,
                                },
                                select: { id: true },
                            });
                            rr.entity_id = Number(upserted.id);
                        } catch (e: any) {
                            if (e?.code === 'P2002') {
                                rr.status = 'error';
                                rr.reason = 'conflict_runtime';
                                rr.entity_id = null;
                                error++;
                                throw e;
                            }
                            throw e;
                        }
                    }
                })
                .catch((e: any) => {
                    this.logger.warn(
                        `import chunk rollback kind=admission_stats bulk_op_id=${bulk_op_id} chunk=${i} err=${e?.message ?? String(e)}`,
                    );
                });
        }

        result.error = error;
        return result;
    }

    // ---------- helpers ----------

    private resolveBulkOpId(input?: string): string {
        if (input && /^[0-9a-f-]{8,}$/i.test(input)) return input;
        return randomUUID();
    }

    private assertConfirmation(affected: number, confirmedCount?: number): void {
        if (affected > UniversitiesImportService.CONFIRM_THRESHOLD) {
            if (typeof confirmedCount !== 'number' || confirmedCount !== affected) {
                throw new BadRequestException(`confirmation_required:expected_${affected}_got_${confirmedCount ?? 'null'}`);
            }
        }
    }

    private validateUniversityRow(d: UniversityDataRow, cityIdByName: Map<string, number>): string | null {
        if (!d.unik) return 'unik_required';
        if (!/^[A-Za-z0-9._-]+$/.test(d.unik)) return 'unik_invalid_chars';
        if (d.unik.length > 32) return 'unik_too_long';
        if (!d.title_kk) return 'title_kk_required';
        if (d.title_kk.length > 255) return 'title_kk_too_long';
        if (typeof d.city_name === 'string' && d.city_name.length > 0 && !cityIdByName.has(d.city_name)) {
            return 'city_not_found';
        }
        if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'email_invalid';
        return null;
    }

    private validateSpecialtyRow(d: SpecialtyDataRow, uniIdByUnik: Map<string, number>): string | null {
        if (!d.code) return 'code_required';
        if (!/^[A-Za-z0-9._-]+$/.test(d.code)) return 'code_invalid_chars';
        if (!d.title_kk) return 'title_kk_required';
        if (!d.university_unik) return 'university_unik_required';
        if (!uniIdByUnik.has(d.university_unik)) return 'university_not_found';
        return null;
    }
}
