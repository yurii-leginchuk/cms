import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Set (or clear, with null) a task's assignee. */
export class SetAssigneeDto {
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeGid: string | null;
}
