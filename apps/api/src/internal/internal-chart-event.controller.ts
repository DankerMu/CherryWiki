import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UnprocessableEntityException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Public } from '@cherrygraph/auth-core';

import { AgentService } from '../agent/agent.service.js';
import { AgentTokenGuard } from './agent-token.guard.js';
import { InjectChartEventDto } from './internal-chart-event.dto.js';

type HttpResponseLike = {
  status: (statusCode: number) => {
    send: (body: unknown) => void;
  };
};

@Catch(UnprocessableEntityException)
class InternalChartEventValidationFilter implements ExceptionFilter {
  catch(exception: UnprocessableEntityException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<HttpResponseLike>().status(HttpStatus.BAD_REQUEST).send(exception.getResponse());
  }
}

@Controller('internal/agent')
@Public()
@UseGuards(AgentTokenGuard)
@UseFilters(InternalChartEventValidationFilter)
export class InternalChartEventController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chart-event')
  @HttpCode(HttpStatus.ACCEPTED)
  injectChartEvent(@Body() dto: InjectChartEventDto): { status: string } {
    const result = this.agentService.injectChartEvent(dto.conversationId, dto.chart);
    if (result === 'not_found') {
      throw new HttpException({ message: 'No active agent turn for this conversation' }, HttpStatus.NOT_FOUND);
    }
    return { status: 'injected' };
  }
}
