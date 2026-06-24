import {
  IsOptional,
  IsString,
  IsArray,
  IsIn,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { BriefStatus } from '../brief.entity';
import { RecommendationInput } from '../../agent/tools/proposal-validation';

const BRIEF_STATUSES: BriefStatus[] = ['draft', 'in_progress', 'applied'];

export class UpdateBriefDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string | null;

  @IsOptional()
  @IsString()
  pageId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pageUrl?: string;

  @IsOptional()
  @IsString()
  proposedMetaTitle?: string | null;

  @IsOptional()
  @IsString()
  proposedMetaDescription?: string | null;

  @IsOptional()
  @IsString()
  proposedSlug?: string | null;

  @IsOptional()
  @IsString()
  proposedContent?: string | null;

  @IsOptional()
  @IsString()
  proposedSchema?: string | null;

  @IsOptional()
  @IsString()
  keywordStrategy?: string | null;

  @IsOptional()
  @IsArray()
  internalLinks?: { anchor: string; targetUrl: string }[];

  @IsOptional()
  @IsArray()
  recommendations?: RecommendationInput[] | null;

  // User-confirmed: clears the unverified-claims banner when set to [].
  @IsOptional()
  @IsArray()
  unverifiedClaims?: string[] | null;

  @IsOptional()
  @IsIn(BRIEF_STATUSES)
  status?: BriefStatus;

  // Date the brief was applied (YYYY-MM-DD). Required by the service when status
  // is 'applied'; null when status is anything else.
  @IsOptional()
  @IsDateString()
  appliedAt?: string | null;
}
