import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  MaxLength,
} from 'class-validator';
import { IndexDirective } from '../page.entity';

export class UpdatePageMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customMetaTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customMetaDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  isTransactional?: boolean;

  /**
   * Legacy boolean noindex (agent/chat). When provided, it is mirrored into
   * `indexDirective`. New callers should send `indexDirective` instead.
   */
  @IsOptional()
  @IsBoolean()
  noindex?: boolean;

  /** Robots index tri-state (default | index | noindex). */
  @IsOptional()
  @IsEnum(IndexDirective)
  indexDirective?: IndexDirective;

  /** Robots nofollow override (false = follow). */
  @IsOptional()
  @IsBoolean()
  nofollow?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  canonical?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ogTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  ogDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ogImage?: string | null;

  @IsOptional()
  @IsInt()
  ogImageId?: number | null;

  @IsOptional()
  @IsBoolean()
  skipSync?: boolean;
}
