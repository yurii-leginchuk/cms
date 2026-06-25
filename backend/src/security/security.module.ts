import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Page } from '../pages/page.entity';
import { SettingsModule } from '../settings/settings.module';
import { SecurityScanRun } from './entities/security-scan-run.entity';
import { SecurityScanFinding } from './entities/security-scan-finding.entity';
import { SecurityScanSnapshot } from './entities/security-scan-snapshot.entity';
import { SecurityIncident } from './entities/security-incident.entity';
import { SECURITY_QUEUE, SecurityProcessor } from './security.processor';
import { SecurityScanService } from './security-scan.service';
import { SecurityService } from './security.service';
import { IncidentService } from './incident.service';
import { SecurityController } from './security.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SecurityScanRun,
      SecurityScanFinding,
      SecurityScanSnapshot,
      SecurityIncident,
      Page,
    ]),
    BullModule.registerQueue({ name: SECURITY_QUEUE }),
    SettingsModule,
  ],
  controllers: [SecurityController],
  providers: [SecurityScanService, SecurityService, IncidentService, SecurityProcessor],
  exports: [SecurityScanService],
})
export class SecurityModule {}
