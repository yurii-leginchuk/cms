import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { Page } from '../pages/page.entity';
import { PageChunk } from './page-chunk.entity';
import { Site, EmbeddingStatus } from '../sites/site.entity';
import { SettingsService } from '../settings/settings.service';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const RATE_LIMIT_MS = 50;
const MIN_CHUNK_CHARS = 100;
const MAX_PARAGRAPH_CHARS = 1500;
const PARENT_WINDOW = 3;
const PARENT_MAX_CHARS = 1200;
const SUMMARIZE_THRESHOLD = 15;
const KEEP_RECENT = 10;

export interface EmbeddingStats {
  total: number;
  embedded: number;
  missing: number;
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CHUNK_CHARS);
}

function splitBySentences(paragraph: string): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["']?\s*/g) ?? [paragraph];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > MAX_PARAGRAPH_CHARS && current.length >= MIN_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim().length >= MIN_CHUNK_CHARS) chunks.push(current.trim());
  return chunks.length ? chunks : [paragraph.slice(0, MAX_PARAGRAPH_CHARS)];
}

// Returns array of {text, paragraphIndex} — tracks origin paragraph for parent window
function buildSemanticChunks(paragraphs: string[]): { text: string; paragraphIndex: number }[] {
  const result: { text: string; paragraphIndex: number }[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (para.length > MAX_PARAGRAPH_CHARS) {
      for (const chunk of splitBySentences(para)) {
        result.push({ text: chunk, paragraphIndex: i });
      }
    } else {
      result.push({ text: para, paragraphIndex: i });
    }
  }
  return result;
}

function buildParentText(paragraphs: string[], centerIndex: number): string {
  const start = Math.max(0, centerIndex - PARENT_WINDOW);
  const end = Math.min(paragraphs.length - 1, centerIndex + PARENT_WINDOW);
  let result = paragraphs.slice(start, end + 1).join('\n\n');
  if (result.length > PARENT_MAX_CHARS) result = result.slice(0, PARENT_MAX_CHARS);
  return result;
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectRepository(PageChunk)
    private readonly chunkRepo: Repository<PageChunk>,
    private readonly settingsService: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.logger.log('pgvector extension ready');
    } catch (err) {
      this.logger.warn(`Could not create vector extension: ${(err as Error).message}`);
    }
    try {
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS page_chunks_embedding_hnsw
        ON page_chunks
        USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
      this.logger.log('HNSW index ready');
    } catch (err) {
      this.logger.warn(`Could not create HNSW index: ${(err as Error).message}`);
    }
  }

  async embed(text: string): Promise<number[]> {
    const apiKey = await this.settingsService.getRaw('openai_api_key');
    if (!apiKey) throw new BadRequestException('OpenAI API key not configured');

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        { model: EMBEDDING_MODEL, input: text.slice(0, 8000) },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );
      return response.data.data[0].embedding as number[];
    } catch (err) {
      if (err instanceof AxiosError) {
        throw new Error(`OpenAI embeddings error: ${err.response?.data?.error?.message ?? err.message}`);
      }
      throw err;
    }
  }

  async upsertPageEmbedding(page: Page): Promise<void> {
    const prefix = [page.url, page.customMetaTitle ?? page.metaTitle]
      .filter(Boolean)
      .join(' | ');
    const body = page.cleanContent ?? '';

    const paragraphs = splitIntoParagraphs(body.length > 0 ? body : prefix);
    const semanticChunks = buildSemanticChunks(paragraphs);

    await this.chunkRepo.delete({ pageId: page.id });

    if (semanticChunks.length === 0) {
      await this.pageRepo.update(page.id, { embeddingUpdatedAt: new Date() });
      return;
    }

    const chunkEntities: Partial<PageChunk>[] = [];
    for (let i = 0; i < semanticChunks.length; i++) {
      const { text: chunkText, paragraphIndex } = semanticChunks[i];
      const textToEmbed = prefix ? `${prefix}\n${chunkText}` : chunkText;
      const parentText = buildParentText(paragraphs, paragraphIndex);

      const embedding = await this.embed(textToEmbed);
      chunkEntities.push({
        pageId: page.id,
        siteId: page.siteId,
        chunkIndex: i,
        text: textToEmbed,
        parentText,
        embedding,
        embeddingUpdatedAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    await this.chunkRepo.save(chunkEntities as PageChunk[]);
    await this.pageRepo.update(page.id, { embeddingUpdatedAt: new Date() });
  }

  async markEmbeddingStarted(siteId: string): Promise<void> {
    await this.siteRepo.update(siteId, { embeddingStatus: EmbeddingStatus.EMBEDDING });
  }

  async generateForSite(siteId: string): Promise<{ processed: number; skipped: number; errors: number }> {
    await this.siteRepo.update(siteId, { embeddingStatus: EmbeddingStatus.EMBEDDING });
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const pages = await this.pageRepo.find({ where: { siteId } });

      for (const page of pages) {
        if (!page.cleanContent && !page.metaTitle) {
          skipped++;
          continue;
        }
        try {
          await this.upsertPageEmbedding(page);
          processed++;
        } catch (err) {
          this.logger.warn(`Embedding failed for page ${page.url}: ${(err as Error).message}`);
          errors++;
        }
      }

      this.logger.log(`Embeddings for site ${siteId}: processed=${processed} skipped=${skipped} errors=${errors}`);
      await this.siteRepo.update(siteId, { embeddingStatus: EmbeddingStatus.DONE });
    } catch (err) {
      this.logger.error(`generateForSite failed for ${siteId}: ${(err as Error).message}`);
      await this.siteRepo.update(siteId, { embeddingStatus: EmbeddingStatus.ERROR });
    }

    return { processed, skipped, errors };
  }

  async getStats(siteId: string): Promise<EmbeddingStats> {
    const total = await this.pageRepo.count({ where: { siteId } });
    const embedded = await this.pageRepo
      .createQueryBuilder('p')
      .where('p.siteId = :siteId', { siteId })
      .andWhere('p.embeddingUpdatedAt IS NOT NULL')
      .getCount();
    return { total, embedded, missing: total - embedded };
  }

  async searchSimilar(
    siteId: string,
    query: string,
    limit = 8,
  ): Promise<{
    id: string; url: string; metaTitle: string | null; customMetaTitle: string | null;
    metaDescription: string | null; customMetaDescription: string | null;
    cleanContent: string | null; parentText: string | null; isTransactional: boolean; noindex: boolean; score: number;
  }[]> {
    // Check if chunks exist for this site
    const chunkCount = await this.chunkRepo.count({ where: { siteId } });
    if (chunkCount === 0) {
      return this.searchSimilarLegacy(siteId, query, limit);
    }

    const queryEmbedding = await this.embed(query);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    let rows: any[];
    try {
      // Hybrid search: vector similarity + FTS combined via RRF
      rows = await this.chunkRepo.query(
        `WITH vector_search AS (
           SELECT
             c.id,
             c."pageId",
             c.text,
             ROW_NUMBER() OVER (ORDER BY c.embedding::vector(${EMBEDDING_DIMS}) <=> $1::vector(${EMBEDDING_DIMS})) AS vector_rank
           FROM page_chunks c
           WHERE c."siteId" = $2
             AND c.embedding IS NOT NULL
           ORDER BY c.embedding::vector(${EMBEDDING_DIMS}) <=> $1::vector(${EMBEDDING_DIMS})
           LIMIT 40
         ),
         text_search AS (
           SELECT
             c.id,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank_cd(to_tsvector('simple', c.text), plainto_tsquery('simple', $3)) DESC
             ) AS text_rank
           FROM page_chunks c
           WHERE c."siteId" = $2
             AND to_tsvector('simple', c.text) @@ plainto_tsquery('simple', $3)
           ORDER BY ts_rank_cd(to_tsvector('simple', c.text), plainto_tsquery('simple', $3)) DESC
           LIMIT 40
         ),
         combined AS (
           SELECT
             v.id,
             v."pageId",
             v.text,
             1.0 / (60.0 + v.vector_rank) + COALESCE(1.0 / (60.0 + t.text_rank), 0.0) AS rrf_score
           FROM vector_search v
           LEFT JOIN text_search t ON v.id = t.id
         )
         SELECT
           c.id AS chunk_id,
           c."pageId" AS id,
           c.text AS snippet,
           c.rrf_score AS score,
           p.url,
           p."metaTitle",
           p."customMetaTitle",
           p."metaDescription",
           p."customMetaDescription",
           p."cleanContent",
           p."isTransactional",
           p.noindex,
           c."parentText"
         FROM combined c
         JOIN pages p ON p.id = c."pageId"
         ORDER BY c.rrf_score DESC`,
        [vectorLiteral, siteId, query],
      );
    } catch {
      // FTS parse error (e.g. special chars) — fall back to pure vector search on chunks
      rows = await this.chunkRepo.query(
        `SELECT
           c.id AS chunk_id,
           c."pageId" AS id,
           c.text AS snippet,
           1 - (c.embedding::vector(${EMBEDDING_DIMS}) <=> $1::vector(${EMBEDDING_DIMS})) AS score,
           p.url,
           p."metaTitle",
           p."customMetaTitle",
           p."metaDescription",
           p."customMetaDescription",
           p."cleanContent",
           p."isTransactional",
           p.noindex,
           c."parentText"
         FROM page_chunks c
         JOIN pages p ON p.id = c."pageId"
         WHERE c."siteId" = $2
           AND c.embedding IS NOT NULL
         ORDER BY c.embedding::vector(${EMBEDDING_DIMS}) <=> $1::vector(${EMBEDDING_DIMS})
         LIMIT 40`,
        [vectorLiteral, siteId],
      );
    }

    // Deduplicate by pageId — keep best scoring chunk per page
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        deduped.push(row);
      }
    }

    return deduped.slice(0, limit).map((r) => ({
      id: r.id,
      url: r.url,
      metaTitle: r.metaTitle,
      customMetaTitle: r.customMetaTitle,
      metaDescription: r.metaDescription,
      customMetaDescription: r.customMetaDescription,
      cleanContent: (r.cleanContent as string | null) ?? null,
      parentText: (r.parentText as string | null) ?? null,
      isTransactional: r.isTransactional,
      noindex: r.noindex,
      score: parseFloat(r.score),
      snippet: r.snippet as string,
    }));
  }

  // Legacy: page-level vector search (used when no chunks exist yet)
  private async searchSimilarLegacy(siteId: string, query: string, limit: number) {
    const queryEmbedding = await this.embed(query);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const rows: any[] = await this.pageRepo.query(
      `SELECT
         id,
         url,
         "metaTitle",
         "customMetaTitle",
         "metaDescription",
         "customMetaDescription",
         "cleanContent",
         "isTransactional",
         noindex,
         1 - (embedding::vector(${EMBEDDING_DIMS}) <=> $1::vector(${EMBEDDING_DIMS})) AS score
       FROM pages
       WHERE "siteId" = $2
         AND embedding IS NOT NULL
       ORDER BY embedding::vector(${EMBEDDING_DIMS}) <=> $1::vector(${EMBEDDING_DIMS})
       LIMIT $3`,
      [vectorLiteral, siteId, limit],
    );

    return rows.map((r) => ({
      ...r,
      score: parseFloat(r.score),
      cleanContent: (r.cleanContent as string | null) ?? null,
    }));
  }

  // Summarize old messages for session context compression
  async summarizeMessages(
    messages: { role: string; content: string | null }[],
    apiKey: string,
  ): Promise<string> {
    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}: ${(m.content ?? '').slice(0, 500)}`)
      .join('\n');
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          max_tokens: 400,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'Summarize the following chat conversation briefly. Focus on: key facts established, page URLs discussed, decisions made, pending tasks. Be concise, use bullet points.',
            },
            { role: 'user', content: transcript },
          ],
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 },
      );
      return res.data.choices[0].message.content as string;
    } catch {
      return '';
    }
  }
}

export { SUMMARIZE_THRESHOLD, KEEP_RECENT };
