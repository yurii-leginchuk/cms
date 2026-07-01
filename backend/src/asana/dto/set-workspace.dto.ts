import { IsString, MaxLength } from 'class-validator';

/** Pin the workspace the connection operates in (GID from GET /workspaces). */
export class SetWorkspaceDto {
  @IsString()
  @MaxLength(64)
  workspaceGid: string;
}
