import { IsString, IsUUID } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsUUID()
  siteId: string;
}
