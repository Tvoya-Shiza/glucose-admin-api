import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';

/**
 * Admin rewards module — manages point-earning rule definitions.
 *
 * PrismaModule is @Global (registered in AppModule), no import needed.
 */
@Module({
    imports: [AccessModule],
    controllers: [RewardsController],
    providers: [RewardsService],
})
export class RewardsModule {}
