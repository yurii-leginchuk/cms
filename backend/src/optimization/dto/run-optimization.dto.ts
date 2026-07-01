import { IsEnum } from 'class-validator';
import { OptimizationRunScope } from '../image-optimization-run.entity';

export class RunOptimizationDto {
  @IsEnum(OptimizationRunScope)
  scope: OptimizationRunScope;
}
