import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brief } from './brief.entity';
import { BriefsService } from './briefs.service';
import { BriefsController } from './briefs.controller';
import { DocxExporter } from './export/docx-exporter';
import { GDocsExporter } from './export/gdocs-exporter';
import { BRIEF_EXPORTER, BriefExporter } from './export/brief-exporter';

@Module({
  imports: [TypeOrmModule.forFeature([Brief])],
  controllers: [BriefsController],
  providers: [
    BriefsService,
    DocxExporter,
    GDocsExporter,
    {
      // Real Google Docs export is activated ONLY when GOOGLE_DOCS_FOLDER_ID is
      // set (a service account needs a Shared Drive folder to have any quota).
      // Otherwise the always-works .docx exporter is used.
      provide: BRIEF_EXPORTER,
      useFactory: (docx: DocxExporter, gdocs: GDocsExporter): BriefExporter =>
        process.env.GOOGLE_DOCS_FOLDER_ID ? gdocs : docx,
      inject: [DocxExporter, GDocsExporter],
    },
  ],
  exports: [BriefsService],
})
export class BriefsModule {}
