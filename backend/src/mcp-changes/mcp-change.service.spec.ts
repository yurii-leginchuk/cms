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
    const syncService = { pushPageNow: jest.fn().mockResolvedValue(undefined) };
    const schemaService = {
      createManaged: jest.fn().mockResolvedValue({ id: 'sch-new' }),
      updateManaged: jest.fn().mockResolvedValue({}),
      removeManaged: jest.fn().mockResolvedValue(undefined),
    };
    const schemaSyncService = {
      publish: jest.fn().mockResolvedValue({}),
      publishSingle: jest.fn().mockResolvedValue({}),
    };
    const imageService = { setAlt: jest.fn().mockResolvedValue({}) };
    const imageSyncService = { applyOne: jest.fn().mockResolvedValue({}) };
    const asanaTaskService = {
      createTask: jest.fn().mockResolvedValue({}),
      updateTask: jest.fn().mockResolvedValue({}),
      setStatus: jest.fn().mockResolvedValue({}),
      setAssignee: jest.fn().mockResolvedValue({}),
      createSubtask: jest.fn().mockResolvedValue({}),
      linkEntity: jest.fn().mockResolvedValue({}),
    };
    const redirectWriteService = { applyChange: jest.fn().mockResolvedValue(undefined) };

    const service = new McpChangeService(
      repo as any, pageRepo as any, schemaRepo as any, imageRepo as any,
      pagesService as any, syncService as any, schemaService as any,
      schemaSyncService as any, imageService as any, imageSyncService as any,
      asanaTaskService as any, redirectWriteService as any,
    );
    return { service, req, repo, schemaRepo, pagesService, syncService, schemaService, schemaSyncService, imageService, imageSyncService, asanaTaskService, redirectWriteService };
  }

  it('meta.update → updateMeta + per-page sync, marks accepted', async () => {
    const ctx = makeService({
      module: 'meta', action: 'meta.update', targetType: 'page', targetId: 'page-1',
      payload: { ogTitle: 'X', indexDirective: 'noindex' },
    });
    const out = await ctx.service.accept('req-1');
    expect(ctx.pagesService.updateMeta).toHaveBeenCalledWith('page-1', { ogTitle: 'X', indexDirective: 'noindex' });
    expect(ctx.syncService.pushPageNow).toHaveBeenCalledWith('site-1', 'page-1');
    expect(out.status).toBe('accepted');
    expect(out.decidedAt).toBeInstanceOf(Date);
  });

  it('asana.create → AsanaTaskService.createTask, marks accepted', async () => {
    const ctx = makeService({
      module: 'asana', action: 'asana.create', targetType: 'task', targetId: '-',
      payload: { name: 'Fix /pricing', dueOn: '2026-07-20', sectionGid: 'sec-1' },
    });
    const out = await ctx.service.accept('req-1');
    expect(ctx.asanaTaskService.createTask).toHaveBeenCalledWith('site-1', {
      name: 'Fix /pricing', notes: undefined, assigneeGid: undefined, dueOn: '2026-07-20', sectionGid: 'sec-1',
    });
    expect(out.status).toBe('accepted');
  });

  it('asana.status → AsanaTaskService.setStatus with the target task gid', async () => {
    const ctx = makeService({
      module: 'asana', action: 'asana.status', targetType: 'task', targetId: 'task-9',
      payload: { sectionGid: 'sec-2', completed: true },
    });
    await ctx.service.accept('req-1');
    expect(ctx.asanaTaskService.setStatus).toHaveBeenCalledWith('site-1', 'task-9', {
      sectionGid: 'sec-2', completed: true,
    });
  });

  it('schema.add → createManaged + targeted publish of the new row only', async () => {
    const ctx = makeService({
      module: 'schema', action: 'schema.add', targetType: 'page', targetId: 'page-1',
      payload: { type: 'Organization', jsonld: { '@type': 'Organization' } },
    });
    await ctx.service.accept('req-1');
    expect(ctx.schemaService.createManaged).toHaveBeenCalledWith('site-1', 'page-1', {
      type: 'Organization', jsonld: { '@type': 'Organization' },
    });
    expect(ctx.schemaSyncService.publishSingle).toHaveBeenCalledWith('site-1', 'page-1', 'sch-new');
    expect(ctx.schemaSyncService.publish).not.toHaveBeenCalled();
  });

  it('schema.update → updateManaged + targeted publish of that schema only', async () => {
    const ctx = makeService({
      module: 'schema', action: 'schema.update', targetType: 'page', targetId: 'page-1',
      payload: { schemaId: 'sch-9', jsonld: { '@type': 'FAQPage' } },
    });
    await ctx.service.accept('req-1');
    expect(ctx.schemaService.updateManaged).toHaveBeenCalledWith('sch-9', { jsonld: { '@type': 'FAQPage' } });
    expect(ctx.schemaSyncService.publishSingle).toHaveBeenCalledWith('site-1', 'page-1', 'sch-9');
    expect(ctx.schemaSyncService.publish).not.toHaveBeenCalled();
  });

  it('schema.delete of a live row → removeManaged + targeted publish', async () => {
    const ctx = makeService({
      module: 'schema', action: 'schema.delete', targetType: 'page', targetId: 'page-1',
      payload: { schemaId: 'sch-9' },
    });
    // Row still exists after removeManaged → it was soft-removed (was live on WP).
    ctx.schemaRepo.findOne = jest.fn().mockResolvedValue({ id: 'sch-9' });
    await ctx.service.accept('req-1');
    expect(ctx.schemaService.removeManaged).toHaveBeenCalledWith('sch-9');
    expect(ctx.schemaSyncService.publishSingle).toHaveBeenCalledWith('site-1', 'page-1', 'sch-9');
  });

  it('schema.delete of a never-published draft → removeManaged only, no publish', async () => {
    const ctx = makeService({
      module: 'schema', action: 'schema.delete', targetType: 'page', targetId: 'page-1',
      payload: { schemaId: 'sch-9' },
    });
    // Row gone after removeManaged → it was hard-deleted (never on WP).
    ctx.schemaRepo.findOne = jest.fn().mockResolvedValue(null);
    await ctx.service.accept('req-1');
    expect(ctx.schemaService.removeManaged).toHaveBeenCalledWith('sch-9');
    expect(ctx.schemaSyncService.publishSingle).not.toHaveBeenCalled();
    expect(ctx.schemaSyncService.publish).not.toHaveBeenCalled();
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
    expect(ctx.syncService.pushPageNow).not.toHaveBeenCalled();
  });

  it('accepting an already-decided request throws', async () => {
    const ctx = makeService({ status: 'accepted', module: 'meta', action: 'meta.update', targetId: 'p', payload: {} });
    await expect(ctx.service.accept('req-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publish failure leaves the request pending with the error recorded', async () => {
    const ctx = makeService({
      module: 'meta', action: 'meta.update', targetType: 'page', targetId: 'page-1', payload: { ogTitle: 'X' },
    });
    ctx.syncService.pushPageNow.mockRejectedValueOnce(new Error('WP unreachable'));
    await expect(ctx.service.accept('req-1')).rejects.toThrow('WP unreachable');
    expect(ctx.req.status).toBe('pending');
    expect(ctx.req.error).toBe('WP unreachable');
  });

  it('redirect.update → delegates to RedirectWriteService.applyChange, marks accepted', async () => {
    const ctx = makeService({
      module: 'redirect', action: 'redirect.update', targetType: 'redirect', targetId: 'redir-1',
      payload: { actionCode: 301 },
    });
    const out = await ctx.service.accept('req-1');
    expect(ctx.redirectWriteService.applyChange).toHaveBeenCalledWith(ctx.req);
    expect(out.status).toBe('accepted');
  });

  it('redirect push failure leaves the request pending with the error recorded', async () => {
    const ctx = makeService({
      module: 'redirect', action: 'redirect.create', targetType: 'redirect', targetId: '', payload: { source: '/a' },
    });
    ctx.redirectWriteService.applyChange.mockRejectedValueOnce(new Error('HTTP 502'));
    await expect(ctx.service.accept('req-1')).rejects.toThrow('HTTP 502');
    expect(ctx.req.status).toBe('pending');
    expect(ctx.req.error).toBe('HTTP 502');
  });
});
