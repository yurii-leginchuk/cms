import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { PageSpeedResult } from './page-speed-result.entity';
import { Page } from '../pages/page.entity';
import { PageSpeedService } from './page-speed.service';
import { PageSpeedProcessor, PAGESPEED_QUEUE } from './page-speed.processor';
import { PageSpeedController } from './page-speed.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PageSpeedResult, Page]),
    BullModule.registerQueue({ name: PAGESPEED_QUEUE }),
    SettingsModule,
  ],
  controllers: [PageSpeedController],
  providers: [PageSpeedService, PageSpeedProcessor],
  exports: [PageSpeedService],
})
export class PageSpeedModule {}
