import 'source-map-support/register';
import { App, Stack, Tags } from 'aws-cdk-lib';
import { EnSupersetStack } from '../lib/en-superset-stack';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';

const envName = process.env.ENV_NAME || 'development';
const r53DomainName = 'myroute53domain.com';
const app = new App();


const acmStack = new Stack(app, 'AcmCertStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
});
const cert = new acm.Certificate(acmStack, 'Cert', {
  domainName: `superset.${r53DomainName}`,
  validation: acm.CertificateValidation.fromDns(
    route53.HostedZone.fromLookup(acmStack, 'HostedZone', {
        domainName: r53DomainName
      })),
});

const serviceStack = new EnSupersetStack(app, 'EnSupersetStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-central-1' 
  },
  crossRegionReferences: true, // Enable cross-region references
  envName: envName,
  vpcIdParameter: '/base/network/vpcId',
  r53DomainName: r53DomainName,
  ACMCertArn: cert.certificateArn,
  ContainerImage: '01234567890.dkr.ecr.eu-central-1.amazonaws.com/superset:4.11',
  FirstRun: true,

});

Tags.of(acmStack).add('environment', envName);
Tags.of(acmStack).add('service', 'superset');
Tags.of(serviceStack).add('environment', envName);
Tags.of(serviceStack).add('service', 'superset');