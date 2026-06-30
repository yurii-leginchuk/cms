import { BadRequestException } from '@nestjs/common';
import { McpChangeService } from './mcp-change.service';
import type { McpChangeRequest } from './mcp-change-request.entity';

/**
 * Unit tests for the human-approval gate dispatch: accept() must apply the
 * proposed change to the correct reused module service AND publish, then mark
 * the request accepted; reject() must discard without touching any module.
 */
describe('McpChangeService accept/reject dispatch', () => {
  function makeService(seed: Partial<McpChangeRequest>) {
    const req = {
      id: 'req-1',
      siteId: 'site-1',
      status: 'pending',
      decidedAt: null,
      error: null,
      payload: {},
      ...seed,
    } as McpChangeRequest;

    const repo = {
      findOne: jest.fn().mockResolvedValue(req),
      save: jest.fn().mockImplementation(async (r) => r),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((r) => r),
    };
    const pageRepo = { findOne: jest.fn() };
    const schemaRepo = { findOne: jest.fn() };
    const imageRepo = { findOne: jest.fn() };

    const pagesService = { updateMeta: jest.fn().mockResolvedValue({}) };
    const syncService = { triggerPageSync: jest.fn().mockResolvedValue(undefined) };
    const schemaService = {
      createManaged: jest.fn().mockResolvedValue({}),
      updateManaged: jest.fn().mockResolvedValue({}),
      removeManaged: jest.fn().mockResolvedValue(undefined),
    };
    const schemaSyncService = { publish: jest.fn().mockResolvedValue({}) };
    const imageService = { setAlt: jest.fn().mockResolvedValue({}) };
    const imageSyncService = { applyOne: jest.fn().mockResolvedValue({}) };

    const service = new McpChangeService(
      repo as any, pageRepo as any, schemaRepo as any, imageRepo as any,
      pagesService as any, syncService as any, schemaService as any,
      schemaSyncService as any, imageService as any, imageSyncService as any,
    );
    return { service, req, repo, pagesService, syncService, schemaService, schemaSyncService, imageService, imageSyncService };
  }

  it('meta.update → updateMeta + per-page sync, marks accepted', async () => {
    const ctx = makeService({
      module: 'meta', action: 'meta.update', targetType: 'page', targetId: 'page-1',
      payload: { ogTitle: 'X', indexDirective: 'noindex' },
    });
    const out = await ctx.service.accept('req-1');
    expect(ctx.pagesService.updateMeta).toHaveBeenCalledWith('page-1', { ogTitle: 'X', indexDirective: 'noindex' });
    expect(ctx.syncService.triggerPageSync).toHaveBeenCalledWith('site-1', 'page-1');
    expect(out.status).toBe('accepted');
    expect(out.decidedAt).toBeInstanceOf(Date);
  });

  it('schema.add → createManaged + publish', async () => {
    const ctx = makeService({
      module: 'schema', action: 'schema.add', targetType: 'page', targetId: 'page-1',
      payload: { type: 'Organization', jsonld: { '@type': 'Organization' } },
    });
    await ctx.service.accept('req-1');
    expect(ctx.schemaService.createManaged).toHaveBeenCalledWith('site-1', 'page-1', {
      type: 'Organization', jsonld: { '@type': 'Organization' },
    });
    expect(ctx.schemaSyncService.publish).toHaveBeenCalledWith('site-1', 'page-1');
  });

  it('schema.update → updateManaged + publish', async () => {
    const ctx = makeService({
      module: 'schema', action: 'schema.update', targetType: 'page', targetId: 'page-1',
      payload: { schemaId: 'sch-9', jsonld: { '@type': 'FAQPage' } },
    });
    await ctx.service.accept('req-1');
    expect(ctx.schemaService.updateManaged).toHaveBeenCalledWith('sch-9', { jsonld: { '@type': 'FAQPage' } });
    expect(ctx.schemaSyncService.publish).toHaveBeenCalledWith('site-1', 'page-1');
  });

  it('schema.delete → removeManaged + publish', async () => {
    const ctx = makeService({
      module: 'schema', action: 'schema.delete', targetType: 'page', targetId: 'page-1',
      payload: { schemaId: 'sch-9' },
    });
    await ctx.service.accept('req-1');
    expect(ctx.schemaService.removeManaged).toHaveBeenCalledWith('sch-9');
    expect(ctx.schemaSyncService.publish).toHaveBeenCalledWith('site-1', 'page-1');
  });

  it('alt.set → setAlt + applyOne', async () => {
    const ctx = makeService({
      module: 'alt', action: 'alt.set', targetType: 'image', targetId: 'img-1',
      payload: { alt: 'A red door' },
    });
    await ctx.service.accept('req-1');
    expect(ctx.imageService.setAlt).toHaveBeenCalledWith('img-1', 'A red door');
    expect(ctx.imageSyncService.applyOne).toHaveBeenCalledWith('site-1', 'img-1');
  });

  it('reject → marks rejected, dispatches nothing', async () => {
    const ctx = makeService({
      module: 'meta', action: 'meta.update', targetType: 'page', targetId: 'page-1', payload: { ogTitle: 'X' },
    });
    const out = await ctx.service.reject('req-1');
    expect(out.status).toBe('rejected');
    expect(out.decidedAt).toBeInstanceOf(Date);
    expect(ctx.pagesService.updateMeta).not.toHaveBeenCalled();
    expect(ctx.syncService.triggerPageSync).not.toHaveBeenCalled();
  });

  it('accepting an already-decided request throws', async () => {
    const ctx = makeService({ status: 'accepted', module: 'meta', action: 'meta.update', targetId: 'p', payload: {} });
    await expect(ctx.service.accept('req-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publish failure leaves the request pending with the error recorded', async () => {
    const ctx = makeService({
      module: 'meta', action: 'meta.update', targetType: 'page', targetId: 'page-1', payload: { ogTitle: 'X' },
    });
    ctx.syncService.triggerPageSync.mockRejectedValueOnce(new Error('WP unreachable'));
    await expect(ctx.service.accept('req-1')).rejects.toThrow('WP unreachable');
    expect(ctx.req.status).toBe('pending');
    expect(ctx.req.error).toBe('WP unreachable');
  });
});
