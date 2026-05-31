# NestJS Patterns in CherryWiki

CherryWiki API is built on NestJS with Fastify adapter.

## Module Structure

```typescript
@Module({
  imports: [
    DrizzleModule,
    AuthModule,
    ChatModule,
    UploadsModule,
    WikiModule,
    SpacesModule,
    GraphModule,
    AdminModule,
    BridgeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

## Guard Pattern: Permission Check

```typescript
@Injectable()
export class PermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.get<string[]>(
      'permissions', context.getHandler()
    );
    if (!requiredPermissions) return true;

    const request = context.switchToHttp().getRequest();
    const userPermissions = request.user?.permissions ?? [];
    return requiredPermissions.every(p => userPermissions.includes(p));
  }
}
```

## Interceptor: Response Wrapper

```typescript
@Injectable()
export class ResponseWrapperInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => ({
        data,
        meta: { timestamp: new Date().toISOString() }
      }))
    );
  }
}
```

All API responses are wrapped in `{"data": ..., "meta": {...}}` format by this interceptor.

## SSE Streaming Pattern

```typescript
@Post('chat/completions')
async streamCompletion(@Body() dto, @Res() reply) {
  const events = await this.chatService.streamCompletion(dto);

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  for await (const event of events) {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
}
```

## Error Handling

```typescript
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).send({
      error: {
        code: this.extractErrorCode(exception),
        message: this.extractMessage(exception),
      },
    });
  }
}
```
