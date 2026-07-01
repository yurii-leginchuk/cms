import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { AsanaProjectMap } from './asana-project-map.entity';
import { AsanaConnectionService } from './asana-connection.service';
import {
  AsanaApiClient,
  type AsanaProject,
  type AsanaSection,
  type AsanaUser,
} from './asana-api-client';
import { SetMappingDto } from './dto/set-mapping.dto';

/** Redacted per-site mapping view (+ webhook health + freshness). */
export interface AsanaMappingPublic {
  siteId: string;
  projectGid: string | null;
  projectName: string | null;
  webhookStatus: AsanaProjectMap['webhookStatus'];
  webhookLastReceivedAt: Date | null;
  lastFullSyncAt: Date | null;
  syncError: string | null;
}

@Injectable()
export class AsanaProjectService {
  constructor(
    @InjectRepository(AsanaProjectMap)
    private readonly mapRepo: Repository<AsanaProjectMap>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    private readonly connection: AsanaConnectionService,
    private readonly api: AsanaApiClient,
  ) {}

  async getOrCreateMap(siteId: string): Promise<AsanaProjectMap> {
    const existing = await this.mapRepo.findOne({ where: { siteId } });
    if (existing) return existing;
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    return this.mapRepo.save(this.mapRepo.create({ siteId, webhookStatus: 'none' }));
  }

  toPublic(m: AsanaProjectMap): AsanaMappingPublic {
    return {
      siteId: m.siteId,
      projectGid: m.projectGid,
      projectName: m.projectName,
      webhookStatus: m.webhookStatus,
      webhookLastReceivedAt: m.webhookLastReceivedAt,
      lastFullSyncAt: m.lastFullSyncAt,
      syncError: m.syncError,
    };
  }

  async getMappingPublic(siteId: string): Promise<AsanaMappingPublic> {
    return this.toPublic(await this.getOrCreateMap(siteId));
  }

  /** The mapped project GID for a site, or throw a helpful error. */
  async requireProject(siteId: string): Promise<AsanaProjectMap> {
    const m = await this.getOrCreateMap(siteId);
    if (!m.projectGid) {
      throw new BadRequestException('This site has no Asana project mapped yet.');
    }
    return m;
  }

  /** Map the site to a project, resolving its name from Asana. */
  async setProject(siteId: string, dto: SetMappingDto): Promise<AsanaMappingPublic> {
    const m = await this.getOrCreateMap(siteId);
    const token = await this.connection.getToken();
    const project = await this.api.getProject(token, dto.projectGid);
    m.projectGid = project.gid;
    m.projectName = project.name;
    m.syncError = null;
    return this.toPublic(await this.mapRepo.save(m));
  }

  // ── Live lookups (for the pickers) — read straight from Asana ────────────────

  async listProjects(): Promise<AsanaProject[]> {
    const token = await this.connection.getToken();
    const workspace = await this.connection.requireWorkspace();
    return this.api.listProjects(token, workspace);
  }

  async listUsers(): Promise<AsanaUser[]> {
    const token = await this.connection.getToken();
    const workspace = await this.connection.requireWorkspace();
    return this.api.listUsers(token, workspace);
  }

  async listSections(siteId: string): Promise<AsanaSection[]> {
    const m = await this.requireProject(siteId);
    const token = await this.connection.getToken();
    return this.api.listSections(token, m.projectGid!);
  }
}
