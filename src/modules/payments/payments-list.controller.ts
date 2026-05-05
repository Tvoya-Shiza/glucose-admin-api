import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { PaymentsListService } from './payments-list.service';

/**
 * PAY-01 — GET /admin-api/v1/admin/payments.
 *
 * Returns the raw `PaymentListResponseDto` shape (NOT wrapped in apiResponse) per
 * glucose-admin-api/CLAUDE.md "List endpoints (Phase 3+) return `{ rows, total, ... }`
 * directly — TanStack Table on the admin-client consumes the raw shape." Our shape
 * is `{ rows, total, page, page_size, next_cursor }` per Plan 01's locked
 * lib/payments/types.ts contract.
 *
 * RBAC (D-18): admin-only. Curator + teacher receive 403 from RolesGuard. Belt-and-
 * braces in service via KASPI_SCOPE_RULES default-deny.
 *
 * Audit posture: GET endpoints exempt from the @Audit lint (only POST/PUT/PATCH/DELETE
 * trip the requirement) — no decorator needed here.
 */
@Controller('admin-api/v1/admin/payments')
@UseGuards(JwtGuard, RolesGuard)
export class PaymentsListController {
    constructor(private readonly listService: PaymentsListService) {}

    @Get()
    @Roles('admin')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListPaymentsDto) {
        return this.listService.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
