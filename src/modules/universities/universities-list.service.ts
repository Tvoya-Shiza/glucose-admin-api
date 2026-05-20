import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListUniversitiesDto } from './dto/list-universities.dto';
import { UNIVERSITY_SCOPE_RULES } from './universities.scope';

export interface UniversityListRow {
    id: number;
    unik: string;
    title_kk: string;
    city_id: number | null;
    city_title_kk: string | null;
    has_dormitory: boolean;
    has_military_department: boolean;
    website: string | null;
    phone: string | null;
    email: string | null;
    specialty_count: number;
    created_at: number;
    updated_at: number | null;
}

export interface UniversityListResponse {
    rows: UniversityListRow[];
    total: number;
    pageCount: number;
}

@Injectable()
export class UniversitiesListService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListUniversitiesDto): Promise<UniversityListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            UniversitiesListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? UniversitiesListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'title_kk';
        const order: 'asc' | 'desc' = query.order ?? (sort === 'title_kk' || sort === 'unik' ? 'asc' : 'desc');

        const filterWhere: any = { deleted_at: null };
        if (typeof query.city_id === 'number') filterWhere.city_id = query.city_id;
        if (typeof query.has_dormitory === 'boolean') filterWhere.has_dormitory = query.has_dormitory;
        if (typeof query.has_military_department === 'boolean') {
            filterWhere.has_military_department = query.has_military_department;
        }
        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            filterWhere.OR = [
                { unik: { contains: needle } },
                { title_kk: { contains: needle } },
                { address: { contains: needle } },
            ];
        }

        const scopeWhere = buildScopeWhere(actor, UNIVERSITY_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        let orderBy: any;
        if (sort === 'created_at') orderBy = { created_at: order };
        else if (sort === 'updated_at') orderBy = { updated_at: order };
        else if (sort === 'unik') orderBy = { unik: order };
        else orderBy = { title_kk: order };

        const skip = (page - 1) * page_size;

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.university.count({ where }),
            this.prisma.university.findMany({
                where,
                select: {
                    id: true,
                    unik: true,
                    title_kk: true,
                    city_id: true,
                    has_dormitory: true,
                    has_military_department: true,
                    website: true,
                    phone: true,
                    email: true,
                    created_at: true,
                    updated_at: true,
                    city: { select: { translations: { where: { locale: 'kk' }, select: { title: true } } } },
                    _count: { select: { specialties: { where: { deleted_at: null } } } },
                },
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: UniversityListRow[] = (rows as any[]).map((r: any) => ({
            id: Number(r.id),
            unik: r.unik,
            title_kk: r.title_kk,
            city_id: r.city_id === null ? null : Number(r.city_id),
            city_title_kk: r.city?.translations?.[0]?.title ?? null,
            has_dormitory: !!r.has_dormitory,
            has_military_department: !!r.has_military_department,
            website: r.website ?? null,
            phone: r.phone ?? null,
            email: r.email ?? null,
            specialty_count: Number(r._count?.specialties ?? 0),
            created_at: Number(r.created_at),
            updated_at: r.updated_at === null ? null : Number(r.updated_at),
        }));

        return {
            rows: out,
            total: Number(total),
            pageCount: Math.max(1, Math.ceil(Number(total) / page_size)),
        };
    }
}
