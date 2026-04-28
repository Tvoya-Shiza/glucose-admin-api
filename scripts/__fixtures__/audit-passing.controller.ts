/* eslint-disable */
/**
 * FIXTURE — NOT a real controller. NOT mounted in any module.
 *
 * This file passes the audit lint: every non-GET handler carries either
 * @Audit(...) or @SkipAudit('non-empty reason'). Used by
 * `npm run ci:audit-required:self-test:pass` to confirm the linter exits 0
 * on properly decorated controllers.
 */
import { Controller, Patch, Post } from '@nestjs/common';
import { Audit, SkipAudit } from '../../src/common/audit/audit.decorator';

@Controller('fixture-passing')
export class AuditPassingController {
    @Post()
    @Audit('fixture.create', 'fixture')
    createSomething() {
        return { id: 1 };
    }

    @Patch(':id')
    @SkipAudit('side-effect free toggle, intentionally skipped for fixture demo')
    toggle() {
        return { ok: true };
    }
}
