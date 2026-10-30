/**
 * Sends feedback emails through an SNS topic with an email subscription. Like s3-storage.ts, only
 * lambda.ts loads this file.
 */
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { Notifier } from './feedback';

export class SnsNotifier implements Notifier {
  constructor(
    private topicArn: string,
    private client = new SNSClient({}),
  ) {}

  async send(subject: string, text: string): Promise<void> {
    await this.client.send(new PublishCommand({ TopicArn: this.topicArn, Subject: subject, Message: text }));
  }
}
