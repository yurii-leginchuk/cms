import { IsOptional, IsString, IsArray, MaxLength } from 'class-validator';
import { RecommendationInput } from '../../agent/tools/proposal-validation';

export class CreateBriefDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string | null;

  @IsOptional()
  @IsString()
  pageId?: string | null;

  @IsString()
  @MaxLength(2048)
  pageUrl: string;

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
}
