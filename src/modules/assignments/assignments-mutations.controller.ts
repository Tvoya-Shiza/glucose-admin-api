import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { ToggleAssignmentStatusDto, UpdateAssignmentDto } from './dto/update-assignment.dto';
import { UpsertAttachmentDto } from './dto/upsert-attachment.dto';
import { AssignmentsMutationsService } from './assignments-mutations.service';

/**
 * Write endpoints for assignments + attachments.
 *
 * Routes:
 *   POST   /admin-api/v1/admin/assignments                              — create
 *   PATCH  /admin-api/v1/admin/assignments/:id                          — update fields/translations
 *   PATCH  /admin-api/v1/admin/assignments/:id/status                   — publish toggle
 *   DELETE /admin-api/v1/admin/assignments/:id                          — hard delete
 *   POST   /admin-api/v1/admin/assignments/:id/attachments              — add (cap 5)
 *   DELETE /admin-api/v1/admin/assignments/:id/attachments/:attachId    — remove
 *
 * RBAC:
 *   - Curators are excluded — they don't author assignments (D-21 mirror).
 *   - Teachers may create/update/publish; only admin may delete.
 *   - Attachments follow the same author/edit rule as the parent assignment.
 */
@Controller('admin-api/v1/admin/assignments')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class AssignmentsMutationsController {
    constructor(private readonly svc: AssignmentsMutationsService) {}

    @Post()
    @Roles('admin', 'teacher')
    @RequirePermission('assignments.create')
    @Audit('assignments.create', 'assignment')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateAssignmentDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'teacher')
    @RequirePermission('assignments.edit')
    @Audit('assignments.update', 'assignment')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateAssignmentDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Patch(':id/status')
    @Roles('admin', 'teacher')
    @RequirePermission('assignments.publish')
    @Audit('assignments.publish', 'assignment')
    public async toggleStatus(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ToggleAssignmentStatusDto,
    ) {
        return this.svc.toggleStatus({ id: actor.id, role_name: actor.role_name }, id, dto.status);
    }

    @Delete(':id')
    @Roles('admin')
    @RequirePermission('assignments.delete')
    @Audit('assignments.delete', 'assignment')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.remove({ id: actor.id, role_name: actor.role_name }, id);
    }

    @Post(':id/attachments')
    @Roles('admin', 'teacher')
    @RequirePermission('assignments.edit')
    @Audit('assignments.attachment.create', 'assignment')
    public async addAttachment(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertAttachmentDto,
    ) {
        return this.svc.addAttachment({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id/attachments/:attachId')
    @Roles('admin', 'teacher')
    @RequirePermission('assignments.edit')
    @Audit('assignments.attachment.delete', 'assignment')
    @HttpCode(HttpStatus.OK)
    public async removeAttachment(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Param('attachId', ParseIntPipe) attachId: number,
    ) {
        return this.svc.removeAttachment({ id: actor.id, role_name: actor.role_name }, id, attachId);
    }
}
