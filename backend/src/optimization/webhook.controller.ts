import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { WebhookService } from './webhook.service';

interface NewImageBody {
  attachmentId?: number | string;
}

/**
 * PUBLIC webhook endpoint (plugin → CMS). Marked @Public() so the global
 * ApiKeyGuard lets it through — it is authenticated ONLY by the per-site
 * webhook secret (constant-time compare inside WebhookService).
 */
@Public()
@Controller('webhooks/optimization/:siteId')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('new-image')
  @HttpCode(HttpStatus.OK)
  newImage(
    @Param('siteId') siteId: string,
    @Headers('x-poirier-webhook-secret') secret: string | undefined,
    @Body() body: NewImageBody,
  ) {
    const attachmentId = Number(body?.attachmentId);
    return this.webhookService.handleNewImage(siteId, secret, attachmentId);
  }
}
