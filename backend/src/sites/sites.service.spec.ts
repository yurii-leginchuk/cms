import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SitesService } from './sites.service';
import { Site, SiteStatus, EmbeddingStatus } from './site.entity';
import { SiteBrief } from './site-brief.entity';
import { ScraperService } from '../scraper/scraper.service';

const mockSite: Site = {
  id: 'uuid-1',
  name: 'Test Site',
  url: 'https://example.com',
  sitemapUrl: 'https://example.com/sitemap.xml',
  favicon: null,
  wpApiKey: null,
  hostedOnWpEngine: false,
  status: SiteStatus.IDLE,
  embeddingStatus: EmbeddingStatus.IDLE,
  pagesTotal: 0,
  pagesProcessed: 0,
  lastParsedAt: null,
  gscProperty: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  pages: [],
};

const mockRepo = {
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockBriefRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockScraperService = {
  parseSite: jest.fn(),
};

describe('SitesService', () => {
  let service: SitesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SitesService,
        { provide: getRepositoryToken(Site), useValue: mockRepo },
        { provide: getRepositoryToken(SiteBrief), useValue: mockBriefRepo },
        { provide: ScraperService, useValue: mockScraperService },
      ],
    }).compile();

    service = module.get<SitesService>(SitesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('should return sites with pagesCount', async () => {
      const qb = {
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ ...mockSite, pagesCount: 5 }]),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].pagesCount).toBe(5);
    });
  });

  describe('findOne', () => {
    it('should return a site by id', async () => {
      const qb = {
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...mockSite, pagesCount: 3 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findOne('uuid-1');

      expect(result.id).toBe('uuid-1');
    });

    it('should throw NotFoundException when site not found', async () => {
      const qb = {
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create and save a site', async () => {
      mockRepo.create.mockReturnValue(mockSite);
      mockRepo.save.mockResolvedValue(mockSite);

      const result = await service.create({
        name: 'Test Site',
        url: 'https://example.com',
        sitemapUrl: 'https://example.com/sitemap.xml',
      });

      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'Test Site',
        url: 'https://example.com',
        sitemapUrl: 'https://example.com/sitemap.xml',
      });
      expect(result).toEqual(mockSite);
    });
  });

  describe('remove', () => {
    it('should remove an existing site', async () => {
      mockRepo.findOne.mockResolvedValue(mockSite);
      mockRepo.remove.mockResolvedValue(undefined);

      await service.remove('uuid-1');

      expect(mockRepo.remove).toHaveBeenCalledWith(mockSite);
    });

    it('should throw NotFoundException when site not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('triggerParse', () => {
    it('should call scraperService.parseSite', async () => {
      mockRepo.findOne.mockResolvedValue(mockSite);
      mockScraperService.parseSite.mockResolvedValue(undefined);

      await service.triggerParse('uuid-1');

      expect(mockScraperService.parseSite).toHaveBeenCalledWith('uuid-1');
    });

    it('should throw NotFoundException when site not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.triggerParse('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
