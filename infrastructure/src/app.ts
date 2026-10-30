#!/usr/bin/env node
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { App } from 'aws-cdk-lib';
import { H2eStack } from './stack';

/** The H2E account. CDK refuses to deploy with credentials for any other account. */
const ACCOUNT = '675536972377';

/** The admin token is generated on the first synth and kept out of git. */
const TOKEN_FILE = path.join(__dirname, '..', '.admin-token');

function adminToken(): string {
  if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, `${randomBytes(24).toString('base64url')}\n`, { mode: 0o600 });
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

const app = new App();
new H2eStack(app, 'H2E', {
  env: { account: ACCOUNT, region: 'us-east-1' },
  description: 'HD2 Galactic Market: site, market API, daily price update, feedback email',
  adminToken: adminToken(),
  feedbackEmail: 'helldivers2endgame@gmail.com',
  contact: 'helldivers2endgame@gmail.com',
  schedule: app.node.tryGetContext('schedule') !== 'off',
  domain: app.node.tryGetContext('domain') ? { name: app.node.tryGetContext('domain'), hostedZoneId: app.node.tryGetContext('hostedZoneId') } : undefined,
  waf: app.node.tryGetContext('waf') === 'on',
});
