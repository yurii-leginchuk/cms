import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertSiteBriefDto {
  @IsOptional() @IsString() keywordCsv?: string | null;
  @IsOptional() @IsString() clientNotes?: string | null;
  @IsOptional() @IsString() pastPageExample?: string | null;
  @IsOptional() @IsString() locations?: string | null;
  @IsOptional() @IsString() @MaxLength(20) spellingVariant?: string | null;
  @IsOptional() @IsString() approvedCtas?: string | null;
  @IsOptional() @IsString() complianceNotes?: string | null;
}
