import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Adopt an existing Asana task (created outside the CMS) for tracking, by URL or
 * raw GID. The task must belong to the site's mapped project.
 */
export class TrackTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  url: string;
}
