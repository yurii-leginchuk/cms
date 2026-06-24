import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PagesService } from './pages.service';
import { Page, PageSyncStatus } from './page.entity';
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
  canonical: null,
  syncStatus: PageSyncStatus.IDLE,
  syncError: null,
  syncAppliedAt: null,
  lastScrapedAt: new Date(),
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
        { provide: SyncService, useValue: { enqueue: jest.fn() } },
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
  });
});
