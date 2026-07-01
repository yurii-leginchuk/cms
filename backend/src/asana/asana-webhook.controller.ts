import {
  Controller,
  Post,
  Param,
  Headers,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AsanaWebhookService } from './asana-webhook.service';

/**
 * PUBLIC Asana webhook endpoint. Marked @Public() so the global ApiKeyGuard lets
 * it through — it authenticates via the X-Hook-Secret handshake + per-delivery
 * X-Hook-Signature HMAC (verified inside AsanaWebhookService against the raw body).
 */
@Public()
@Controller('webhooks/asana/:siteId')
export class AsanaWebhookController {
  constructor(private readonly webhook: AsanaWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Param('siteId') siteId: string,
    @Headers('x-hook-secret') hookSecret: string | undefined,
    @Headers('x-hook-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Establishment handshake: echo X-Hook-Secret back and store it.
    if (hookSecret) {
      await this.webhook.handleHandshake(siteId, hookSecret);
      res.setHeader('X-Hook-Secret', hookSecret);
      return {};
    }
    await this.webhook.handleEvents(siteId, signature, req.rawBody ?? Buffer.from(''), req.body);
    return {};
  }
}
