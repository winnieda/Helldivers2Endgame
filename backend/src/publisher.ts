/**
 * Where lobby change notices go. On AWS that's AppSync Events (events.ts, loaded only by
 * lambda.ts); everywhere else nothing is published and browsers poll instead.
 */
export interface Publisher {
  publish(channel: string, event: object): Promise<void>;
}

export const noPublisher: Publisher = {
  async publish() {},
};
