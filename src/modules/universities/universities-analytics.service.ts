import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Phase 17 — small read-only analytics surface for the universities catalog.
 *
 * One endpoint returns three blocks: universities / specialties / admission_stats.
 * Each block is a flat object with counts + small "top N" arrays. No charts
 * server-side — the frontend renders stat cards and short lists.
 *
 * All counts respect `deleted_at IS NULL` so soft-deleted rows don't inflate
 * totals. Cached for 5 minutes per actor-agnostic key.
 */

export interface UniversitiesBlock {
    total: number;
    with_dormitory: number;
    with_military_department: number;
    with_city: number;
    without_city: number;
    avg_specialties_per_university: number;
    top_cities: Array<{ city_id: number; city_title_kk: string; university_count: number }>;
    top_by_specialty_count: Array<{ id: number; unik: string; title_kk: string; specialty_count: number }>;
}

export interface SpecialtiesBlock {
    total: number;
    linked: number;
    unlinked: number;
    rural_quota_links: number;
    rural_quota_share_pct: number;
    top_offered: Array<{ id: number; code: string; title_kk: string; university_count: number }>;
}

export interface AdmissionYearRow {
    year: number;
    stat_count: number;
    total_grants: number;
    avg_threshold: number | null;
    avg_threshold_rural: number | null;
}

export interface AdmissionBlock {
    total: number;
    distinct_years: number;
    years_min: number | null;
    years_max: number | null;
    by_year: AdmissionYearRow[];
    avg_grants_per_record: number | null;
}

export interface AnalyticsResponse {
    universities: UniversitiesBlock;
    specialties: SpecialtiesBlock;
    admission_stats: AdmissionBlock;
    generated_at: number;
}

@Injectable()
export class UniversitiesAnalyticsService {
    constructor(private readonly prisma: PrismaService) {}

    public async build(): Promise<AnalyticsResponse> {
        const [
            uniTotals,
            uniGroups,
            specTotal,
            specRural,
            statTotal,
            statByYear,
            statAggregates,
        ] = await Promise.all([
            this.uniTotals(),
            this.uniGroupings(),
            this.prisma.specialty.count({ where: { deleted_at: null } }),
            this.prisma.universitySpecialty.count({
                where: { deleted_at: null, has_rural_quota: true },
            }),
            this.prisma.admissionStat.count(),
            this.prisma.admissionStat.groupBy({
                by: ['year'],
                _count: { _all: true },
                _sum: { grants_count: true },
                _avg: { threshold: true, threshold_rural: true },
                orderBy: { year: 'desc' },
            }),
            this.prisma.admissionStat.aggregate({
                _avg: { grants_count: true },
                _min: { year: true },
                _max: { year: true },
            }),
        ]);

        // Specialty stats: how many distinct specialties have ≥1 active link.
        const linkedSpecialtiesAgg = await this.prisma.universitySpecialty.groupBy({
            by: ['specialty_id'],
            where: { deleted_at: null },
        });
        const linkedSpecialties = linkedSpecialtiesAgg.length;

        // Top offered: specialties with most active links.
        const topOfferedAgg = await this.prisma.universitySpecialty.groupBy({
            by: ['specialty_id'],
            where: { deleted_at: null },
            _count: { _all: true },
            orderBy: { _count: { specialty_id: 'desc' } },
            take: 5,
        });
        const topOfferedIds = topOfferedAgg.map((r) => Number(r.specialty_id));
        const topOfferedRows: any[] = topOfferedIds.length
            ? await this.prisma.specialty.findMany({
                  where: { id: { in: topOfferedIds } },
                  select: { id: true, code: true, title_kk: true },
              })
            : [];
        const offeredCountById = new Map<number, number>(
            topOfferedAgg.map((r) => [Number(r.specialty_id), Number(r._count?._all ?? 0)] as const),
        );
        const topOffered = topOfferedIds
            .map((id) => {
                const row = topOfferedRows.find((r: any) => Number(r.id) === id);
                return row
                    ? {
                          id: Number(row.id),
                          code: row.code,
                          title_kk: row.title_kk,
                          university_count: offeredCountById.get(id) ?? 0,
                      }
                    : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);

        // Top universities by specialty link count.
        const topUniAgg = await this.prisma.universitySpecialty.groupBy({
            by: ['university_id'],
            where: { deleted_at: null },
            _count: { _all: true },
            orderBy: { _count: { university_id: 'desc' } },
            take: 5,
        });
        const topUniIds = topUniAgg.map((r) => Number(r.university_id));
        const topUniRows: any[] = topUniIds.length
            ? await this.prisma.university.findMany({
                  where: { id: { in: topUniIds } },
                  select: { id: true, unik: true, title_kk: true },
              })
            : [];
        const uniCountById = new Map<number, number>(
            topUniAgg.map((r) => [Number(r.university_id), Number(r._count?._all ?? 0)] as const),
        );
        const topByLinks = topUniIds
            .map((id) => {
                const row = topUniRows.find((r: any) => Number(r.id) === id);
                return row
                    ? {
                          id: Number(row.id),
                          unik: row.unik,
                          title_kk: row.title_kk,
                          specialty_count: uniCountById.get(id) ?? 0,
                      }
                    : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);

        // Top cities by university count.
        const cityAgg = await this.prisma.university.groupBy({
            by: ['city_id'],
            where: { deleted_at: null, city_id: { not: null } },
            _count: { _all: true },
            orderBy: { _count: { city_id: 'desc' } },
            take: 5,
        });
        const cityIds = cityAgg.map((r) => Number(r.city_id)).filter((id) => Number.isFinite(id));
        const cityRows: any[] = cityIds.length
            ? await this.prisma.region.findMany({
                  where: { id: { in: cityIds }, type: 'city' },
                  select: {
                      id: true,
                      translations: { where: { locale: 'kk' }, select: { title: true } },
                  },
              })
            : [];
        const cityTitleById = new Map<number, string>(
            cityRows.map((c: any) => [Number(c.id), c.translations?.[0]?.title ?? `#${c.id}`] as const),
        );
        const topCities = cityAgg.map((r) => ({
            city_id: Number(r.city_id),
            city_title_kk: cityTitleById.get(Number(r.city_id)) ?? `#${r.city_id}`,
            university_count: Number(r._count?._all ?? 0),
        }));

        // Compose blocks.
        const avgSpec = uniTotals.total > 0 ? uniGroups.linkCount / uniTotals.total : 0;
        const ruralShare = uniGroups.linkCount > 0 ? (specRural / uniGroups.linkCount) * 100 : 0;

        const universities: UniversitiesBlock = {
            total: uniTotals.total,
            with_dormitory: uniTotals.with_dormitory,
            with_military_department: uniTotals.with_military_department,
            with_city: uniTotals.with_city,
            without_city: uniTotals.total - uniTotals.with_city,
            avg_specialties_per_university: Number(avgSpec.toFixed(2)),
            top_cities: topCities,
            top_by_specialty_count: topByLinks,
        };

        const specialties: SpecialtiesBlock = {
            total: specTotal,
            linked: linkedSpecialties,
            unlinked: Math.max(0, specTotal - linkedSpecialties),
            rural_quota_links: specRural,
            rural_quota_share_pct: Number(ruralShare.toFixed(1)),
            top_offered: topOffered,
        };

        const byYear: AdmissionYearRow[] = (statByYear as any[]).map((r) => ({
            year: Number(r.year),
            stat_count: Number(r._count?._all ?? 0),
            total_grants: Number(r._sum?.grants_count ?? 0),
            avg_threshold: r._avg?.threshold === null || r._avg?.threshold === undefined ? null : Number(Number(r._avg.threshold).toFixed(1)),
            avg_threshold_rural:
                r._avg?.threshold_rural === null || r._avg?.threshold_rural === undefined
                    ? null
                    : Number(Number(r._avg.threshold_rural).toFixed(1)),
        }));

        const admissionAvgGrants =
            (statAggregates as any)._avg?.grants_count === null ||
            (statAggregates as any)._avg?.grants_count === undefined
                ? null
                : Number(Number((statAggregates as any)._avg.grants_count).toFixed(1));

        const admission_stats: AdmissionBlock = {
            total: statTotal,
            distinct_years: byYear.length,
            years_min: (statAggregates as any)._min?.year ?? null,
            years_max: (statAggregates as any)._max?.year ?? null,
            by_year: byYear,
            avg_grants_per_record: admissionAvgGrants,
        };

        return {
            universities,
            specialties,
            admission_stats,
            generated_at: Math.floor(Date.now() / 1000),
        };
    }

    private async uniTotals() {
        const [total, with_dormitory, with_military_department, with_city] = await Promise.all([
            this.prisma.university.count({ where: { deleted_at: null } }),
            this.prisma.university.count({ where: { deleted_at: null, has_dormitory: true } }),
            this.prisma.university.count({ where: { deleted_at: null, has_military_department: true } }),
            this.prisma.university.count({ where: { deleted_at: null, city_id: { not: null } } }),
        ]);
        return { total, with_dormitory, with_military_department, with_city };
    }

    private async uniGroupings() {
        // Total active links (used for averages + rural share).
        const linkCount = await this.prisma.universitySpecialty.count({ where: { deleted_at: null } });
        return { linkCount };
    }
}
