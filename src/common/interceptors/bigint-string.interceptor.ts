import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Recursively converts BigInt values to strings in HTTP response payloads.
 *
 * Diverges from glucose-api/src/common/interceptors/custom-bigint.interceptor.ts:
 * - Always emits BigInt as string (no Number coercion, even for safe integers).
 * - Does NOT patch BigInt.prototype.toJSON globally — the admin-client relies on
 *   consistent string types across every response.
 *
 * Bypass: when Content-Type is application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 * (Excel exports — admin-api will use exceljs in later phases), the value passes through
 * untouched so binary streams are not mangled.
 */
@Injectable()
export class BigIntStringInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            map((value) => {
                // Streamed file responses must reach Nest's serializer as a
                // StreamableFile *instance* so the framework pipes the stream.
                // The recursive `convert` below deep-clones into a plain object,
                // turning a StreamableFile into `{"options":{...},"stream":{...}}`
                // which Nest then JSON-serializes — corrupting binary downloads
                // (e.g. submission PDFs arriving as application/pdf but containing
                // the serialized object). Pass it through untouched.
                if (value instanceof StreamableFile) {
                    return value;
                }
                const res = context.switchToHttp().getResponse();
                const contentType = res?.getHeader?.('content-type');
                if (typeof contentType === 'string' && contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
                    return value;
                }
                return convert(value, new WeakSet<object>());
            })
        );
    }
}

function convert(value: any, seen: WeakSet<object>): any {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    const t = typeof value;
    if (t !== 'object') {
        return value;
    }
    if (value instanceof Date) {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (seen.has(value)) {
        return value;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            out[i] = convert(value[i], seen);
        }
        return out;
    }
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
        out[key] = convert(value[key], seen);
    }
    return out;
}
