import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('admin-api/health')
export class HealthController {
    constructor(private readonly health: HealthService) {}

    @Public()
    @Get()
    async check() {
        return this.health.getHealth();
    }
}
