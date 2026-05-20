import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAdmissionStatsDto } from './dto/list-admission-stats.dto';
import { UpsertAdmissionStatDto } from './dto/upsert-admission-stat.dto';

export interface AdmissionStatRow {
    id: number;
    university_specialty_id: number;
    university_id: number;
    university_unik: string;
    specialty_id: number;
    specialty_code: string;
    year: number;
    grants_count: number | null;
    threshold: number | null;
    threshold_rural: number | null;
    created_at: number;
    updated_at: number | null;
}

export interface AdmissionStatListResponse {
    rows: AdmissionStatRow[];
    total: number;
    pageCount: number;
}

@Injectable()
export class AdmissionStatsService {
    constructor(private readonly prisma: PrismaService) {}

    public async list(query: ListAdmissionStatsDto): Promise<AdmissionStatListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(500, Math.max(1, query.page_size ?? 100));

        const where: any = {};
        if (typeof query.year === 'number') where.year = query.year;
        if (typeof query.university_id === 'number' || typeof query.specialty_id === 'number') {
            const linkWhere: any = { deleted_at: null };
            if (typeof query.university_id === 'number') linkWhere.university_id = query.university_id;
            if (typeof query.specialty_id === 'number') linkWhere.specialty_id = query.specialty_id;
            where.link = linkWhere;
        }

        const skip = (page - 1) * page_size;
        const [total, rows] = await this.prisma.$transaction([
            this.prisma.admissionStat.count({ where }),
            this.prisma.admissionStat.findMany({
                where,
                select: {
                    id: true,
                    university_specialty_id: true,
                    year: true,
                    grants_count: true,
                    threshold: true,
                    threshold_rural: true,
                    created_at: true,
                    updated_at: true,
                    link: {
                        select: {
                            university_id: true,
                            specialty_id: true,
                            university: { select: { unik: true } },
                            specialty: { select: { code: true } },
                        },
                    },
                },
                orderBy: [{ year: 'desc' }, { id: 'asc' }],
                take: page_size,
                skip,
            }),
        ]);

        return {
            rows: (rows as any[]).map((r: any) => this.toRow(r)),
            total: Number(total),
            pageCount: Math.max(1, Math.ceil(Number(total) / page_size)),
        };
    }

    public async upsert(dto: UpsertAdmissionStatDto): Promise<AdmissionStatRow> {
        if (!dto.university_specialty_id) {
            throw new BadRequestException('admission_stats.university_specialty_id_required');
        }
        if (!dto.year) throw new BadRequestException('admission_stats.year_required');

        const link = await this.prisma.universitySpecialty.findFirst({
            where: { id: dto.university_specialty_id, deleted_at: null },
            select: { id: true },
        });
        if (!link) throw new BadRequestException('admission_stats.link_not_found');

        const now = Math.floor(Date.now() / 1000);
        const upserted: any = await this.prisma.admissionStat.upsert({
            where: {
                uniq_admission_us_year: {
                    university_specialty_id: dto.university_specialty_id,
                    year: dto.year,
                },
            },
            create: {
                university_specialty_id: dto.university_specialty_id,
                year: dto.year,
                grants_count: dto.grants_count ?? null,
                threshold: dto.threshold ?? null,
                threshold_rural: dto.threshold_rural ?? null,
                created_at: now,
            },
            update: {
                grants_count: dto.grants_count === undefined ? undefined : dto.grants_count,
                threshold: dto.threshold === undefined ? undefined : dto.threshold,
                threshold_rural: dto.threshold_rural === undefined ? undefined : dto.threshold_rural,
                updated_at: now,
            },
            select: { id: true },
        });

        return this.getDetail(Number(upserted.id));
    }

    public async update(id: number, dto: UpsertAdmissionStatDto): Promise<AdmissionStatRow> {
        const existing = await this.prisma.admissionStat.findFirst({
            where: { id },
            select: { id: true, university_specialty_id: true, year: true },
        });
        if (!existing) throw new NotFoundException('admission_stats.not_found');

        const data: Record<string, unknown> = {};
        if (dto.grants_count !== undefined) data.grants_count = dto.grants_count;
        if (dto.threshold !== undefined) data.threshold = dto.threshold;
        if (dto.threshold_rural !== undefined) data.threshold_rural = dto.threshold_rural;
        if (typeof dto.year === 'number' && dto.year !== existing.year) {
            const conflict = await this.prisma.admissionStat.findFirst({
                where: {
                    university_specialty_id: existing.university_specialty_id,
                    year: dto.year,
                    NOT: { id },
                },
                select: { id: true },
            });
            if (conflict) throw new ConflictException('admission_stats.year_taken');
            data.year = dto.year;
        }
        if (Object.keys(data).length === 0) return this.getDetail(id);
        data.updated_at = Math.floor(Date.now() / 1000);
        await this.prisma.admissionStat.update({ where: { id }, data });
        return this.getDetail(id);
    }

    public async remove(id: number): Promise<{ id: number; deleted: true }> {
        const existing = await this.prisma.admissionStat.findFirst({ where: { id }, select: { id: true } });
        if (!existing) throw new NotFoundException('admission_stats.not_found');
        await this.prisma.admissionStat.delete({ where: { id } });
        return { id, deleted: true };
    }

    public async getDetail(id: number): Promise<AdmissionStatRow> {
        const row: any = await this.prisma.admissionStat.findFirst({
            where: { id },
            select: {
                id: true,
                university_specialty_id: true,
                year: true,
                grants_count: true,
                threshold: true,
                threshold_rural: true,
                created_at: true,
                updated_at: true,
                link: {
                    select: {
                        university_id: true,
                        specialty_id: true,
                        university: { select: { unik: true } },
                        specialty: { select: { code: true } },
                    },
                },
            },
        });
        if (!row) throw new NotFoundException('admission_stats.not_found');
        return this.toRow(row);
    }

    private toRow(r: any): AdmissionStatRow {
        return {
            id: Number(r.id),
            university_specialty_id: Number(r.university_specialty_id),
            university_id: Number(r.link?.university_id ?? 0),
            university_unik: r.link?.university?.unik ?? '',
            specialty_id: Number(r.link?.specialty_id ?? 0),
            specialty_code: r.link?.specialty?.code ?? '',
            year: Number(r.year),
            grants_count: r.grants_count === null ? null : Number(r.grants_count),
            threshold: r.threshold === null ? null : Number(r.threshold),
            threshold_rural: r.threshold_rural === null ? null : Number(r.threshold_rural),
            created_at: Number(r.created_at),
            updated_at: r.updated_at === null ? null : Number(r.updated_at),
        };
    }
}
