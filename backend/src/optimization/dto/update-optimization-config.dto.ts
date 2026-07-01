import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateOptimizationConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  webpEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autopilotEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quality?: number;

  /** null clears the resize cap; otherwise a sane pixel range. */
  @IsOptional()
  @IsInt()
  @Min(320)
  @Max(8000)
  maxWidth?: number | null;
}
