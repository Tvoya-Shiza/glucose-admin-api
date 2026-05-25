import { Body, Controller, Get, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateRewardDto } from './dto/update-reward.dto';
import { RewardsService } from './rewards.service';

/**
 * Admin endpoints for managing point-earning rules.
 *
 * GET  /rewards/rules         — list all reward types with current score + status
 * PATCH /rewards/rules/:type  — update score or enable/disable a rule
 *
 * RBAC: admin-only. Curators and teachers do not manage reward rules.
 */
@Controller('admin-api/v1/admin/rewards')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class RewardsController {
    constructor(private readonly service: RewardsService) {}

    @Get('rules')
    @Roles('admin')
    @RequirePermission('rewards.view')
    public async listRules() {
        return this.service.listRules();
    }

    @Patch('rules/:type')
    @Roles('admin')
    @RequirePermission('rewards.manage')
    @Audit('rewards.update_rule', 'reward')
    public async updateRule(
        @Param('type') type: string,
        @Body() dto: UpdateRewardDto,
    ) {
        if (!type || !/^[a-z_]{2,64}$/.test(type)) {
            throw new NotFoundException('invalid_reward_type');
        }
        return this.service.updateRule(type, dto);
    }
}
