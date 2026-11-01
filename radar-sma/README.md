# Radar SMA · cómo sacar fiscalizaciones y sancionatorios desde SNIFA

Este documento explica cómo obtener de forma automática la información pública de la **Superintendencia del Medio Ambiente (SMA)**: fiscalizaciones, procedimientos sancionatorios, medidas provisionales, programas de cumplimiento y sanciones firmes. Es la base de un "radar" que avise cuando aparece algo nuevo de las instalaciones que seguimos.

> **No es un MCP ni una API oficial.** Es la misma consulta interna que usa el sitio [SNIFA](https://snifa.sma.gob.cl) para llenar sus tablas. Es pública, no pide clave ni registro y no tiene costo. La SMA puede cambiarla sin aviso, así que el radar debe fallar con un mensaje claro y no en silencio.
>
> Todo lo que sigue se probó contra SNIFA entre el 28-10-2026 y el 01-11-2026.

```
SNIFA (snifa.sma.gob.cl)
   │  POST → JSON (listados)   GET → HTML (fichas)   GET → PDF (documentos)
   ▼
Radar (Apps Script con disparador diario, o un servidor MCP)
   │  compara con la foto anterior, por número de expediente
   ▼
Pestaña "Radar SMA" de la planilla ──► aviso en la app / correo
```

---

## 1 · Qué hay en SNIFA

| Sección | Qué contiene | Cómo se consulta | Total al 01-11-2026 |
|---|---|---|---|
| Procedimientos sancionatorios | Expedientes `D-`, `F-`, `P-`… con su estado | `POST /Sancionatorio/ObtenerResultadosGrid` → **JSON** | 3.526 |
| Fiscalizaciones | Expedientes `DFZ-…` | `POST /Fiscalizacion/ObtenerResultadosGrid` → **JSON** | 59.669 (1.866 de 2026) |
| Catastro de unidades fiscalizables | Cada instalación regulada | `POST /UnidadFiscalizable/Resultado` → tabla HTML | — |
| Registro de sanciones | Sanciones firmes, con multa en UTA y si está pagada | `POST /RegistroPublico/Resultado` → tabla HTML | — |
| Medidas provisionales | Expedientes `MP-…` | `POST /MedidaProvisional/Resultado` → tabla HTML | — |
| Programas de cumplimiento | PdC aprobados y su ejecución | `POST /ProgramaCumplimiento/Resultado` → tabla HTML | — |
| Fichas de detalle | Todo lo de un expediente o una instalación | `GET /<Sección>/Ficha/{id}` → HTML | — |
| Documentos | Resoluciones, actas, informes, anexos | `GET /General/Descargar/{id}` → PDF, DOCX, XLSX o ZIP | — |

**Qué se publica y cuándo** (textos del propio SNIFA):

- **Sancionatorios:** se publican desde que se inician, también los que están **en curso**. Según las preguntas frecuentes de SNIFA, los documentos de sancionatorios y medidas provisionales se publican apenas se dictan.
- **Fiscalizaciones:** solo las **finalizadas**. Aparecen las que terminaron sin hallazgos y las que, con hallazgos, ya dieron pie a una formulación de cargos. Una fiscalización en curso **no se ve** hasta entonces.
- **Registro de sanciones:** solo sanciones **firmes**, es decir, sin recursos pendientes.

---

## 2 · Cómo se consulta

Todas las direcciones parten de `https://snifa.sma.gob.cl`.

### 2.1 Listados en JSON: sancionatorios y fiscalizaciones

Se envía un `POST` con el formulario (`application/x-www-form-urlencoded`):

| Campo | Qué es | Ejemplo |
|---|---|---|
| `draw` | Contador de la tabla; se devuelve igual | `1` |
| `start` | Desde qué fila (parte en 0) | `0` |
| `length` | Cuántas filas traer (ver límites en la sección 4) | `25` |
| `nombre` | Busca en el nombre de la unidad fiscalizable **o** en la razón social. No distingue mayúsculas. | `copec` |
| `expediente` | Busca el texto dentro del número de expediente | `F-036-2026`, `DFZ-2026` |
| `categoria` | Código de categoría (tabla 2.5); vacío = todas | `13` |
| `ddlRegion` | Códigos de región separados por coma (tabla 2.5) | `6` o `6,7` |
| `ddlComuna` | Códigos de comuna separados por coma | vacío |

Conviene enviar todos los campos, aunque vayan vacíos, igual que lo hace el sitio.

```bash
curl -sS -X POST https://snifa.sma.gob.cl/Sancionatorio/ObtenerResultadosGrid \
  -d "draw=1&start=0&length=25&nombre=copec&expediente=&categoria=&ddlRegion=&ddlComuna="
```

Respuesta:

```json
{
  "draw": 1,
  "recordsTotal": 11,
  "recordsFiltered": 11,
  "data": [
    ["1", "F-036-2026", "<ul…><a href='/UnidadFiscalizable/Ficha/9899'>TERMINAL MARITIMO DE QUINTERO COPEC</a>…",
     "<ul…>COPEC S.A.…", "<ul…>Infraestructura Portuaria…", "<ul…>Región de Valparaíso…", "En curso",
     "<a href='/Sancionatorio/Ficha/4674'>Ver detalles</a>"]
  ]
}
```

Cada fila es una lista de celdas, y varias traen **HTML**: hay que quitar las etiquetas para quedarse con el texto y sacar del `href` el **id de la ficha**.

**Columnas de sancionatorios (8):**

| # | Contenido |
|---|---|
| 0 | Correlativo |
| 1 | Expediente (ej. `F-036-2026`) |
| 2 | Unidad fiscalizable, con enlace a `/UnidadFiscalizable/Ficha/{id}` |
| 3 | Razón social del titular |
| 4 | Categoría |
| 5 | Región |
| 6 | Estado (texto plano) |
| 7 | Enlace a `/Sancionatorio/Ficha/{id}` |

Estados que aparecen: `En curso`, `Programa de Cumplimiento en ejecución`, `Terminado - Sanción`, `Terminado - PDC Satisfactorio`, `Terminado - Archivado`, `Terminado - Absolución` y `Suspendido`.

**Columnas de fiscalizaciones (9):**

| # | Contenido |
|---|---|
| 0 | Correlativo |
| 1 | Expediente (ej. `DFZ-2026-1173-V-NE`) |
| 2 | Razón social del titular |
| 3 | Categoría |
| 4 | Unidad fiscalizable, con enlace a `/UnidadFiscalizable/Ficha/{id}` |
| 5 | Región |
| 6 | Comuna |
| 7 | Estado (`En SNIFA`) |
| 8 | Enlace a `/Fiscalizacion/Ficha/{id}` |

### 2.2 Listados en HTML: unidades fiscalizables, registro de sanciones, medidas provisionales y programas de cumplimiento

Estas secciones no tienen JSON. El `POST` devuelve la página completa con una tabla `<table>` de resultados.

| Sección | Campos del formulario |
|---|---|
| `/UnidadFiscalizable/Resultado` | `nombre`, `categoria` |
| `/ProgramaCumplimiento/Resultado` | `nombre`, `expediente`, `categoria` |
| `/RegistroPublico/Resultado` | `txtPalabraClave`, `txtNumero`, `sltCategoria` |
| `/MedidaProvisional/Resultado` | `txtPalabraClave`, `txtNumero`, `sltCategoria` |

```bash
curl -sS -X POST https://snifa.sma.gob.cl/RegistroPublico/Resultado -d "txtPalabraClave=copec"
```

Columnas de cada tabla:

- **Unidades fiscalizables:** Unidad fiscalizable · Razón social · Región · Categoría · Comuna · enlace a la ficha.
- **Registro de sanciones:** Expediente · Unidad fiscalizable · Razón social · Categoría · Región · **Multa (UTA)** · **Pago de multa** · enlace a la ficha.
- **Medidas provisionales:** Expediente · Unidades fiscalizables · Razones sociales · Categoría · Región · Estado · enlace a la ficha.
- **Programas de cumplimiento:** Expediente · Unidad fiscalizable · Razón social · Categoría · Región · Comuna · enlace a la ficha.

### 2.3 Fichas de detalle (HTML)

| Ficha | Qué trae |
|---|---|
| `/Sancionatorio/Ficha/{id}` | Fecha de inicio y de término, estado, unidad fiscalizable, titular. Tablas de **documentos** (nombre, tipo, fecha y enlace de descarga), **hechos imputados** (norma infringida, letra del art. 35 y clasificación del art. 36 de la LOSMA: leve, grave o gravísima), fiscalizaciones asociadas, medidas provisionales y sanciones. |
| `/Fiscalizacion/Ficha/{id}` | Año, estado, unidad fiscalizable. Documentos (actas, reportes técnicos, informe de fiscalización, anexos), instrumentos fiscalizados, organismos participantes y sancionatorios asociados. |
| `/UnidadFiscalizable/Ficha/{id}` | **RUT** y razón social del o los titulares, tamaño de la empresa y código CIIU. Además: instrumentos aplicables (RCA con enlace al SEIA, normas de emisión, planes de descontaminación), **todas** sus fiscalizaciones, medidas provisionales, sancionatorios, requerimientos de ingreso e informes de seguimiento ambiental. |
| `/RegistroPublico/Ficha/{id}`, `/MedidaProvisional/Ficha/{id}`, `/ProgramaCumplimiento/Ficha/{id}` | El detalle de cada registro. |

La ficha de una unidad fiscalizable es la mejor fuente para seguir una instalación concreta, porque con **una sola consulta** trae todo lo asociado a ella. La del Terminal Marítimo de Quintero, por ejemplo, lista 73 fiscalizaciones, 3 sancionatorios, 2 medidas provisionales y 50 informes de seguimiento.

### 2.4 Documentos

```bash
curl -sS -o documento.pdf https://snifa.sma.gob.cl/General/Descargar/2060100099243
```

El servidor responde con el tipo de archivo (`Content-Type`) y su nombre original (`Content-Disposition`). En las fiscalizaciones también hay DOCX, XLSX y ZIP.

**Los PDF no se pueden leer como texto directamente.** De las dos muestras revisadas, la formulación de cargos usa fuentes sin mapeo de caracteres (al extraer el texto sale basura) y el acta de inspección no tiene texto, probablemente es un escaneo. Para buscar **dentro** de los documentos haría falta OCR. El radar no lo necesita: le basta el listado de documentos de cada ficha, con su nombre, tipo y fecha.

### 2.5 Códigos de los filtros

**Categoría** (`categoria` / `sltCategoria`):

| Código | Categoría | Código | Categoría |
|---|---|---|---|
| 6 | Agroindustrias | 1 | Instalación fabril |
| 20 | Alumbrado | 9 | Minería |
| 10 | Energía | 18 | Monitoreo de calidad ambiental |
| 11 | Equipamiento (incluye estaciones de servicio) | 15 | Otras categorías |
| 19 | ETCA | 8 | Pesca y Acuicultura |
| 14 | ETFA | 3 | Saneamiento Ambiental |
| 7 | Forestal | 13 | Transportes y almacenajes |
| 4 | Infraestructura de Transporte | 12 | Vivienda e Inmobiliarios |
| 2 | Infraestructura Hidráulica | 5 | Infraestructura Portuaria |

**Región** (`ddlRegion`):

| Código | Región | Código | Región |
|---|---|---|---|
| 1 | Arica y Parinacota | 10 | Biobío |
| 2 | Tarapacá | 11 | La Araucanía |
| 3 | Antofagasta | 12 | Los Ríos |
| 4 | Atacama | 13 | Los Lagos |
| 5 | Coquimbo | 14 | Aysén |
| 6 | Valparaíso | 15 | Magallanes |
| 7 | Metropolitana | 16 | Interregional |
| 8 | O'Higgins | 17 | Ñuble |
| 9 | Maule | | |

Las comunas de una región se obtienen con `POST /Home/ObtenerComunasPorRegion` y el campo `regionId`.

---

## 3 · Cómo funciona el radar

La idea es tomar una **foto diaria** de lo que SNIFA muestra para nuestra lista de seguimiento y compararla con la foto anterior. No conviene depender del orden de los resultados (sección 4); la llave es siempre el **número de expediente**.

1. **Lista de seguimiento.** Una pestaña con lo que queremos vigilar. Puede ser un término de búsqueda (`copec`), un titular o, más preciso, los **ids de las unidades fiscalizables** (el número de `/UnidadFiscalizable/Ficha/{id}`).
2. **Barrido diario**, para cada elemento de la lista:
   - Sancionatorios: una consulta con `length=1000`.
   - Fiscalizaciones: páginas de **49** filas hasta completar `recordsFiltered`.
   - Medidas provisionales, programas de cumplimiento y registro de sanciones: una consulta HTML cada uno.
   - Si se sigue por id de unidad fiscalizable, basta **una ficha por instalación**.
3. **Comparar con la foto anterior:**
   - Expediente que no estaba → **nuevo** (fiscalización publicada, sancionatorio iniciado, medida provisional, sanción firme).
   - Expediente cuyo estado cambió → **movimiento** (por ejemplo, de `En curso` a `Programa de Cumplimiento en ejecución` o a `Terminado - Sanción`).
4. **Sancionatorios abiertos:** abrir su ficha y comparar la tabla de documentos. Un documento nuevo es un **hito** (formulación de cargos, resolución, requerimiento de información, sanción), con su fecha y enlace de descarga.
5. **Anotar y avisar:** escribir una fila por novedad en la pestaña del radar (fecha, tipo, expediente, instalación, titular, estado, enlace) y avisar en la app o por correo.

**Carga estimada para Copec** con búsqueda por nombre: 1 consulta de sancionatorios (11 expedientes), 5 de fiscalizaciones (221 expedientes), 3 de las secciones HTML y 5 fichas de sancionatorios no terminados (3 en curso y 2 con programa de cumplimiento en ejecución). En total, unas **15 consultas al día**: nada para el servidor de la SMA si se espera 1 o 2 segundos entre consultas.

**Ejemplo real de lo que detecta el radar:** el **F-036-2026**, Terminal Marítimo de Quintero de COPEC S.A., en curso. Los cargos se formularon el 08-10-2026 por superar el volumen de descarga de riles autorizado (D.S. 90/2000), con infracción **leve**. El 23-10-2026 se agregó al expediente un formulario de asistencia al cumplimiento.

---

## 4 · Reglas y rarezas (probadas)

- **Fiscalizaciones con filtro: máximo 49 filas por página.** Con `nombre` o `expediente` y `length` de 50 o más, la respuesta llega **vacía** (`recordsTotal: 0`) sin error. Con 49 o menos funciona.
- **Sin filtro: hasta 1.000 filas por página.** Probado en sancionatorios y fiscalizaciones. Con 5.000 el servidor responde error 500.
- **Orden:**
  - Sancionatorios: de más nuevo a más antiguo.
  - Fiscalizaciones sin filtro: de más **antigua** a más nueva (parten en 2013). El parámetro `order` de la tabla se ignora y pedir la última página directamente devuelve vacío.
  - Fiscalizaciones con filtro por nombre: sin orden cronológico.
  - **Fiscalizaciones del año:** `expediente=DFZ-2026` trae solo las de 2026, de la más nueva a la más antigua. Se puede combinar con `nombre`: `copec` + `DFZ-2026` da 16.
- **La búsqueda por nombre mezcla titulares.** `copec` encuentra a COPEC S.A. y también estaciones con "Copec" en el nombre operadas por terceros, como Copec Angamos, cuya sanción en el registro público figura a nombre de otra razón social. Para separarlas, filtrar por la razón social (columna 3 en sancionatorios, columna 2 en fiscalizaciones) o seguir por id de unidad fiscalizable.
- **No se puede buscar por RUT.** El RUT solo aparece en la ficha de la unidad fiscalizable (COPEC S.A.: 99.520.000-7).
- **No hay `robots.txt` ni términos de uso de esta consulta.** Conviene identificarse con un `User-Agent` propio, esperar entre consultas y no repetir barridos completos de las 59 mil fiscalizaciones si no hace falta.
- **Certificado del sitio.** SNIFA usa un certificado de **emSign (eMudhra)**, una raíz que está en el almacén de Mozilla pero falta en algunos sistemas. En el contenedor donde se probó hubo que agregar el paquete `certifi` de Python para que `curl` lo aceptara. **No está probado** si `UrlFetchApp` de Apps Script lo acepta: es lo primero que hay que verificar.
- **Datos Abiertos.** La sección [Datos Abiertos](https://snifa.sma.gob.cl/DatosAbiertos) enlaza a carpetas públicas de Google Drive de la SMA (sancionatorios, fiscalizaciones, unidades fiscalizables, sanciones firmes, riles, termoeléctricas, REP y biodiversidad). No se pudo revisar qué archivos contienen. Las carpetas de sancionatorios y fiscalizaciones figuran modificadas por última vez en 2021, así que para el radar es mejor la consulta en vivo.

---

## 5 · Boceto en Apps Script

> Boceto para mostrar la forma de la consulta. La lógica se probó contra SNIFA real en Node, reemplazando `UrlFetchApp` por `curl`: con `copec` devolvió los 11 sancionatorios y las 221 fiscalizaciones, sin repetidos. **No está probado dentro de Apps Script**: antes de usarlo hay que verificar el certificado (sección 4).

```js
const SNIFA = 'https://snifa.sma.gob.cl';

// Quita las etiquetas HTML de una celda y deja el texto.
function snifaTexto_(celda) {
  return String(celda || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Saca el id numérico del primer enlace de una celda (…/Ficha/4674 → 4674).
function snifaId_(celda) {
  const m = String(celda || '').match(/\/Ficha\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Sancionatorios que calzan con `nombre`.
function snifaSancionatorios_(nombre) {
  const res = UrlFetchApp.fetch(SNIFA + '/Sancionatorio/ObtenerResultadosGrid', {
    method: 'post',
    payload: { draw: 1, start: 0, length: 1000, nombre: nombre, expediente: '', categoria: '', ddlRegion: '', ddlComuna: '' },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('SNIFA respondió ' + res.getResponseCode());
  return JSON.parse(res.getContentText()).data.map(f => ({
    expediente: f[1],
    unidad: snifaTexto_(f[2]),
    unidadId: snifaId_(f[2]),
    titular: snifaTexto_(f[3]),
    categoria: snifaTexto_(f[4]),
    region: snifaTexto_(f[5]),
    estado: snifaTexto_(f[6]),
    fichaId: snifaId_(f[7]),
  }));
}

// Fiscalizaciones que calzan con `nombre`, en páginas de 49 (con 50 o más SNIFA devuelve vacío).
function snifaFiscalizaciones_(nombre) {
  const filas = [];
  for (let start = 0; ; start += 49) {
    const res = UrlFetchApp.fetch(SNIFA + '/Fiscalizacion/ObtenerResultadosGrid', {
      method: 'post',
      payload: { draw: 1, start: start, length: 49, nombre: nombre, expediente: '', categoria: '', ddlRegion: '', ddlComuna: '' },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error('SNIFA respondió ' + res.getResponseCode());
    const json = JSON.parse(res.getContentText());
    json.data.forEach(f => filas.push({
      expediente: f[1],
      titular: snifaTexto_(f[2]),
      categoria: snifaTexto_(f[3]),
      unidad: snifaTexto_(f[4]),
      unidadId: snifaId_(f[4]),
      region: snifaTexto_(f[5]),
      comuna: snifaTexto_(f[6]),
      estado: snifaTexto_(f[7]),
      fichaId: snifaId_(f[8]),
    }));
    if (!json.data.length || filas.length >= json.recordsFiltered) break;
    Utilities.sleep(1500);
  }
  return filas;
}
```

Con estas dos funciones, el radar guarda los expedientes en una pestaña oculta (la "foto") y en cada corrida compara expediente y estado para anotar las novedades.

---

## 6 · Convertirlo en un MCP de verdad (opcional)

Para preguntarle a Claude directamente ("¿qué sancionatorios abiertos tiene Copec en Valparaíso?"), estas mismas consultas se pueden exponer como un servidor MCP con herramientas como:

| Herramienta | Qué hace |
|---|---|
| `buscar_sancionatorios(nombre, expediente, categoria, region)` | Sección 2.1 |
| `buscar_fiscalizaciones(nombre, expediente, categoria, region)` | Sección 2.1, en páginas de 49 |
| `buscar_unidades(nombre, categoria)` | Sección 2.2 |
| `ficha(tipo, id)` | Sección 2.3, devuelve las tablas ya limpias |
| `documentos(tipo, id)` | La lista de documentos de una ficha, con enlaces de descarga |

A diferencia del radar en Apps Script, un MCP necesita estar **publicado en un servidor** (por ejemplo, Cloud Run o Railway), lo que puede tener costo, y se agrega en Claude como conector personalizado con su URL `/mcp`.

Ya existen proyectos de código abierto que hacen algo parecido, como [Open Legal Chile](https://github.com/elpabloultron/open-legal-chile), que trae la herramienta `sma_search_sancionatorios`, y [SNIFA MCP](https://glama.ai/mcp/servers/bawzenit-glitch/snifa-mcp). No se revisó su código.

---

## 7 · Qué no cubre, frente a PIA

[PIA](https://pia.inzai.cl) reúne además el **SEIA** (proyectos y RCA), los **tribunales ambientales**, guías y leyes, y búsqueda dentro de unos 2 millones de documentos. Este radar cubre solo SNIFA y no lee el contenido de los PDF. Para sumar el SEIA, la ficha de cada unidad fiscalizable ya trae los enlaces a sus RCA en `seia.sea.gob.cl`, pero ese sitio no se ha revisado.
