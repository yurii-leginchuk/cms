import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class ProvisionCdnDto {
  /** e.g. cdn.client.com — a hostname on a Cloudflare zone in the same account. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i, { message: 'cdnDomain must be a valid hostname.' })
  cdnDomain: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  cfZoneId: string;
}
