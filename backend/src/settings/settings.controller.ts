import { Controller, Get, Put, Param, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

import { SECRET_KEYS } from './settings.constants';
export { SECRET_KEYS };

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  findAll() {
    return this.settingsService.findAll();
  }

  @Put(':key')
  async upsert(
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
  ) {
    const isSecret = SECRET_KEYS.has(key);
    await this.settingsService.upsert(key, dto.value ?? null, isSecret);
    return { success: true };
  }
}
