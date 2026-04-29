import 'reflect-metadata';

export const AUDIT_METADATA_KEY = Symbol('AUDIT_METADATA_KEY');

export function Audited(action: string): MethodDecorator & ClassDecorator {
  return (target: object, _propertyKey?: string | symbol, descriptor?: PropertyDescriptor): void => {
    Reflect.defineMetadata(AUDIT_METADATA_KEY, action, getMetadataTarget(target, descriptor));
  };
}

function getMetadataTarget(target: object, descriptor: PropertyDescriptor | undefined): object {
  if (descriptor === undefined) {
    return target;
  }

  const descriptorValue: unknown = descriptor.value;
  return typeof descriptorValue === 'function' ? descriptorValue : target;
}
