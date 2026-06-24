import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { SettingsModule } from '../settings/settings.module';
import { TokenUsageModule } from '../token-usage/token-usage.module';

@Module({
  imports: [SettingsModule, TokenUsageModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
