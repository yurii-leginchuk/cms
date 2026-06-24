import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Optional page the assistant is embedded on — lets schema tools default to it. */
export class PageContextDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsOptional()
  @IsString()
  pageUrl?: string;
}

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext?: PageContextDto;
}
