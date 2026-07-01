import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Write-only PAT. The token is accepted here and encrypted on write; the
 * response redacts it to a `patSet` boolean. Setting a new value replaces the
 * old one and resets verification to `untested`.
 */
export class UpdateConnectionDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  pat: string;
}
