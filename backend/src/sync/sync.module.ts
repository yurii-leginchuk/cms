import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncJob } from './sync-job.entity';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SyncJob, Page, Site])],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
