import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Page } from '../pages/page.entity';
import { PageChunk } from './page-chunk.entity';
import { Site } from '../sites/site.entity';
import { EmbeddingService } from './embedding.service';
import { EmbeddingController } from './embedding.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([Page, PageChunk, Site]), SettingsModule],
  controllers: [EmbeddingController],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
