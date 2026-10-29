// POST /uploads          -> firma una URL para subir una imagen (PUT, 5 min).
// GET  /uploads/{proxy+}  -> firma una URL para ver una imagen (GET, 1 hora).
//
// La imagen no pasa por la Lambda: el navegador pide una URL firmada y sube
// directo a S3. El bucket es privado, así que leerla también necesita firma.

import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const BUCKET = process.env.BUCKET
// WHEN_REQUIRED para no firmar el checksum de un cuerpo vacío en la URL de PUT.
const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' })

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
const respuesta = (statusCode, cuerpo) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(cuerpo),
})

// contentType de imagen -> extensión del archivo.
const EXTENSIONES = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function handler(event) {
  if (event.httpMethod === 'GET') {
    // La llave lleva un '/', por eso viene por el proxy greedy.
    const imageKey = event.pathParameters?.proxy
    if (!imageKey) {
      return respuesta(400, { error: 'Falta la llave de la imagen.' })
    }
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: imageKey }),
      { expiresIn: 3600 },
    )
    return respuesta(200, { url })
  }

  // POST: firma para subir.
  const cuerpo = JSON.parse(event.body || '{}')
  const { altarId, contentType } = cuerpo
  if (!altarId) {
    return respuesta(400, { error: 'Falta altarId.' })
  }
  const ext = EXTENSIONES[contentType]
  if (!ext) {
    return respuesta(400, { error: 'El contentType no es una imagen válida.' })
  }

  const imageKey = `${altarId}/${randomUUID()}.${ext}`
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: imageKey, ContentType: contentType }),
    { expiresIn: 300 },
  )
  return respuesta(200, { url, imageKey })
}
