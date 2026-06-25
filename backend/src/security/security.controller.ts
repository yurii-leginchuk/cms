import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SecurityScanService } from './security-scan.service';
import { SecurityService } from './security.service';
import { IncidentService } from './incident.service';
import { IncidentStatus } from './security.types';

@Controller('sites/:siteId/security')
export class SecurityController {
  constructor(
    private readonly scan: SecurityScanService,
    private readonly read: SecurityService,
    private readonly incidents: IncidentService,
  ) {}

  @Get('overview')
  getOverview(@Param('siteId') siteId: string) {
    return this.scan.getOverview(siteId);
  }

  @Get('progress')
  getProgress(@Param('siteId') siteId: string) {
    return this.scan.getProgress(siteId);
  }

  @Post('scan-now')
  scanNow(@Param('siteId') siteId: string) {
    return this.scan.triggerScan(siteId);
  }

  @Get('incidents')
  listIncidents(@Param('siteId') siteId: string, @Query('status') status?: IncidentStatus) {
    return this.read.listIncidents(siteId, status);
  }

  @Get('incidents/:id')
  getIncident(@Param('id') id: string) {
    return this.read.getIncidentDetail(id);
  }

  @Get('incidents/:id/export')
  exportIncident(@Param('id') id: string) {
    return this.read.getEvidence(id);
  }

  @Post('incidents/:id/confirm')
  confirm(@Param('id') id: string) {
    return this.incidents.confirm(id);
  }

  @Post('incidents/:id/dismiss')
  dismiss(@Param('id') id: string) {
    return this.incidents.dismiss(id);
  }

  @Post('incidents/:id/snooze')
  snooze(@Param('id') id: string, @Body('until') until?: string) {
    // Default snooze: 7 days.
    const date = until ? new Date(until) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return this.incidents.snooze(id, date);
  }

  @Post('incidents/:id/resolve')
  resolve(@Param('id') id: string) {
    return this.incidents.resolve(id);
  }

  @Post('incidents/:id/reopen')
  reopen(@Param('id') id: string) {
    return this.incidents.reopen(id);
  }
}
