import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

/** Create a subtask under a tracked task. */
export class CreateSubtaskDto {
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

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueOn must be YYYY-MM-DD' })
  dueOn?: string;
}
