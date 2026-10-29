// El stack del altar.
//
// El backend del módulo 3: una tabla de DynamoDB, un bucket privado de S3,
// tres Lambdas en JavaScript plano (lambda/) y una REST API con cuatro rutas.
// Mira .kiro/specs/ofrenda/design.md para el porqué de cada decisión.

import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import { Construct } from 'constructs'

export class OfrendaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // La tabla. La llave no se toca: todos los elementos de un altar viven en
    // la misma partición (altarId) y la sort key empieza con la fecha, así que
    // un Query ascendente los devuelve en orden.
    const tabla = new dynamodb.Table(this, 'Tabla', {
      tableName: 'ofrenda-elementos',
      partitionKey: { name: 'altarId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // El bucket privado para las imágenes. Solo se ven con URLs firmadas.
    const bucket = new s3.Bucket(this, 'Imagenes', {
      bucketName: `ofrenda-imagenes-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    })

    // Las tres Lambdas, en JavaScript plano montado con Code.fromAsset: el
    // código que escribes es el que corre, sin build ni Docker.
    const comun = {
      runtime: lambda.Runtime.NODEJS_24_X,
      code: lambda.Code.fromAsset('lambda'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
    }

    const listar = new lambda.Function(this, 'Listar', {
      ...comun,
      handler: 'listar.handler',
      environment: { TABLA: tabla.tableName },
    })
    tabla.grantReadData(listar)

    const agregar = new lambda.Function(this, 'Agregar', {
      ...comun,
      handler: 'agregar.handler',
      environment: { TABLA: tabla.tableName },
    })
    tabla.grantReadWriteData(agregar)

    const subir = new lambda.Function(this, 'Subir', {
      ...comun,
      handler: 'subir.handler',
      environment: { BUCKET: bucket.bucketName },
    })
    bucket.grantPut(subir)
    bucket.grantRead(subir)

    // La REST API. Stage v1, CORS en el preflight de cada ruta.
    const api = new apigateway.RestApi(this, 'Api', {
      deployOptions: { stageName: 'v1' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST'],
        allowHeaders: ['Content-Type'],
      },
    })

    const elements = api.root.addResource('elements')
    elements.addMethod('GET', new apigateway.LambdaIntegration(listar))
    elements.addMethod('POST', new apigateway.LambdaIntegration(agregar))

    const uploads = api.root.addResource('uploads')
    uploads.addMethod('POST', new apigateway.LambdaIntegration(subir))
    // Proxy greedy: el imageKey lleva un '/' (<altarId>/<uuid>.jpeg) y un path
    // parameter normal se cortaría en el '/'. El handler lo lee de proxy.
    const uploadsKey = uploads.addResource('{proxy+}')
    uploadsKey.addMethod('GET', new apigateway.LambdaIntegration(subir))

    // La base de la API; va en Amplify como VITE_API_URL.
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url })
  }
}
