/**
 * "This lobby changed" notices, published to an AppSync Events channel per lobby
 * (/lobbies/<id>). Browsers subscribe and refetch the lobby from the API, so a notice carries
 * only a version number: a forged one could do no more than trigger a refetch. Publishing is
 * signed with the Lambda's own credentials (IAM); browsers may only subscribe.
 *
 * Only lambda.ts loads this file (it brings in the AWS request signer); see publisher.ts.
 */
import { createHash, createHmac, type Hash, type Hmac } from 'crypto';
import { SignatureV4 } from '@smithy/signature-v4';
import type { Publisher } from './publisher';

type Source = string | ArrayBuffer | ArrayBufferView;
const bytes = (d: Source) => (typeof d === 'string' ? d : ArrayBuffer.isView(d) ? Buffer.from(d.buffer, d.byteOffset, d.byteLength) : Buffer.from(d));

/** The hash SignatureV4 expects, on top of Node's crypto. */
class Sha256 {
  private hash: Hash | Hmac;
  constructor(secret?: Source) {
    this.hash = secret ? createHmac('sha256', bytes(secret)) : createHash('sha256');
  }
  update(data: Source): void {
    this.hash.update(bytes(data));
  }
  async digest(): Promise<Uint8Array> {
    return new Uint8Array(this.hash.digest());
  }
  reset(): void {}
}

export class AppSyncPublisher implements Publisher {
  private signer: SignatureV4;

  constructor(
    private httpDomain: string,
    region: string,
  ) {
    this.signer = new SignatureV4({
      service: 'appsync',
      region,
      sha256: Sha256,
      // The Lambda runtime provides these for the function's role.
      credentials: async () => ({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }),
    });
  }

  async publish(channel: string, event: object): Promise<void> {
    const body = JSON.stringify({ channel, events: [JSON.stringify(event)] });
    const signed = await this.signer.sign({
      method: 'POST',
      protocol: 'https:',
      hostname: this.httpDomain,
      path: '/event',
      headers: { host: this.httpDomain, 'content-type': 'application/json' },
      body,
    });
    const res = await fetch(`https://${this.httpDomain}/event`, { method: 'POST', headers: signed.headers as Record<string, string>, body, signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`AppSync publish failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}
