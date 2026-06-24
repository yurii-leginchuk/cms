import { IsString, IsUrl, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsUrl({ require_protocol: true })
  @MaxLength(255)
  url: string;

  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  sitemapUrl: string;
}
