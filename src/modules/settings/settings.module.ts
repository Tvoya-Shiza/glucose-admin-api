import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
    imports: [AccessModule],
    controllers: [SettingsController],
    providers: [SettingsService],
})
export class SettingsModule {}
