import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertUniversitySpecialtyDto } from './dto/upsert-university-specialty.dto';

export interface UniversitySpecialtyRow {
    id: number;
    university_id: number;
    specialty_id: number;
    specialty_code: string;
    specialty_title_kk: string;
    has_rural_quota: boolean;
    short_desc_kk: string | null;
    full_desc_kk: string | null;
    admission_stats_count: number;
    created_at: number;
    updated_at: number | null;
}

@Injectable()
export class UniversitySpecialtiesService {
    constructor(private readonly prisma: PrismaService) {}

    public async listForUniversity(universityId: number): Promise<UniversitySpecialtyRow[]> {
        await this.assertUniversity(universityId);
        const rows: any[] = await this.prisma.universitySpecialty.findMany({
            where: { university_id: universityId, deleted_at: null },
            select: {
                id: true,
                university_id: true,
                specialty_id: true,
                has_rural_quota: true,
                short_desc_kk: true,
                full_desc_kk: true,
                created_at: true,
                updated_at: true,
                specialty: { select: { code: true, title_kk: true } },
                _count: { select: { admission_stats: true } },
            },
            orderBy: [{ specialty: { code: 'asc' } }, { id: 'asc' }],
        });
        return rows.map((r) => this.toRow(r));
    }

    public async link(universityId: number, dto: UpsertUniversitySpecialtyDto): Promise<UniversitySpecialtyRow> {
        if (!dto.specialty_id) throw new BadRequestException('university_specialties.specialty_id_required');
        await this.assertUniversity(universityId);
        await this.assertSpecialty(dto.specialty_id);

        const existing = await this.prisma.universitySpecialty.findFirst({
            where: { university_id: universityId, specialty_id: dto.specialty_id, deleted_at: null },
            select: { id: true },
        });
        if (existing) throw new ConflictException('university_specialties.link_exists');

        const now = Math.floor(Date.now() / 1000);
        const created: any = await this.prisma.universitySpecialty.create({
            data: {
                university_id: universityId,
                specialty_id: dto.specialty_id,
                has_rural_quota: dto.has_rural_quota ?? false,
                short_desc_kk: dto.short_desc_kk ?? null,
                full_desc_kk: dto.full_desc_kk ?? null,
                created_at: now,
            },
            select: { id: true },
        });
        return this.getDetail(Number(created.id));
    }

    public async update(linkId: number, dto: UpsertUniversitySpecialtyDto): Promise<UniversitySpecialtyRow> {
        const existing: any = await this.prisma.universitySpecialty.findFirst({
            where: { id: linkId, deleted_at: null },
            select: { id: true, specialty_id: true, university_id: true },
        });
        if (!existing) throw new NotFoundException('university_specialties.not_found');

        if (dto.specialty_id && dto.specialty_id !== existing.specialty_id) {
            await this.assertSpecialty(dto.specialty_id);
            const conflict = await this.prisma.universitySpecialty.findFirst({
                where: {
                    university_id: existing.university_id,
                    specialty_id: dto.specialty_id,
                    deleted_at: null,
                    NOT: { id: linkId },
                },
                select: { id: true },
            });
            if (conflict) throw new ConflictException('university_specialties.link_exists');
        }

        const data: Record<string, unknown> = {};
        if (dto.specialty_id !== undefined) data.specialty_id = dto.specialty_id;
        if (dto.has_rural_quota !== undefined) data.has_rural_quota = dto.has_rural_quota;
        if (dto.short_desc_kk !== undefined) data.short_desc_kk = dto.short_desc_kk;
        if (dto.full_desc_kk !== undefined) data.full_desc_kk = dto.full_desc_kk;
        if (Object.keys(data).length === 0) return this.getDetail(linkId);
        data.updated_at = Math.floor(Date.now() / 1000);
        await this.prisma.universitySpecialty.update({ where: { id: linkId }, data });
        return this.getDetail(linkId);
    }

    public async unlink(linkId: number): Promise<{ id: number; deleted: true }> {
        const existing = await this.prisma.universitySpecialty.findFirst({
            where: { id: linkId, deleted_at: null },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('university_specialties.not_found');

        const now = Math.floor(Date.now() / 1000);
        await this.prisma.universitySpecialty.update({
            where: { id: linkId },
            data: { deleted_at: now, updated_at: now },
        });
        return { id: linkId, deleted: true };
    }

    public async getDetail(linkId: number): Promise<UniversitySpecialtyRow> {
        const row: any = await this.prisma.universitySpecialty.findFirst({
            where: { id: linkId, deleted_at: null },
            select: {
                id: true,
                university_id: true,
                specialty_id: true,
                has_rural_quota: true,
                short_desc_kk: true,
                full_desc_kk: true,
                created_at: true,
                updated_at: true,
                specialty: { select: { code: true, title_kk: true } },
                _count: { select: { admission_stats: true } },
            },
        });
        if (!row) throw new NotFoundException('university_specialties.not_found');
        return this.toRow(row);
    }

    private async assertUniversity(id: number): Promise<void> {
        const u = await this.prisma.university.findFirst({
            where: { id, deleted_at: null },
            select: { id: true },
        });
        if (!u) throw new NotFoundException('universities.not_found');
    }

    private async assertSpecialty(id: number): Promise<void> {
        const s = await this.prisma.specialty.findFirst({
            where: { id, deleted_at: null },
            select: { id: true },
        });
        if (!s) throw new BadRequestException('specialties.not_found');
    }

    private toRow(r: any): UniversitySpecialtyRow {
        return {
            id: Number(r.id),
            university_id: Number(r.university_id),
            specialty_id: Number(r.specialty_id),
            specialty_code: r.specialty?.code ?? '',
            specialty_title_kk: r.specialty?.title_kk ?? '',
            has_rural_quota: !!r.has_rural_quota,
            short_desc_kk: r.short_desc_kk ?? null,
            full_desc_kk: r.full_desc_kk ?? null,
            admission_stats_count: Number(r._count?.admission_stats ?? 0),
            created_at: Number(r.created_at),
            updated_at: r.updated_at === null ? null : Number(r.updated_at),
        };
    }
}
