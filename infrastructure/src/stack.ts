/**
 * Everything the live site runs on, in one stack, chosen to stay inside AWS's always-free
 * allowances (or a few cents) at a few hundred players:
 *
 *   CloudFront ─┬─ /*      → S3 "Site": the static export (frontend/out), private, read through OAC
 *               └─ /api/*  → Lambda "Api" (function URL, IAM auth, so only CloudFront can call it)
 *                                → S3 "Data": market, history, feedback (versioned)
 *                                → SNS "Feedback" → email
 *   EventBridge (daily) → Lambda "Jobs" → market update
 *
 * Optional, switched on in cdk.json once they exist: the site's own domain (its Route 53 hosted
 * zone, which lives outside the stack, a free ACM certificate, www → apex redirect) and a
 * WAF web ACL for the CloudFront flat-rate Free plan, which requires one and covers its cost.
 *
 * No VPC, NAT, load balancer, database server, KMS key or Secrets Manager secret: those are what
 * make small AWS bills not small. The site is uploaded by scripts/deploy.sh, not by CDK.
 */
import * as path from 'path';
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

export interface H2eProps extends StackProps {
  /** For /api/admin/* (the ship terminal's `token <value>`). */
  adminToken: string;
  /** Where feedback is emailed. The address has to confirm the subscription once. */
  feedbackEmail: string;
  /** Sent to api.helldivers2.dev as X-Super-Contact. */
  contact: string;
  /** Run the market update every day. Off: prices only move when an admin runs `update`. */
  schedule: boolean;
  /** The site's domain and its Route 53 hosted zone (made outside the stack). Unset: only the cloudfront.net address. */
  domain?: { name: string; hostedZoneId: string };
  /**
   * Attach a WAF web ACL. Only with the flat-rate Free plan, which requires one and covers it:
   * on pay-as-you-go pricing this ACL would cost about $8 a month.
   */
  waf: boolean;
}

const REPO = path.resolve(__dirname, '..', '..');

/** The daily market update, in UTC: 05:00 on the US east coast, 11:00 in central Europe. */
const UPDATE_HOUR_UTC = '9';

/**
 * Viewer requests to the site: www.<domain> redirects to the bare domain, and since Next's export
 * links to /market/ but writes /market/index.html (S3 has no directory indexes), paths get their
 * index.html.
 */
const INDEX_REWRITE = `function handler(event) {
  var r = event.request;
  var host = r.headers.host ? r.headers.host.value : '';
  if (host.indexOf('www.') === 0) {
    var qs = Object.keys(r.querystring).map(function (k) { return k + '=' + r.querystring[k].value; }).join('&');
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: 'https://' + host.slice(4) + r.uri + (qs ? '?' + qs : '') } } };
  }
  if (r.uri.endsWith('/')) r.uri += 'index.html';
  else if (r.uri.split('/').pop().indexOf('.') === -1) r.uri += '/index.html';
  return r;
}`;

export class H2eStack extends Stack {
  constructor(scope: Construct, id: string, props: H2eProps) {
    super(scope, id, props);

    // Market, history and feedback. Versioned, so any document can be rolled back for 30 days.
    // Kept if the stack is deleted.
    const data = new s3.Bucket(this, 'Data', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // The static site. Every deploy re-uploads it, so it goes with the stack.
    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const feedback = new sns.Topic(this, 'Feedback', { displayName: 'H2E Feedback' });
    feedback.addSubscription(new subscriptions.EmailSubscription(props.feedbackEmail));

    const backend = (name: string, extra: Partial<NodejsFunctionProps>) =>
      new NodejsFunction(this, name, {
        entry: path.join(REPO, 'backend', 'src', 'lambda.ts'),
        handler: 'handler',
        projectRoot: REPO,
        depsLockFilePath: path.join(REPO, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        // The AWS SDK comes with the runtime, so it stays out of the bundle (the default for Node 18+).
        bundling: { minify: true, target: 'node22' },
        logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
        environment: {
          HD2E_STORAGE: 's3',
          HD2E_BUCKET: data.bucketName,
          HD2E_FEEDBACK_TOPIC: feedback.topicArn,
          HD2E_ADMIN_TOKEN: props.adminToken,
          HD2E_CONTACT: props.contact,
        },
        ...extra,
      });

    const api = backend('Api', { description: 'H2E market API, behind CloudFront /api/*', memorySize: 512, timeout: Duration.seconds(15) });
    const jobs = backend('Jobs', { description: 'H2E jobs: the daily market update, live war sync, console commands', memorySize: 1024, timeout: Duration.minutes(5) });
    data.grantReadWrite(api);
    data.grantReadWrite(jobs);
    feedback.grantPublish(api);

    const apiUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    const zone = props.domain && route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: props.domain.hostedZoneId, zoneName: props.domain.name });
    const names = props.domain ? [props.domain.name, `www.${props.domain.name}`] : [];
    // Public ACM certificates are free and renew themselves.
    const certificate = zone && new acm.Certificate(this, 'Certificate', { domainName: names[0], subjectAlternativeNames: names.slice(1), validation: acm.CertificateValidation.fromDns(zone) });

    // Requests WAF blocks don't count against the flat-rate plan's allowance. The Free plan takes
    // only plain rules (no path or header matching), so the rate limit covers the whole site. It's
    // high because one household (one IP) can be a whole squad loading hundreds of item icons.
    const rule = (name: string, priority: number, statement: wafv2.CfnWebACL.StatementProperty, managed = false): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      statement,
      ...(managed ? { overrideAction: { none: {} } } : { action: { block: {} } }),
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `h2e-${name}`, sampledRequestsEnabled: true },
    });
    const firewall =
      props.waf &&
      new wafv2.CfnWebACL(this, 'Firewall', {
        scope: 'CLOUDFRONT',
        defaultAction: { allow: {} },
        visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'h2e', sampledRequestsEnabled: true },
        rules: [
          rule('site-rate-limit', 0, { rateBasedStatement: { limit: 10_000, evaluationWindowSec: 300, aggregateKeyType: 'IP' } }),
          rule('ip-reputation', 1, { managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesAmazonIpReputationList' } }, true),
        ],
      });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'HD2 Galactic Market',
      defaultRootObject: 'index.html',
      domainNames: names.length ? names : undefined,
      certificate,
      webAclId: firewall ? firewall.attrArn : undefined,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        // LIST lets S3 answer 404 (not 403) for a missing page, so the 404 page below applies.
        origin: origins.S3BucketOrigin.withOriginAccessControl(site, { originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST] }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: new cloudfront.Function(this, 'IndexRewrite', { runtime: cloudfront.FunctionRuntime.JS_2_0, code: cloudfront.FunctionCode.fromInline(INDEX_REWRITE) }), eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        // Nothing here is cached at the edge; the API's ETags make repeat reads cheap 304s instead.
        '/api/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [{ httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(5) }],
    });
    // LIST would let a request for a directory list the bucket; the root object and the rewrite
    // above turn every directory request into an index.html request first.
    Annotations.of(distribution).acknowledgeWarning('@aws-cdk/aws-cloudfront-origins:listBucketSecurityRisk', 'defaultRootObject is set and INDEX_REWRITE maps directories to index.html.');

    if (zone) {
      // Alias records: queries to them are free, and they work at the apex where CNAMEs can't.
      const target = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution));
      names.forEach((recordName, i) => {
        new route53.ARecord(this, `Ipv4${i}`, { zone, recordName, target });
        new route53.AaaaRecord(this, `Ipv6${i}`, { zone, recordName, target });
      });
    }

    new events.Rule(this, 'DailyUpdate', {
      description: 'Runs the H2E market update once a day',
      enabled: props.schedule,
      schedule: events.Schedule.cron({ minute: '0', hour: UPDATE_HOUR_UTC }),
      // --min-hours: a retried or doubled trigger can't run two market days back to back.
      targets: [new targets.LambdaFunction(jobs, { event: events.RuleTargetInput.fromObject({ job: 'daily', args: ['--min-hours', '20'] }), retryAttempts: 2 })],
    });

    new CfnOutput(this, 'SiteUrl', { value: `https://${names[0] ?? distribution.distributionDomainName}` });
    new CfnOutput(this, 'DistributionArn', { value: distribution.distributionArn });
    if (firewall) new CfnOutput(this, 'FirewallArn', { value: firewall.attrArn });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'SiteBucket', { value: site.bucketName });
    new CfnOutput(this, 'DataBucket', { value: data.bucketName });
    new CfnOutput(this, 'JobsFunction', { value: jobs.functionName });
    new CfnOutput(this, 'FeedbackTopic', { value: feedback.topicArn });
  }
}
