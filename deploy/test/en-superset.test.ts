import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EnSupersetStack, EnSupersetStackProps } from '../lib/en-superset-stack';

const defaultProps: EnSupersetStackProps = {
  envName: 'test',
  ContainerImage: 'test-image',
};

test('RDS Cluster Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::RDS::DBCluster', {
    Engine: 'aurora-postgresql',
  });
});

test('ElastiCache Cluster Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ElastiCache::CacheCluster', {
    Engine: 'redis',
  });
});

test('ECS Cluster Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ECS::Cluster', {
    ClusterName: 'superset-test',
  });
});

test('ALB Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    Scheme: 'internet-facing',
  });
});

test('CloudFront Distribution Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      Enabled: true,
    },
  });
});

test('Secrets Manager Secret Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::SecretsManager::Secret', {
    Name: 'superset/cluster',
  });
});

test('Fargate Service Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ECS::Service', {
    LaunchType: 'FARGATE',
  });
});

test('Security Groups Created', () => {
  const app = new cdk.App();
  const stack = new EnSupersetStack(app, 'MyTestStack', defaultProps);
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::EC2::SecurityGroup', 4);
});

test('CloudFront Distribution with ACM Certificate', () => {
  const app = new cdk.App();
  const propsWithCert: EnSupersetStackProps = {
    ...defaultProps,
    ACMCertArn: 'arn:aws:acm:region:account:certificate/certificate-id',
    r53DnsName: 'example.com',
  };
  const stack = new EnSupersetStack(app, 'MyTestStackWithCert', propsWithCert);
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      Aliases: ['example.com'],
      ViewerCertificate: {
        AcmCertificateArn: 'arn:aws:acm:region:account:certificate/certificate-id',
        SslSupportMethod: 'sni-only',
      },
    },
  });
});
