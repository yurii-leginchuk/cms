import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { PageSchema, PageSchemaStatus } from './page-schema.entity';
import { SchemaHistory } from './schema-history.entity';
import { SchemaService } from './schema.service';
import { SchemaSyncService } from './schema-sync.service';

const mockPageRepo = { find: jest.fn(), findOne: jest.fn() };
const mockSiteRepo = { findOne: jest.fn() };
const mockManagedRepo = { find: jest.fn() };
const mockHistoryRepo = { save: jest.fn(), create: jest.fn() };
const mockSchemaService = { reparse: jest.fn() };

describe('SchemaSyncService — site-level', () => {
  let service: SchemaSyncService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchemaSyncService,
        { provide: getRepositoryToken(Page), useValue: mockPageRepo },
        { provide: getRepositoryToken(Site), useValue: mockSiteRepo },
        { provide: getRepositoryToken(PageSchema), useValue: mockManagedRepo },
        { provide: getRepositoryToken(SchemaHistory), useValue: mockHistoryRepo },
        { provide: SchemaService, useValue: mockSchemaService },
      ],
    }).compile();

    service = module.get<SchemaSyncService>(SchemaSyncService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('pendingSummary', () => {
    it('classifies add / edit / remove and aggregates counts', async () => {
      mockManagedRepo.find.mockResolvedValue([
        // never published → add
        {
          id: 's1',
          pageId: 'p1',
          type: 'Service',
          status: PageSchemaStatus.MODIFIED,
          source: 'human',
          validationStatus: 'valid',
          lastPublishedAt: null,
        },
        // previously published + modified → edit (also has errors)
        {
          id: 's2',
          pageId: 'p1',
          type: 'FAQPage',
          status: PageSchemaStatus.MODIFIED,
          source: 'ai_generated',
          validationStatus: 'errors',
          lastPublishedAt: new Date(),
        },
        // soft-removed → remove
        {
          id: 's3',
          pageId: 'p2',
          type: 'Article',
          status: PageSchemaStatus.REMOVED,
          source: 'imported',
          validationStatus: 'valid',
          lastPublishedAt: new Date(),
        },
      ]);
      mockPageRepo.find.mockResolvedValue([
        { id: 'p1', url: 'https://x.com/a' },
        { id: 'p2', url: 'https://x.com/b' },
      ]);

      const result = await service.pendingSummary('site-1');

      expect(result.totalChanges).toBe(3);
      expect(result.totalPages).toBe(2);
      expect(result.totalAdds).toBe(1);
      expect(result.totalEdits).toBe(1);
      expect(result.totalRemoves).toBe(1);
      expect(result.schemasWithErrors).toBe(1);

      const p1 = result.pages.find((p) => p.pageId === 'p1');
      expect(p1?.url).toBe('https://x.com/a');
      expect(p1?.items.map((i) => i.action)).toEqual(['add', 'edit']);
    });

    it('returns empty summary when nothing is pending', async () => {
      mockManagedRepo.find.mockResolvedValue([]);

      const result = await service.pendingSummary('site-1');

      expect(result.totalChanges).toBe(0);
      expect(result.pages).toHaveLength(0);
      expect(mockPageRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('publishAll', () => {
    it('throws when the site has no WP API key', async () => {
      mockSiteRepo.findOne.mockResolvedValue({ id: 'site-1', wpApiKey: null });

      await expect(service.publishAll('site-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound when the site is missing', async () => {
      mockSiteRepo.findOne.mockResolvedValue(null);

      await expect(service.publishAll('site-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when there are no pending changes', async () => {
      mockSiteRepo.findOne.mockResolvedValue({ id: 'site-1', wpApiKey: 'k' });
      mockManagedRepo.find.mockResolvedValue([]);

      await expect(service.publishAll('site-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('aggregates per-page results and survives a partial failure', async () => {
      mockSiteRepo.findOne.mockResolvedValue({ id: 'site-1', wpApiKey: 'k' });
      mockManagedRepo.find.mockResolvedValue([
        { pageId: 'p1' },
        { pageId: 'p1' },
        { pageId: 'p2' },
      ]);
      mockPageRepo.find.mockResolvedValue([
        { id: 'p1', url: 'https://x.com/a' },
        { id: 'p2', url: 'https://x.com/b' },
      ]);

      const publishSpy = jest
        .spyOn(service, 'publish')
        .mockResolvedValueOnce({ published: 2, at: 'now', reparsed: true })
        .mockRejectedValueOnce(new Error('boom'));

      const result = await service.publishAll('site-1');

      expect(publishSpy).toHaveBeenCalledTimes(2);
      expect(result.applied).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.perPage).toHaveLength(2);
      expect(result.perPage[1].error).toBe('boom');
    });
  });
});
