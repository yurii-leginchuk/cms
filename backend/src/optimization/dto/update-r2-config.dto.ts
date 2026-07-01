import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Write-only R2 credentials. Secrets are accepted here and encrypted on write;
 * the response redacts them to isSet booleans. Omitting a field leaves it as-is;
 * an empty string clears it (for accountId/accessKeyId).
 */
export class UpdateR2ConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  r2AccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  r2AccessKeyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  r2Secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cfApiToken?: string;
}
