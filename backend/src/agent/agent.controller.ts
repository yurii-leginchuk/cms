import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Res,
  HttpCode,
} from '@nestjs/common';
import { ServerResponse } from 'http';
import { AgentService } from './agent.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { ChatDto } from './dto/chat.dto';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('sessions')
  createSession(@Body() dto: CreateSessionDto) {
    return this.agentService.createSession(dto.siteId);
  }

  @Get('sessions/site/:siteId')
  getSessions(@Param('siteId') siteId: string) {
    return this.agentService.getSessions(siteId);
  }

  @Get('sessions/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.agentService.getMessages(id);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  deleteSession(@Param('id') id: string) {
    return this.agentService.deleteSession(id);
  }

  @Post('sessions/:id/chat')
  async chat(
    @Param('id') sessionId: string,
    @Body() dto: ChatDto,
    @Res({ passthrough: false }) res: ServerResponse,
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    await this.agentService.streamChat(
      sessionId,
      dto.message,
      res,
      dto.pageContext ?? null,
    );
  }
}
