import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MuteFindingDto {
  @IsString()
  @MaxLength(2000)
  reason: string;
}

export class AcceptFindingDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
