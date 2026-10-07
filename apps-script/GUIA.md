# Guía de instalación · Cuadre AACC v3.1

Una herramienta del equipo, no de control. Tiene dos secciones:

- **Gestión**:
  - proyectos de Cascade por pilar, con sus tareas a la vista;
  - lista personal **Mis tareas** a la derecha;
  - tareas compartidas o privadas;
  - un aviso por correo cuando una tarea vence, que cada persona puede apagar;
  - carta Gantt en **Planificación**.
- **Presupuesto**:
  - líneas por año, OC, pagos, responsables y comentarios;
  - solo para Gonzalo, la bandeja de **Solicitudes de compra** que llegan de Ariba.

> **¿Ya tenías la v3?** En la v3.1 cambiaron casi todos los archivos y hay uno nuevo: **`Drive`** (secuencia de comandos). Pégalos todos, ejecuta `setup()` (pedirá el permiso nuevo de **Google Drive**) y publica una nueva versión.
>
> **¿Ya tenías la v2 instalada?** Pega de nuevo **todos** los archivos (la mayoría cambió), crea los 3 nuevos (`Aprobaciones`, `TodoPanel` y `VAprobaciones`), **elimina `VAvance`**, ejecuta `setup()` otra vez y publica una nueva versión.

Tiempo estimado: unos 20 minutos. No hay que instalar nada en tu computador.

---

## 0 · Antes de empezar (2 minutos)

1. **Respalda la planilla:** **Archivo → Hacer una copia**. `setup()` agrega columnas y una pestaña nueva, así que conviene tener un respaldo.
2. Verifica que la pestaña se llame exactamente **`Cuadre 2026`**.

## 1 · Abrir el proyecto de Apps Script

En la Google Sheet: **Extensiones → Apps Script**. Es el mismo proyecto de la v1.

## 2 · Mostrar el archivo de configuración (`appsscript.json`)

1. En el menú de la izquierda, haz clic en **⚙ Configuración del proyecto**.
2. Marca **"Mostrar el archivo de manifiesto 'appsscript.json' en el editor"**.
3. Vuelve a **‹› Editor**, abre `appsscript.json` y reemplaza todo su contenido por el de [appsscript.json](appsscript.json).

Este archivo define la zona horaria (Santiago), el modo de ejecución y el único servicio externo permitido: Gemini, que queda inactivo mientras no lo actives.

## 3 · Copiar los archivos

En el editor, **＋ → Secuencia de comandos** crea un archivo `.gs`, y **＋ → HTML** crea un archivo HTML. Escribe los nombres **sin la extensión** (el editor la agrega sola).

| Tipo | Nombre en el editor | Archivo a pegar |
|---|---|---|
| Secuencia de comandos | `Code` (ya existe: reemplaza todo) | `Code.gs` |
| Secuencia de comandos | `Presupuesto` | `Presupuesto.gs` |
| Secuencia de comandos | `Gestion` | `Gestion.gs` |
| Secuencia de comandos | `Setup` | `Setup.gs` |
| Secuencia de comandos | `Notificaciones` | `Notificaciones.gs` |
| Secuencia de comandos | `Asistente` | `Asistente.gs` |
| Secuencia de comandos | `Aprobaciones` | `Aprobaciones.gs` |
| Secuencia de comandos | `Drive` | `Drive.gs` |
| Secuencia de comandos | `WhatsApp` | `WhatsApp.gs` (bandeja del bot de WhatsApp; opcional, ver `docs/GUIA_WHATSAPP.md`) |
| HTML | `Index` (ya existe: reemplaza todo) | `Index.html` |
| HTML | `Styles` (ya existe: reemplaza todo) | `Styles.html` |
| HTML | `Core` | `Core.html` |
| HTML | `VPresupuesto` | `VPresupuesto.html` |
| HTML | `VAprobaciones` | `VAprobaciones.html` |
| HTML | `VGestion` | `VGestion.html` |
| HTML | `FGestion` | `FGestion.html` |
| HTML | `TodoPanel` | `TodoPanel.html` |
| HTML | `VAdmin` | `VAdmin.html` |
| HTML | `VAsistente` | `VAsistente.html` |

4. **Elimina los archivos que ya no se usan**: `App` (de la v1) y `VAvance` (de la v2). Para eliminar: ⋮ junto al nombre → Eliminar.
5. Guarda con **⌘ + S**.

> Consejo: abre cada archivo de la carpeta `apps-script` en un editor de texto, selecciona todo (**⌘ + A**), copia y pega. Si falta un solo carácter, la app no carga.

## 4 · Ejecutar `setup()` una vez

1. Abre `Setup.gs`. En la barra superior, elige la función **`setup`** y presiona **▶ Ejecutar**.
2. Google pedirá **permisos nuevos**:
   - enviar correos en tu nombre (para los avisos);
   - **leer tu Gmail**, solo para registrar las solicitudes de Ariba;
   - **Google Drive**, para crear la carpeta de cada proyecto y subir archivos;
   - ejecutar activadores;
   - conectarse a servicios externos (Gemini, para más adelante);
   - editar la planilla.

   Acepta igual que en la v1: **Configuración avanzada → Ir a … → Permitir**.
3. En el **Registro de ejecución** verás lo que hizo `setup()`:
   - guardó el ID de la planilla, así que no hace falta editar `SHEET_ID`;
   - agregó las columnas **Responsable** e **ID** al final de `Cuadre 2026` (no toca tus datos);
   - creó la pestaña **Gestión** (oculta) y cargó el **catálogo de Cascade** de las capturas;
   - creó los **proyectos por defecto desde Cascade** (cada acción u objetivo es un proyecto; las iniciativas que solo tienen KPIs o hitos son un proyecto en sí mismas);
   - creó la pestaña oculta **Solicitudes**;
   - instaló el **aviso diario de vencimientos** (entre 08:00 y 09:00).

   La lectura de Ariba **no** se activa sola; se activa en el paso 5b.

`setup()` se puede ejecutar de nuevo sin duplicar nada. Después de recargar la planilla aparece el menú **Cuadre AACC**, con la opción **Configurar / reparar**, que hace lo mismo.

> **Importante:** ejecuta `setup()` con **tu cuenta (gvicencio@copec.cl)**. Los correos de aviso salen desde la cuenta que instaló el activador. Si otra persona lo instala de nuevo, los avisos llegarían duplicados.

## 5 · Publicar la nueva versión (misma URL)

1. **Implementar → Gestionar implementaciones**.
2. Haz clic en ✏️ (lápiz) en la implementación existente.
3. En **Versión**, elige **Nueva versión** → **Implementar**.

El link `/exec` que ya tiene tu equipo sigue funcionando. Mantén **Ejecutar como: Yo** y **Acceso: cualquier usuario de copec.cl**.

> Para probar antes que el equipo, usa **Implementar → Implementaciones de prueba**, que entrega una URL `/dev`.

**Quién puede entrar:** como la app trabaja con tus permisos sobre la planilla, solo la abren las 4 personas del equipo (Ina, Benja, Ignacio y Gonzalo). Para dar acceso a alguien más (por ejemplo, tu jefatura), ve a **⚙ Configuración del proyecto → Propiedades del script** y agrega la propiedad `EXTRA_USERS` con sus correos separados por coma, como `persona@copec.cl,otra@copec.cl`. No hace falta volver a publicar.

### 5a · Modo seguro: Drive apagado, Gmail encendido (desde v3.6)

**Drive sigue apagado**, así la app no pide el permiso amplio de "ver todos tus archivos de Drive", que en Copec puede activar alertas de seguridad. **Gmail está encendido** desde el 6 de octubre de 2026, por decisión tuya, para leer los correos de Ariba (5b).
- En `Code.gs`, la configuración `CONFIG.FEATURES` tiene `DRIVE: false` y `GMAIL: true`.
- El `appsscript.json` pide la planilla, enviar correos, los activadores, tu correo y **Gmail completo** (`https://mail.google.com/`). Es el único permiso que acepta el servicio de Gmail de Apps Script. Google lo muestra como "leer, redactar, enviar y eliminar todo tu correo"; la app solo lee los correos de Ariba.
- Las carpetas de Drive por proyecto (5c) siguen apagadas. Ajustes lo indica con "Desactivado (modo seguro)".
- **Si vuelve a aparecer el bucle de Drive** (`access.workspace.google.com/remediate`): pon `GMAIL: false`, quita `https://mail.google.com/` de `appsscript.json`, publica una nueva versión y avísale a TI.

**Para activarlas, solo cuando TI lo apruebe:**
1. Pídele a TI que marque la app como de confianza (control de acceso a apps) y que revise las reglas de acceso según contexto.
2. En `Code.gs`, cambia a `true` lo que corresponda (`DRIVE` y/o `GMAIL`).
3. Reemplaza `appsscript.json` por el contenido de `appsscript.completo.json`.
4. Ejecuta `setup()` y publica una nueva versión.

### 5b · Activar las solicitudes de compra (solo Gonzalo)

1. En el editor, elige la función **`aprobInstall`** y presiona **▶ Ejecutar**. Google pedirá autorizar el permiso de Gmail: revisa y acepta.
2. Desde ahí también puedes activarla en la app: **Ajustes → Solicitudes de compra (Ariba) → Activar revisión automática**.
- La app revisa tu Gmail **una vez al día (alrededor de las 7:00)**, solo los correos de `buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com`.
- En **Presupuesto → Solicitudes de compra** está el botón **Revisar ahora**, para forzar una revisión cuando quieras.
- La aprobación la sigues haciendo **en el mismo correo de Ariba**. En la app solo la registras: la **vinculas a una línea** (y queda OC = Sí), **creas una línea nueva** "Fuera de POA" o la **descartas**.
- El monto sugerido es la parte de tu CeCo (**XUF80853 · PROY.CAMBIOS CLIMA**). Si tienes otros CeCos, dímelo y los agrego.

### 5c · Carpetas de Drive por proyecto (solo Gonzalo, requiere 5a)

1. En el **Drive compartido del equipo**, crea (o elige) una carpeta para los proyectos, por ejemplo *Cuadre AACC · Proyectos*, y copia su link.
2. En la app ve a **Ajustes → Carpetas de Drive**, pega el link y guarda.
3. Presiona **Crear carpetas que faltan**. La app crea *Pilar › Proyecto* para cada proyecto. Si son muchos y avisa que quedan pendientes, vuelve a presionar el botón.

Desde ahí, cada proyecto nuevo crea su carpeta solo. En el panel del proyecto, la pestaña **Drive** muestra sus archivos y permite subir fotos, PDF y documentos (hasta 20 MB cada uno; para archivos más grandes, usa **Abrir carpeta**). Los archivos se crean con tu cuenta, dentro de la unidad compartida, así que todo el equipo puede abrirlos.

**Enlace de los correos:** la primera vez que alguien abre la URL publicada (`/exec`), la app guarda su dirección y la usa en el botón "Abrir mis tareas" de los avisos. Puedes revisarla o corregirla en **Ajustes**.

## 6 · Primer uso

- **Mis tareas:** a la derecha de cada pilar (en el celular, el botón flotante). Ya no está en el menú.
  - Escribe y presiona Enter: aparece el menú **¿Para cuándo?** (Hoy · Mañana · Viernes · Próx. lunes · Elegir… · Sin fecha). También puedes usar las teclas 1 a 5, y Esc cancela. Si escribiste "mañana", "viernes" o "15/10" al final, la fecha se pone sola.
  - Ordénalas arrastrando la tarea (en el celular, mantenla presionada un momento y muévela). Con el teclado: Alt + ↑/↓.
  - En la pantalla ancha, arrastra una tarea fuera del panel y suéltala sobre un proyecto del pilar para sumarla a ese proyecto (sigue en tu lista).
  - **Personas** (el ícono de persona con +, o ⋯ en el celular): cambia el responsable o suma a más gente. Con más de una persona, la tarea es pública y le aparece a cada una en «Mis tareas»; el aviso de vencida le llega a todas.
  - Márcalas con el check. El comentario de cierre es opcional, y puedes agregarlo después desde el aviso.
- **Crear una tarea con más detalle:** botón **Nueva tarea**.
  - Una línea para escribir y botones rápidos para fecha, persona, proyecto, **Avisarme** y **Compartida/Privada**.
  - El indicador de Cascade y los links quedan en "Más detalles".
- **Tareas privadas:** solo las ven quien la creó y su responsable, **dentro de la app**. Quedan guardadas en la pestaña oculta de la planilla.
- **Proyectos:** cada pilar muestra sus proyectos agrupados como en Cascade, con sus tareas. Para vincular líneas de presupuesto, abre el proyecto y entra a la pestaña *Presupuesto*.
- **Planificación:** el enlace discreto junto al nombre del pilar abre la carta Gantt. Para que las barras se vean bien, agrega **Inicio** y **Término** a los proyectos.
- **Buscar:** usa **⌘K** para encontrar proyectos, tareas, notas y links. La opción **Buscar en Drive con IA de Google** abre la misma pregunta en Drive, donde responde su IA con tus archivos.
- **Año:** el selector de año (arriba a la derecha) cambia Presupuesto y Gestión al mismo tiempo.
- **Solo para Gonzalo:** Vista general, Historial y Solicitudes de compra. En **Ajustes → Vista → Ver como admin** puedes apagarlo para ver la app tal como la ve tu equipo.
- **Correo de respaldo:** en *Líneas de presupuesto*, las líneas vinculadas a una solicitud de Ariba muestran un ícono 👁 que abre ese correo en Gmail (solo tú lo ves, porque el correo está en tu bandeja).

## 7 · Crear el año 2027

Hay dos opciones:

- **Desde la app** (solo administradores): **Ajustes → Años de presupuesto → Crear año** crea la pestaña `Cuadre 2027` con los encabezados.
- **A mano:** duplica la pestaña `Cuadre 2026` y renómbrala **exactamente** `Cuadre 2027`. Los IDs repetidos se corrigen solos al abrir la app.

## 8 · Avisos por correo

- La app avisa **solo cuando una tarea vence** sin estar lista, y **una sola vez**. El correo le llega a la persona responsable la mañana siguiente al vencimiento (~08:00). Si tiene varias tareas vencidas ese día, recibe un solo correo con todas.
- No hay avisos al crear una tarea ni en los días previos.
- Cada tarea tiene el interruptor **Avisarme si vence**, encendido por defecto. Al apagarlo, esa tarea no envía correos.
- Si se cambia la fecha o el responsable, la tarea puede avisar una vez más cuando venza la fecha nueva.
- Para probarlo, usa **Ajustes → Enviarme una prueba** o, en la planilla, el menú **Cuadre AACC → Enviarme mis tareas vencidas**.

## 9 · Asistente con Gemini (opcional, más adelante)

El buscador ya funciona como **directorio**: no usa IA ni envía datos fuera de Google. Si más adelante quieren respuestas en lenguaje natural:

1. Crea una API key en **aistudio.google.com → Get API key**. La suscripción de Gemini **no** incluye acceso a la API.
2. En Apps Script: **⚙ Configuración del proyecto → Propiedades del script → Agregar propiedad**.
   - Propiedad: `GEMINI_API_KEY`
   - Valor: tu clave
3. Listo. No hace falta tocar código ni volver a publicar.

> **Privacidad:** en el plan gratuito de AI Studio, Google puede usar las consultas para mejorar sus productos. Para datos internos se recomienda un proyecto con facturación activada (con este volumen, el costo es de centavos al mes).

## 10 · Cómo actualizar en el futuro

Cuando agreguemos funciones te diré **qué archivos cambiaron**. Pega solo esos archivos y publica con **Gestionar implementaciones → ✏️ → Nueva versión**. **No uses "Nueva implementación"**, porque eso crea una URL distinta.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| "No se pudieron cargar los datos" | Ejecuta `setup()` desde el editor. Revisa que exista la pestaña `Cuadre 2026` con sus encabezados en la fila 1. |
| "Falta la columna …" | Algún encabezado de la fila 1 cambió de nombre. Corrígelo en la planilla. |
| La página sale en blanco o sin estilos | Revisa que pegaste los 19 archivos con el nombre exacto y que eliminaste `VAvance`. Usa Chrome o Edge actualizados (111 o superior). |
| Drive (drive.google.com) queda en blanco y salta en bucle a `access.workspace.google.com/remediate` | Es la política de **acceso según contexto** de Copec, no la app. Abre Drive en Chrome con tu perfil de Copec y sincronización activa. Luego, en la extensión Endpoint Verification, presiona **Sync now** y revisa que Netskope esté conectado. Si sigue igual, escríbele a TI con la hora y la URL. |
| Quiero quitar los permisos de Gmail y Drive que le di a la app | En **myaccount.google.com/connections**, elimina el acceso del proyecto. Después instala la versión en modo seguro (5a), ejecuta `setup()` y publica una nueva versión. |
| La pestaña Drive dice que falta configurar | Pega el link de la carpeta raíz en **Ajustes → Carpetas de Drive** (solo Gonzalo). Si dice que no hay acceso, comparte esa carpeta con gvicencio@copec.cl. |
| No aparecen solicitudes de Ariba | En **Ajustes** revisa que la revisión automática esté activa, y usa **Revisar ahora**. Si un correo no se leyó completo, la solicitud aparece con la marca "Revisa los datos". |
| No llegan los avisos | Ejecuta `setup()` con la cuenta de Gonzalo. En **⏰ Activadores** debe aparecer `notifDaily`. |
| "Usuario no identificado" | Google no entregó el correo del visitante. En **Ajustes → Tu perfil**, elige tu nombre (solo afecta los filtros de *Mis tareas*). |
| Un colega ve "No tienes acceso a Cuadre AACC…" | Agrega su correo a la propiedad `EXTRA_USERS` (ver paso 5). |
| Un cambio aparece y luego vuelve atrás, con un aviso de error | No se pudo guardar (por ejemplo, sin conexión). La app vuelve a los datos reales de la planilla: repite el cambio. |
| Quiero ver la pestaña Gestión | Menú **Cuadre AACC → Mostrar u ocultar pestaña Gestión**. No edites esa pestaña a mano salvo que sea necesario. |

---

### Para desarrollo (opcional)

En la carpeta `dev/` está la especificación técnica (`SPEC.md`) y un banco de pruebas que simula Apps Script en el Mac:

```bash
bash dev/harness/run_tests.sh
```
```bash
python3 dev/harness/build.py
```

El segundo comando genera una vista previa local de la app con datos de ejemplo en `dev/preview/index.html`.
