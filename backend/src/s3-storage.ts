/**
 * Storage on S3 for the Lambda. Each document is one object, `<prefix><key>.json`. Conditional
 * writes use S3's If-Match / If-None-Match on PutObject, so the read-modify-write retries in
 * MarketService work the same as on disk. Only lambda.ts loads this file: the AWS SDK comes with
 * the Lambda runtime and isn't needed to run the local server.
 */
import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { ConflictError, type Storage, type Stored } from './storage';

export class S3Storage implements Storage {
  constructor(
    private bucket: string,
    private prefix = '',
    private client = new S3Client({}),
  ) {}

  private key(key: string): string {
    if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(key) || key.includes('..')) throw new Error(`Bad storage key "${key}".`);
    return `${this.prefix}${key}.json`;
  }

  async get(key: string): Promise<Stored | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      return { body: (await res.Body?.transformToString('utf8')) ?? '', etag: res.ETag ?? '' };
    } catch (e) {
      if (e instanceof S3ServiceException && (e.name === 'NoSuchKey' || e.$metadata.httpStatusCode === 404)) return null;
      throw e;
    }
  }

  async put(key: string, body: string, ifMatch?: string | null): Promise<string> {
    try {
      const res = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(key),
          Body: body,
          ContentType: 'application/json; charset=utf-8',
          ...(ifMatch === null ? { IfNoneMatch: '*' } : ifMatch !== undefined ? { IfMatch: ifMatch } : {}),
        }),
      );
      return res.ETag ?? '';
    } catch (e) {
      // 412: the object changed (or exists). 409: another conditional write to it is in flight.
      const status = e instanceof S3ServiceException ? e.$metadata.httpStatusCode : undefined;
      if (status === 412 || status === 409) throw new ConflictError(key);
      throw e;
    }
  }
}
