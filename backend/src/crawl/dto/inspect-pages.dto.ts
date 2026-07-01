import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class InspectPagesDto {
  /** Page ids to re-inspect now (on-demand, against the daily quota headroom). */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  pageIds: string[];
}
