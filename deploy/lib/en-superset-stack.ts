import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { InstanceType } from 'aws-cdk-lib/aws-ec2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as r53 from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Stack, StackProps, Fn, CfnCondition, CfnOutput,
        Tags, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Provider, Role, Database, Schema } from 'cdk-rds-sql';
import { RetentionDays, LogGroup, CfnQueryDefinition } from 'aws-cdk-lib/aws-logs';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

export interface EnSupersetStackProps extends StackProps {
  envName: string; // The environment name (e.g., development, staging, production)
  redisInstanceType?: string; // The instance type for Redis
  auroraInstanceType?: string; // The instance type for Aurora, without db. prefix
  supersetMemoryLimit?: number; // Memory Limit for Superset Service
  supersetCPU?: number; // CPU allocation for Superset Service
  supersetMinCapacity?: number; // Minimum number of tasks for the service
  supersetMaxCapacity?: number; // Maximum number of tasks for the service
  supersetDesiredCount?: number; // Desired number of tasks for the service
  r53DomainName?: string; // (Optional) The Route53 DomainName to use for the CloudFront distribution
  ACMCertArn?: string; // (Optional) The ACM certificate arn to use for the CloudFront distribution
  vpcIdParameter?: string; // The Parameter with VPC ID to use for the stack
  ContainerImage: string; // The container image to use for the Superset service
  FirstRun?: boolean; // If true, create the admin user and initialize the database
  
}

export class EnSupersetStack extends Stack {
  constructor(scope: Construct, id: string, props: EnSupersetStackProps) {
    super(scope, id, props);

    const envName = props.envName;
    const redisInstanceType = props.redisInstanceType || 'cache.t4g.medium';
    const auroraInstanceType = props.auroraInstanceType || 't4g.large';
    const supersetMemoryLimit = props.supersetMemoryLimit || 8192;
    const supersetCPU = props.supersetCPU || 2048;
    const r53DomainName = props.r53DomainName || 'none';
    const ACMCertArn = props.ACMCertArn || 'none';
    const vpcIdParameter = props.vpcIdParameter || '/base/network/vpcId';
    const ContainerImage = props.ContainerImage ;
    const FirstRun = props.FirstRun || false;
    const supersetMinCapacity = props.supersetMinCapacity || 1;
    const supersetMaxCapacity = props.supersetMaxCapacity || 2;
    const supersetDesiredCount = props.supersetDesiredCount || 1;
    const supersetUrl = `https://superset.${r53DomainName}/`;

    
    

    // Route53 Zone and ACM Certificate, must set both of them to use SSL
    // The assumption is that the actual r53 record is created outside this stack but
    // we need to set the dns name with the certificate in cloudfront on creation

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
      vpcId: StringParameter.valueFromLookup(this, vpcIdParameter),
    });

    // Security Groups
    const redisSecurityGroup = new ec2.SecurityGroup(this, `superset-RedisSecurityGroup`, {
      vpc
    });

    Tags.of(redisSecurityGroup).add('Name', `superset-redis-${envName}`);

    const serviceSecurityGroup = new ec2.SecurityGroup(this, `superset-ServiceSecurityGroup`, {
      vpc
    });

    Tags.of(serviceSecurityGroup).add('Name', `superset-${envName}`);

    const albSecurityGroup = new ec2.SecurityGroup(this, `superset-ALBSecurityGroup`, {
      vpc
    });

    Tags.of(albSecurityGroup).add('Name', `superset-alb-${envName}`);

    const dbSecurityGroup = new ec2.SecurityGroup(this, `superset-DBSecurityGroup`, {
      vpc
    });
    Tags.of(dbSecurityGroup).add('Name', `$superset-db-{envName}`);
    

    // Lookup the CloudFront prefix list ID

    const cloudFrontPrefixListIdResource = new AwsCustomResource(this, 'CloudFrontPrefixListIdResource', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: {
          Filters: [
            {
              Name: 'prefix-list-name',
              Values: ['com.amazonaws.global.cloudfront.origin-facing']
            }
          ]
        },
        physicalResourceId: PhysicalResourceId.of('CloudFrontPrefixListId')
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
      logRetention: RetentionDays.ONE_DAY
    });

    const cloudFrontPrefixListId = cloudFrontPrefixListIdResource.getResponseField('PrefixLists.0.PrefixListId');

    new ec2.CfnSecurityGroupIngress(this, `superset-ALBSecurityGroupIngressCloudFront`, {
      groupId: albSecurityGroup.securityGroupId,
      sourcePrefixListId: cloudFrontPrefixListId,
      description: 'Allow CloudFront to access the ALB',
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80
    });

    new ec2.CfnSecurityGroupIngress(this, `superset-DBSecurityGroupIngress`, {
      groupId: dbSecurityGroup.securityGroupId,
      sourceSecurityGroupId: serviceSecurityGroup.securityGroupId,
      description: 'Allow supserset service to access the database',
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432
    });

    new ec2.CfnSecurityGroupIngress(this, `superset-redisSecurityGroupIngress`, {
      groupId: redisSecurityGroup.securityGroupId,
      sourceSecurityGroupId: serviceSecurityGroup.securityGroupId,
      description: 'Allow superset service to access the Redis cluster',
      ipProtocol: 'tcp',
      fromPort: 6379,
      toPort: 6379
    });

    new ec2.CfnSecurityGroupIngress(this, `superset-serviceSecurityGroupIngress`, {
      groupId: serviceSecurityGroup.securityGroupId,
      sourceSecurityGroupId: albSecurityGroup.securityGroupId,
      description: 'Allow ALB to access the service',
      ipProtocol: 'tcp',
      fromPort: 8088,
      toPort: 8088
    });

    // Generate the credentials and store in secrets manager


    const dbSecret = new rds.DatabaseSecret(this, 'AuroraSecret', {
      secretName: `superset/cluster`,
      username: 'postgres',
      excludeCharacters: '/@"',
    });

    const supersetAppSecret = new secretsmanager.Secret(this, 'SupersetAppSecret', {
      secretName: `superset/supersetapp`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'superset' }),
        generateStringKey: 'secret',
        excludeCharacters: '/@"',
      },
    });

    const supersetDatabaseUserSecret = secretsmanager.Secret.fromSecretNameV2(this, 
      'SupersetDatabaseSecret',  
      'superset/database');

    const dbCluster = new rds.DatabaseCluster(this, `superset-AuroraCluster`, {
      clusterIdentifier: `superset-${envName}-AuroraCluster`,
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4
      }),
      writer: rds.ClusterInstance.provisioned( 'writer',{
        instanceIdentifier: `superset-${envName}-writer`,
        instanceType: new InstanceType(auroraInstanceType),
      }),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      vpc: vpc,
      credentials: rds.Credentials.fromSecret(dbSecret),
      defaultDatabaseName: 'superset_db',
      removalPolicy: RemovalPolicy.DESTROY,
      securityGroups: [dbSecurityGroup]
    });


     // Create the superset user in the database and grant necessary permissions

     const provider = new Provider(this, "Provider", {
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      cluster: dbCluster,
      secret: dbCluster.secret!,
    })

    const superset_dbuser = new Role(this, "Role", {
      provider: provider,
      roleName: "superset_user",
      databaseName: "superset_db",
      secretName: "superset/database",
    })

    new Database(this, "Database", {
      provider: provider,
      databaseName: "public",
    })

    new Schema(this, "Schema", {
      provider: provider,
      schemaName: "public",
      role: superset_dbuser,
    })


    const redisCluster = new elasticache.CfnCacheCluster(this, `superset-RedisCluster`, {
      clusterName: `superset-${envName}`,
      cacheNodeType: redisInstanceType,
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: new elasticache.CfnSubnetGroup(this, `superset-RedisSubnetGroup`, {
        description: 'Subnet group for Redis cluster',
        subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId)
      }).ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId]
    });

    const supersetEcsCluster = new ecs.Cluster(this, `superset-ecs-cluster`, {
      vpc,
      clusterName: `superset-${envName}`
    });

    const executionRole = new iam.Role(this, `superset-ExecutionRole`, {
      roleName: `superset-${envName}-ExecutionRole`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly')
      ]
    });


    const taskRole = new iam.Role(this, `superset-TaskRole`, {
      roleName: `superset-${envName}-TaskRole`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const taskRolePolicy = new iam.Policy(this, `superset-TaskRolePolicy`, {
      policyName: `superset-${envName}-TaskRolePolicy`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'ssmmessages:CreateControlChannel',
            'ssmmessages:CreateDataChannel',
            'ssmmessages:OpenControlChannel',
            'ssmmessages:OpenDataChannel'
          ],
          resources: ['*']
        })
      ]
    });

    taskRole.attachInlinePolicy(taskRolePolicy);

    const taskDefinition = new ecs.FargateTaskDefinition(this, `superset-SupersetTaskDefinition`, {
      memoryLimitMiB: supersetMemoryLimit,
      cpu: supersetCPU,
      executionRole: executionRole,
      taskRole: taskRole,
      family: 'superset'
    });

    let TaskCommand: string;

    if (FirstRun) {
      TaskCommand = '/usr/bin/run-server.sh & sleep 30 && superset fab create-admin --username admin --firstname Superset --lastname Admin --email admin@superset.com --password admin && superset db upgrade && superset init && tail -f /dev/null'
    } else {
      TaskCommand = '/usr/bin/run-server.sh && superset db upgrade && superset init'
    }

    const SupersetLogGroup = new LogGroup(this, `superset-LogGroup`, {
      logGroupName: `/ecs/${envName}/superset`,
      removalPolicy: RemovalPolicy.DESTROY
    })

    // Log Insights Query which filters out all the health checks
    new CfnQueryDefinition(this, 'LogQueryExcHealth', {
      name: 'superset/ExcludeHealthChecks',
      queryString: `fields @timestamp, @message
                  | sort @timestamp desc
                  | filter @message not like "GET /health HTTP/1.1"
                  | limit 10000`,
    
      logGroupNames: [SupersetLogGroup.logGroupName],
    });

    // Log Insights Query which filters out all the HTTP requests
    new CfnQueryDefinition(this, 'LogQueryExcHTTP', {
      name: 'superset/ExcludeHTTPRequests',
      queryString: `fields @timestamp, @message
                  | sort @timestamp desc
                  | filter @message not like /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
                  | limit 10000`,
    
      logGroupNames: [SupersetLogGroup.logGroupName],
    });


    taskDefinition.addContainer('SupersetContainer', {
      containerName: 'Superset',
      image: ecs.ContainerImage.fromRegistry(ContainerImage),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8088/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60)
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'ecs',
        logGroup: SupersetLogGroup
      }),
      portMappings: [
        {
          containerPort: 8088,
          hostPort: 8088,
          protocol: ecs.Protocol.TCP
        }
      ],
      environment: {
        REDIS_HOST: redisCluster.attrRedisEndpointAddress,
        DATABASE_DIALECT: 'postgresql',
        REDIS_PORT: '6379',
        REDIS_RESULTS_DB: '1',
        SUPERSET_ENV: 'production',
        SUPERSET_LOAD_EXAMPLES: 'no',
        REDIS_CELERY_DB: '0',
        DATABASE_USER: 'superset_user',
        DATABASE_HOST: dbCluster.clusterEndpoint.hostname,
        DATABASE_PORT: dbCluster.clusterEndpoint.port.toString(),
        DATABASE_DB: 'superset_db',
        PUBLIC_URL: supersetUrl,
      },
      secrets: {  
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(supersetDatabaseUserSecret, 'password'),
        SUPERSET_SECRET_KEY: ecs.Secret.fromSecretsManager(supersetAppSecret, 'secret')
      },
      entryPoint: ['sh', '-c'],
      command: [ TaskCommand ],
    });

    const fargateService = new ecs.FargateService(this, `superset-SupersetService`, {
      serviceName: `superset-${envName}`,
      cluster: supersetEcsCluster,
      taskDefinition: taskDefinition,
      desiredCount: (FirstRun) ? 1: supersetDesiredCount, // Only one task for the first run
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [serviceSecurityGroup],
      healthCheckGracePeriod: Duration.minutes(5),
      circuitBreaker: { rollback: true },
    });

    // Configure some simple scaling

    const scaling = fargateService.autoScaleTaskCount({
      minCapacity: (FirstRun) ? 1: supersetMinCapacity,
      maxCapacity: (FirstRun) ? 1: supersetMaxCapacity,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80
    });

    fargateService.node.addDependency(dbCluster);
    fargateService.node.addDependency(redisCluster);
    fargateService.node.addDependency(provider);

    // Expose the service via an Application Load Balancer through Cloudfront
    // TODO: Switch to private origin once CDK supports it

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, `superset-ALB`, {
      loadBalancerName: `superset-${envName}`,
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup
    });

    const listener = loadBalancer.addListener(`superset-Listener`, {
      port: 80,
      open: false
    });

    listener.addTargets(`superset-ECS`, {
      port: 80,
      targets: [fargateService],
      healthCheck: {
        path: '/health',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5
      }
    });



    // Crappy condition to get the CloudFront distribution to work with or without a certificate

    let distribution: cloudfront.Distribution;

    if ( ACMCertArn == 'none' && r53DomainName == 'none') {
      distribution = new cloudfront.Distribution(this, `superset-CDNDistribution`, {
        comment: `superset-${envName}`,
        defaultBehavior: {
          origin: new origins.LoadBalancerV2Origin(loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            httpPort: 80
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      });
    } else {

      distribution = new cloudfront.Distribution(this, `superset-CDNDistribution`, {
        comment: `superset-${envName}`,
        defaultBehavior: {
          origin: new origins.LoadBalancerV2Origin(loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            httpPort: 80
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
        domainNames: [`superset.${r53DomainName}`],
        certificate: acm.Certificate.fromCertificateArn(this, 'ACMCertificate', ACMCertArn),
      });
    }
    
    if (r53DomainName != 'none') {
      new r53.ARecord(this, `superset-DNSRecord`, {
        zone: r53.HostedZone.fromLookup(this, 'MyZone', { domainName: r53DomainName}),
        target: r53.RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        recordName: `superset.${r53DomainName}`,
      });
    }

    // CloudWatch Alarms
    new cloudwatch.Alarm(this, `superset-TaskCpuUtilizationAlarm`, {
      alarmName: `superset-${envName}-TaskCpuUtilizationAlarm`,
      metric: fargateService.metricCpuUtilization(),
      threshold: 80,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if task CPU utilization exceeds 80%'
    });

    new cloudwatch.Alarm(this, `superset-TaskMemoryUtilizationAlarm`, {
      alarmName: `superset-${envName}-TaskMemoryUtilizationAlarm`,
      metric: fargateService.metricMemoryUtilization(),
      threshold: 80,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if task memory utilization exceeds 80%'
    });

    new cloudwatch.Alarm(this, `superset-Task5xxCountAlarm`, {
      alarmName: `superset-${envName}-Task5xxCountAlarm`,
      metric: loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT),
      threshold: 5,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if task 5xx count exceeds 5 datapoints'
    });

    new cloudwatch.Alarm(this, `superset-RedisCpuUtilizationAlarm`, {
      alarmName: `superset-${envName}-RedisCpuUtilizationAlarm`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          CacheClusterId: redisCluster.ref
        }
      }),
      threshold: 60,
      evaluationPeriods: 3,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if Redis CPU utilization exceeds 60%'
    });

    new cloudwatch.Alarm(this, `superset-RedisMemoryUtilizationAlarm`, {
      alarmName: `superset-${envName}-RedisMemoryUtilizationAlarm`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'DatabaseMemoryUsagePercentage',
        dimensionsMap: {
          CacheClusterId: redisCluster.ref
        }
      }),
      threshold: 80,
      evaluationPeriods: 3,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if Redis memory utilization exceeds 80%'
    });

    new cloudwatch.Alarm(this, `superset-AuroraCpuUtilizationAlarm`, {
      alarmName: `superset-${envName}-AuroraCpuUtilizationAlarm`,
      metric: dbCluster.metricCPUUtilization(),
      threshold: 90,
      evaluationPeriods: 5,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if Aurora CPU utilization exceeds 90%'
    });

    new cloudwatch.Alarm(this, `superset-AuroraFreeableMemoryAlarm`, {
      alarmName: `superset-${envName}-AuroraFreeableMemoryAlarm`,
      metric: dbCluster.metricFreeableMemory(),
      threshold: 2 * 1024 * 1024 * 1024, // 2 GB
      evaluationPeriods: 5,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if Aurora freeable memory falls below 2 GB'
    });

    new cloudwatch.Alarm(this, `superset-CloudFront5xxErrorRateAlarm`, {
      alarmName: `superset-${envName}-CloudFront5xxErrorRateAlarm`,
      metric: distribution.metric('5xxErrorRate', {
        statistic: 'Sum',
        period: Duration.minutes(5)
      }),
      threshold: 5,
      evaluationPeriods: 5,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if CloudFront 5xx error rate exceeds 1%'
    });

    // Outputs
    new CfnOutput(this, 'LoadBalancerDNS', {
      value: loadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the Application Load Balancer, not publicly accessible'
    });

    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'The domain name of the CloudFront distribution'
    });


    if (r53DomainName) {
    new CfnOutput(this, 'R53DNSName', {
        value: `https://superset.${r53DomainName}/`,
        description: 'The DNS record for superset'
      });


  }
}
