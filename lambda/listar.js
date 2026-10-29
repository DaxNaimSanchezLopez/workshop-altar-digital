// GET /elements?altarId=...  -> lista los elementos de un altar.
//
// Un Query por altarId (nunca un Scan), ascendente, acotado con Limit. La
// sort key sk es un detalle interno: se quita de cada item antes de devolver.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

const TABLA = process.env.TABLA
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
const respuesta = (statusCode, cuerpo) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(cuerpo),
})

export async function handler(event) {
  const altarId = event.queryStringParameters?.altarId
  if (!altarId) {
    return respuesta(400, { error: 'Falta altarId.' })
  }

  const salida = await doc.send(
    new QueryCommand({
      TableName: TABLA,
      KeyConditionExpression: 'altarId = :a',
      ExpressionAttributeValues: { ':a': altarId },
      ScanIndexForward: true,
      Limit: 200,
    }),
  )

  const elementos = (salida.Items || []).map(({ sk, ...resto }) => resto)
  return respuesta(200, { elementos })
}
