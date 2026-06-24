import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';
import { SECRET_KEYS } from './settings.constants';

export interface SettingPublicDto {
  key: string;
  value: string | null;
  isSet: boolean;
  isSecret: boolean;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settingRepo: Repository<Setting>,
  ) {}

  async getRaw(key: string): Promise<string | null> {
    const setting = await this.settingRepo.findOne({ where: { key } });
    return setting?.value ?? null;
  }

  async findAll(): Promise<SettingPublicDto[]> {
    const settings = await this.settingRepo.find({ order: { key: 'ASC' } });
    return settings.map((s) => {
      const secret = SECRET_KEYS.has(s.key);
      return {
        key: s.key,
        isSet: s.value !== null && s.value !== '',
        isSecret: secret,
        value: secret ? null : s.value,
      };
    });
  }

  async upsert(key: string, value: string | null, isSecret = false): Promise<void> {
    await this.settingRepo.upsert(
      { key, value, isSecret },
      { conflictPaths: ['key'], skipUpdateIfNoValuesChanged: false },
    );
  }
}
