import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_METADATA_KEY = Symbol('PERMISSIONS_METADATA_KEY');

export function Permissions(...permissions: string[]): MethodDecorator & ClassDecorator {
  return SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
}
