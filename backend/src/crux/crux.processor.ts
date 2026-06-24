import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import axios, { AxiosError } from 'axios';
import { CruxResult } from './crux-result.entity';
import { SettingsService } from '../settings/settings.service';

export const CRUX_QUEUE = 'crux';

export interface CruxJobData {
  pageId: string;
  siteId: string;
  url: string;
  formFactor: 'PHONE' | 'DESKTOP';
}

const CWV_THRESHOLDS: Record<string, [number, number]> = {
  lcp:  [2500, 4000],
  fcp:  [1800, 3000],
  cls:  [0.1,  0.25],
  inp:  [200,  500],
  ttfb: [800,  1800],
};

function categorize(metric: string, value: number): 'good' | 'needs_improvement' | 'poor' {
  const [good, poor] = CWV_THRESHOLDS[metric] ?? [0, 0];
  if (value <= good) return 'good';
  if (value < poor)  return 'needs_improvement';
  return 'poor';
}

const CRUX_API = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

// Concurrency 1 + 500ms delay between jobs = ~120 req/min (limit: 150/min)
@Processor(CRUX_QUEUE, { concurrency: 1 })
export class CruxProcessor extends WorkerHost {
  private readonly logger = new Logger(CruxProcessor.name);

  constructor(
    @InjectRepository(CruxResult)
    private readonly cruxRepo: Repository<CruxResult>,
    private readonly settingsService: SettingsService,
  ) {
    super();
  }

  async process(job: Job<CruxJobData>): Promise<void> {
    const { pageId, siteId, url, formFactor } = job.data;

    const apiKey = await this.settingsService.getRaw('psi_api_key');
    if (!apiKey) { this.logger.warn('No API key — skipping CrUX'); return; }

    let data: any = null;
    let isOriginFallback = false;

    // 1. Try URL-level
    try {
      const res = await axios.post(CRUX_API, { url, formFactor }, {
        params: { key: apiKey },
        timeout: 15_000,
      });
      data = res.data;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 404) {
        // 2. Fallback to origin-level
        try {
          const origin = new URL(url).origin;
          const res = await axios.post(CRUX_API, { origin, formFactor }, {
            params: { key: apiKey },
            timeout: 15_000,
          });
          data = res.data;
          isOriginFallback = true;
        } catch { /* no data at all */ }
      } else {
        throw err;
      }
    }

    const metrics = data?.record?.metrics ?? null;
    const p75 = (key: string) => metrics?.[key]?.percentiles?.p75 ?? null;

    const lcpP75  = p75('largest_contentful_paint');
    const clsP75  = p75('cumulative_layout_shift');
    const fcpP75  = p75('first_contentful_paint');
    const inpP75  = p75('interaction_to_next_paint');
    const ttfbP75 = p75('experimental_time_to_first_byte');

    await this.cruxRepo.save(
      this.cruxRepo.create({
        pageId, siteId, url, formFactor,
        hasData: !!metrics,
        isOriginFallback,
        lcpP75, clsP75, fcpP75, inpP75, ttfbP75,
        lcpCategory:  lcpP75  != null ? categorize('lcp',  lcpP75)  : null,
        clsCategory:  clsP75  != null ? categorize('cls',  clsP75)  : null,
        fcpCategory:  fcpP75  != null ? categorize('fcp',  fcpP75)  : null,
        inpCategory:  inpP75  != null ? categorize('inp',  inpP75)  : null,
        fetchedAt: new Date(),
      }),
    );

    this.logger.debug(
      `CrUX ${formFactor} ${url} → ${metrics ? (isOriginFallback ? 'origin fallback' : 'ok') : 'no data'}`,
    );
  }
}
