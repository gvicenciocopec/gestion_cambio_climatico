# Bot de WhatsApp para crear tareas · costo $0, solo Google + Meta

Tu equipo le escribe al número del bot, por ejemplo *"Enviar informe a la fundación mañana"*. El mensaje queda anotado en la planilla y aparece en la app como **tarea privada de quien lo envió**, con la fecha que escribió. El bot **no responde** (responder tiene costo); si quieres, confirma con el doble check azul ✓✓.

```
WhatsApp del equipo ──► Meta ──► Receptor (Apps Script aparte, en tu cuenta Copec) ──► pestaña "WhatsApp" de la planilla
                                                                                              │
                                                       Al abrir la app, cada fila se convierte en tarea
```

**Por qué cuesta $0:** Meta no cobra por recibir mensajes y el bot nunca envía. Sin tarjeta, Meta no puede cobrar nada. Apps Script es gratis.

**Lo que ya tienes:**
- El número del bot registrado en la app de Meta **"Enke chat"**, con "Suscribir webhooks" activado.
- El **identificador del número de teléfono** (`PHONE_NUMBER_ID`).

> La **clave secreta de la app** no se usa en este camino. No la pegues en ninguna parte.

---

## Paso 1 · La app (5 min)
1. En el editor de Apps Script de la app, pega los archivos actualizados y crea la secuencia de comandos **`WhatsApp`** con `apps-script/WhatsApp.gs`.
2. Ejecuta **`setup()`**. Se crean las pestañas **"WhatsApp"** (oculta) y **"WhatsApp contactos"**.
3. En la planilla, abre la pestaña **"WhatsApp contactos"** y escribe en la columna **Número** el WhatsApp de cada persona, por ejemplo `56912345678`.
4. Publica una nueva versión: **Implementar → Gestionar implementaciones → ✏️ → Nueva versión**.

## Paso 2 · El receptor (10 min, con tu cuenta Copec)
> ⚠️ El receptor va en un **proyecto nuevo y separado**. **No** lo crees con **Extensiones → Apps Script** desde la planilla: eso abre el proyecto de la app, y si lo pegas ahí la rompes.

1. Entra a **script.google.com** → **Nuevo proyecto**. Arriba a la izquierda, cambia el nombre a **Receptor WhatsApp**.
2. Borra todo el contenido de `Código.gs` y pega `bot-whatsapp/ReceptorWhatsApp.gs`.
3. Haz clic en el engranaje **⚙ Configuración del proyecto**, en la barra izquierda. No es un archivo: es otra pantalla del editor.
   - Baja hasta el final, a **Propiedades de la secuencia de comandos** (en algunos editores dice "Propiedades del script").
   - Presiona **Agregar propiedad de la secuencia de comandos** dos veces y completa las casillas **Propiedad** y **Valor**:
     - `SHEET_ID`: el ID de la planilla. Abre la planilla donde aparece el menú **Cuadre AACC** y copia lo que va entre `/d/` y `/edit` en su dirección.
     - `PHONE_NUMBER_ID`: el identificador del número que copiaste en Meta.
   - Presiona **Guardar propiedades de la secuencia de comandos**.
   - Después de ejecutar `probarReceptor` aparecerán dos más, `VERIFY_TOKEN` y `URL_KEY`. Las crea el receptor: no las toques.

   **No necesitas crear `appsscript.json`.** El editor solo deja crear archivos .gs y .html, y ese archivo ya existe, escondido. En el receptor puedes dejarlo como está: los permisos se detectan solos y el acceso se elige al implementar.
4. En el editor, elige la función **`probarReceptor`** → **▶ Ejecutar** → **Revisar permisos** y autoriza con tu cuenta. Pide permisos para hojas de cálculo y servicios externos, los mismos que ya tiene la app. No pide Drive ni Gmail.
5. Mira el **Registro de ejecución**:
   - Debe decir **✓ Todo listo**.
   - Más abajo aparecen la **clave para la URL** (después de `?k=`) y el **Token de verificación**.
   - Si algo sale con **✗**, sigue lo que dice y vuelve a ejecutar.
6. Ve a **Implementar → Nueva implementación** → engranaje **⚙** → **Aplicación web** y completa:
   - **Ejecutar como:** Yo (tu cuenta Copec).
   - **Quién tiene acceso:** la opción que dice solo **Cualquier usuario**. No elijas "…de Copec" ni "…con una cuenta de Google". Meta no tiene cuenta de Google: con otra opción, Google le pide iniciar sesión y los mensajes no llegan. Esto solo abre el receptor (sin la clave no hace nada), no la planilla ni la app.
   - Presiona **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).
7. **Comprueba la URL:** ábrela en una **ventana de incógnito**.
   - Si dice **"Receptor de tareas: funcionando."**, está bien.
   - Si pide iniciar sesión, revisa que el acceso sea "Cualquier usuario". Si la URL tiene `/a/macros/copec.cl/`, cámbialo por `/macros/` (queda `https://script.google.com/macros/s/…/exec`) y vuelve a probar.
8. Arma la URL para Meta: la URL que funcionó en incógnito, más `?k=` y la clave del registro. Queda así:
   `https://script.google.com/macros/s/AKfy…/exec?k=abc123…`

## Paso 3 · Conectar en Meta (5 min)
Desde este paso, el bot anterior deja de recibir mensajes.
1. En **developers.facebook.com → Mis apps → Enke chat**, en el **Panel**, haz clic en **Personalizar el caso de uso "Conectarte con los clientes a través de WhatsApp"**. Es la misma página donde viste "Registra tu número de teléfono".
2. Busca **Configurar webhooks**. Si no aparece ahí, búscalo en el menú izquierdo, en **Configuraciones**. Si ya hay una URL (la del bot anterior), presiona **Editar** y reemplázala. Completa:
   - **URL de devolución de llamada:** la URL que armaste en el Paso 2.8.
   - **Token de verificación:** el que salió en el registro.
   - Presiona **Verificar y guardar**.
3. En **Campos del webhook**, revisa que **messages** esté suscrito. Si no lo está, presiona **Suscribirse**.
4. **No agregues tarjeta** en ninguna parte.
5. Si el bot anterior corría en algún servidor o servicio, apágalo. Ya no recibe mensajes, pero mientras siga encendido podría enviar mensajes con el número.

## Paso 4 · Probar
1. Desde tu WhatsApp, escríbele al número del bot: **"Probar el bot mañana"**.
2. Abre la app. Debe aparecer **"Probar el bot"** en tus tareas, privada y con fecha de mañana.
3. Si no aparece, revisa la pestaña "WhatsApp" de la planilla (está oculta: ábrela desde **Ver → Hojas ocultas**):
   - **Si no hay fila**, el mensaje no llegó al receptor. Revisa **Ejecuciones** en el menú izquierdo del proyecto del receptor y luego sigue el Paso 5.
   - **Si hay fila**, mira las columnas **Estado** y **Nota**.

## Paso 5 · Solo si en el Paso 4 no llegó nada: publicar la app de Meta
Meta a veces no envía mensajes mientras la app está "Sin publicar".
1. En **Enke chat → Configuración de la app → Básica**, completa:
   - **URL de la política de privacidad** e **instrucciones de eliminación de datos:** la URL `/exec` + `?pagina=privacidad` (el receptor ya trae esa página).
   - **Categoría:** cualquiera.
   - **Ícono:** si lo pide, cualquier imagen cuadrada.
   - Presiona **Guardar cambios**.
2. En el menú izquierdo, ve a **Publicar → Publicar**.
3. Vuelve a probar.

## Opcional · Doble check azul ✓✓
Necesitas un **token permanente** de Meta:
1. En **business.facebook.com → Configuración → Usuarios del sistema**, presiona **Agregar** y elige el rol Administrador.
2. En **Asignar activos**, agrega la app Enke chat y la cuenta de WhatsApp.
3. Presiona **Generar token**:
   - Caducidad: **Nunca**.
   - Permisos: `whatsapp_business_messaging` y `whatsapp_business_management`.
4. En el receptor, agrega el token como propiedad **`WA_TOKEN`**. No hace falta volver a implementar.

## Opcional · Foto y nombre del bot
- **Foto y descripción (sin revisión).** Entra a **WhatsApp Manager → Herramientas de la cuenta → Números de teléfono**, elige el número y abre la pestaña **Perfil**. Ahí subes la foto (cuadrada, 640×640, JPG o PNG) y escribes la descripción. Luego presiona **Guardar**.
- **Nombre (lo más simple).** Cada persona guarda el número en su teléfono como *Tareas Cambio Climático*. WhatsApp muestra el nombre guardado en la lista de chats.
- **Nombre visible en Meta.** Está en la misma pestaña **Perfil → Nombre visible → Editar**, pero tiene condiciones:
  - Meta lo revisa y exige que el nombre tenga relación con la empresa dueña de la cuenta (Enke SpA).
  - Aparece arriba del chat solo si Meta verifica el nombre; si no, el equipo ve el número.
  - Si lo aprueban, hay que volver a registrar el número (`POST /<PHONE_NUMBER_ID>/register` con el PIN) dentro de 14 días.
  - Se puede cambiar hasta 10 veces cada 30 días.

---

## Cómo lo usa el equipo
- Basta con escribir la tarea. El prefijo `Tarea:` es opcional.
- Para la fecha, termina el mensaje con: **hoy · mañana · pasado mañana · lunes…domingo · próxima semana · en 3 días · 15/10 · 15/10/2026**.
- La tarea queda **privada** y asignada a quien la envió. Para compartirla, usa **Seleccionar → Hacer públicas** en la app.
- Las tareas se importan **al abrir la app**, y también una vez al día, junto con el aviso de vencimientos. Si una tarea vence sin estar lista, llega un solo aviso por correo.
- Las fotos y los audios no crean tareas: quedan como "Ignorada" en la bandeja.

## Seguridad
- **"Cualquier usuario" es solo para el receptor.** La app Cuadre AACC siempre va con **"Cualquier usuario de Copec"**. Si quedara abierta, cualquiera en internet podría ver el presupuesto.
- **No compartas el proyecto del receptor.** Corre con tus permisos: quien pueda editarlo podría usarlos.
- **La URL con `?k=` funciona como una contraseña.** No la compartas. Si se filtra:
  1. Borra la propiedad `URL_KEY`.
  2. Vuelve a ejecutar `probarReceptor`, que crea una clave nueva.
  3. Actualiza la URL en Meta.
- **Solo se aceptan los números** de "WhatsApp contactos". El receptor solo **agrega** filas: no lee ni muestra el resto de la planilla.
- Los textos pasan por Meta, que los guarda hasta 30 días. No envíes datos sensibles por el bot.
- **Mantén activa la línea prepago.** Si se da de baja, el bot se queda sin número.

## Problemas frecuentes
| Síntoma | Solución |
|---|---|
| Meta no puede "Verificar y guardar" | Abre la URL en incógnito (Paso 2.7): debe decir "funcionando". Revisa que termine en `/exec?k=…` con la clave correcta y que el token sea idéntico. |
| En incógnito pide iniciar sesión | El acceso debe ser **Cualquier usuario**. Quita `/a/macros/copec.cl` de la URL (queda `/macros/s/…/exec`). |
| No llega nada al receptor (sin ejecuciones) | Publica la app de Meta (Paso 5). Revisa que "messages" esté suscrito y que "Suscribir webhooks" del número siga activado. |
| Hay ejecuciones con error | Ábrelas en **Ejecuciones**. Casi siempre falta `SHEET_ID` o está mal copiado. |
| La fila dice "Ignorada" | Lee la **Nota**: el número no está en "WhatsApp contactos" o el mensaje no es texto. |
| Llegó la fila pero no veo la tarea | Abre o recarga la app. Si la fila dice "Error", lee la Nota. |

---
*Otras formas: el receptor también funciona en una cuenta Gmail aparte (un "bot"); en ese caso, compártele la planilla como Editor y haz el Paso 2 con esa cuenta. También hay una alternativa con Cloudflare en `bot-whatsapp/alternativa-cloudflare/`. Las notas técnicas están en `dev/WHATSAPP_TECH.md`.*
