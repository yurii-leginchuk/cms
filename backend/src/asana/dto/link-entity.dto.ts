import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Link a task to a CMS entity (a page / meta change / schema change), or unlink
 * by sending both fields null. CMS-only — no Asana call.
 */
export class LinkEntityDto {
  @ValidateIf((o) => o.entityType !== null)
  @IsOptional()
  @IsIn(['page', 'meta', 'schema'])
  entityType: 'page' | 'meta' | 'schema' | null;

  @ValidateIf((o) => o.entityId !== null)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  entityId: string | null;
}
