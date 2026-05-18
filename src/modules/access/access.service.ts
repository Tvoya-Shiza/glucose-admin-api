import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from './permissions.service';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';

export interface RoleSummaryDto {
    id: number;
    code: string;
    name: string;
    description: string | null;
    is_admin: boolean;
    is_system: boolean;
    display_order: number;
    user_count: number;
    permission_count: number | null; // null for admin (super-bypass — count is meaningless)
}

export interface PermissionGroupDto {
    id: number;
    code: string;
    name_ru: string;
    name_kz: string;
    display_order: number;
    permissions: PermissionDto[];
}

export interface PermissionDto {
    id: number;
    code: string;
    action: string;
    name_ru: string;
    name_kz: string;
    description: string | null;
    display_order: number;
}

@Injectable()
export class AccessService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly permissions: PermissionsService,
    ) {}

    private nowSec(): number {
        return Math.floor(Date.now() / 1000);
    }

    public async listRoles(): Promise<RoleSummaryDto[]> {
        const roles = await this.prisma.role.findMany({
            orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
            include: {
                _count: { select: { permissions: true } },
            },
        });

        // User → Role has no FK in shared MySQL (student-app contract), so the
        // schema deliberately has no Role.users[] relation. Counts via groupBy.
        const userCounts = await this.prisma.user.groupBy({
            by: ['role_id'],
            _count: { _all: true },
            where: { deleted_at: null },
        });
        const userCountByRole = new Map(userCounts.map((c) => [c.role_id, c._count._all]));

        return roles.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            description: r.description,
            is_admin: r.is_admin,
            is_system: r.is_system,
            display_order: r.display_order,
            user_count: userCountByRole.get(r.id) ?? 0,
            permission_count: r.code === 'admin' ? null : r._count.permissions,
        }));
    }

    public async createRole(actorId: number, dto: CreateRoleDto): Promise<RoleSummaryDto> {
        // Reserve well-known codes — even with a unique constraint, a clearer 400 helps the UI.
        if (['admin', 'curator', 'teacher', 'student'].includes(dto.code)) {
            throw new BadRequestException('role_code_reserved');
        }

        try {
            const created = await this.prisma.role.create({
                data: {
                    code: dto.code,
                    name: dto.name,
                    description: dto.description ?? null,
                    is_admin: false,
                    is_system: false,
                    display_order: 1000 + this.nowSec() % 1000, // gentle dispersion so insertion order is preserved
                    created_at: this.nowSec(),
                },
            });
            void actorId; // audit picks this up via @Audit decorator at controller layer
            return {
                id: created.id,
                code: created.code,
                name: created.name,
                description: created.description,
                is_admin: created.is_admin,
                is_system: created.is_system,
                display_order: created.display_order,
                user_count: 0,
                permission_count: 0,
            };
        } catch (err) {
            // Prisma unique-constraint error
            if ((err as { code?: string })?.code === 'P2002') {
                throw new ConflictException('role_code_taken');
            }
            throw err;
        }
    }

    public async updateRole(id: number, dto: UpdateRoleDto): Promise<RoleSummaryDto> {
        const existing = await this.prisma.role.findUnique({
            where: { id },
            include: { _count: { select: { permissions: true } } },
        });
        if (!existing) throw new NotFoundException('role_not_found');

        const updated = await this.prisma.role.update({
            where: { id },
            data: {
                name: dto.name ?? existing.name,
                description: dto.description === undefined ? existing.description : (dto.description || null),
                updated_at: this.nowSec(),
            },
            include: { _count: { select: { permissions: true } } },
        });

        const userCount = await this.prisma.user.count({
            where: { role_id: id, deleted_at: null },
        });

        return {
            id: updated.id,
            code: updated.code,
            name: updated.name,
            description: updated.description,
            is_admin: updated.is_admin,
            is_system: updated.is_system,
            display_order: updated.display_order,
            user_count: userCount,
            permission_count: updated.code === 'admin' ? null : updated._count.permissions,
        };
    }

    public async deleteRole(id: number): Promise<void> {
        const existing = await this.prisma.role.findUnique({
            where: { id },
            select: { id: true, is_system: true },
        });
        if (!existing) throw new NotFoundException('role_not_found');
        if (existing.is_system) {
            throw new ConflictException('cannot_delete_system_role');
        }
        const userCount = await this.prisma.user.count({
            where: { role_id: id, deleted_at: null },
        });
        if (userCount > 0) {
            throw new ConflictException('role_has_users');
        }
        // Cascade clears role_permissions.
        await this.prisma.role.delete({ where: { id } });
        await this.permissions.invalidateRoleCache(id);
    }

    public async listCatalog(): Promise<PermissionGroupDto[]> {
        const groups = await this.prisma.permissionGroup.findMany({
            orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
            include: {
                permissions: {
                    orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
                },
            },
        });
        return groups.map((g) => ({
            id: g.id,
            code: g.code,
            name_ru: g.name_ru,
            name_kz: g.name_kz,
            display_order: g.display_order,
            permissions: g.permissions.map((p) => ({
                id: p.id,
                code: p.code,
                action: p.action,
                name_ru: p.name_ru,
                name_kz: p.name_kz,
                description: p.description,
                display_order: p.display_order,
            })),
        }));
    }

    public async getRolePermissionCodes(id: number): Promise<string[]> {
        const role = await this.prisma.role.findUnique({ where: { id }, select: { id: true } });
        if (!role) throw new NotFoundException('role_not_found');
        const set = await this.permissions.getRolePermissions(id);
        return Array.from(set);
    }

    public async setRolePermissions(id: number, codes: string[], actorId: number): Promise<string[]> {
        const role = await this.prisma.role.findUnique({
            where: { id },
            select: { id: true, code: true },
        });
        if (!role) throw new NotFoundException('role_not_found');
        if (role.code === 'admin') {
            // admin is super-bypass; permission rows are meaningless and would be misleading.
            throw new BadRequestException('cannot_modify_admin_permissions');
        }

        const perms = await this.prisma.permission.findMany({
            where: { code: { in: codes } },
            select: { id: true, code: true },
        });
        const knownCodes = new Set(perms.map((p) => p.code));
        const unknown = codes.filter((c) => !knownCodes.has(c));
        if (unknown.length > 0) {
            // Silently drop unknown codes — the catalog is the source of truth and we don't
            // want a typo from the UI (or a stale catalog snapshot) to fail the whole save.
            void unknown;
        }

        const now = this.nowSec();
        await this.prisma.$transaction(async (tx) => {
            await tx.rolePermission.deleteMany({ where: { role_id: id } });
            if (perms.length > 0) {
                await tx.rolePermission.createMany({
                    data: perms.map((p) => ({
                        role_id: id,
                        permission_id: p.id,
                        granted_at: now,
                        granted_by: actorId,
                    })),
                    skipDuplicates: true,
                });
            }
        });

        await this.permissions.invalidateRoleCache(id);
        return perms.map((p) => p.code);
    }
}
