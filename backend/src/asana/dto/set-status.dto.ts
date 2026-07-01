import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Move a task to a section (status column), optionally toggling completed. */
export class SetStatusDto {
  @IsString()
  @MaxLength(64)
  sectionGid: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
