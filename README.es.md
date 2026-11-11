# StoryForge · 故事熔炉

**Escribe historias. Entra en sus mundos.**

<!-- readme-languages:start -->
[简体中文](./README.md) · [English](./README.en.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Italiano](./README.it.md) · [Español](./README.es.md) · [Português](./README.pt.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md)
<!-- readme-languages:end -->

**Tutoriales y comunidad en chino:** [Vídeo de Bilibili](https://www.bilibili.com/video/BV1q37j6QExh/) · [Introducción de Zhihu](https://zhuanlan.zhihu.com/p/2038714210188780594) · **Grupo QQ: 1082374587** · [Más contactos](#community)

[Empieza a crear](#quick-start) · [Prueba Fog Harbor](#try-a-story) · [Explora la arquitectura](#architecture)

StoryForge es una herramienta de código abierto para crear y vivir historias con IA, diseñada para conservar los datos en local. Escribe novelas y relatos breves, adapta novelas a guiones o cómics, construye mundos reutilizables y explora experiencias interactivas. Tú eliges el proceso y apruebas las propuestas de la IA antes de incorporarlas a tu obra.

> Estado de `main` comprobado el 13 de octubre de 2026: novela, narrativa breve, guion, cómic, preproducción animada y motor de mundos tienen entradas oficiales. El modo de nodos y los productos interactivos son versiones preliminares. Este README está traducido; no significa que toda la interfaz o los documentos enlazados estén disponibles en español. Las capturas y muchas guías están en chino.

<a id="try-a-story"></a>


**Sin entorno de desarrollo:** [descarga la versión portátil más reciente](https://github.com/yuanbw2025/storyforge/releases/latest), elige Windows x64, Mac Apple Silicon/Intel o Linux x64, extrae toda la carpeta y ejecuta `Start-StoryForge`. Incluye aplicación, medios y Node.js; no requiere instalar npm. La IA necesita tu propio proveedor y las funciones preliminares conservan su estado.

## ¿Primera vez? Elige cómo descargar y pide ayuda a una IA local

**Puedes utilizar StoryForge de dos maneras.**

- **Instalador o paquete portátil** — descarga el programa adecuado desde las Releases oficiales e instálalo o descomprímelo.
- **Código fuente mediante Git** — cómodo para actualizar, consultar el código, reparar problemas o desarrollar funciones.

Un Agent de escritorio como ByteDance Trae, Tencent WorkBuddy, Alibaba Tongyi Lingma o Google Antigravity puede ayudarte. Para instalación habitual, revisión del funcionamiento y diagnóstico básico, empieza con una versión o cuota gratuita. **Rellena el dispositivo y la carpeta y copia la instrucción correspondiente.**

### Opción 1 — Descargar el repositorio con Git

> Quiero **descargar el código fuente de StoryForge con Git y ejecutarlo localmente**. El repositorio es https://github.com/yuanbw2025/storyforge y la carpeta de destino es «ruta de mi carpeta». Comprueba el entorno, instala Git si hace falta, lee el README y las instrucciones de desarrollo, instala el entorno y las dependencias requeridos, inicia el proyecto e indícame dónde abrirlo. **Revisa primero los archivos existentes y conserva mis obras, configuración y cambios locales.** Explícame también cómo actualizarlo después.

### Opción 2 — Descargar un paquete Release oficial

> Quiero **descargar una aplicación StoryForge empaquetada desde las Releases oficiales**, para «Windows, macOS, Linux o Android», en «ruta de la carpeta». La página es https://github.com/yuanbw2025/storyforge/releases/latest . Comprueba la última versión estable oficial, elige el instalador o paquete portátil correspondiente al sistema y arquitectura del procesador, verifica las sumas de comprobación facilitadas y ayúdame a instalar o descomprimir y ejecutar la aplicación. Para un teléfono, explica cómo transferir e instalar el paquete. **Si StoryForge ya está instalado, ayúdame primero a respaldar mis obras y configuración y después actualiza según las instrucciones oficiales.** Indica las opciones disponibles si no hay un paquete compatible.

**Las guías y los canales para informar de bugs, sugerencias y errores de documentación están en la [documentación oficial](https://docs.storyforge-lab.com/en/).**

**Marca el repositorio con una Star, arriba a la derecha, para encontrarlo y seguir sus actualizaciones.**

---

## Importante — Usa la IA local para investigar problemas y enviar informes

StoryForge sigue en desarrollo y **una sola persona lo desarrolla y mantiene**. Con tantas funciones pueden aparecer bugs. Tus comentarios son bienvenidos.

**Un Agent local puede ayudarte tanto con el código Git como con el cliente descargado.** Si un capítulo no abre, falla la generación o el guardado, o la aplicación se cierra, pídele que revise los errores y diagnósticos disponibles y envíe directamente el informe. **Copia esta instrucción y describe el problema.**

> Mi StoryForge presenta este problema: «descripción». Revisa la versión actual, los errores y los diagnósticos relevantes. Organiza los pasos para reproducirlo, los resultados esperados y reales y los registros pertinentes, y **envía directamente un informe mediante la entrada oficial de comentarios del proyecto**. Si ya existe el mismo problema, añade la información al informe existente. Retira claves API, información de cuenta y manuscritos privados antes de enviarlo y dame después el identificador o enlace del informe. **Conserva mis obras, configuración y cambios locales, sigue investigando y propón una solución.**

El Agent puede investigar, organizar y enviar todo junto para facilitar el trabajo del mantenedor. También puede ayudarte con reparaciones sencillas mientras sigues usando la aplicación y esperas actualizaciones. **Haz una copia antes de operar sobre datos y conserva originales y obras antes de modificarlos.**

Puedes desarrollar funciones con un Agent local, crear tu propio proyecto o contribuir a StoryForge mediante una PR.

---

## Web oficial, demostración y documentación

Conoce el proyecto en la web, explora la interfaz real en la demostración aislada y descarga el código para crear con todas las funciones.

| Entrada | Utilidad |
|---|---|
| [Web oficial](https://storyforge-lab.com/) | Proyecto, productos, taller comunitario y contacto |
| [Demostración](https://storyforge-lab.com/storyforge/) | Interfaz real, ejemplos, copias de prueba y edición manual; configuración API, generación IA y servicios externos desactivados |
| [Taller comunitario](https://storyforge-lab.com/workshop) | Descubrir plugins y contenidos, revisar autores y dependencias, descargar e importar en local |
| [Documentación](https://docs.storyforge-lab.com/en/) | Instalación, primeros pasos, productos, modelos, copias, métodos de prompts, plugins y problemas |
| [Novedades y desarrollo](https://docs.storyforge-lab.com/en/updates/changelog) | Cambios en main, trabajo sin integrar y verificaciones históricas |

[Estado de desarrollo](https://docs.storyforge-lab.com/en/updates/development-status) · [GitHub Releases](https://github.com/yuanbw2025/storyforge/releases)

La documentación está en chino e inglés. La demostración usa almacenamiento separado; los manuscritos no se trasladan automáticamente entre versiones, dominios o puertos. Las Releases son fijas; main, despliegue de la aplicación y documentación tienen estados distintos.

## Capacidades recientes y uso

Revisado contra main remoto el 13 de octubre de 2026. Novela, relato corto, guion, cómic, materiales de series animadas y motor de mundos tienen entradas oficiales. Nodos e interacción siguen en versión preliminar; API de plugins 1 / SDK 0.1 es para desarrollo.

### Preproducción de series animadas

Desde una idea o novela se preparan biblia de serie, episodios, personajes/vestuario/localizaciones/objetos/sonido, guiones, storyboards y fotogramas de referencia. Los prompts de imagen y movimiento se separan. Se revisan continuidad, derechos y límites antes de exportar paquetes Seedance, Runway, LTX o genéricos. Materiales y entregas conservan versiones; las revisiones requieren comprobar los planos afectados. Vídeo, edición y mezcla se realizan fuera; cada proveedor determina las opciones disponibles.

[Guía de uso](https://docs.storyforge-lab.com/en/features/motion-drama)

### Plugins y taller creativo

Instala plugins funcionales, contenidos sin código o conjuntos con dependencias bloqueadas, activados por obra o mundo. Doce ejemplos muestran notas, tarjetas, calendarios, cronologías, tableros, nodos, IA y herramientas. Las sustituciones específicas abarcan historia del mundo y progreso narrativo. Activa la vista de desarrollo en `/workshop/discover`, crea una obra de prueba y confirma la confianza. Desactivar o desinstalar conserva datos. El SDK verifica y empaqueta `.sfplugin`; hay instrucciones IA y un kit Skill. Las interfaces nativas comparten origen: declarar capacidades no crea una sandbox contra código malicioso. El taller público y la gestión local tienen roles distintos.

[Guía de uso](https://docs.storyforge-lab.com/en/workshop/)

### Nodos: conectar, revisar y recuperar

Añade o busca nodos, arrastra desde puertos de entrada o salida y elige nodos compatibles. Plantillas de prompts, variables, temperatura, tokens y cantidad de candidatos se guardan en el grafo sin alterar la plantilla global. Ejecutar hasta un nodo procesa solo sus requisitos. Los candidatos guardados usan, cuando se permite, la adopción de la novela. Recuperar tras recargar no inicia generación; la validación completa entre modos sigue pendiente.

[Guía de uso](https://docs.storyforge-lab.com/en/features/nodes)

### Codex local y modelos por tarea

Además de API y servicios locales compatibles, Codex app-server reutiliza una cuenta ChatGPT iniciada en el equipo: detecta acceso, selecciona modelos y asigna presets sin clave API para ese canal. Solo texto y salida estructurada; no funciona desde una aplicación puramente estática alojada. Imágenes, audio y embeddings necesitan configuración aparte. Rigen límites de suscripción y permisos. Las solicitudes recientes ayudan tras desconexiones; resultados desconocidos no se reenvían ni pasan automáticamente a otra API de pago.

[Guía de uso](https://docs.storyforge-lab.com/en/getting-started/model-config)

## Características técnicas

| Tecnología o diseño | Función y valor |
|---|---|
| React + TypeScript + Vite | Interfaces y tipos de dominio; Zustand gestiona estado, TipTap texto y Three.js escenas 3D integradas |
| Dexie / IndexedDB | Almacenamiento local; PROJECT_TABLES gobierna copias, importación, eliminación, migración y referencias |
| Contexto y adopción trazables | CONTEXT_SOURCES + assembleContext() registran lecturas; Context Gateway recupera fuentes; FIELD_REGISTRY + AdoptionSchema + adopt() controlan escritura oficial |
| Harness persistente | Skills, contratos, eventos, checkpoints, candidatos y recibos; validación de versión/ámbito y recuperación de resultados guardados |
| Productos independientes y mundos congelados | Work posee contenidos; cada producto lee su SourcePlan y posee medios, publicaciones y partidas sin reescribir la novela original |

La arquitectura y las pruebas siguientes explican límites. Calidad literaria, personajes y capacidades de proveedores siguen necesitando criterio del autor.

**Más información:** [Preproducción animada](https://docs.storyforge-lab.com/en/features/motion-drama) · [Instalación y desarrollo de plugins](https://docs.storyforge-lab.com/en/workshop/) · [Nodos](https://docs.storyforge-lab.com/en/features/nodes) · [Configuración de modelos](https://docs.storyforge-lab.com/en/getting-started/model-config) · [Copias y recuperación](https://docs.storyforge-lab.com/en/guides/backup-restore) · [Métodos de prompts](https://docs.storyforge-lab.com/en/prompts/) · [Comentarios y soporte](https://docs.storyforge-lab.com/en/feedback/)

## Prueba una historia original

### Fog Harbor: The Last Light — aventura de rol en versión preliminar comunitaria

Investiga un antiguo naufragio con dos compañeros IA, protege los secretos de tu personaje y decide cómo volverán los barcos esta noche. Un director de juego IA (KP) guía la aventura con reglas originales **2d6**, **7 escenas, 6 pistas y 3 finales**.

![Pantalla de acceso a la aventura Fog Harbor](./docs/assets/readme/ttrpg-current.png)

El juego y sus medios incluidos están en el repositorio. Configura tu propia API de modelo para empezar. La captura muestra la entrada real a la aventura.

**Ciclo de juego:** proponer una acción → resolver las reglas → leer la respuesta del director → revisar pistas → guardar y continuar.

<details>
<summary>Cómo jugar y alcance actual</summary>

Ejecuta el código actual de `main`, abre **TTRPG** (`跑团`) y selecciona la aventura debajo de la sección de producción, o visita `/storyforge/play`. Configura el modelo y elige un personaje. Juega en solitario con compañeros IA o por turnos en un mismo dispositivo. Progreso, reanudación y puntos de control son locales. No hay multijugador público en línea desplegado; los secretos en un dispositivo compartido no están protegidos frente a su propietario.

[Guía del jugador](./examples/ttrpg/README.md) · [Evidencias de producción y partidas](./examples/ttrpg/fog-harbor/production-status.md)

</details>

## Por qué StoryForge

- **Memoria vinculada al manuscrito.** Texto original, hechos, resúmenes y búsqueda ayudan a recuperar pistas antiguas; los cambios confirmados tras un capítulo alimentan los siguientes.
- **Un proceso específico por producto.** La narrativa breve comprueba extensión y finalización; el guion conserva decisiones de adaptación; el cómic separa viñetas, imágenes y rotulación.
- **El autor conserva el control.** La creación oficial genera primero propuestas. Harness añade protección de revisiones, evidencias de ejecución y recuperación de estados guardados.

[Inicio rápido](#quick-start) · [Productos](#products) · [Primera sesión](#first-session) · [Mundos](#worlds) · [Harness](#architecture) · [Privacidad](#privacy) · [Comunidad](#community)

<a id="quick-start"></a>

## Inicio rápido

Abre la [aplicación web](https://yuanbw.vercel.app/storyforge/) o ejecuta el código localmente. La creación local básica no requiere una cuenta de StoryForge. La IA usa tus credenciales del proveedor y sus cargos de API son independientes. El sitio puede ir por detrás de `main`; las Releases antiguas son versiones fijas.

Usa **Node.js 24** y npm, igual que la CI:

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

Abre la dirección que muestra Vite con la ruta `/storyforge/` y mantén el terminal en ejecución. Un ZIP del código necesita los mismos pasos tras descomprimirlo; no es un instalador de escritorio.

En la página inicial, abre los ajustes del modelo de la esquina superior derecha (`模型与本地设置`). Para proveedores API, elige proveedor, introduce API Key, Base URL y un modelo accesible, y prueba la conexión y una generación pequeña. Conectarse no garantiza calidad, saldo ni capacidad de contexto. Para errores CORS del navegador, sigue las instrucciones del proxy local del panel.

<a id="products"></a>

## Elige tu punto de partida

![Página de productos de StoryForge](./docs/assets/readme/home-current.png)

| Objetivo | Entrada | Resultado y estado |
|---|---|---|
| Escribir una novela | Novela | Personajes, esquemas, capítulos, continuidad y revisión; proceso técnico actual validado |
| Terminar una obra breve | Narrativa breve | Diseño, fichas de capítulos, borrador, revisión, edición inmutable; Markdown/TXT/JSON |
| Adaptar a guion | Novela a guion | Fuentes fijadas, decisiones, escenas estructuradas, revisiones; Fountain/FDX/impresión |
| Adaptar a cómic | Novela a cómic | Páginas, viñetas, referencias visuales, rotulación, ediciones; PNG/WebP/CBZ/PDF |
| Preparar una serie animada | Materiales de serie animada | Biblia, episodios, materiales, storyboard y paquetes; vídeo producido externamente |
| Crear un mundo | Motor de mundos | Contenido semántico, derivación explícita, versiones inmutables y lectura |
| Componer un proceso visual | Modo de nodos | Versión preliminar; comparte lógica y datos de la novela |
| Jugar o crear experiencias | TTRPG / Chat de personajes / Ciudad IA / Juegos de texto | Versiones preliminares con ciclos propios de producción y ejecución |

Escribir novelas no requiere el motor de mundos. El autor puede derivar explícitamente un mundo de contenido confirmado de una novela u obra breve. Guiones y cómics son adaptaciones independientes sin esa vía de exportación. Se puede jugar una aventura publicada sin crear antes un mundo.

<a id="first-session"></a>

## Tu primera sesión de escritura

1. Abre **Novela** (`长篇`) → **Biblioteca** (`作品库`) → **Nueva novela** (`新建长篇`) e introduce el título.
2. Registra intención, referencias y reglas de escritura; añade la ambientación necesaria.
3. Planifica conflicto y personajes, luego volúmenes y capítulos. Escribe manualmente o edita y aprueba propuestas de la IA.
4. Desarrolla escenas y texto. Revisa los cambios en hechos, estados, relaciones y pistas antes de seguir.
5. En **Gestión de datos** (`数据管理`), exporta el texto y una copia JSON completa.

![Esquema de novela con un ejemplo redactado manualmente](./docs/assets/readme/longform-outline-current.png)

## Qué hace cada producto por tu obra

### Novelas y nodos

El espacio de novela incluye referencias, ambientación, personajes y relaciones, tramas, esquemas, capítulos, anticipaciones, hechos, inventarios, estilo, plantillas de prompts e historial.

La memoria conserva el **texto original como evidencia**, hechos y estados estructurados, resúmenes de capítulo/volumen/obra e índices de búsqueda. Context Gateway descubre recursos antes de leer sus detalles y registra las fuentes realmente usadas. Los resúmenes e índices derivados se comprueban mediante hashes de origen; si faltan o están obsoletos, se puede volver al texto original. El ámbito de la obra y los límites temporales filtran la recuperación.

Tras cada capítulo, el procesamiento propone cambios de hechos, personajes, relaciones, objetos, cronología, pistas y tramas para que el autor los confirme. El análisis de impacto afecta a planes futuros y preserva la historia confirmada. Las comprobaciones de versión impiden que propuestas antiguas sobrescriban ediciones recientes.

Los nodos oficiales reutilizan los mismos Skills, datos y procesos de aprobación para componer pasos y resultados intermedios. Los borradores experimentales no pueden incorporarse al contenido oficial. La interoperabilidad completa entre interfaces sigue en validación.

[Búsqueda narrativa](./src/lib/context-gateway/narrative-retrieval.ts) · [Procesamiento tras el capítulo](./src/lib/ai/chapter-memory/run-chapter-memory.ts) · [Contrato novela/nodos](./docs/products/LONGFORM-AND-NODE.md)

### Narrativa breve: un camino visible hasta terminar

El proceso dedicado apunta a **5.000–25.000 caracteres chinos en 3–8 capítulos**: brief, diseño, fichas, redacción, revisión, reescritura y publicación. Comprueba longitud real, estructura, texto ausente y propuestas pendientes. Los hallazgos de revisión señalan capítulos y fragmentos; la revisión queda ligada al hash del manuscrito y debe actualizarse después de cambios. Las reescrituras se dirigen a capítulos concretos. Los problemas bloqueantes impiden publicar; cada edición aceptada es inmutable y conserva las anteriores.

[Producción y criterios de finalización](./src/lib/short-novel/service.ts) · [Ejecuciones IA persistentes dedicadas](./src/lib/agent/run/short-novel-durable.ts)

### Guiones: decisiones de adaptación trazables

El proceso fija las fuentes seleccionadas y las conecta con hechos, causalidad, decisiones de adaptación, momentos narrativos, fichas y escenas. Se puede revisar por qué se eliminó, fusionó o transformó un evento. Las escenas usan un **AST**, una representación estructurada de bloques de guion que el código valida y convierte a Fountain, FDX o impresión.

La fidelidad a la fuente y la estructura dramática tienen revisiones separadas. Cada corrección identifica escena y revisión esperada; hay que desbloquear las escenas bloqueadas y se rechazan correcciones obsoletas. Las ediciones fijan fuentes, decisiones y escenas: modificar después la novela no altera automáticamente el guion publicado.

[Producción y revisiones](./src/lib/screenplay/production.ts) · [Ediciones](./src/lib/screenplay/release.ts) · [Renderizadores](./src/lib/screenplay/renderers.ts)

### Cómics: imágenes y rotulación en capas independientes

Primero se desarrollan momentos narrativos, páginas y viñetas; después, imágenes y rotulación. Identidades estables y un orden de lectura explícito conectan encuadres, acciones, diálogos y fuentes. Los sujetos visuales dan identidad a personajes, lugares y objetos. Las imágenes candidatas guardan procedencia y evidencias de las referencias realmente enviadas al proveedor.

La **rotulación SVG local** añade bocadillos, cartelas y efectos sonoros editables encima de las imágenes. Corregir un diálogo no requiere regenerar la viñeta. Las comprobaciones detectan desbordamientos, solapamientos y márgenes inseguros; el autor sigue revisando las partes de la imagen que quedan ocultas. Storyboard y edición visual tienen criterios distintos. Las ediciones visuales mantienen referencias fuertes a los Blob de las imágenes elegidas.

**Límite actual:** el adaptador de imágenes genérico compatible con OpenAI solo envía texto y declara no admitir imágenes de referencia, semillas fijas ni inpainting. Mencionar una referencia en un prompt no equivale a enviar la imagen. La producción visual requiere un servicio configurado o recursos adecuados del autor, con selección y revisión humana de continuidad.

[Producción](./src/lib/comic/production.ts) · [Evidencias de medios](./src/lib/comic/media-service.ts) · [Rotulación](./src/lib/comic/renderers.ts) · [Controles de calidad](./src/lib/comic/qa.ts)

Los procesos técnicos actuales están implementados en `main`; el rendimiento de proveedores y la calidad del contenido siguen evaluándose. Consulta la [base de capacidades](./docs/roadmap/CAPABILITY-BASELINE.md).

<a id="worlds"></a>

## Mundos y productos interactivos

Crea o deriva explícitamente un mundo, fija una versión y configura e inicia la producción dentro del producto elegido. El motor conserva solo **contenido semántico versionado**. Cada producto posee sus medios, partidas y evolución privada. Ni los cambios posteriores de la novela ni las partidas reescriben automáticamente el mundo compartido.

La derivación registra obra de origen, revisión, intervalo y hash. Los adaptadores de cada producto declaran recursos obligatorios, opcionales y prohibidos y fijan un **SourcePlan**. Las lecturas progresivas `describe / search / read` dejan un Context Manifest por ejecución y un SourceManifest final de lecturas reales. Una aventura puede seguir en la versión 1 mientras el autor trabaja en la 2.

[Cliente de recursos del mundo](./src/lib/context-gateway/world-release-client.ts) · [Contrato del mundo](./docs/products/WORLD-ENGINE.md)

**Todos los productos siguientes son versiones preliminares:**

| Producto | Mecanismos implementados | Límite actual |
|---|---|---|
| [TTRPG / director IA](./src/lib/ttrpg/information-boundary.ts) | Código para reglas, dados y efectos; contextos separados director/jugador/PNJ, secretos por destinatario, eventos y puntos de control | Fog Harbor tiene evidencias con modelos reales; sin multijugador público en línea |
| [Chat de personajes](./src/lib/character-interaction/runtime.ts) | Perfiles y voz fijados, objetivos de escena, memoria de compromisos/secretos/conflictos, confianza/cercanía/cautela/respeto | Calidad de personajes a largo plazo en evaluación |
| [Ciudad IA Afterstory](./src/lib/ai-town/runtime.ts) | Seis franjas diarias, lugares y viajes, conocimientos, recuerdos, relaciones, gestión ligera y avance del tiempo sin conexión | Reproducción de 14 días validada; modelos a largo plazo y medios no simulados aún en evaluación |
| [Aventura de texto](./src/lib/adventure/runtime.ts) | Requisitos, inventario, recursos, habilidades, misiones y consecuencias comprobados por código | Cada obra necesita validación específica |
| [AVG](./src/lib/avg/runtime.ts) | Indicaciones declarativas, capas de fondos/personajes/audio, comprobación de medios e instantáneas de escena | Experiencia audiovisual completa en validación |
| [Mundo abierto textual](./src/lib/open-world/runtime.ts) | Regiones, viajes, recursos, facciones, horarios y cambios regionales con el tiempo | Producción completa y juego prolongado en desarrollo |

La comunidad en línea y los servicios comerciales pertenecen a fases posteriores.

<a id="architecture"></a>

## Arquitectura compartida y coherencia a largo plazo

**Harness es el sistema de ejecución y validación que rodea las llamadas al modelo.** Vincula contratos de tarea, entradas reales, propuestas, versiones, puntos de control y resultados con la obra. Cada producto mantiene sus propios servicios de dominio y datos.

```mermaid
flowchart TB
  subgraph PRODUCTS["Productos · servicios y propiedad independientes"]
    L["Novelas / Nodos"]
    C["Narrativa breve / Guiones / Cómics"]
    W["Motor de mundos"]
    I["TTRPG / Personajes / Ciudad IA / Juegos de texto"]
  end
  L & C & W & I --> H["Harness compartido · Tareas IA oficiales<br/>Skill + Run Contract · Presupuesto · Versiones · Recuperación"]
  H --> G["Context Gateway / Memoria<br/>Fuentes registradas · Búsqueda · Texto original"]
  H --> M["Adaptadores de modelos<br/>Propuestas y respuestas originales"]
  H --> A["Incorporación a la obra<br/>Aprobación del autor · Validación · adopt"]
  H -.-> E["Registro persistente<br/>Eventos · Puntos de control · Recibos"]
  G -->|"Lecturas dentro del ámbito"| D["Datos y archivos locales<br/>IndexedDB / Archivos y medios<br/>PROJECT_TABLES gobierna los ciclos de vida"]
  A -->|"Escrituras transaccionales y relectura"| D
  E --> D
  classDef engine fill:#e8f0fa,stroke:#5279a4,color:#18324f
  classDef author fill:#fff2df,stroke:#b58a45,color:#593b16
  classDef data fill:#eaf4ee,stroke:#628b73,color:#254a34
  class H,M,E engine
  class A author
  class G,D data
```

Las flechas indican dependencias o accesos a datos, no el orden de ejecución. Novelas y narrativa breve no requieren el motor de mundos. Los productos interactivos usan comandos y máquinas de estados propios.

### Cómo se mantiene la coherencia entre capítulos

El ciclo continuo consiste en **recuperar evidencias, aprobar cambios y entregar la versión correcta a la siguiente tarea**. Generación, actualización de memoria, auditoría y planificación futura contribuyen al proceso.

```mermaid
flowchart TB
  K["Datos confirmados<br/>Texto / Hechos / Estado / Pistas"]
  K --> R["1. Fijar tarea y buscar<br/>Ámbito, tiempo, versiones y carencias"]
  R --> C["2. Generar y verificar propuesta<br/>Estructura y límites de información<br/>Revisión semántica si se configura"]
  C --> A["3. Aprobación y control de versión<br/>Adoptar → Releer → Recibo"]
  A --> P["4. Procesamiento e impacto futuro<br/>Proponer cambios → Aprobación del autor"]
  P -->|"Actualizar datos e índices para los capítulos siguientes"| K
  R -. "Falta evidencia obligatoria" .-> X["Pausar / Rechazar escritura<br/>Conservar evidencias para resolver"]
  A -. "Fuente o destino obsoletos" .-> X
  classDef engine fill:#e8f0fa,stroke:#5279a4,color:#18324f
  classDef author fill:#fff2df,stroke:#b58a45,color:#593b16
  classDef data fill:#eaf4ee,stroke:#628b73,color:#254a34
  classDef paused fill:#f7eaea,stroke:#b27a7a,color:#6a3030
  class R,C engine
  class A,P author
  class K data
  class X paused
```

Cada ejecución oficial conserva su registro y puntos de control. El procesamiento posterior al capítulo y las revisiones futuras son ejecuciones separadas y acotadas, con sus propias comprobaciones de versión y aprobaciones. El ciclo puede abarcar varias sesiones.

- La falta de fuentes obligatorias bloquea el avance. Los manifiestos registran ámbito, hashes, lecturas y carencias. Los límites de obra, mundo y tiempo evitan mezclas y conocimiento prematuro.
- La adopción vuelve a comprobar revisiones de entrada y destino. Una propuesta obsoleta no puede sobrescribir texto reciente. La relectura y el recibo verifican lo guardado.
- Las auditorías explícitas de coherencia se vinculan al hash del texto. Modificarlo invalida las evidencias anteriores.
- La recuperación restaura estados persistidos con comprobación de versión. Un resultado desconocido del proveedor no desencadena reenvíos a ciegas.

Ejemplo: el capítulo 8 establece quién tiene un objeto único. En el capítulo 80, la búsqueda puede aportar el pasaje original y el estado confirmado. Si el autor cambia al propietario antes de aprobar una propuesta, el control de revisión bloquea su adopción directa. Tras confirmar el nuevo capítulo y sus cambios de memoria, los siguientes capítulos pueden utilizarlos.

### Evidencias que puedes inspeccionar

- [Búsqueda a gran escala y aislamiento de mundos e información futura](./tests/regression/R-PHASE4-long-form-scale-gate.test.ts)
- [Bloqueo sin evidencia obligatoria y destinos de edición exactos](./tests/regression/R-CTXG7-gateway-execution.test.ts)
- [Rechazo de propuestas obsoletas tras cambios de texto o ajustes](./tests/regression/R-HARNESS7-prose-generation-durable.test.ts)
- [Recuperación del procesamiento del capítulo sin otra llamada al modelo](./tests/regression/R-HARNESS20-chapter-post-adoption-durable.test.ts)
- [Invalidación de auditorías tras ediciones y sin reenvíos ante resultados desconocidos](./tests/regression/R-MEMORY-CLOSE1-consistency-audit-durable.test.ts)
- [Conservación de la historia escrita e invalidación de planes futuros](./tests/regression/R-FUTURE1-continuous-evolution.test.ts)

[Ejecuciones oficiales de prosa](./src/lib/agent/run/prose-generation-durable.ts) · [Recibos de verificación](./src/lib/agent/run/verification-receipt.ts) · [Arquitectura](./docs/ARCHITECTURE.md) · [Estándar Harness](./docs/HARNESS-QUALITY-STANDARD.md)

**Alcance de las garantías:** el código comprueba versiones, ámbitos, estructura, transiciones y reglas de escritura. La revisión semántica depende de la configuración o de una acción explícita del autor. Subtexto, metáforas, pistas no registradas y calidad literaria siguen necesitando criterio humano y del modelo. Los tests de **100.000 / 300.000 / 1.000.000 de caracteres** demuestran comportamiento técnico, no garantizan la coherencia literaria de una novela de un millón de palabras. La recuperación cubre estados guardados; las entradas auxiliares y experimentales conservan sus límites declarados.

<a id="privacy"></a>

## Modelos, almacenamiento y privacidad

- Usa tu proveedor cloud o un servicio local compatible, como Ollama o LM Studio. Los ajustes predefinidos no certifican que todos los modelos sirvan igual para cada producto.
- La generación cloud envía el contexto seleccionado al proveedor configurado. Guardar datos en local no convierte todas las llamadas IA en operaciones sin conexión.
- Obras y partidas residen en IndexedDB, según el perfil y origen del navegador. Cambiar navegador, host o puerto no transfiere los datos.
- Las claves API duran por defecto lo que la sesión del navegador. Solo la opción explícita de recordarlas en el dispositivo las guarda en localStorage.
- Exporta una **copia JSON completa** antes de cambiar de dispositivo o borrar datos del navegador. Markdown/TXT no la sustituyen; para medios usa los exports del producto o espacio de trabajo.
- El acceso a carpetas locales requiere autorización: [guía del espacio de memoria](./docs/MEMORY-WORKSPACE-GUIDE.md).
- La copia opcional en GitHub Gist sube el JSON completo del proyecto a tu Gist privado. No tiene cifrado de extremo a extremo.

<a id="community"></a>

## Comunidad y contribuciones

[GitHub Issues](https://github.com/yuanbw2025/storyforge/issues) · [Sitio del desarrollador](https://yuanbw.vercel.app/) · [Perfil de Zhihu del desarrollador](https://www.zhihu.com/people/dan-ran-xing-yuan-59) · Grupo QQ: **1082374587**

[Tutorial de Bilibili](https://www.bilibili.com/video/BV1q37j6QExh/) e [introducción de Zhihu](https://zhuanlan.zhihu.com/p/2038714210188780594): recursos históricos en chino cuyos menús pueden diferir. Al informar de errores, indica versión, navegador/sistema, pasos y resultado esperado/real. Elimina claves y textos privados de capturas y registros. Se agradecen estrellas, ejemplos, vídeos, traducciones y contribuciones.

StoryForge usa **React, TypeScript, Vite, Zustand, TipTap y Dexie**. Tres registros gobiernan la base compartida: `CONTEXT_SOURCES` + `assembleContext()` para lecturas IA; `FIELD_REGISTRY` + `AdoptionSchema` + `adopt()` para escrituras aprobadas; `PROJECT_TABLES` para el ciclo de vida de las tablas.

```bash
npm run ci
npm run ci:e2e
```

Antes de contribuir lee [AGENTS.md](./AGENTS.md), [CONTRIBUTING.md](./CONTRIBUTING.md), el [proceso de colaboración](./docs/COLLAB-WORKFLOW.md) y la [carta del proyecto](./docs/PROJECT-MASTER-CHARTER.md).

## Estrellas, apoyo y licencia

[![StoryForge Star History](https://raw.githubusercontent.com/yuanbw2025/storyforge/readme-assets/storyforge-star-history.svg)](https://www.star-history.com/?repos=yuanbw2025%2Fstoryforge&type=date&legend=top-left)

El apoyo económico es voluntario y no cambia el acceso a funciones o futuras actualizaciones. Ayuda a financiar suscripciones de modelos y mantenimiento. [Detalles del apoyo](./README.md#自愿赞助).

Código bajo licencia [MIT](./LICENSE). Obras originales, modelos, medios de terceros y resultados conservan sus respectivas condiciones. Consulta el [aviso de licencia SRD TTRPG](./docs/ttrpg/licenses/SRD-5.2.1-CC-BY-4.0.md) cuando corresponda.
