import { IsString, MaxLength } from 'class-validator';

/** Map this site to an Asana project (GID from GET /asana/projects). */
export class SetMappingDto {
  @IsString()
  @MaxLength(64)
  projectGid: string;
}
