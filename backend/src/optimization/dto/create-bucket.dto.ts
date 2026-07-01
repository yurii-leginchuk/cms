import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBucketDto {
  /** Optional override; otherwise derived from the site domain. */
  @IsOptional()
  @IsString()
  @MaxLength(63)
  name?: string;
}
