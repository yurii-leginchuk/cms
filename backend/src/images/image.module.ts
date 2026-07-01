import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { BrandCard } from '../sites/brand-card.entity';
import { SiteImage } from './site-image.entity';
import { ImagePlacement } from './image-placement.entity';
import { AltPublishEvent } from '../impact/alt-publish-event.entity';
import { ImageService } from './image.service';
import { ImageAiService } from './image-ai.service';
import { ImageSyncService } from './image-sync.service';
import { ImageAutopilotService } from './image-autopilot.service';
import { WpMediaService } from './wp-media.service';
import { ImageController, ImageSiteController } from './image.controller';
import { SettingsModule } from '../settings/settings.module';
import { TokenUsageModule } from '../token-usage/token-usage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Page, Site, BrandCard, SiteImage, ImagePlacement, AltPublishEvent]),
    SettingsModule,
    TokenUsageModule,
  ],
  controllers: [ImageSiteController, ImageController],
  providers: [
    ImageService,
    ImageAiService,
    ImageSyncService,
    ImageAutopilotService,
    WpMediaService,
  ],
  exports: [ImageService, ImageAutopilotService, ImageSyncService, WpMediaService],
})
export class ImageModule {}
