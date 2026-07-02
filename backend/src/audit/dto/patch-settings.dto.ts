import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PatchAuditSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(500)
  liveFetchBudget?: number;
}
