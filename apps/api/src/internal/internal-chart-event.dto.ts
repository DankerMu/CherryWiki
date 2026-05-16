import { IsNotEmpty, IsObject, IsString, ValidateBy, type ValidationOptions } from 'class-validator';

const CHERRYWIKI_CHART_TYPE = 'cherrywiki.chart';

export class InjectChartEventDto {
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @IsObject()
  @IsCherryWikiChart()
  chart!: Record<string, unknown>;
}

function IsCherryWikiChart(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCherryWikiChart',
      validator: {
        validate: (value: unknown): boolean => isPlainRecord(value) && value.type === CHERRYWIKI_CHART_TYPE,
        defaultMessage: (): string => `chart.type must equal "${CHERRYWIKI_CHART_TYPE}"`,
      },
    },
    validationOptions,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
