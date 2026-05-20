import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListSpecialtiesDto } from './dto/list-specialties.dto';

export interface SpecialtyListRow {
    id: number;
    code: string;
    title_kk: string;
    university_count: number;
    created_at: number;
    updated_at: number | null;
}

export interface SpecialtyListResponse {
    rows: SpecialtyListRow[];
    total: number;
    pageCount: number;
}

@Injectable()
export class SpecialtiesListService {
    constructor(private readonly prisma: PrismaService) {}

    public async list(query: ListSpecialtiesDto): Promise<SpecialtyListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(200, Math.max(1, query.page_size ?? 100));
        const sort = query.sort ?? 'code';
        const order: 'asc' | 'desc' = query.order ?? 'asc';

        const where: any = { deleted_at: null };
        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            where.OR = [{ code: { contains: needle } }, { title_kk: { contains: needle } }];
        }

        const orderBy: any = sort === 'created_at' ? { created_at: order } : sort === 'title_kk' ? { title_kk: order } : { code: order };
        const skip = (page - 1) * page_size;

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.specialty.count({ where }),
            this.prisma.specialty.findMany({
                where,
                select: {
                    id: true,
                    code: true,
                    title_kk: true,
                    created_at: true,
                    updated_at: true,
                    _count: { select: { links: { where: { deleted_at: null } } } },
                },
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        return {
            rows: (rows as any[]).map((r: any) => ({
                id: Number(r.id),
                code: r.code,
                title_kk: r.title_kk,
                university_count: Number(r._count?.links ?? 0),
                created_at: Number(r.created_at),
                updated_at: r.updated_at === null ? null : Number(r.updated_at),
            })),
            total: Number(total),
            pageCount: Math.max(1, Math.ceil(Number(total) / page_size)),
        };
    }
}
