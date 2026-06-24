import { IsString, IsOptional } from 'class-validator';

export class UpsertPromptDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  model?: string | null;
}
