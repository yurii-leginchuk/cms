import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { Brief } from '../brief.entity';
import { buildBriefHtml } from './brief-html';
import { BriefExporter, BriefExportResult } from './brief-exporter';
import { DocxExporter } from './docx-exporter';

/**
 * Exports a brief as a real Google Doc via the Drive API.
 *
 * A service account has ZERO Drive storage quota, so files.create into the SA's
 * own My Drive throws 403 storageQuotaExceeded. The file MUST be created inside
 * a Shared Drive / shared folder (parents:[GOOGLE_DOCS_FOLDER_ID]) with
 * supportsAllDrives:true. If that env is unset the factory never instantiates
 * this exporter; if Drive still 403s on quota we fall back to the .docx path so
 * the user always gets a deliverable.
 */
@Injectable()
export class GDocsExporter implements BriefExporter {
  private readonly logger = new Logger(GDocsExporter.name);

  constructor(private readonly docxExporter: DocxExporter) {}

  async export(brief: Brief): Promise<BriefExportResult> {
    const folderId = process.env.GOOGLE_DOCS_FOLDER_ID;
    if (!folderId) {
      // Should not happen (factory gates on this) — defensive fallback.
      return this.docxExporter.export(brief);
    }

    // Allow override; default to the Docker key path. NEVER log the key.
    const keyFile =
      process.env.GOOGLE_APPLICATION_CREDENTIALS || '/app/gsc-credentials.json';

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: [
          'https://www.googleapis.com/auth/documents',
          'https://www.googleapis.com/auth/drive',
        ],
      });
      const drive = google.drive({ version: 'v3', auth });

      const html = buildBriefHtml(brief);
      const name = brief.proposedMetaTitle || brief.pageUrl || `Content Brief ${brief.id}`;

      const res = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.document',
          parents: [folderId],
        },
        media: {
          mimeType: 'text/html',
          body: html,
        },
        fields: 'id,webViewLink',
      });

      const url = res.data.webViewLink;
      if (!url) {
        this.logger.warn('Google Doc created but no webViewLink returned; falling back to docx');
        return this.docxExporter.export(brief);
      }
      return { kind: 'gdoc', url };
    } catch (err: unknown) {
      if (this.isStorageQuotaExceeded(err)) {
        this.logger.warn(
          'Google Drive returned storageQuotaExceeded (service account has no quota — ' +
            'use a Shared Drive folder); falling back to .docx export.',
        );
        return this.docxExporter.export(brief);
      }
      throw err;
    }
  }

  private isStorageQuotaExceeded(err: unknown): boolean {
    const e = err as {
      code?: number;
      errors?: { reason?: string }[];
      response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } };
    };
    const status = e?.code ?? e?.response?.status;
    if (status !== 403) return false;
    const reasons = [
      ...(e?.errors ?? []),
      ...(e?.response?.data?.error?.errors ?? []),
    ].map((x) => x?.reason);
    return reasons.includes('storageQuotaExceeded');
  }
}
