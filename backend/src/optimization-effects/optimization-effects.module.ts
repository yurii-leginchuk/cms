import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OptimizationEffect } from './optimization-effect.entity';
import { OptimizationEffectQuery } from './optimization-effect-query.entity';
import { OptimizationEffectsService } from './optimization-effects.service';
import { OptimizationEffectsController } from './optimization-effects.controller';
import { GscModule } from '../gsc/gsc.module';

@Module({
  imports: [TypeOrmModule.forFeature([OptimizationEffect, OptimizationEffectQuery]), GscModule],
  controllers: [OptimizationEffectsController],
  providers: [OptimizationEffectsService],
  exports: [OptimizationEffectsService],
})
export class OptimizationEffectsModule {}
