function route(name, enTitle, esTitle, enDescription, esDescription, lesson, example) {
  return Object.freeze({ name, enTitle, esTitle, enDescription, esDescription, lesson, example });
}

export const applicationProfilePayloads = Object.freeze({
  blank: Object.freeze({
    actions: Object.freeze([]),
    marker: 'academy-blank-app',
    enTitle: 'Cells Academy Blank',
    esTitle: 'Cells Academy Inicial',
    routes: Object.freeze([
      route('home', 'Home', 'Inicio', 'A minimal Cells starting point.', 'Un punto de partida mínimo para Cells.'),
      route('details', 'Details', 'Detalles', 'A second route with browser back navigation.', 'Una segunda ruta con navegación atrás del navegador.')
    ])
  }),
  'web-app': Object.freeze({
    actions: Object.freeze(['refresh']),
    marker: 'academy-web-app',
    enTitle: 'Cells Academy Web',
    esTitle: 'Cells Academy Web',
    routes: Object.freeze([
      route('home', 'Overview', 'Resumen', 'Desktop application overview.', 'Resumen de la aplicación de escritorio.'),
      route('catalog', 'Catalog', 'Catálogo', 'Browse public teaching data.', 'Explora datos públicos de aprendizaje.'),
      route('details', 'Details', 'Detalles', 'Inspect one selected item.', 'Inspecciona un elemento seleccionado.')
    ])
  }),
  'web-mobile-app': Object.freeze({
    actions: Object.freeze(['success', 'error', 'delayed', 'cancel']),
    marker: 'academy-mobile-app',
    enTitle: 'Cells Academy Mobile',
    esTitle: 'Cells Academy Móvil',
    routes: Object.freeze([
      route('login', 'Sign in', 'Ingresar', 'Enter the local teaching flow.', 'Entra al flujo local de aprendizaje.'),
      route('dashboard', 'Dashboard', 'Panel', 'Review the learning summary.', 'Revisa el resumen de aprendizaje.'),
      route('movements', 'Movements', 'Movimientos', 'Explore local fixture records.', 'Explora registros de fixtures locales.'),
      route('settings', 'Settings', 'Ajustes', 'Switch safe local preferences.', 'Cambia preferencias locales seguras.'),
      route('help', 'Help', 'Ayuda', 'Find the next learning step.', 'Encuentra el siguiente paso de aprendizaje.')
    ])
  }),
  'academy-app': Object.freeze({
    actions: Object.freeze(['lesson']),
    marker: 'academy-learning-app',
    enTitle: 'Cells Academy Lessons',
    esTitle: 'Lecciones Cells Academy',
    routes: Object.freeze([
      route('welcome', 'Welcome', 'Bienvenida', 'Start the guided Cells course.', 'Comienza el curso guiado de Cells.', 'startAcademyApp', "startAcademyApp({ mainNode: 'app', routes }); class AcademyRoutePage extends widgetMixin(ScopedElementsMixin(LitElement)) {}"),
      route('routing', 'Routing', 'Rutas', 'Navigate with public Cells Core.', 'Navega con Cells Core público.', 'navigate', "navigate('routing', { lessonId: 'routing' })"),
      route('pubsub', 'Pub/Sub', 'Publicación y suscripción', 'Share namespaced messages.', 'Comparte mensajes con espacio de nombres.', 'publish+subscribe', "publish('academy:course:lesson:ready', data); subscribe(channel, render); this.emitEvent('lesson-complete', { lesson: 'pubsub' })"),
      route('data', 'Data', 'Datos', 'Load and cancel local requests.', 'Carga y cancela solicitudes locales.', 'createDataManager', 'createDataManager({ request, publish })'),
      route('local-api', 'Local API', 'API local', 'Request deterministic local fixtures.', 'Solicita fixtures locales deterministas.', 'createLocalApiRequest', "createLocalApiRequest({ baseUrl: location.origin })"),
      route('i18n', 'Localization', 'Localización', 'Switch English and Spanish safely.', 'Cambia entre inglés y español de forma segura.', 'loadMessages', "loadMessages('es'); this.t('route.i18n.title')"),
      route('scoped', 'Scoped elements', 'Elementos aislados', 'Isolate child element versions.', 'Aísla versiones de elementos secundarios.', 'createScopedRouteHosts', "createScopedRouteHosts({ childConstructor, routeTag }); static get scopedElements() { return { ...super.scopedElements, 'academy-type-text': AcademyTypeText }; }")
    ])
  })
});
