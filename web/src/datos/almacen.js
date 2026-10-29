// Donde se guarda el altar.
//
// ---------------------------------------------------------------------
//  ESTE ES EL UNICO ARCHIVO QUE CAMBIA EN EL MODULO 3.
// ---------------------------------------------------------------------
//
// Ya no guarda en el localStorage de ESTE navegador: le habla a tu propia
// API. Las cuatro funciones de abajo mantienen su firma y siguen siendo
// async, así que los componentes no se tocan ni una línea. Eso es a
// propósito: cuando la frontera entre tu app y donde viven los datos cabe en
// un archivo, cambiar de localStorage a una base de datos es un cambio chico
// y fácil de revisar.
//
// Por eso `agregar` recibe el File crudo de la imagen y lo procesa AQUI: la
// reduce a un Blob y lo sube a S3 con una URL firmada, guardando solo la
// imageKey en el elemento.

import { reducirABlob } from '../lib/imagen.js'

// El modo está escrito aquí como un dato y no se deduce de la configuración:
// el banner de la página tiene que decir lo que ESTE archivo hace de verdad.
// Ahora el altar vive en la nube.
export const MODO = 'nube'

const LLAVE = 'ofrenda:elementos'
const LLAVE_NOMBRE = 'ofrenda:nombre'

// La base de la API nunca se escribe en el código: sale del entorno de Vite.
// Se normaliza sin diagonal final para pegarle las rutas sin dudar.
const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// La misma URL abre el mismo altar en la laptop y en el teléfono.
const altarId = window.location.hostname

// Para que la migración desde la laptop corra una sola vez.
let migracionHecha = false

/** Todos los elementos del altar, en el orden en que se pusieron. */
export async function listar() {
  const elementos = await pedirElementos()

  // Primera carga desde la laptop: si la nube está vacía, sube lo que ya
  // existía en el localStorage de este navegador.
  if (elementos.length === 0 && !migracionHecha) {
    migracionHecha = true
    const importados = await migrarDesdeLocal()
    if (importados.length > 0) return importados
  }

  return elementos
}

/** GET /elements?altarId=... -> el arreglo de elementos. */
async function pedirElementos() {
  const r = await fetch(`${API}/elements?altarId=${encodeURIComponent(altarId)}`)
  if (!r.ok) throw new Error('No pude leer el altar.')
  const datos = await r.json()
  return datos.elementos || []
}

/**
 * Agrega un elemento y devuelve cómo quedó guardado.
 *
 * Si trae `imagen` (el File del formulario), aquí se reduce a un Blob, se pide
 * una URL firmada, se sube directo a S3 y se guarda solo la imageKey en el
 * elemento. El componente nunca sabe qué pasó con el archivo: solo lo entrega.
 */
export async function agregar(elemento) {
  const { imagen, imagenLocal, ...resto } = elemento

  if (imagen) {
    const blob = await reducirABlob(imagen)
    resto.imageKey = await subirImagen(blob, 'image/jpeg')
  }

  return crear(resto)
}

/** POST /elements con los campos permitidos -> el elemento guardado. */
async function crear(campos) {
  const r = await fetch(`${API}/elements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      altarId,
      tipo: campos.tipo,
      nivel: campos.nivel,
      texto: campos.texto,
      link: campos.link,
      puestoPor: campos.puestoPor,
      imageKey: campos.imageKey,
    }),
  })
  if (!r.ok) throw new Error('No pude guardar el elemento.')
  return r.json()
}

/** Pide una URL firmada, sube el Blob a S3 y devuelve la imageKey. */
async function subirImagen(blob, contentType) {
  const r = await fetch(`${API}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ altarId, contentType }),
  })
  if (!r.ok) throw new Error('No pude firmar la subida de la imagen.')
  const { url, imageKey } = await r.json()

  const subida = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  })
  if (!subida.ok) throw new Error('No pude subir la imagen a S3.')

  return imageKey
}

/** Quita un elemento del altar. */
export async function borrar(id) {
  const r = await fetch(`${API}/elements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ altarId, borrar: true, id }),
  })
  if (!r.ok) throw new Error('No pude borrar el elemento.')
}

/**
 * De dónde sale la imagen de un elemento.
 *
 * En la nube la imagen vive en S3 y el elemento solo guarda su imageKey: aquí
 * se pide la URL firmada de lectura. Los elementos importados de la laptop que
 * aún traigan imagenLocal (data URL) siguen renderizando directo.
 */
export async function urlDeImagen(elemento) {
  if (elemento.imageKey) {
    const r = await fetch(`${API}/uploads/${elemento.imageKey}`)
    if (!r.ok) throw new Error('No pude leer la imagen.')
    const { url } = await r.json()
    return url
  }
  return elemento.imagenLocal || null
}

/**
 * Primera carga desde la laptop: sube a la nube lo que ya existía en el
 * localStorage de este navegador, incluidas las imágenes guardadas como data
 * URL. Devuelve los elementos ya importados.
 */
async function migrarDesdeLocal() {
  let locales
  try {
    const crudo = localStorage.getItem(LLAVE)
    if (crudo === null) return []
    locales = JSON.parse(crudo)
  } catch {
    return []
  }
  if (!Array.isArray(locales) || locales.length === 0) return []

  const importados = []
  for (const el of locales) {
    const campos = {
      tipo: el.tipo,
      nivel: el.nivel,
      texto: el.texto,
      link: el.link,
      puestoPor: el.puestoPor,
    }
    // Una imagen de la laptop viaja como data URL: la convertimos a Blob y la
    // subimos con el mismo flujo de URL firmada.
    if (el.imagenLocal) {
      const blob = await dataUrlABlob(el.imagenLocal)
      campos.imageKey = await subirImagen(blob, blob.type || 'image/jpeg')
    }
    importados.push(await crear(campos))
  }
  return importados
}

/** Convierte una data URL (texto) en un Blob (bytes) para subirla a S3. */
async function dataUrlABlob(dataUrl) {
  const r = await fetch(dataUrl)
  return r.blob()
}

/** Quien está poniendo cosas en el altar. Se pregunta una sola vez. */
export function nombre() {
  return localStorage.getItem(LLAVE_NOMBRE) || ''
}

export function guardarNombre(valor) {
  localStorage.setItem(LLAVE_NOMBRE, valor.slice(0, 40))
}
