import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PagesService } from './pages.service';
import { Page, PageSyncStatus, IndexDirective } from './page.entity';
import { MetaHistory } from './meta-history.entity';
import { SyncService } from '../sync/sync.service';
import { AiService } from '../ai/ai.service';
import { PromptsService } from '../prompts/prompts.service';
import { Site } from '../sites/site.entity';
import { SiteBrief } from '../sites/site-brief.entity';
import { OptimizationEffectsService } from '../optimization-effects/optimization-effects.service';

const mockPage: Page = {
  id: 'page-uuid-1',
  siteId: 'site-uuid-1',
  site: null as any,
  url: 'https://example.com/about',
  rawHtml: '<html><title>About</title></html>',
  cleanContent: null,
  contentStructure: null,
  detectedSchemas: null,
  schemaCheckedAt: null,
  metaTitle: 'About Us',
  metaDescription: 'Learn about our company',
  h1Text: null,
  customMetaTitle: null,
  customMetaDescription: null,
  isTransactional: false,
  noindex: false,
  indexDirective: IndexDirective.DEFAULT,
  nofollow: false,
  canonical: null,
  ogTitle: null,
  ogDescription: null,
  ogImage: null,
  ogImageId: null,
  lastSyncedMeta: null,
  syncStatus: PageSyncStatus.IDLE,
  syncError: null,
  syncAppliedAt: null,
  lastScrapedAt: new Date(),
  missingFromSitemapAt: null,
  embedding: null,
  embeddingUpdatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getCount: jest.fn(),
  getMany: jest.fn(),
};

const mockRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockSync = { enqueue: jest.fn() };

describe('PagesService', () => {
  let service: PagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PagesService,
        { provide: getRepositoryToken(Page), useValue: mockRepo },
        { provide: getRepositoryToken(MetaHistory), useValue: { save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(Site), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SiteBrief), useValue: { findOne: jest.fn() } },
        { provide: SyncService, useValue: mockSync },
        { provide: AiService, useValue: { generateMeta: jest.fn() } },
        { provide: PromptsService, useValue: { findEffective: jest.fn() } },
        { provide: OptimizationEffectsService, useValue: { captureBaseline: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<PagesService>(PagesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findBySite', () => {
    it('should return paginated pages', async () => {
      mockQb.getCount.mockResolvedValue(2);
      mockQb.getMany.mockResolvedValue([mockPage]);
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.findBySite('site-uuid-1', 1, 50, '');

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should apply search filter when search is provided', async () => {
      mockQb.getCount.mockResolvedValue(0);
      mockQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      await service.findBySite('site-uuid-1', 1, 50, 'about');

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'page.url ILIKE :search',
        { search: '%about%' },
      );
    });
  });

  describe('findOne', () => {
    it('should return a page by id', async () => {
      mockRepo.findOne.mockResolvedValue(mockPage);

      const result = await service.findOne('page-uuid-1');

      expect(result.id).toBe('page-uuid-1');
    });

    it('should throw NotFoundException when page not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMeta', () => {
    it('should update customMetaTitle and customMetaDescription', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockPage });
      mockRepo.save.mockResolvedValue({
        ...mockPage,
        customMetaTitle: 'New Title',
        customMetaDescription: 'New description',
      });

      const result = await service.updateMeta('page-uuid-1', {
        customMetaTitle: 'New Title',
        customMetaDescription: 'New description',
      });

      expect(mockRepo.save).toHaveBeenCalled();
      expect(result.customMetaTitle).toBe('New Title');
    });

    it('mirrors indexDirective=noindex into the legacy boolean and enqueues a sync', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockPage });
      mockRepo.save.mockImplementation((p: Page) => Promise.resolve(p));

      const result = await service.updateMeta('page-uuid-1', {
        indexDirective: IndexDirective.NOINDEX,
      });

      expect(result.indexDirective).toBe(IndexDirective.NOINDEX);
      expect(result.noindex).toBe(true);
      expect(mockSync.enqueue).toHaveBeenCalledWith('site-uuid-1', 'page-uuid-1');
    });

    it('mirrors a legacy noindex=true (agent) into indexDirective', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockPage });
      mockRepo.save.mockImplementation((p: Page) => Promise.resolve(p));

      const result = await service.updateMeta('page-uuid-1', { noindex: true });

      expect(result.indexDirective).toBe(IndexDirective.NOINDEX);
      expect(result.noindex).toBe(true);
    });

    it('enqueues a sync when only an OG field changes', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockPage });
      mockRepo.save.mockImplementation((p: Page) => Promise.resolve(p));

      await service.updateMeta('page-uuid-1', { ogImage: 'https://cdn.test/og.png' });

      expect(mockSync.enqueue).toHaveBeenCalledWith('site-uuid-1', 'page-uuid-1');
    });

    it('does not enqueue a sync when nothing changes', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockPage });
      mockRepo.save.mockImplementation((p: Page) => Promise.resolve(p));

      await service.updateMeta('page-uuid-1', { noindex: false });

      expect(mockSync.enqueue).not.toHaveBeenCalled();
    });

    it('CLEARS customMetaTitle/customMetaDescription when null is sent (editor reset)', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...mockPage,
        customMetaTitle: 'Old custom title',
        customMetaDescription: 'Old custom description',
      });
      mockRepo.save.mockImplementation((p: Page) => Promise.resolve(p));

      const result = await service.updateMeta('page-uuid-1', {
        customMetaTitle: null,
        customMetaDescription: null,
      });

      expect(result.customMetaTitle).toBeNull();
      expect(result.customMetaDescription).toBeNull();
      expect(mockSync.enqueue).toHaveBeenCalledWith('site-uuid-1', 'page-uuid-1');
    });

    it('normalizes an empty string to null (clear), same as the canonical/OG fields', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...mockPage,
        customMetaTitle: 'Old custom title',
      });
      mockRepo.save.mockImplementation((p: Page) => Promise.resolve(p));

      const result = await service.updateMeta('page-uuid-1', { customMetaTitle: '' });

      expect(result.customMetaTitle).toBeNull();
    });
  });
});
