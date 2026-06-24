import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CruxResult } from './crux-result.entity';
import { Page } from '../pages/page.entity';
import { CruxService } from './crux.service';
import { CruxProcessor, CRUX_QUEUE } from './crux.processor';
import { CruxController } from './crux.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CruxResult, Page]),
    BullModule.registerQueue({ name: CRUX_QUEUE }),
    SettingsModule,
  ],
  controllers: [CruxController],
  providers: [CruxService, CruxProcessor],
  exports: [CruxService],
})
export class CruxModule {}
