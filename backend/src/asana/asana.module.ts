import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from '../sites/site.entity';
import { CryptoModule } from '../common/crypto/crypto.module';
import { AsanaConnection } from './asana-connection.entity';
import { AsanaProjectMap } from './asana-project-map.entity';
import { AsanaTask } from './asana-task.entity';
import { AsanaApiClient } from './asana-api-client';
import { AsanaConnectionService } from './asana-connection.service';
import { AsanaProjectService } from './asana-project.service';
import { AsanaSyncService } from './asana-sync.service';
import { AsanaTaskService } from './asana-task.service';
import { AsanaWebhookService } from './asana-webhook.service';
import { AsanaController } from './asana.controller';
import { AsanaSiteController } from './asana-site.controller';
import { AsanaWebhookController } from './asana-webhook.controller';

/**
 * Asana integration.
 *   Phase 1 (this): connect (encrypted PAT), pick workspace, map a project per
 *     site, read-through "Sync now" into a local mirror, and a read-only Task
 *     Monitoring surface.
 *   Phase 2: task writes (create/update/status/assignee/subtasks) + CMS links.
 *   Phase 3: webhooks + gated MCP tools.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AsanaConnection, AsanaProjectMap, AsanaTask, Site]),
    CryptoModule,
  ],
  controllers: [AsanaController, AsanaSiteController, AsanaWebhookController],
  providers: [
    AsanaApiClient,
    AsanaConnectionService,
    AsanaProjectService,
    AsanaSyncService,
    AsanaTaskService,
    AsanaWebhookService,
  ],
  exports: [AsanaTaskService, AsanaProjectService, AsanaConnectionService],
})
export class AsanaModule {}
