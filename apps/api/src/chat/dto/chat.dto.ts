import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ChatCompletionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  space_id!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  session_id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}

export class ChatSessionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
