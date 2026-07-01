import { IsArray, IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Set a task's Impact scope. `sitewide` → global timeline only; `pages` →
 * `pageIds` (+ global); null → unscoped (no marker). CMS-local metadata.
 */
export class SetScopeDto {
  @ValidateIf((o) => o.scope !== null)
  @IsIn(['sitewide', 'pages'])
  scope: 'sitewide' | 'pages' | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pageIds?: string[];
}
