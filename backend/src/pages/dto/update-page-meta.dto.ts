import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdatePageMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customMetaTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customMetaDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  isTransactional?: boolean;

  @IsOptional()
  @IsBoolean()
  noindex?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  canonical?: string | null;

  @IsOptional()
  @IsBoolean()
  skipSync?: boolean;
}
