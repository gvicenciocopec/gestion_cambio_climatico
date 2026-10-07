# Cuadre Asuntos Corporativos v2 — Technical SPEC (contract for all modules)

App: Google Apps Script web app (HtmlService, IFRAME sandbox) backed by ONE Google Spreadsheet.
Users: 4-person sustainability team at Copec (Spanish UI, es-CL). Small data (hundreds of rows).
Two sections: **Presupuesto** (budget lines, per-year sheets "Cuadre YYYY") and **Gestión**
(projects + tasks per pillar, stored in hidden sheet "Gestión"), plus Avance por período, Cascade
catalog, Historial, Ajustes and an anti-hallucination Gemini "Asistente" (directory-style search).

ALL user-facing text is Spanish (Chile). Code comments in Spanish, short. Money is CLP integers,
formatted `$1.234.567` (es-CL). Dates `yyyy-mm-dd` strings on the wire; display `12 oct 2026`.

---------------------------------------------------------------------------------------------------
## 0. Hard rules (every module)

1. Apps Script = one shared global scope across ALL .gs files. **Never declare a top-level name that
   another file declares.** Top-level code may ONLY declare `const`/`function`; never call functions
   at top level (file load order is not guaranteed). Private helpers end with `_` and carry the
   module prefix: Presupuesto.gs → `pres*_`, Gestion.gs → `g*_`, Notificaciones.gs → `notif*_`,
   Asistente.gs → `ai*_`, Setup.gs → `setup*_`. Code.gs owns un-prefixed helpers listed in §3.
2. V8 runtime: modern JS ok (const/let, arrow, spread, template literals, optional chaining is OK in
   V8 Apps Script). No `import`, no Node APIs.
3. google.script.run payloads: only primitives, arrays, plain objects. **No Date objects** in
   either direction (convert to strings). No `undefined` inside arrays. Functions ending in `_` are
   private (not callable from client) — public API functions must NOT end in `_`.
4. Every write goes through `mutate_(fn)` (script lock + returns fresh bundle) and logs via `log_`.
5. Client renders with template strings + innerHTML. **Escape every user/data string with `esc()`**.
   URLs placed in href must pass `safeUrl()` (http/https only). Never use inline `onclick=` —
   use `data-action` delegation (§6.3).
6. Tailwind classes only (runtime CDN scans the DOM) + a few custom classes in Styles.html.
   Every color must have a dark variant (`dark:`). Icons: Lucide via `icon(name, cls)` helper.
7. Mobile first: works at 375px width (no horizontal page scroll; tables scroll inside wrapper).

---------------------------------------------------------------------------------------------------
## 1. Spreadsheet data model

### 1.1 Budget sheets: tab name `Cuadre YYYY` (regex `/^Cuadre\s+(\d{4})$/i`)
Row 1 headers (matched case/accent-insensitive by name, any order):
`Area | Proyecto | Clasificacion | Presupuesto original | Monto final proyectado | Pagado a la fecha |
Pendiente | OC emitida | Estado | Alerta | Nota | Responsable | ID`
- Required: Area, Proyecto, Clasificacion, Presupuesto original, Monto final proyectado, Pagado a la fecha, OC emitida.
- `Responsable` and `ID` are appended automatically at the end of row 1 if missing (by `presEnsureColumns_`).
- `ID` = `L-` + 8 hex chars; missing IDs are assigned (written back) on read under lock.
- `Pendiente`, `Estado`, `Alerta` are computed (`presCalc_`) and written back on every write of that row.
- Cells with formulas are never overwritten.
- `OC emitida`: "Si" | "No" | "" (normalize "sí"/"SI" → "Si").
- `Area` values: "Cambio Climatico" | "Economia Circular" | "Naturaleza" (map to pillar keys §2).
- `Clasificacion`: "POA" | "Nuevo" | "Fuera de POA".

Business rules (unchanged from v1):
```
pend = max(pf - pg, 0)
estado: pf==0 → "No se realizará"; pg>=pf → "Ejecutado"; oc=="Si"||pg>0 → "En curso"; else "Por ejecutar"
alerta: pf==0 → "—"; clas=="Fuera de POA" → "Ejecutado"; oc=="" → "Definir OC";
        oc=="No" && pend>0 → "Pagar/OC ya"; pend==0 → "Pagado"; else "OK con OC"
```

### 1.2 Hidden sheet `Gestión` (single polymorphic table; created + hidden by `gSheet_`)
Row 1 headers EXACTLY in this order (constant `G_HEADERS` in Gestion.gs; read by header name):
```
ID | Tipo | Pilar | Padre | Nombre | Detalle | Responsable | Fecha | Estado | Clase | Cascade |
Evidencias | Presupuesto | Año | Cierre | Completada | Creado por | Creado | Actualizado por |
Actualizado | Notificado | Orden
```
`Tipo` ∈ `Proyecto | Tarea | Comentario | Cascade`. Column usage per Tipo:

| Column | Proyecto | Tarea | Comentario | Cascade |
|---|---|---|---|---|
| ID | `PRJ-xxxxxxxx` | `TSK-xxxxxxxx` | `CMT-xxxxxxxx` | `CAS-xxxxxxxx` |
| Pilar | pillar area string ("Naturaleza") | same | — | same |
| Padre | — | project ID or "" | ref ID (L-/PRJ-/TSK-) | parent CAS id ("" = group) |
| Nombre | name | name | — | name |
| Detalle | description | note | comment text | tag text e.g. "Iniciativa" |
| Responsable | email | email | author email | — |
| Fecha | — | due date (Date cell) | — | — |
| Estado | Activo/En pausa/Cerrado | Pendiente/Realizada | — | — |
| Clase | — | — | — | grupo/kpi/accion/objetivo/hito |
| Cascade | default CAS id (opt) | CAS id (opt) | — | — |
| Evidencias | JSON `[{"t":"title","u":"https://..."}]` | same | — | — |
| Presupuesto | comma-separated budget line IDs `L-..,L-..` | — | — | — |
| Año | "2026" or "" (all years) | — | — | — |
| Cierre | — | closing comment | — | — |
| Completada | — | completion date (Date cell) | — | — |
| Notificado | — | marker `2026-10-15:0` = overdue notice sent for that fecha (§17; legacy `3` ignored) | — | — |
| Orden | — | — | — | integer sort order |
Audit columns Creado por / Creado (Date) / Actualizado por / Actualizado (Date) for all.

### 1.3 Sheet `Historial` (exists from v1): `Fecha | Usuario | Acción | Proyecto | Detalle`
(column "Proyecto" is used as "Entidad" label). Created if missing.

---------------------------------------------------------------------------------------------------
## 2. Config (Code.gs) — referenced inside functions only

```js
const CONFIG = {
  SHEET_ID: '',                       // empty if bound script
  APP_NAME: 'Cuadre AACC',
  APP_VERSION: '2.0.0',
  BUDGET_PREFIX: 'Cuadre',            // tabs "Cuadre 2026", "Cuadre 2027"
  GESTION_SHEET: 'Gestión',
  LOG_SHEET: 'Historial',
  ALERT_DAYS: 7,                      // "pronto a vencer" window in UI
  NOTIFY_HOUR: 8,
  GEMINI_MODEL: 'gemini-3.5-flash-lite', // overridable by Script Property GEMINI_MODEL
  ADMINS: ['gvicencio@copec.cl'],
  USERS: [
    { email: 'ibachler@copec.cl',     name: 'Ina',     color: 'violet' },
    { email: 'bderigoulier@copec.cl', name: 'Benja',   color: 'sky' },
    { email: 'idiaz@copec.cl',        name: 'Ignacio', color: 'amber' },
    { email: 'gvicencio@copec.cl',    name: 'Gonzalo', color: 'emerald' },
  ],
  PILLARS: [
    { key: 'cc',  area: 'Cambio Climatico',  label: 'Cambio Climático',  icon: 'cloud-sun', color: 'sky' },
    { key: 'ec',  area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle',   color: 'amber' },
    { key: 'nat', area: 'Naturaleza',        label: 'Naturaleza',        icon: 'leaf',      color: 'emerald' },
  ],
};
```
Gemini API key lives in Script Properties `GEMINI_API_KEY` (never sent to client).

---------------------------------------------------------------------------------------------------
## 3. Server shared helpers (Code.gs) — available to every module

```
ss_()                       → Spreadsheet
withLock_(fn)               → runs fn under script lock (waitLock 25s)
mutate_(fn)                 → withLock_(fn) then returns bundle_() ; if fn returns {lastId}, bundle.lastId = it
bundle_()                   → full client bundle (§4)
log_(accion, entidad, det)  → append to Historial
me_()                       → current user email (lowercase) or 'desconocido'
userName_(email)            → display name from CONFIG.USERS or email prefix
isAdmin_()                  → me_() in CONFIG.ADMINS
norm_(s)                    → lowercase, no accents, trimmed
str_(v), num_(v)            → trimmed string / rounded integer (parses "1.234.567")
uid_(prefix)                → prefix + '-' + 8 hex
tz_()                       → Session.getScriptTimeZone()
today_()                    → 'yyyy-MM-dd' in tz
dateStr_(v)                 → Date|string → 'yyyy-MM-dd' or ''
toDate_(s)                  → 'yyyy-MM-dd' → Date (local midnight) or '' if empty/invalid
iso_(v)                     → Date → ISO string, else ''
daysBetween_(a, b)          → integer days b - a for 'yyyy-MM-dd' strings
pillarKey_(areaOrKey)       → 'cc'|'ec'|'nat'|'' (accepts area string, label or key)
pillarArea_(key)            → area string for key
headerIndex_(headerRow, names) → {name: colIndex|-1} using norm_
appUrl_()                   → ScriptApp.getService().getUrl() (try/catch → '')
```

Public functions in Code.gs: `doGet`, `include`, `bootstrap`, `getHistory(limit)`, `getAdminStatus`.

---------------------------------------------------------------------------------------------------
## 4. Bundle (returned by `bootstrap()` and by EVERY mutation)

```js
{
  me: { email, name, admin: bool },
  users: [{ email, name, color }],
  pillars: [{ key, area, label, icon, color }],
  years: [2026, 2027],                 // numbers, ascending, from Cuadre tabs
  defaultYear: 2026,                   // current year if exists else max
  budget: { '2026': [Line], '2027': [Line] },
  projects: [Project], tasks: [Task], cascade: [Cascade], comments: [Comment],
  config: { alertDays, geminiEnabled: bool, tz, today: 'yyyy-mm-dd',
            sheetUrl, appUrl, version },
  loadedAt: ISO string,
  lastId: 'PRJ-..' | undefined         // id created/edited by the mutation (if any)
}
Line    = { id, year, row, pilar, area, proj, clas, po, pf, pg, pend, oc, estado, alerta, nota, resp }
Project = { id, pilar, nombre, detalle, resp, estado, anio, lineas: [lineId], cascade, evidencias: [{t,u}],
            creadoPor, creado, actualizadoPor, actualizado }
Task    = { id, pilar, proyecto, nombre, detalle, resp, fecha, estado, cascade, evidencias: [{t,u}],
            cierre, completada, creadoPor, creado, actualizadoPor, actualizado }
Cascade = { id, pilar, padre, nombre, etiqueta, clase, orden }
Comment = { id, ref, texto, autor, creado }
```
(pilar = pillar key 'cc'|'ec'|'nat'; dates 'yyyy-mm-dd'; audit timestamps ISO strings; resp/autor = email lowercase.)

---------------------------------------------------------------------------------------------------
## 5. Public server API (all mutations return the bundle)

Presupuesto.gs
```
budgetSave(year, id, data)      id null/'' → create line in "Cuadre {year}". data ⊆ {area, proj, clas, po, pf, pg, oc, nota, resp}
                                (area may be pillar key or area string). Finds row by ID (fallback: none → error).
budgetDelete(year, id)          also calls gOnLineDeleted_(id) inside the same lock
budgetCreateYear(year)          admin only; creates tab "Cuadre {year}" with the 13 headers, bold, frozen row
recalcAll()                     menu: recompute Pendiente/Estado/Alerta for every Cuadre tab
setAppUrl(url)                  admin only: save/clear the /exec URL used in reminder emails (Code.gs, see §12)
internal: presYears_(ss) → [{year, sheet}], presReadAll_(ss) → {years:[], byYear:{}}, presCalc_(d), presEnsureColumns_(sh)
```
Gestion.gs
```
gSave(entity)                   entity.tipo ∈ 'Proyecto'|'Tarea'|'Cascade'; no id → create. Validates
                                (nombre required, pilar valid, task proyecto must exist if given and share pilar,
                                 evidencias urls must be http(s), lineas must be IDs).
                                When a task's fecha or resp changes → clear Notificado. Returns bundle with lastId.
gDelete(id)                     Proyecto: its tasks get proyecto='' (kept). Tarea: also deletes its comments.
                                Cascade group with children → error "Elimina primero sus indicadores".
                                Comments on deleted entity are deleted.
taskComplete(id, data)          data = {cierre (required, non-empty), completada ('yyyy-mm-dd', default today),
                                evidencias (array to APPEND, optional)} → estado 'Realizada'
taskReopen(id)                  estado 'Pendiente', clears completada (keeps cierre text as history in log)
commentAdd(ref, texto)          ref = any L-/PRJ-/TSK- id; texto non-empty ≤ 4000 chars
commentDelete(id)               only author (or admin)
internal: gSheet_(ss) (get-or-create + hide; only call inside the lock), gRead_(ss) → {projects,tasks,cascade,comments}
          (returns empty arrays if the sheet does not exist yet — never creates it), gUpdateFields_(sh, id, fieldsByHeader),
          gOnLineDeleted_(lineId) (inside lock: removes lineId from every project's Presupuesto + deletes comments with Padre=lineId).
```
Notificaciones.gs
```
installTrigger()                admin; idempotent daily trigger for notifDaily at CONFIG.NOTIFY_HOUR → {installed:true}
notifDaily()                    trigger handler: one email per responsible person with their newly OVERDUE tasks (§17)
sendTestDigest()                sends the current user's overdue pending tasks to themselves (even if none) → {sent, to, count}
internal: notifStatus_() → {triggerInstalled: bool}
```
Asistente.gs
```
ask(question)                   → { mode: 'ai'|'search', found: bool, answer: string, sources: [Source], results: [Source], note? }
Source = { id, type: 'line'|'project'|'task'|'comment'|'evidence'|'cascade', title, subtitle, pilar, url?, refId }
```
Setup.gs
```
setup()                         run once from editor (and safe to re-run): ensure Gestión sheet (hidden),
                                Historial, budget columns/IDs, seed Cascade catalog if no Cascade rows, install trigger.
onOpen()                        sheet menu "Cuadre": Recalcular, Configurar app (setup), Mostrar/ocultar Gestión
toggleGestionSheet()            show/hide the Gestión tab
const CASCADE_SEED              (§9)
```
Code.gs public: `bootstrap()`, `getHistory(limit)` → [{fecha ISO, usuario, accion, entidad, detalle}] newest first,
`getAdminStatus()` → {admin, triggerInstalled, geminiEnabled, model, years, gestionRows, tz, version}.

Errors: throw `new Error('mensaje en español')`; client shows it in a toast.

---------------------------------------------------------------------------------------------------
## 6. Client architecture

Files (HTML partials included by Index.html in this order):
`Styles.html` (CSS), `Core.html` (state, utils, UI kit, router, shell), `VPresupuesto.html`,
`VGestion.html`, `FGestion.html`, `VAvance.html`, `VAdmin.html`, `VAsistente.html`.
Each JS partial is one `<script>` block. Top-level: only declarations + `registerView` / `action` calls.

### 6.1 Global state (Core)
```js
S = { ...bundle, year: Number, route: {name, params, path}, ui: {} }   // S.ui[viewKey] = view-local state
IDX = { line: Map(id→Line, all years), project: Map, task: Map, cascade: Map, comment: Map,
        tasksByProject: Map(id→[Task]), commentsByRef: Map(ref→[Comment] oldest first),
        cascadeChildren: Map(groupId→[Cascade] by orden), cascadeGroups: {cc:[group..],ec:[],nat:[]},
        lineProject: Map(lineId→projectId) }
```
`applyBundle(b)` sets S fields, keeps S.year if still valid, rebuilds IDX, re-renders shell, view and open drawer.

### 6.2 Core helper API (use these; do NOT re-implement)
Formatting: `esc(s)`, `safeUrl(u)` ('' if not http/https), `fmtMoney(n)` ("$1.234.567", 0 → "$0"),
`fmtNum(n)` ("1.234.567"), `fmtCompact(n)` ("$12,3 M"), `parseMoney(str)` → int, `fmtDate('yyyy-mm-dd')` → "12 oct 2026",
`fmtDateShort` → "12 oct", `fmtRel(iso|date)` → "hace 3 h"/"ayer"/"12 oct", `todayStr()`, `addDays(str, n)`,
`daysUntil(str)` → int (str - today), `pct(a, b)` → 0..100 int, `linkify(text)` (escapes + anchors),
`plural(n, 'tarea', 'tareas')`, `initials(name)`.
Domain: `userName(email)`, `userColor(email)`, `avatar(email, size='sm'|'md'|'lg')`, `PIL(keyOrArea)` → pillar obj,
`pillarBadge(key)`, `dueInfo(task)` → `{key:'done'|'overdue'|'today'|'soon'|'ok'|'nodate', label, tone, icon, days}`,
`dueBadge(task)`, `taskInYear(t, year)`, `projectInYear(p, year)`, `linesOf(project)` → [Line] (resolved via IDX, any year),
`projectStats(p)` → {tasks, done, pending, overdue, soon, pf, pg, pend, nextTask}, `cascadeLabel(id)` → "Grupo › Item",
`CLASE_META[clase]` → {label:'KPI'|'Acción'|'Objetivo'|'Hito'|'Grupo', icon:'gauge'|'clipboard-pen'|'target'|'file-text'|'folder', tone},
`budgetLines(year)`, `myEmail()`, `isMine(t)`.
UI primitives (return HTML strings): `icon(name, cls='size-4')`, `badge(text, tone='zinc', iconName?)`,
`btn({label, icon, variant:'primary'|'secondary'|'ghost'|'danger'|'subtle', size:'sm'|'md', action, data:{}, attrs, title, href})`,
`iconBtn({icon, action, data, title, variant})`, `card(inner, cls)`, `statCard({label, value, sub, icon, tone, money:bool})`,
`progress(pctValue, tone, cls)`, `stackBar([{value, tone, label}])`, `emptyState({icon, title, text, actionHtml})`,
`skeleton(n)`, `segmented({name, value, options:[{value,label,icon?,count?}], action})` (each option is a button with
`data-action=action data-value=..`), `tabs({value, options:[{value,label,icon,count}], action})`,
`searchInput({value, placeholder, input: actionName, attrs})`, `sectionHeader({title, sub, icon, right})`,
`pageHeader({title, sub, icon, tone, right, crumbs:[{label, href}]})`.
Form helpers: `field({name, label, type:'text'|'number'|'date'|'url'|'email'|'textarea'|'money', value, placeholder,
required, hint, rows, attrs})`, `selectField({name, label, value, options:[{value,label,disabled?,group?}], placeholder})`
(groups → optgroup), `userSelect({name, label, value, allowEmpty=true})`, `readForm(rootEl)` → {name: value}
(money fields parsed to int; checkboxes → bool), `CX` class constants: `CX.input, CX.label, CX.card, CX.cardHover,
CX.kbd, CX.th, CX.td, CX.tableWrap, CX.muted, CX.chip, CX.chipOn`.
Overlays: `openDrawer({key, render:()=>({title, subtitle, iconHtml, headerRight, body, footer})|null, onMount(el), width:'md'|'lg'|'xl'})`,
`refreshDrawer()`, `closeDrawer()`, `currentDrawerKey()`;
`openModal({title, subtitle, iconHtml, body, footer, size:'sm'|'md'|'lg'|'xl', onMount(el, close), onClose})` → `{el, close}`;
`confirmDialog({title, message, confirmLabel='Confirmar', danger=false})` → Promise<bool>;
`promptDialog({title, label, value, placeholder, multiline})` → Promise<string|null>;
`toast(message, type='success'|'error'|'info')`; `copyText(text)` → Promise (clipboard with modal fallback).
Server: `run(fnName, ...args)` → Promise (rejects on server error); `mutate(fnName, args=[], {success:'Guardado', silent})`
→ Promise<bundle|null> (shows progress bar, applies bundle → re-renders shell + current view + open drawer, toasts;
**on error it toasts the message and resolves `null` — it never rejects**, so write `mutate(...).then(b => { if (b) close(); })`).
`refreshData(silent)` reloads the bundle. `myEmail()` = server email, or the identity picked in Ajustes (LS 'whoami') when
the server could not detect it. `LS.get(key, default)` / `LS.set(key, value)` = safe localStorage (prefix `aacc.`).
Router: `registerView(name, {title, render(params) → html, mount?(root, params)})`, `go(hash)`, `rerender()`.
Actions: `action(name, fn(data, el, event))` where data = el.dataset (strings).
Misc: `refreshIcons(root?)` (call after any manual innerHTML), `debounce(fn, ms)`, `downloadXlsx(rows, sheetName, fileName, cols?)`.

Lock rule: `bundle_()` is ALWAYS called outside the script lock (mutate_ releases the lock first). Read paths
(`presReadAll_`, `gRead_`) may briefly take the lock themselves via `withLock_` only to repair data (assign missing
budget IDs / append missing columns) — never nest `withLock_` calls.

View-local UI state namespaces: `S.ui.budget`, `S.ui.gestion`, `S.ui.forms`, `S.ui.avance`, `S.ui.admin`, `S.ui.assistant`
(initialize lazily: `S.ui.budget = S.ui.budget || {...defaults}`).
Theme: Core exposes `applyTheme(pref)`; Ajustes sets an explicit pref with `LS.set('theme', v); applyTheme(v); renderTopbar();`.

### 6.3 Event delegation (Core installs once)
- click on `[data-action]` → `ACTIONS[name](el.dataset, el, ev)` (ev.preventDefault() for `<a>` / buttons inside forms)
- change on `[data-change]` → `ACTIONS[name](el.dataset, el, ev)` (value in `el.value`)
- input on `[data-input]` → same (debounce inside handler if needed)
- keydown Enter on `[data-enter]` → `ACTIONS[name](el.dataset, el, ev)`
- Escape closes top-most modal, else drawer. ⌘K / Ctrl+K / "/" (when not typing) → `ACTIONS['assistant.open']`.
Action names are namespaced: `budget.*`, `gestion.*`, `task.*`, `project.*`, `avance.*`, `cascade.*`, `admin.*`,
`assistant.*`; Core owns `nav.*`, `theme.*`, `year.*`, `comment.*`, `drawer.*`, `modal.*`.

### 6.4 Routes (hash) → view names
```
#/presupuesto            budget.summary     (VPresupuesto)
#/presupuesto/lineas     budget.lines       (VPresupuesto)
#/gestion                gestion.overview   (VGestion)
#/gestion/:pilar         gestion.pillar     (VGestion)  pilar ∈ cc|ec|nat ; S.ui tab 'proyectos'|'tareas'
#/tareas                 gestion.mine       (VGestion)  "Mis tareas"
#/avance                 avance             (VAvance)
#/cascade                cascade            (VAdmin)
#/historial              history            (VAdmin)
#/ajustes                settings           (VAdmin)
```
Default route: last visited (localStorage) else `#/gestion`.
Cross-module entry points (globals):
- FGestion: `openProject(id)`, `openProjectForm({id?, pilar?})`, `openTask(id)`, `openTaskForm({id?, pilar?, proyecto?, fecha?, cascade?})`,
  `openCompleteTask(id)`, `cascadePickerHtml({name, pilar, value})`, `evidenceEditorHtml(name, list)`,
  `readEvidence(rootEl, name)` → [{t,u}], `taskRow(task, {showProject, showPillar})` (list row HTML, used by many views).
- VPresupuesto: `openLine(id)` (drawer with details/edit/comments/linked project).
- VAsistente: `openAssistant(initialQuery?)`.
- Core: `commentsPanel(ref)` HTML + actions `comment.add` / `comment.delete`.

### 6.5 Design system
- Font Inter (Google Fonts), `antialiased`. Base: `bg-zinc-50 dark:bg-zinc-950`, text zinc-900 / zinc-100.
- Surfaces: cards `rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900`.
- Primary accent: indigo-600 (hover indigo-500), focus rings `focus-visible:ring-2 ring-indigo-500/60`.
- Pillar tones: cc=sky, ec=amber, nat=emerald. Users: violet/sky/amber/emerald avatars.
- Tones for badges: zinc, red, amber, emerald, sky, indigo, violet (Core `TONES` map has bg/text/ring/solid/soft classes).
- Motion (Styles.html custom classes): `.anim-fade-in`, `.anim-slide-up`, `.anim-scale-in`, drawer slide-in from right,
  `.skeleton` shimmer, `.lift` hover translate. All disabled under `prefers-reduced-motion`.
- Numbers: `tabular-nums`. KPI values can animate with `data-countup="12345"` (Core animates after render).
- Dark mode: `class="dark"` on `<html>`; theme pref 'system'|'light'|'dark' in localStorage `aacc.theme`.
- Density: comfortable; text-sm base in tables; headings text-lg/xl font-semibold tracking-tight.
- Accessibility: buttons have `title`/aria-label when icon-only; color is never the only signal (icons+text).

---------------------------------------------------------------------------------------------------
## 7. Selectability criteria ("qué es seleccionable")

- **Cascade picker** (task/project "Indicador Cascade"): items with `padre === ''` are **groups**
  (Cascade objectives/initiatives) shown as non-selectable headers; their children (clase kpi/accion/objetivo/hito)
  are selectable, each with type icon + label (KPI = gauge, Acción = clipboard-pen, Objetivo = target, Hito = file-text).
  Filter to task's pillar by default, with a search box. Option "Sin indicador".
- **Budget lines linkable to a project**: same pillar, any year (default the selected year).
  Lines with `pf === 0` ("No se realizará") are shown disabled. A line already linked to ANOTHER project is shown
  disabled with "En: <proyecto>" (a line belongs to at most one project, to avoid double counting).
- **Project for a task**: only projects of the same pillar with estado ≠ 'Cerrado' (plus the current one).

---------------------------------------------------------------------------------------------------
## 8. Gestión UX summary

- Overview: 3 pillar cards (active projects, pending tasks, overdue, due ≤ alertDays, done this month, budget
  pf/pg of linked lines), "Próximos vencimientos" (next 14 days + overdue, all pillars), "Actividad reciente"
  (last completed tasks + comments).
- Pillar page: header in pillar tone; tabs Proyectos | Tareas. Projects as cards grid (name, resp avatar, estado badge,
  tasks progress, next due badge, linked budget progress pf/pg, comment count) + "Nuevo proyecto". Tasks tab: grouped
  Vencidas / Esta semana / Próximas / Sin fecha / Realizadas (collapsed), filters responsable + proyecto + search.
- Project drawer: header + tabs Resumen (description, resp, estado, cascade, evidencias) | Tareas (quick-add) |
  Presupuesto (linked lines + totals + "Vincular líneas") | Comentarios.
- Task drawer/modal: fields nombre, proyecto, responsable, fecha, indicador Cascade, nota, evidencias (Drive links);
  "Marcar como realizada" opens dialog requiring comentario de cierre (+ optional evidence + date, default today).
  Realizada tasks show cierre and allow "Reabrir".
- "Mis tareas": tasks where resp == me, grouped by urgency; sidebar badge = my overdue + due today/soon count.
- Avance por período: presets (Esta semana, Mes actual, Mes anterior, Trimestre actual, Trimestre anterior, Año, Personalizado),
  pillar + responsable filters, group by Indicador Cascade (default) or Proyecto. Shows completed tasks in range
  (completada ∈ [from,to]) with cierre + evidence links; counts per pillar; "Copiar para Cascade" (plain text per
  indicator and for all) + Excel export. Also a "Sin indicador" bucket.

---------------------------------------------------------------------------------------------------
## 9. Cascade seed catalog (Setup.gs `CASCADE_SEED`)
Format: `[{pilar:'ec', nombre, etiqueta, items:[[clase, nombre], ...]}, ...]` groups are clase 'grupo'.
Clase codes: k=kpi, a=accion, o=objetivo, h=hito.

ECONOMÍA CIRCULAR (ec)
- Implementación y Desarrollo Estrategia Zero Waste [Iniciativa Estratégica Organizacional]
  k Costo Valorización / Tonelada valorizadas; k Tasa Desvío COPEC; a Implementar Sistemas Estrategia Zero Waste;
  a Elaborar estrategia Zero Waste; o Implementar el plan zero waste en la red de tiendas (Retail Arcoprime)
- Valorización Plantas, CD, Oficinas [Iniciativa]
  k CD Maipú; k Planta Chacabuco; k Planta Pureo; k Planta Chillán; k Planta SIAV; k Planta Bluemax; k Planta Maipú;
  k Planta Concón; k Planta LUB; k Planta TPI; k Planta Guayacán; k Planta Caldera; k Planta Iquique; k Planta Arica; k Planta Mejillones
- Valorización EDS [Iniciativa]
  o Logística Inversa; a Isla Sin Basura; a APL EDS

NATURALEZA (nat)
- Iniciativas de gestión hídrica estratégicas [Iniciativa]
  o Certificación de "Sello Azul" en instalaciones
- Iniciativas de reducción de consumo hídrico [Iniciativa]
  a Búsqueda y evaluación de nuevas iniciativas de reducción hídrica; a Pilotaje de reúso de aguas grises tratadas en baños Pronto;
  a Implementación de remarcadores de agua en estaciones de servicio con sobreconsumo
- Reducción neta de consumo de agua [Iniciativa]
  k Reducción - Jardines sustentables; k Reducción - Reductores de flujo en grifería; k Reducción - Autolavado;
  k Reducción - Sobreconsumo EDS 20606; k Reducción - Lavado Tunel; k Reducción - Eliminación de jardines;
  k Reducción - Planta Pureo; k Compensación - Kilimo; k Compensación - Nilus; a Reducción - Oneka
- Conservar y proteger Ecosistemas cercanos a nuestra operación [Iniciativa]
  a 15 - Santuario Naturaleza Desembocadura río Lluta, Arica (2025); a 1 - Quebrada de Huatacondo, Pozo Almonte (2025);
  a 2 - Humedal Aguada La Chimba, Antofagasta (2019); a 3 - Parque Nacional Nevado Tres Cruces, Copiapó (2025);
  a 4 - Humedal Estero Tongoy, Coquimbo (2025); a 5 - Humedal El Bato, Quintero (2020);
  a 13 - Santuario del Maipo, San José de Maipo (2026); a 13 - Humedal El Trebal, Maipú (2025);
  a 7 - Humedal Rio Claro, Talca (2025); a 8 - Humedal Palomares (2026); a 16 - Reserva Nacional Huemules Niblinto, Coihueco (2025);
  a 14 - Centro Rescate Fauna Silvestre Huilo Huilo (2024); a 10 - Santuario Naturaleza Isla Kaikue/Lagartija, Calbuco (2025);
  a 11 - Humedal Vientos del Chelenko, Rio Ibáñez (2022); a 12 - Humedal Huairavo, Cabo de hornos (2025)
- Implementación Jardines Sustentables [Iniciativa Estratégica Organizacional]
  a Jardines Sustentables 2026

CAMBIO CLIMÁTICO (cc)
- Gestión energética [—]
  a Implementación SGE; a Spirax - recubrimiento térmico planta lubricantes
- Consumo de energía renovable [Iniciativa]
  a Compra de certificados de energía renovable
- Electrificación flota logística [Iniciativa Estratégica Organizacional]
  a Proyecto camiones híbridos; a Piloto 1er Camión eléctrico
- Eficiencia energética logística [Iniciativa]
  a Vigía - Inflado automático de neumatico; a Diésel Premium; a Green Energy: Paneles solares en camiones;
  a Gestión de datos; a Efilabs - Inflado de neumáticos
- Mitigación Huella [Iniciativa]
  k Movener; k Gestión de flota; k Diésel Premium; k Green Energy; k Efilabs; k Compensación EDS;
  k Electrificación de flota lubricantes; k Climatización eficiente Pronto; k Certificados IREC; k Contrato energía renovable
- Sistema de climatización Flair [Iniciativa]
  a Piloto Pronto Express
- Estrategia descarbonización Logística [Iniciativa]
  h Entregable 1 - Benchmark y medidas de mitigación; h Mesas de trabajo; h Entregable final - Hoja de ruta

---------------------------------------------------------------------------------------------------
## 10. Asistente (anti-hallucination) contract

1. Server builds a corpus from ALL data (all budget years, projects, tasks, comments, each evidence link as its
   own doc with parent context, cascade items). Each doc: {id, type, pilar, title, text, url?, refId, date?, estado?, resp?}.
2. Retrieval (deterministic): accent-insensitive tokens, Spanish stopwords removed, light stemming (plural s/es),
   prefix match ≥4 chars, field weights (title ×3, text ×1, url host/path ×1), IDF; intent filters from the question:
   pillar words (clima/carbono/energ/huella → cc; residu/reciclaj/circular/valoriz → ec; naturaleza/agua/hídric/humedal/biodiv → nat),
   "pendiente"/"por hacer" → pending tasks, "vencid"/"atrasad" → overdue, "realizad"/"hech"/"complet" → done,
   user names (Ina, Benja, Ignacio, Gonzalo) → resp filter. Top 20 docs.
3. If no GEMINI_API_KEY → `{mode:'search', found: results.length>0, answer:'', results}`.
4. Else Gemini call: temperature 0, JSON output `{found:boolean, answer:string, sourceIds:string[]}`, system
   instruction: answer in Spanish in ≤2 short sentences like a directory; use ONLY the provided records; cite ids;
   never invent names, numbers, dates or links; if records don't contain the answer → found=false.
5. Server-side guards: drop sourceIds not in the context; if found && no valid sources → found=false;
   strip any URL from answer that is not present in the cited docs; truncate answer to 400 chars.
6. Client always shows the cited sources as clickable cards (open drawer / open link) + the full keyword results
   list below ("Resultados en el directorio"), and a disclaimer "Respuesta generada sólo con datos de la app".
   Client also does INSTANT local filtering while typing (no server call) over S data; Enter = ask server.

---------------------------------------------------------------------------------------------------
## 11. Verified stack facts (researched 2026-10-02 — follow these exactly)

**Tailwind**: v4 browser build pinned `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3` (already in Index.html,
with `@custom-variant dark (&:where(.dark, .dark *));` in Styles.html). It watches DOM mutations, so classes inside
innerHTML strings work, including dynamically composed ones. v4 notes: border/ring default color is currentColor →
always write explicit colors (`border-zinc-200 dark:border-zinc-800`, `ring-1 ring-zinc-200`); `shadow-sm` is a light shadow;
use `size-*`, `shrink-0`, slash opacity (`bg-black/40`), `h-dvh`, arbitrary values ok. No plugins (no `forms`, no `typography`).

**Lucide**: pinned `https://unpkg.com/lucide@1.50.0/dist/umd/lucide.min.js` (NOT on cdnjs). Icons via `icon(name, cls)`.
`refreshIcons(rootEl?)` after manual DOM injection (Core already calls it after views/drawers/modals/toasts render).
**Use canonical v1 names**: `trash` (not trash-2), `rotate-ccw-clock` (not history), `funnel` (not filter),
`loader-circle` (not loader-2), `circle-check` / `circle-check-big`, `triangle-alert`, `circle-alert`, `ellipsis`
(not more-horizontal), `chart-column`, `chart-pie`, `circle-help`, `circle-x`. Verified to exist: layout-dashboard, wallet,
table, table-2, list-checks, folder-kanban, leaf, recycle, cloud, sprout, trees, droplets, flame, calendar-clock,
calendar, bell, bell-ring, message-square, message-square-text, paperclip, link, link-2, external-link, user, users,
user-round, clock, sparkles, search, command, moon, sun, plus, pencil, x, chevron-down/right/left, download, refresh-cw,
file-spreadsheet, target, gauge, clipboard-pen, clipboard-list, file-text, flag, milestone, send, arrow-up-right,
trending-up, copy, check, panel-left, menu, settings, info, inbox, kanban, list-todo, calendar-range, square-check,
circle, circle-dot, hourglass. Unknown names only console.warn (the harness checks every name against the real build).

**Gemini API** (Asistente.gs): default model `gemini-3.5-flash-lite` (2.5 models are restricted for new users since
2026-09-18). `POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent`, header
`x-goog-api-key`. Body: `systemInstruction:{parts:[{text}]}`, `contents:[{role:'user', parts:[{text}]}]`,
`generationConfig:{ responseFormat:{ text:{ mimeType:'application/json', schema:<JSON Schema> } }, maxOutputTokens: 1024 }`.
If HTTP 400 mentions responseFormat, retry ONCE with the legacy pair `responseMimeType:'application/json', responseJsonSchema:<schema>`.
**Do not send temperature/topP/topK** (deprecated in 3.x). Do not send thinkingConfig for flash-lite (default minimal);
if the model id contains '3.7-flash' or '3.8-flash' send `thinkingConfig:{thinkingLevel:'low'}`. Retry 429/503 with
backoff (1s, 2s). Check `promptFeedback.blockReason`, `candidates[0].finishReason === 'STOP'`, read text by joining
`parts.filter(p => p.text && !p.thought)`. `muteHttpExceptions: true`. Never expose the key to the client.
The paid consumer/Workspace Gemini subscription does NOT include API access → an AI Studio key is required; on the
free tier Google may use prompts to improve products (say so in Ajustes/GUIA).

**Apps Script**: no Date in google.script.run payloads (nested too) → convert. `Session.getActiveUser().getEmail()` is
"generally" available for same-domain viewers with Execute-as-me, but can be blank → handled (`'desconocido'`).
Installable triggers run as their creator and `getProjectTriggers()` only lists the current user's triggers → only admins
install. MailApp: `MailApp.sendEmail({to, subject, htmlBody, body, name})`, Workspace quota 1,500 recipients/day;
check `MailApp.getRemainingDailyQuota()`. `Sheet.hideSheet()` throws if it is the last visible sheet.
`insertSheet(name)` activates it. LockService `tryLock(ms)` returns bool. Meta tags in HTML files are ignored (use addMetaTag).
Manifest `appsscript.json`: timeZone `America/Santiago`, runtime V8, webapp executeAs USER_DEPLOYING / access DOMAIN,
`urlFetchWhitelist: ["https://generativelanguage.googleapis.com/"]`.
localStorage may throw inside the iframe → always use `LS` helper.

---------------------------------------------------------------------------------------------------
## 12. Contract additions after the review (2026-10-02) — these override earlier sections

Server (Code.gs)
- Access: `assertMember_()` / `isMember_()` — only CONFIG.USERS, CONFIG.ADMINS and emails in Script Property `EXTRA_USERS`
  (comma-separated) may use the app ('desconocido' is tolerated because Google sometimes hides the email). Called by
  `mutate_`, `bootstrap`, `getHistory`, `getAdminStatus`, `ask`, `sendTestDigest`.
- `mutate_(fn)` → bundle, or `{stale:true, lastId, warning}` when the write succeeded but reloading failed (Core shows an info
  toast and refreshes). `log_` never throws and escapes user text (`logCell_`).
- `bundleBudget_(ss, warnings)` reads budgets skipping malformed "Cuadre YYYY" tabs; `bundle.config.warnings: string[]`
  (Core renders `warningsBanner()` on every view).
- App URL for emails: `CONFIG.APP_URL` → Script Property `APP_URL` (auto-captured on the first `/exec` request, or set with
  admin-only public `setAppUrl(url)`) → `ScriptApp.getService().getUrl()`. `getAdminStatus()` adds `appUrl`, `appUrlSaved`.
- `bundle_().loadedAt` is stamped BEFORE reading; Core ignores bundles older than the current one.

Server (Presupuesto.gs / Gestion.gs)
- `budgetSave(year, id, data, base?, opts?)`: optional `base` = {field: value the client saw}; a changed field that no longer matches
  `base` throws a Spanish conflict error and nothing is written (v3.4 §18: the UI no longer sends `base`; kept for API callers).
  `opts.light` (edits only) → `{ok, lastId}` without the bundle. Area change across pillars is refused while the line is
  linked to a project of another pillar.
- `gSave(entity)`: optional `entity.base` = the `actualizado` ISO string the client saw (edits only, never on create) →
  conflict error naming who changed it (v3.4 §18: the UI no longer sends `base`; kept for API callers). Newly linked lines must exist, share the project's pillar and have pf > 0.
  Project pillar change moves its tasks / unlinks lines of the old pillar (logged).
- `taskComplete` refuses an already completed task; `taskReopen` refuses an already pending one.
- Gestión text cells are stored without the forced-text apostrophe (only values starting with '=' get it); `gUnq_` cleans old rows.
- Helpers: `gLineProject_(lineId)` → {id, nombre, pilar}|null, `gLineIndex_(ss)`, `gPillarLabel_(key)`, `presFixTab_`,
  `presProtectId_` (warning-only protection on the ID column). Rows emptied by hand lose their ID (logged).

Client (Core.html) — new options/helpers
- `field({id})` / `selectField({id})` stable ids; `statCard({cls, animate:false})`; `pageHeader({iconHtml})`;
  `iconBtn({disabled})`; `openModal({wrapCls, panelCls, bodyCls})`; `captureDrafts/restoreDrafts` keep typed text (inputs
  with id) across re-renders; `fmtMoneyInput` keeps the caret; `parseMoney` ignores a trailing ",00".
- Internal `<a href="#/…">` links are intercepted (Cmd/Ctrl-click navigates in place, middle-click cancelled) because of
  `<base target="_top">`. Deep links: `google.script.url.getLocation` on boot; `google.script.history.replace` on route.
- Comments: double-post guard + textarea cleared after success.
- Public helpers also relied upon by views (keep stable): dataAttrs, BTN_VARIANTS, tone, TONES, normTxt, shortUrl,
  evidenceIcon, evidenceChip, fmtDateTime, ymd, parseYmd, pad2, MESES, MESES_LARGO, MODALS, closeTopModal, errMsg,
  applyTheme, renderTopbar, renderShell, loadApp.

Cross-module entry points added
- VAdmin: `openCascadeItem(id)` (indicator drawer with linked tasks); catalog state via `admState()` (pilar, casQ, open).
- FGestion: `openProjectForm({pilar, lineas})` pre-links lines; picker actions use the `cascade.picker.*` namespace
  (VAdmin owns `cascade.*`). `fgProjCascade(p)` only inherits leaf indicators into tasks.
- VGestion: `vgProjInYear(p, year)` — an Activo/En pausa project from an earlier year stays visible until closed.
- VAsistente: `asstOpenCascade(ref)`; the palette refuses to open over an open modal (toast).

---------------------------------------------------------------------------------------------------
## 13. v3 — "herramienta del equipo, no de control" (2026-10-03). Overrides earlier sections.

Product intent: friendly, low-pressure, team-owned. Fewer alarms (red only for overdue), warm copy ("¡Lista! Una menos"),
personal to-do list front and center, instant interactions (optimistic UI), privacy choice per task. Gonzalo (admin) keeps
oversight views (Vista general, Historial, Solicitudes de compra). "Avance por período" is REMOVED (VAvance.html deleted).

### 13.1 Data model (Gestión sheet) — new headers appended at the end: `Avisar | Privada | Inicio`
- Task: `avisar` bool (sheet "No" → false, anything else/empty → true), `privada` bool (sheet "Sí" → true; default false),
  `orden` number (personal manual order, column Orden; 0/empty = unordered → after ordered ones, then by fecha),
  `pilar` MAY be '' (personal to-do with no pillar/project). If `proyecto` is set, pilar := that project's pilar (server).
  `cierre` is OPTIONAL everywhere (taskComplete with cierre '' is valid). gSave on a Tarea may edit `cierre` and
  `evidencias` at any estado (used to add a closing comment after a quick check).
- Project: `inicio` ('yyyy-mm-dd'|'', column Inicio) and `fin` ('yyyy-mm-dd'|'', stored in column Fecha).
- Bundle Task adds: avisar, privada, orden, creadoPor (already). Bundle Project adds: inicio, fin.
- VISIBILITY (server-enforced in bundle_, gRead_ consumers that serve a user (bundle, ask), and in every task mutation):
  a task is visible to user U iff `!privada || creadoPor === U || resp === U`. Hidden tasks are omitted from the bundle,
  their comments too; projectStats counts only visible tasks (fine). Mutating a task you cannot see → 'No encontré la tarea'.
  Admin does NOT bypass privacy. (Privacy is app-level; the hidden sheet still holds the data — say so in UI copy.)
- New public `taskReorder(ids)` → sets Orden = 1..n for those ids (each must be visible to me); returns bundle.
- (Superseded by §17 in v3.3: there is no immediate reminder.) Immediate reminder: after any gSave (create/edit) or taskReopen of a task that is Pendiente && avisar && resp && fecha &&
  daysLeft ≤ CONFIG.NOTIFY_DAYS, if the corresponding marker isn't set, send the single-task email NOW
  (`notifTaskNow_(task)` in Notificaciones.gs; inside the same mutation; never throws — failures are logged) and set markers
  exactly like notifDaily. notifDaily skips avisar=false tasks.
- Cascade → projects import: public admin-only `importCascadeProjects()` → mutate_ → bundle with `lastImport:{projects,tasks}`;
  internal `gImportCascadeProjects_()` (called by setup()). Rule: for each Cascade group: every child with clase accion|objetivo
  becomes a Project (nombre = child name, pilar, cascade = child id, estado 'Activo', anio ''); a group with NO accion/objetivo
  children becomes one Project itself (cascade = group id) and its hito children become Tasks of that project (cascade = hito id,
  no fecha, avisar true, privada false). Idempotent: skip when a project (or task) with that cascade id already exists.

### 13.2 Solicitudes de compra (Ariba) — new file Aprobaciones.gs (prefix aprob*_), hidden sheet CONFIG.APROB_SHEET 'Solicitudes'
CONFIG: ARIBA_SENDER, APROB_SHEET, MY_CECOS ['XUF80853'], APROB_SCAN_HOUR 7 (daily scan; user decision 2026-10-03 — NOT every N minutes).
Headers: `ID | Gmail ID | Hilo | Recibido | Solicitante | PR | Nombre | Monto CLP | Monto texto | Fecha solicitud | Proveedor |
Descripción | Comentario | CeCos | Total UF | Estado | Año | Línea | Monto imputado | Nota | Procesado por | Procesado | Asunto | Lectura`
Sol (bundle `solicitudes`, ADMIN ONLY, [] otherwise): {id:'SOL-xxxxxxxx', gmailId, hiloUrl, recibido ISO, solicitante, pr:'PR71524',
nombre:'Piloto Green Energy en Transcom', montoClp:int (rounded), montoTexto:'$13.473.363,17 CLP', fechaTexto:'viernes, 2 octubre,
2026 a las 11:17, CLST', fecha ISO|'', proveedor, descripcion, comentario, cecos:[{cuenta:'0005602585', cuentaNombre, codigo:'XUF80853',
nombre:'PROY.CAMBIOS CLIMA', uf:109.8, clp:int, propio:bool}], totalUf, estado:'Pendiente'|'Vinculada'|'Nueva línea'|'Descartada',
anio, lineId, montoImputado:int, sugerido:int (sum clp of propio cecos, else montoClp), nota, procesadoPor, procesado ISO, asunto,
lectura:'ok'|'parcial'}.
Parsing (pure, testable `aprobParse_(subject, plainBody, receivedDate)`): subject pattern "…Solicitud de compra que <NAME> ha enviado -
<PR> - <NOMBRE> ($<monto> CLP)"; body labels "En representación de", "Solicitud de compra", "Creado", "Importe total", "Proveedor",
"Descripción", "Comentarios recientes", cost lines "<cuenta>(<cuentaNombre>) <CODIGO>(<NOMBRE>) Importe <n,nn> CLF" (may wrap lines).
CLP per CeCo = round(montoClp × uf / totalUf). Sample text: dev/fixtures/ariba_PR71524.txt.
Public admin-only API (all via mutate_ except scan status): `aprobScan()` → bundle + lastScan {found, added, updated};
`aprobLink(id, {year, lineId, monto, marcarOc:bool, nota})` → estado 'Vinculada' (if marcarOc: line oc='Si'; append "PRxxxx" to the
line Nota if absent) ; `aprobNewLine(id, {year, area, proj, monto, nota})` → creates budget line (clas 'Fuera de POA', pf = monto,
pg 0, oc 'Si', nota "PRxxxx · <solicitante>") and links it → 'Nueva línea' ; `aprobDiscard(id, motivo)` → 'Descartada' ;
`aprobReset(id)` → back to 'Pendiente' (does not undo budget edits) ; `aprobInstall()` → DAILY time trigger 'aprobScanTrigger' at
APROB_SCAN_HOUR (everyDays(1).atHour, idempotent, reinstalls if the hour changes; manual 'Revisar ahora' = aprobScan) ; `aprobScanTrigger()` (trigger handler). Internal: `aprobRead_(ss)`, `aprobStatus_()` →
{triggerInstalled, lastScan ISO, lastResult, sender}. Gmail query `from:(<SENDER>) newer_than:120d`, max 50 threads, only
messages from SENDER with 'Solicitud de compra' in the subject; dedupe by message id; same PR still 'Pendiente' → update fields;
processed PR → ignore newer reminders (record nothing). GmailApp needs a new permission (read Gmail) — owner account only.
Presupuesto.gs exposes `presSaveInLock_(year, id, data, base)` → {id} (same logic as budgetSave without mutate_), used by
Aprobaciones. Code.gs: bundle_ adds `solicitudes` (admin only, via typeof aprobRead_), getAdminStatus adds `aprob: aprobStatus_()`.
Backup mail for the whole team (2026-10-07, user decisions): the team NEVER opens or reads Gonzalo's Gmail; they see a frozen
SCREENSHOT ("pantallazo") of that one Ariba mail. Hidden sheet APROB_SNAP_SHEET 'Capturas de correo', one row per request:
`ID | Gmail ID | Capturado | Asunto | De | Fecha | Captura` (the capture continues in G, H…: chunks of APROB_SNAP_PART 45000
chars, each prefixed with "|" so Sheets never parses it; > APROB_SNAP_PARTS 10 chunks → plain-text <pre> capture). Taken with
GmailApp only by the admin/trigger: in aprobLink / aprobNewLine (aprobSnapFor_, outside the lock, saved inside it) and in
aprobScan / aprobScanTrigger (aprobSnapPending_: linked requests without capture, up to APROB_SNAP_BATCH 20 per run — covers
requests linked before this version and failed captures). Only messages from ARIBA_SENDER; aprobSnapHtml_ keeps layout (tables,
<style>, https images) and removes scripts, forms, frames, on* handlers and ALL links (Aprobar/Denegar/Ver carry the approver's
token). Never breaks linking or scanning; GMAIL feature off → no capture. bundle_ adds `budgetMails` for EVERY member (via
typeof aprobMailRefs_, never throws): [{id:'SOL-…', lineId, pr, fecha ISO|'', recibido ISO}] of requests 'Vinculada'|'Nueva
línea' that have a capture (no amounts, requester or Gmail link). Public `aprobMailView(id)` (any real member, not
'desconocido'; reads ONLY the sheets, never Gmail; works in safe mode and after the mail is deleted) → {id, pr, asunto, de,
fecha ISO, capturado ISO, html, hiloUrl ('' unless admin)}.

### 13.3 Client v3
- Routes: budget.approvals '#/presupuesto/solicitudes' (admin), gestion.plan '#/gestion/:pilar/plan', todo.page '#/tareas',
  gestion.overview (admin only), history (admin only). Non-admins land on their last pillar. (Core done.)
- Core new: isAdminUI(), homeRoute(), myTasks(), greeting(), optimistic(applyLocal, fn, args, {success, rerender}),
  view def `wide: true` (max-w 1680px), checkButton(task, {action, size}) + celebrate(el), completeTask(id, el),
  reopenTask(id), toast(msg, type, {actionLabel, onAction, duration}). Default action of checkButton is 'task.toggle'
  (owned by FGestion: pending → completeTask(id, el); done → reopenTask(id) — no confirm, it's reversible).
  Rows that contain a check should carry `data-task-row` and the title element class `task-title` (strike animation).
  dueInfo labels are softer: 'Atrasada · N d' (red), 'Hoy' / 'Mañana' / 'En N días' (amber), 'dd mmm' (zinc).
- TodoPanel.html (NEW): `todoLayout(mainHtml)`, `todoMount(root)`, view 'todo.page'. Personal list = myTasks().
- VGestion.html: overview (admin), pillar (visual projects+tasks, uses todoLayout), plan (Gantt).
- FGestion.html: friendly task composer, project dates, privacy/avisar toggles, optional closing comment, task.toggle.
- VAprobaciones.html (NEW): view budget.approvals. VPresupuesto: line drawer lists linked solicitudes (admin).
- VAsistente.html: "Buscar en Drive con IA" → window.open('https://drive.google.com/drive/search?q=' + encodeURIComponent(q)).
- VAdmin.html: no Avance references; Ajustes: import Cascade projects (admin), Ariba status/install/scan (admin).

---------------------------------------------------------------------------------------------------
## 14. v3.1 — simpler, faster, Drive per project (2026-10-03). Overrides earlier sections.

### 14.1 Performance contract
- Core boots from a localStorage cache of the last FULL bundle (key aacc.bundle.v31) when it belongs to the same viewer
  (`window.AACC_VIEWER`, injected by doGet), then replaces it with the fresh bootstrap (`S.fromCache` while stale).
- PARTIAL bundles: Gestión mutations return `{partial:'gestion', projects, tasks, cascade, comments, loadedAt, lastId?}`
  (built by Code.gs `bundleGestion_()`, visibility-filtered for me_()) instead of the full bundle. Core.applyBundle merges
  partial bundles (replaces only those 4 arrays). Applies to: gSave, gDelete, taskComplete, taskReopen, commentAdd,
  commentDelete, importCascadeProjects. Budget/Aprob mutations keep returning the full bundle. Code.gs helper
  `mutateG_(fn)` = withLock_(fn) + bundleGestion_() (+ lastId / stale handling like mutate_).
- `taskReorder(ids)` returns a LIGHT result `{ok:true, ids}` (no bundle). The client applies the order locally, debounces
  (~700 ms) and sends only the final order: `optimistic(applyLocal, 'taskReorder', [ids], {key:'reorder', rerender:false,
  applyResult:false})`. While a reorder is pending the panel keeps its local order even if a bundle arrives.
- Core `optimistic(…, {key})` ignores responses superseded by a newer call with the same key; `{applyResult:false}` never
  applies the server result. `refreshIcons()` strips data-lucide from rendered SVGs (no re-processing).
- bundle_ must not call ScriptApp.getProjectTriggers(): `config.aprob` uses a fast status (Script Properties only).

### 14.2 Quick date after Enter
Core `pickDate(anchorEl, {title}) → Promise<'yyyy-mm-dd' | '' | null>` (Hoy · Mañana · Viernes · Próx. lunes · Elegir… ·
Sin fecha; keys 1–5, ↑↓ ↵, Esc = null). Every quick-add (to-do panel, pillar inline add, project drawer quick add): on
Enter, if the text has no natural date already, call pickDate(input); null → keep the text, do nothing; '' → create without
date; date → create with that fecha. Then refocus the input for the next one.

### 14.3 Drive folder per project — new Drive.gs (prefix drive*_)
- Root: Script Property `DRIVE_ROOT_ID` (a folder inside the team shared drive), set by admin-only public
  `driveSetRoot(urlOrId)` → {ok, root:{id, name, url}} (validates access with DriveApp.getFolderById).
- Layout: <root>/<Pilar label>/<Proyecto nombre>. Project folder id stored in Gestión column `Carpeta` (append header;
  Gestion.gs reads it into Project.carpeta; Project.carpetaUrl = 'https://drive.google.com/drive/folders/' + id when set).
- Public (assertMember_): `driveStatus()` → {configured, root|null, admin}; `driveFolder(projectId)` → ensures + returns
  {id, url, name}; `driveList(projectId)` → {folder:{id,url,name}|null, files:[{id, name, mimeType, size, updated ISO, url,
  kind:'image'|'pdf'|'doc'|'sheet'|'slide'|'folder'|'video'|'file'}]} (max 200, newest first; does NOT create the folder);
  `driveUpload(projectId, {name, mimeType, base64})` → file entry (creates folder if needed; max 20 MB decoded; sanitized
  name); admin `driveCreateMissing()` → {created, total}. Internal `driveEnsureFolder_(project)` (call outside long locks:
  Drive calls are slow; write the Carpeta cell under withLock_ only). Rename/move on project rename or pillar change is
  best-effort via `driveSyncFolder_(project)` called by Gestion.gs after gSave (typeof-guarded, never throws).
- New project → best-effort folder creation right after the save (typeof driveEnsureFolder_ guard; failure logged only).
- Requires the Drive scope (full Drive) — new permission on setup/redeploy. The app runs as Gonzalo, so files are created
  by his account inside the shared drive; team members open them with their own shared-drive membership.

### 14.4 UI simplification (all views)
Remove low-value text: header stat lines ("10 tareas en curso · 2 esta semana · 1 atrasada"), encouragement/empty prose
("Todo al día por aquí. Buen momento para planificar lo que viene."), helper hints under inputs (keep only error-preventing
ones), legends that are self-evident, redundant counts in section headers, "Iniciativa" etiqueta tags outside the Cascade
catalog, duplicate subtitles. Empty states: icon + one short line (or nothing). Rows: at most title + due chip + avatar
(+ lock if private); project/Cascade chips only where the context is not already the project. Keep aria-labels/titles.
- "Mis tareas" is NOT in the sidebar anymore (the right panel is the only place); '#/tareas' redirects to the home pillar with
  the panel open (TodoPanel exposes `todoOpenSheet()` for mobile). The 'todo.page' view is removed.
- "Ver como admin" (Ajustes, only for real admins): `setAdminView(on)`; `isAdminUI()` is false when off → no Vista general,
  no Solicitudes de compra, no Historial, no admin cards (only the toggle itself stays visible to S.me.admin).
- Budget lines with a linked Ariba request: an eye icon ("Ver correo de respaldo") for the WHOLE team (2026-10-07). With
  "Ver como admin" (S.solicitudes lineId === line.id && hiloUrl) it opens the Gmail thread in a new tab; otherwise (team members,
  or the admin in team view) never open that inbox: the eye comes from S.budgetMails and opens a modal (size xl) with the
  saved screenshot (`budget.mail` → aprobMailView, cached per session), rendered in `<iframe data-snap sandbox="allow-same-origin"
  srcdoc>` (no allow-scripts; own CSP: default-src 'none', img-src https: data:, inline styles) and fitted like an image
  (budSnapFit: full height, scaled down when wider than the modal, pointer-events none).

### 14.5 Implementation notes (as built, 2026-10-03)
- `mutateG_(fn, after?)`: optional `after(res)` runs outside the lock before reading the partial bundle (Drive folder hooks).
- `aprobStatusFast_()` = aprobStatus_ shape + `fast:true`, installed inferred from APROB_SCHEDULE (no trigger lookup).
- Project gains `carpeta`, `carpetaUrl`; `gSetProjectFolder_(projectId, folderId)` (no lock; Drive.gs calls it inside withLock_).
- `taskReorder` → `{ok:true, ids}`, no Historial row. Bundle `config.drive` (bool). APP_VERSION 3.1.0.
- doGet passes `viewerJson` (JSON, `<` escaped) → `window.AACC_VIEWER` for the bundle cache identity check.
- TodoPanel globals relied on by others: `todoParse(text, today) → {nombre, fecha, token}`, `todoOpenSheet()`, `todoIsWide()`,
  input id `todo-add-aside`, action `todo.expand`. FGestion: `evidenceEditorHtml(name, list, {project})`, `taskRow` opts.showCascade.
- Drive.gs errors containing 'configura' / 'Falta conectar' signal "not configured" to FGestion.

---------------------------------------------------------------------------------------------------
## 15. Privacy defaults v3.2 (2026-10-05) — overrides §13.1 defaults

- Rule: a task WITHOUT project is PRIVATE by default; a task WITH project is PUBLIC (shared) by default.
  Exception: if the server cannot identify the user (me_() === 'desconocido') tasks are created public (a private task
  nobody can see is useless).
- Server (Gestion.gs gSave Tarea): on CREATE, if `entity.privada` is undefined/null → privada = !proyecto (respecting the
  exception). On EDIT, if proyecto goes from '' to a project and `entity.privada` is undefined → privada = false.
  Explicit `privada` from the client always wins.
- New public `tasksSetPrivacy(ids, privada)` → mutateG_ partial bundle. Each id must be visible to me AND I must be its
  creator or responsable (else 'Sólo quien creó la tarea o su responsable puede cambiar su privacidad.'). Max 500 ids,
  deduped, one write (column Privada + Actualizado/Actualizado por), one Historial line ("N tareas ahora públicas/privadas",
  no names for private ones).
- Client defaults: to-do quick add → privada = true (unless identity unknown); pillar inline add inside a project / project
  drawer quick add → privada = false; pillar "sin proyecto" inline add → privada = true. Composer (openTaskForm): default
  Privada when no project; choosing a project flips it to Compartida unless the user touched the toggle; removing the project
  flips back. "Mover a proyecto" → also sets privada = false (toast "Ahora la ve el equipo").
- To-do panel multi-select: a discreet "Seleccionar" control in the panel header; selection mode shows checkboxes on rows
  (click, Shift+click ranges, "Todas"); a sticky bottom bar "N seleccionadas · Hacer públicas · Hacer privadas · Cancelar"
  → optimistic local change + ONE tasksSetPrivacy call ({key:'privacy'}). Each private row's lock icon is also a one-click
  toggle (make public) with title "Privada · clic para compartir".

---------------------------------------------------------------------------------------------------
## 16. WhatsApp bot, zero cost (2026-10-05)

- Architecture (2026-10-05): WhatsApp Cloud API (Meta app "Enke chat", NO payment method → Meta cannot bill) → receptor =
  standalone Apps Script web app in a SEPARATE project (`bot-whatsapp/ReceptorWhatsApp.gs` + `bot-whatsapp/appsscript.json`),
  deployed by the user's Copec account (Copec allows "Anyone" sharing; user decision 2026-10-05 — a bot Gmail account with the
  sheet shared as Editor also works), executeAs USER_DEPLOYING, access ANYONE_ANONYMOUS (Meta calls without a Google account),
  scopes spreadsheets + external_request → hidden tab `WhatsApp` (inbox) → `WhatsApp.gs` imports rows into tasks on
  `bootstrap()` and in `notifDaily()`. NEVER put the receptor inside the main project (duplicate doGet; the main app is
  container-bound and must stay DOMAIN because assertMember_ admits 'desconocido').
- Receptor: protected by `?k=URL_KEY` (Apps Script cannot read X-Hub-Signature-256) + allow-list in `WhatsApp contactos`
  column A + `phone_number_id` filter; dedupes by Mensaje ID in the last 1000 inbox rows (Meta may retry); script lock;
  user text written through rxLiteral_ (apostrophe before = + - @, never a formula); throws on sheet failure so Meta retries;
  NEVER sends messages (cost 0), only marks as read when WA_TOKEN is set. `probarReceptor()` creates VERIFY_TOKEN/URL_KEY and
  checks config; `?pagina=privacidad` serves the privacy page. Anonymous URL form: `https://script.google.com/macros/s/<id>/exec`
  (without `/a/macros/<domain>/`); query params only, no pathInfo.
- Alternative kept in `bot-whatsapp/alternativa-cloudflare/worker.js` (Cloudflare Worker: verifies X-Hub-Signature-256 with
  APP_SECRET, Sheets API via a service account, valueInputOption=RAW, 500 on failure so Meta retries).
- Inbox columns: `Recibido | Mensaje ID | Número | Nombre | Texto | Estado | Tarea | Nota`; Estado '' or 'Nueva' = pending;
  import sets Importada (+Tarea id) / Ignorada (+Nota) / Duplicada (same Mensaje ID) / Error (+Nota). Max 50 per run.
- Contacts columns: `Número | Correo | Nombre` (prefilled with CONFIG.USERS by setup; numbers normalized to digits, 9-digit
  Chilean mobiles get the 56 prefix; only team members via isMember_).
- Import creates tasks via `gSaveCore_` (gSave's core, lock held) under `asUser_(email)` (Code.gs identity override for
  me_()), so creadoPor/resp/Historial = sender; privada true, avisar true, pilar ''; trailing natural date parsed by
  `waParse_` (same rules as TodoPanel.todoParse); optional "Tarea:" prefix stripped; names > 300 chars truncated (full text
  in Detalle). No email at import (§17).
- Tests: `dev/harness/tests/whatsapp.test.js` (import), `dev/harness/tests/receptor.test.js` (receptor, loaded isolated) and
  `dev/bot-test/index.html` (Cloudflare alternative, real WebCrypto, mocked Meta/Google).

## 17. Email notices: only when a task is overdue, once (v3.3, 2026-10-05)

- User request: "que sólo me avise cuando una tarea venció, y que sea una vez". Applies to the whole team.
- Removed: the immediate reminder on gSave / taskReopen (gNotifyNow_, notifTaskNow_), the "por vencer" (≤ 3 days) and
  "vence hoy" notices, `CONFIG.NOTIFY_DAYS` and bundle `config.notifyDays`. Saving, completing, reopening, toggling Avisar
  and the WhatsApp import never send email.
- `notifDaily()` (daily trigger at CONFIG.NOTIFY_HOUR): for every pending task with avisar, an email resp and fecha < today
  (d < 0) whose Notificado has no "0" for its CURRENT fecha → one email per responsible person listing those tasks, then
  Notificado = `fecha:0` (other marks of the same fecha are kept). Legacy "0" marks (sent on the due day or when overdue)
  count as already notified, so the upgrade causes no burst; legacy "3" marks do not count. No quota or a send error →
  no mark (retried the next day).
- Changing fecha or resp clears Notificado (unchanged rule) → the new date / person can get one notice. Completing and
  reopening keep the mark → no resend.
- Email copy: subject `[Cuadre AACC] Venció: <nombre>` (one task) / `[Cuadre AACC] N tareas vencidas`; intro "Esta tarea
  venció ayer." / "Tienes N tareas vencidas."; red chip "Venció ayer" / "Venció hace N días"; footer: written once when a
  task you own is overdue, can be turned off per task.
- `sendTestDigest()` and the sheet menu item "Enviarme mis tareas vencidas": the user's overdue pending tasks (avisar=false
  included), marks untouched; subject "Sin tareas vencidas" when there are none.
- UI copy: task drawer switch "Avisarme si vence" / "Avisar si vence" + "Un correo si pasa la fecha sin estar lista";
  composer switch title "Avisarme: un correo si pasa la fecha sin estar lista."; Ajustes card "Un solo correo cuando una
  tarea vence sin estar lista (~08:00 del día siguiente). Se apaga en cada tarea."; no "Vence pronto … apenas la crees" hint.
- Tests: notif.test.js (rewritten), v3_server.test.js (v3.3 block), gestion, fix_gestion-srv, fix_core, whatsapp,
  bootstrap and v3_fgestion.

## 18. Fluidity and mobile (v3.4, 2026-10-05)

- User request: everything felt slow ("aparece una línea azul cargando"); agility is preferred over conflict detection
  ("es difícil que en un span tan rápido dos usuarios hagan el mismo cambio"). Also: fewer filters on mobile, no
  "Requieren acción" button, Pagado editable directly, and no zoom on the phone.
- Saves never light the top progress bar (`setProgress(delta, bar)`: only the manual refresh passes `bar`); the header
  "Guardando…" appears only if a save takes > 1.2 s.
- Instant UI (`optimistic`) for: budget inline edits (Pagado / OC / responsable), line form save, line delete, link /
  unlink line ↔ project; task form edit (only changed fields) and create (tmp id, toast «Ver»), completion with comment,
  closing-comment edit, flags, redate, delete; project edit, reopen, link / unlink lines; comments add / delete. Creating a
  budget line or a project still waits for the server id (the button shows its own spinner).
- No version checks from the UI (`base` / `from` are no longer sent): last write wins, field by field (task and line
  forms send only the fields that changed). The server keeps the optional checks for API callers.
- `optimistic(apply, fn, args, {reapply: true})`: while waiting for its own response, the local change is re-applied after
  any bundle arrives (`reapplyPending()` inside `applyBundle`), so another save's response cannot flicker it back.
  `apply` must look records up by id (IDX / S) and be idempotent. On error: toast + `refreshData(true)`.
- `budgetSave(..., null, {light: true})` for line edits: `{ok, lastId}` without the bundle (the client recomputes with
  `budCalc` = `presCalc_`). An area change uses the full bundle.
- `task.toggle` only ignores a double tap (700 ms); it is no longer blocked while saves are pending.
- Lines view on mobile: search + «Filtros» button (`u.filtersOpen`) holding pillars / OC / estado / responsable;
  «Requieren acción» is no longer a toolbar button (a removable chip appears only when coming from the summary card).
  Cards have an editable Pagado input (`bud-pgc-<id>`, action `budget.pg`, Enter or blur saves); the view does not
  re-render while another Pagado input has focus (`budRerenderSafe`), so the phone keyboard stays open.
- No zoom: viewport `maximum-scale=1, user-scalable=no`; `html { touch-action: manipulation }`; `gesturestart` /
  `gesturechange` prevented (iPhone).
- Pull to refresh (touch devices): with `#view` at the top and no drawer / modal open, dragging down moves `#ptr` (Index,
  under the header) with 0.5 resistance and rotates its icon; released past 70 px it spins while
  `refreshData(false, {quiet: true})` runs (no top bar, no toast), then hides. Ignored when dragging up or sideways, when
  the view is scrolled, or when the touch starts on a field / drag handle. `#view { overscroll-behavior-y: contain }` and
  `preventDefault` stop the native bounce / full-page reload. The header refresh button is hidden on coarse pointers.
- Personal list «Editar» (hover toolbar and ⋯ menu): `todo.edit` opens `openTaskForm({id})` (the editable form), not the
  task drawer.
- Tests: `v34_fluidez.test.js`, plus updated client tests (followup_ui-gestion, v3_fgestion, v31_fgestion, v32_fgestion,
  v3_todo, v32_todo, v31_budget-ui).

## 19. Side swipes on mobile (v3.5, 2026-10-05)

- User request: on the phone, swipe right → left opens «Mis tareas» and left → right opens the hamburger menu; until now
  those swipes made the browser go back / forward through the app's routes.
- `swipeInit()` (Core, called in `boot`): document-level touch listeners (capture, non-passive), only on touch devices
  and widths < 1024 px (wider screens already show the menu and the task panel). Direction locks after 10 px
  (horizontal when |dx| > 1.5·|dy|); a horizontal swipe ≥ 60 px runs `swipeGo`: left → right opens the sidebar or, with
  «Mis tareas» open, closes it; right → left closes the sidebar if open, else opens `todoOpenSheet()`.
- Ignored when the touch starts on a field, a drag handle (`[data-todo-grip]`, `.touch-none`) or inside a horizontally
  scrollable element (chips, tables), when a modal is open, or when a drawer other than «Mis tareas» is open.
- Browser back / forward gestures: a touchstart within 16 px of either screen edge is `preventDefault`-ed unless it lands
  on a button / link / field / `[data-action]` (iOS Safari 13.4+ edge swipe); locked horizontal moves are
  `preventDefault`-ed; `html, body, #view { overscroll-behavior-x: none }` stops Chrome's swipe navigation. Other iOS
  browsers (Chrome / Firefox on iPhone) may still honor their own edge gesture.
- Tests: `v35_gestos.test.js`.

## 20. Several people per task, people button, drag the whole row (v3.6, 2026-10-06)

- User request: (1) a task can be assigned to more than one person, and then it is public by definition; (2) the row
  toolbar drops the drag handle and the up / down arrows and gets a «Personas» button (change the responsible person or
  add people); (3) the whole row can be dragged to reorder and, on a pillar page, dropped on a project (the task stays
  in «Mis tareas» and lives in at most one project). Also: `CONFIG.FEATURES = {DRIVE: false, GMAIL: true}`.
- Data: task assignees in Gestión column `Asignados` (appended after `Carpeta`): comma-separated emails of the people
  besides `Responsable`. Bundle Task adds `asignados: [email]` (never includes `resp`).
- `gSave` (Tarea) accepts `asignados` (array or comma string): team members only (`isMember_`), unique, at most 11 people
  in total; without `resp`, the first one becomes the responsible person. A task with `asignados` is always public
  (`privada` forced false); `tasksSetPrivacy(…, true)` skips such tasks. Visibility (`gTaskVisible_`) also lets
  assignees see a task. Historial: «También: Ina, Benja».
- Overdue notice (§17): every person (responsible + assignees) gets it; one shared `Notificado` marker per task.
- Client: `taskPeople(t)` = [resp, ...asignados]; `isMine(t)` / «Mis tareas» include tasks where I am one of the people;
  rows show stacked avatars (`avatarStack`). People picker (`openPeoplePicker(id)` modal, and inline in the composer):
  tap to add / remove, «Responsable» marks the owner, hint that several people make it public; the privacy switch is
  disabled for multi-person tasks.
- «Mis tareas» row: hover toolbar = Personas · Mover a proyecto · Editar (no handle / arrows); ⋯ menu = Personas · Mover a
  proyecto · Editar. Alt+↑/↓ still reorders from the keyboard.
- Drag: mouse/pen → press anywhere on the row (not the check, lock or toolbar) and move > 4 px; touch → long press
  (~0.4 s) then move (scroll otherwise). A drag cancels the side-swipe / pull-to-refresh gestures and the click that
  would open the task. In the wide layout (panel next to the view), leaving the panel shows a floating chip; hovering a
  project (`[data-drop-project]` on pillar-page cards and chips, not closed projects) highlights it, and releasing there
  runs `todoMoveTo(id, pid)` (public, project's pillar, «Movida a …»).
