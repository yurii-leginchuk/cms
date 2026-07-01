import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  wpApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  gscProperty?: string | null;

  @IsOptional()
  @IsBoolean()
  hostedOnWpEngine?: boolean;
}
