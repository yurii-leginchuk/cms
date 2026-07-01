import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoService } from '../common/crypto/crypto.service';
import { AsanaConnection } from './asana-connection.entity';
import { AsanaApiClient, AsanaError, type AsanaWorkspace } from './asana-api-client';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { SetWorkspaceDto } from './dto/set-workspace.dto';

/** Redacted connection view — the PAT is surfaced ONLY as `patSet`. */
export interface AsanaConnectionPublic {
  patSet: boolean;
  workspaceGid: string | null;
  workspaceName: string | null;
  userName: string | null;
  status: AsanaConnection['status'];
  verifiedAt: Date | null;
  lastError: string | null;
}

@Injectable()
export class AsanaConnectionService {
  constructor(
    @InjectRepository(AsanaConnection)
    private readonly repo: Repository<AsanaConnection>,
    private readonly crypto: CryptoService,
    private readonly api: AsanaApiClient,
  ) {}

  /** The single global connection row (created empty on first access). */
  async getOrCreate(): Promise<AsanaConnection> {
    const existing = await this.repo.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ status: 'untested' }));
  }

  toPublic(c: AsanaConnection): AsanaConnectionPublic {
    return {
      patSet: !!c.patEnc,
      workspaceGid: c.workspaceGid,
      workspaceName: c.workspaceName,
      userName: c.userName,
      status: c.status,
      verifiedAt: c.verifiedAt,
      lastError: c.lastError,
    };
  }

  async getPublic(): Promise<AsanaConnectionPublic> {
    return this.toPublic(await this.getOrCreate());
  }

  /**
   * Store (or replace) the PAT — encrypted on write. Changing the token resets
   * verification and identity; the pinned workspace is kept (re-verify confirms
   * it's still reachable).
   */
  async setPat(dto: UpdateConnectionDto): Promise<AsanaConnectionPublic> {
    const c = await this.getOrCreate();
    c.patEnc = this.crypto.encrypt(dto.pat.trim());
    c.status = 'untested';
    c.verifiedAt = null;
    c.userGid = null;
    c.userName = null;
    c.lastError = null;
    return this.toPublic(await this.repo.save(c));
  }

  /** Remove the token and everything derived from it. */
  async disconnect(): Promise<AsanaConnectionPublic> {
    const c = await this.getOrCreate();
    c.patEnc = null;
    c.status = 'untested';
    c.verifiedAt = null;
    c.userGid = null;
    c.userName = null;
    c.workspaceGid = null;
    c.workspaceName = null;
    c.lastError = null;
    return this.toPublic(await this.repo.save(c));
  }

  /** Decrypt the PAT (server-side only). Throws if not connected. */
  async getToken(): Promise<string> {
    const c = await this.getOrCreate();
    if (!c.patEnc) {
      throw new BadRequestException('Asana is not connected — add a Personal Access Token first.');
    }
    return this.crypto.decrypt(c.patEnc);
  }

  /**
   * Validate the stored token against Asana. On success record the identity +
   * mark verified and return the available workspaces; on failure mark failed
   * with a scrubbed reason.
   */
  async verify(): Promise<{ connection: AsanaConnectionPublic; workspaces: AsanaWorkspace[] }> {
    const c = await this.getOrCreate();
    if (!c.patEnc) {
      throw new BadRequestException('Asana is not connected — add a Personal Access Token first.');
    }
    try {
      const { user, workspaces } = await this.api.verify(this.crypto.decrypt(c.patEnc));
      c.userGid = user.gid;
      c.userName = user.name;
      c.status = 'verified';
      c.verifiedAt = new Date();
      c.lastError = null;
      // Auto-pin the only workspace, or keep an existing valid pin.
      if (!c.workspaceGid && workspaces.length === 1) {
        c.workspaceGid = workspaces[0].gid;
        c.workspaceName = workspaces[0].name;
      } else if (c.workspaceGid) {
        const match = workspaces.find((w) => w.gid === c.workspaceGid);
        c.workspaceName = match?.name ?? c.workspaceName;
      }
      await this.repo.save(c);
      return { connection: this.toPublic(c), workspaces };
    } catch (e) {
      c.status = 'failed';
      c.lastError = e instanceof AsanaError ? e.message : 'Asana verification failed.';
      await this.repo.save(c);
      return { connection: this.toPublic(c), workspaces: [] };
    }
  }

  async listWorkspaces(): Promise<AsanaWorkspace[]> {
    return this.api.listWorkspaces(await this.getToken());
  }

  /** Pin the workspace, resolving its name from the token's workspace list. */
  async setWorkspace(dto: SetWorkspaceDto): Promise<AsanaConnectionPublic> {
    const c = await this.getOrCreate();
    const workspaces = await this.listWorkspaces();
    const match = workspaces.find((w) => w.gid === dto.workspaceGid);
    if (!match) {
      throw new BadRequestException('That workspace is not available for this token.');
    }
    c.workspaceGid = match.gid;
    c.workspaceName = match.name;
    return this.toPublic(await this.repo.save(c));
  }

  /** The pinned workspace GID, or throw a helpful error. */
  async requireWorkspace(): Promise<string> {
    const c = await this.getOrCreate();
    if (!c.workspaceGid) {
      throw new BadRequestException('No Asana workspace selected — pick one in Asana settings.');
    }
    return c.workspaceGid;
  }
}
