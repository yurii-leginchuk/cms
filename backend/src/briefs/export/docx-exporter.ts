import { Injectable } from '@nestjs/common';
import { Packer } from 'docx';
import { Brief } from '../brief.entity';
import { buildBriefDocx } from './brief-docx';
import { BriefExporter, BriefExportResult, briefFilename } from './brief-exporter';

@Injectable()
export class DocxExporter implements BriefExporter {
  async export(brief: Brief): Promise<BriefExportResult> {
    const doc = buildBriefDocx(brief);
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    return { kind: 'docx', buffer, filename: briefFilename(brief) };
  }
}
