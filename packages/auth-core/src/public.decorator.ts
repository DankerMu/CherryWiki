import { SetMetadata } from '@nestjs/common';

export const PUBLIC_METADATA_KEY = Symbol('PUBLIC_METADATA_KEY');

export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(PUBLIC_METADATA_KEY, true);
}
