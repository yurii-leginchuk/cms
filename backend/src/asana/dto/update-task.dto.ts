import { IsBoolean, IsOptional, IsString, MaxLength, Matches, ValidateIf } from 'class-validator';

/**
 * Update a tracked task. Every field is optional (omitted = leave as-is).
 * `dueOn: null` clears the due date.
 */
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  /** YYYY-MM-DD, or null to clear the due date. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueOn must be YYYY-MM-DD or null' })
  dueOn?: string | null;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
