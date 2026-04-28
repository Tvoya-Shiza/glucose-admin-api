/* eslint-disable */
/**
 * FIXTURE — NOT a real controller. NOT mounted in any module.
 *
 * This file intentionally violates the audit lint: it has an @Post handler
 * with no @Audit / @SkipAudit decorator. Used by
 * `npm run ci:audit-required:self-test:fail` to confirm the linter exits 1.
 *
 * If you "fix" this file, the self-test will start failing — leave it broken.
 */
import { Controller, Post } from '@nestjs/common';

@Controller('fixture-violation')
export class AuditViolationController {
    @Post()
    createSomething() {
        return { id: 1 };
    }
}
