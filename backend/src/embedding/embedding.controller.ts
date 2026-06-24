import { Controller, Post, Get, Param } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

@Controller('sites')
export class EmbeddingController {
  constructor(private readonly embeddingService: EmbeddingService) {}

  @Post(':siteId/embeddings')
  async generate(@Param('siteId') siteId: string) {
    // Set status synchronously so frontend sees it on next poll
    await this.embeddingService.markEmbeddingStarted(siteId);
    // Fire-and-forget the actual work
    this.embeddingService.generateForSite(siteId).catch(() => {/* logged inside */});
    return { message: 'Embedding generation started' };
  }

  @Get(':siteId/embeddings')
  async stats(@Param('siteId') siteId: string) {
    return this.embeddingService.getStats(siteId);
  }
}
