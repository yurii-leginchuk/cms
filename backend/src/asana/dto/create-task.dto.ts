import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

/** Create a task in the site's mapped project. */
export class CreateTaskDto {
  @IsString()
  @MaxLength(1024)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeGid?: string;

  /** Asana due date: YYYY-MM-DD. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueOn must be YYYY-MM-DD' })
  dueOn?: string;

  /** Optional starting section (status column). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sectionGid?: string;
}
