// POST /elements  -> crea o borra un elemento (la misma ruta para ambos).
//
// Crear: la API pone id, creadoEn, posicion y sk; del cliente solo acepta
// unos pocos campos. Borrar: { borrar: true, id } busca el item en ese altar
// y lo elimina.

import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'

const TABLA = process.env.TABLA
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
const respuesta = (statusCode, cuerpo) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(cuerpo),
})

// Lo único que la API acepta del cliente. posicion y cualquier otro campo se
// ignoran: la posicion la calcula el servidor.
const CAMPOS = ['tipo', 'nivel', 'texto', 'link', 'puestoPor', 'imageKey']

export async function handler(event) {
  const cuerpo = JSON.parse(event.body || '{}')
  const altarId = cuerpo.altarId

  // Borrar.
  if (cuerpo.borrar === true && cuerpo.id) {
    if (!altarId) {
      return respuesta(400, { error: 'Falta altarId.' })
    }
    const salida = await doc.send(
      new QueryCommand({
        TableName: TABLA,
        KeyConditionExpression: 'altarId = :a',
        ExpressionAttributeValues: { ':a': altarId },
        Limit: 200,
      }),
    )
    const item = (salida.Items || []).find((el) => el.id === cuerpo.id)
    if (!item) {
      return respuesta(404, { error: 'Ese elemento no está en este altar.' })
    }
    await doc.send(
      new DeleteCommand({ TableName: TABLA, Key: { altarId, sk: item.sk } }),
    )
    return respuesta(200, { borrado: cuerpo.id })
  }

  // Crear.
  if (!altarId) {
    return respuesta(400, { error: 'Falta altarId.' })
  }
  if (!cuerpo.tipo) {
    return respuesta(400, { error: 'Falta tipo.' })
  }

  // Cuántos elementos hay ya en ese nivel, para la posicion.
  const nivel = cuerpo.nivel
  const existentes = await doc.send(
    new QueryCommand({
      TableName: TABLA,
      KeyConditionExpression: 'altarId = :a',
      ExpressionAttributeValues: { ':a': altarId },
      Limit: 200,
    }),
  )
  const posicion = (existentes.Items || []).filter((el) => el.nivel === nivel).length

  const permitidos = {}
  for (const campo of CAMPOS) {
    if (cuerpo[campo] !== undefined) permitidos[campo] = cuerpo[campo]
  }

  const id = randomUUID()
  const creadoEn = new Date().toISOString()
  const elemento = {
    ...permitidos,
    altarId,
    posicion,
    id,
    creadoEn,
    sk: `${creadoEn}#${id}`,
  }

  await doc.send(new PutCommand({ TableName: TABLA, Item: elemento }))

  const { sk, ...sinSk } = elemento
  return respuesta(201, sinSk)
}
