import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GscCache } from './gsc-cache.entity';
import { GscService } from './gsc.service';
import { GscController } from './gsc.controller';
import { Site } from '../sites/site.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GscCache, Site])],
  controllers: [GscController],
  providers: [GscService],
  exports: [GscService],
})
export class GscModule {}
