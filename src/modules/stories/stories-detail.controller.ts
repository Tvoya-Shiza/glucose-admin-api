import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StoriesDetailService } from './stories-detail.service';

/**
 * STY-01 — GET /admin-api/v1/admin/stories/:id (Plan 02).
 *
 * Admin-only. apiResponse-wrapped detail: `{ success, status, message, data }`.
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint.
 */
@Controller('admin-api/v1/admin/stories')
@UseGuards(JwtGuard, RolesGuard)
export class StoriesDetailController {
    constructor(private readonly svc: StoriesDetailService) {}

    @Get(':id')
    @Roles('admin')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'stories.fetched', data);
    }
}
