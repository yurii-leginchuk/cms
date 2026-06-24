import { IsString, IsOptional } from 'class-validator';

export class UpsertSettingDto {
  @IsOptional()
  @IsString()
  value: string | null;
}
