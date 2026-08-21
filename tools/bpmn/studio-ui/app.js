(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const query = new URLSearchParams(window.location.search);
  const token = query.get('token') || '';
  const state = {
    token,
    processes: [],
    activeSlug: null,
    process: null,
    sha256: null,
    dirty: false,
    importing: false,
    busy: false,
    activeTab: 'diagram-view',
    lastCheck: null,
    mapUrl: null,
    modeler: null,
    zoom: 1,
    transitionData: null,
    transitionLoading: false,
    transitionRequest: 0,
    selectedTransitionElement: null,
    transitionDeletePreparing: false,
    mode: null,
    fileHandle: null,
    fileName: null,
    fileOriginalXml: null,
    advancedOpen: false
  };

  const elements = {
    list: $('#process-list'),
    listEmpty: $('#process-list-empty'),
    search: $('#process-search'),
    refresh: $('#refresh-button'),
    create: $('#create-button'),
    welcomeCreate: $('#welcome-create-button'),
    welcomeOpen: $('#welcome-open-button'),
    appShell: $('#app-shell'),
    title: $('#process-title'),
    subtitle: $('#process-subtitle'),
    status: $('#process-status'),
    headerActions: $('#header-actions'),
    save: $('#save-button'),
    saveAs: $('#save-as-button'),
    newFile: $('#new-file-button'),
    openFile: $('#open-file-button'),
    openFileInput: $('#open-file-input'),
    check: $('#check-button'),
    saveState: $('#save-state'),
    more: $('#more-button'),
    actionMenu: $('#action-menu'),
    advancedToggle: $('#advanced-toggle-button'),
    download: $('#download-button'),
    reload: $('#reload-button'),
    welcome: $('#welcome-view'),
    canvasLoading: $('#canvas-loading'),
    selectionHint: $('#selection-hint'),
    transitionPanel: $('#transition-panel'),
    transitionPanelClose: $('#transition-panel-close'),
    transitionSourceName: $('#transition-source-name'),
    transitionLoading: $('#transition-loading'),
    transitionPanelError: $('#transition-panel-error'),
    transitionConvert: $('#transition-convert'),
    convertToCallActivity: $('#convert-to-call-activity-button'),
    transitionForm: $('#transition-form'),
    registeredTargetFields: $('#registered-target-fields'),
    registeredTarget: $('#registered-target'),
    registeredTargetEmpty: $('#registered-target-empty'),
    reservedTargetFields: $('#reserved-target-fields'),
    reservedTargetTitle: $('#reserved-target-title'),
    unknownTargetNote: $('#unknown-target-note'),
    transitionLabel: $('#transition-label'),
    saveTransition: $('#save-transition-button'),
    deleteTransition: $('#delete-transition-button'),
    questionsCount: $('#questions-count'),
    processCardContent: $('#process-card-content'),
    processCardMissing: $('#process-card-missing'),
    questionsSummaryCount: $('#questions-summary-count'),
    questionsList: $('#questions-list'),
    questionsEmpty: $('#questions-empty'),
    questionsMissing: $('#questions-missing'),
    mapEmpty: $('#map-empty'),
    mapEmptyTitle: $('#map-empty-title'),
    mapEmptyCopy: $('#map-empty-copy'),
    mapFrame: $('#map-frame'),
    buildMap: $('#build-map-button'),
    rebuildMap: $('#rebuild-map-button'),
    openMap: $('#open-map-button'),
    detailsStatusTitle: $('#details-status-title'),
    detailsStatusCopy: $('#details-status-copy'),
    readinessPercent: $('#readiness-percent'),
    readinessBar: $('#readiness-bar'),
    lifecycleAction: $('#lifecycle-action-button'),
    lifecycleNote: $('#lifecycle-action-note'),
    attentionCount: $('#attention-count'),
    attentionList: $('#attention-list'),
    attentionEmpty: $('#attention-empty'),
    checkReport: $('#check-report'),
    checkReportTitle: $('#check-report-title'),
    checkReportStatus: $('#check-report-status'),
    checkFirstError: $('#check-first-error'),
    checkResults: $('#check-results'),
    transitionsCount: $('#transitions-count'),
    transitionsList: $('#transitions-list'),
    transitionsEmpty: $('#transitions-empty'),
    processFacts: $('#process-facts'),
    createDialog: $('#create-dialog'),
    createForm: $('#create-form'),
    processName: $('#process-name'),
    createSubmit: $('#create-submit'),
    confirmDialog: $('#confirm-dialog'),
    confirmForm: $('#confirm-form'),
    confirmTitle: $('#confirm-title'),
    confirmCopy: $('#confirm-copy'),
    confirmNote: $('#confirm-note'),
    confirmSubmit: $('#confirm-submit'),
    futureProcessDialog: $('#future-process-dialog'),
    futureProcessTitle: $('#future-process-title'),
    futureProcessCard: $('#future-process-card'),
    futureProcessCreate: $('#future-process-create-button'),
    helpButton: $('#help-button'),
    helpPanel: $('#help-panel'),
    helpClose: $('#help-close'),
    backdrop: $('#drawer-backdrop'),
    guide: $('#editor-guide'),
    guideClose: $('#guide-close'),
    toastRegion: $('#toast-region'),
    fileDropOverlay: $('#file-drop-overlay')
  };

  const STARTER_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_MeaningfulProcess" targetNamespace="https://example.local/bpmn">
  <bpmn:process id="Process_MeaningfulWork" name="Новая схема" isExecutable="false">
    <bpmn:startEvent id="StartEvent_RequestReceived" name="Получен запрос">
      <bpmn:outgoing>Flow_StartToClarify</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_ClarifyInput" name="Уточнить входные данные">
      <bpmn:incoming>Flow_StartToClarify</bpmn:incoming>
      <bpmn:outgoing>Flow_ClarifyToDecision</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_CanPerform" name="Работу можно выполнить?" default="Flow_NotReady">
      <bpmn:incoming>Flow_ClarifyToDecision</bpmn:incoming>
      <bpmn:outgoing>Flow_Ready</bpmn:outgoing>
      <bpmn:outgoing>Flow_NotReady</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_PerformAndCheck" name="Выполнить работу и проверить результат">
      <bpmn:incoming>Flow_Ready</bpmn:incoming>
      <bpmn:outgoing>Flow_WorkToSuccess</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="EndEvent_ResultDelivered" name="Результат передан">
      <bpmn:incoming>Flow_WorkToSuccess</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="EndEvent_NoResult" name="Работа завершена без результата">
      <bpmn:incoming>Flow_NotReady</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToClarify" sourceRef="StartEvent_RequestReceived" targetRef="Task_ClarifyInput" />
    <bpmn:sequenceFlow id="Flow_ClarifyToDecision" sourceRef="Task_ClarifyInput" targetRef="Gateway_CanPerform" />
    <bpmn:sequenceFlow id="Flow_Ready" name="Да" sourceRef="Gateway_CanPerform" targetRef="Task_PerformAndCheck" />
    <bpmn:sequenceFlow id="Flow_NotReady" name="Нет" sourceRef="Gateway_CanPerform" targetRef="EndEvent_NoResult" />
    <bpmn:sequenceFlow id="Flow_WorkToSuccess" sourceRef="Task_PerformAndCheck" targetRef="EndEvent_ResultDelivered" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_MeaningfulWork">
    <bpmndi:BPMNPlane id="BPMNPlane_MeaningfulWork" bpmnElement="Process_MeaningfulWork">
      <bpmndi:BPMNShape id="Shape_StartEvent_RequestReceived" bpmnElement="StartEvent_RequestReceived"><dc:Bounds x="130" y="232" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="108" y="275" width="80" height="27" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_Task_ClarifyInput" bpmnElement="Task_ClarifyInput"><dc:Bounds x="220" y="210" width="130" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_Gateway_CanPerform" bpmnElement="Gateway_CanPerform" isMarkerVisible="true"><dc:Bounds x="410" y="225" width="50" height="50" /><bpmndi:BPMNLabel><dc:Bounds x="375" y="188" width="120" height="27" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_Task_PerformAndCheck" bpmnElement="Task_PerformAndCheck"><dc:Bounds x="525" y="210" width="170" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_EndEvent_ResultDelivered" bpmnElement="EndEvent_ResultDelivered"><dc:Bounds x="760" y="232" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="730" y="275" width="96" height="27" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_EndEvent_NoResult" bpmnElement="EndEvent_NoResult"><dc:Bounds x="417" y="350" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="365" y="393" width="140" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_Flow_StartToClarify" bpmnElement="Flow_StartToClarify"><di:waypoint x="166" y="250" /><di:waypoint x="220" y="250" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_Flow_ClarifyToDecision" bpmnElement="Flow_ClarifyToDecision"><di:waypoint x="350" y="250" /><di:waypoint x="410" y="250" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_Flow_Ready" bpmnElement="Flow_Ready"><di:waypoint x="460" y="250" /><di:waypoint x="525" y="250" /><bpmndi:BPMNLabel><dc:Bounds x="482" y="232" width="15" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_Flow_NotReady" bpmnElement="Flow_NotReady"><di:waypoint x="435" y="275" /><di:waypoint x="435" y="350" /><bpmndi:BPMNLabel><dc:Bounds x="442" y="308" width="21" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_Flow_WorkToSuccess" bpmnElement="Flow_WorkToSuccess"><di:waypoint x="695" y="250" /><di:waypoint x="760" y="250" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  const STATUS_TEXT = {
    draft: 'Черновик',
    'review-ready': 'Готов к проверке владельцем',
    rework: 'Требует доработки',
    approved: 'Решение об утверждении зафиксировано',
    rejected: 'Решение об отклонении зафиксировано'
  };

  const STATUS_COPY = {
    draft: 'Схему можно редактировать. Перед регистрацией заполните карточку и устраните замечания проверки.',
    'review-ready': 'Комплект технически подготовлен. Следующий обязательный шаг — отдельно зафиксировать решение уполномоченного владельца через npm run decision:owner в tools/bpmn.',
    rework: 'Владелец или проверка вернули процесс на доработку. Исправьте замечания и обновите комплект.',
    approved: 'Решение владельца зафиксировано. Исполняемый вариант всё равно оформляется отдельным адаптером движка.',
    rejected: 'Решение об отклонении зафиксировано. История сохранена, изменения требуют нового цикла проверки.'
  };

  const BPMN_TRANSLATIONS = {
    'Activate global connect tool': 'Соединить элементы стрелкой',
    'Activate hand tool': 'Перемещать схему',
    'Activate lasso tool': 'Выделить несколько элементов',
    'Activate create/remove space tool': 'Добавить или убрать свободное место',
    'Activate the global connect tool': 'Соединить элементы стрелкой',
    'Activate the hand tool': 'Перемещать схему',
    'Activate the lasso tool': 'Выделить несколько элементов',
    'Activate the create/remove space tool': 'Добавить или убрать свободное место',
    'Create start event': 'Добавить начало процесса',
    'Create end event': 'Добавить завершение процесса',
    'Create intermediate/boundary event': 'Добавить промежуточное событие',
    'Create gateway': 'Добавить развилку',
    'Create task': 'Добавить действие',
    'Create expanded sub-process': 'Добавить подпроцесс с деталями',
    'Create data object reference': 'Добавить документ или данные',
    'Create data store reference': 'Добавить хранилище данных',
    'Create pool/participant': 'Добавить участника процесса',
    'Create group': 'Объединить элементы в группу',
    'Create StartEvent': 'Добавить начало процесса',
    'Create EndEvent': 'Добавить завершение процесса',
    'Create Intermediate/Boundary Event': 'Добавить промежуточное событие',
    'Create Gateway': 'Добавить развилку',
    'Create Task': 'Добавить действие',
    'Create expanded SubProcess': 'Добавить подпроцесс с деталями',
    'Create DataObjectReference': 'Добавить документ или данные',
    'Create DataStoreReference': 'Добавить хранилище данных',
    'Create Pool/Participant': 'Добавить участника процесса',
    'Create Group': 'Объединить элементы в группу',
    'Append end event': 'Добавить завершение',
    'Append gateway': 'Добавить развилку',
    'Append task': 'Добавить следующее действие',
    'Append intermediate/boundary event': 'Добавить промежуточное событие',
    'Append conditional intermediate catch event': 'Добавить ожидание условия',
    'Append message intermediate catch event': 'Добавить ожидание сообщения',
    'Append signal intermediate catch event': 'Добавить ожидание сигнала',
    'Append timer intermediate catch event': 'Добавить ожидание времени',
    'Append receive task': 'Добавить получение сообщения',
    'Append compensation activity': 'Добавить компенсирующее действие',
    'Add text annotation': 'Добавить пояснение',
    'Append EndEvent': 'Добавить завершение',
    'Append Gateway': 'Добавить развилку',
    'Append Task': 'Добавить следующее действие',
    'Append Intermediate/Boundary Event': 'Добавить промежуточное событие',
    'Append TextAnnotation': 'Добавить пояснение',
    'Connect using Sequence/MessageFlow or Association': 'Соединить стрелкой',
    'Connect to other element': 'Соединить с другим элементом',
    'Connect using association': 'Связать пояснение с элементом',
    'Connect using data input association': 'Передать данные в действие',
    'Change element': 'Изменить тип элемента',
    'Delete': 'Удалить',
    'Change type': 'Изменить тип элемента',
    'Remove': 'Удалить',
    'Edit Label': 'Изменить подпись',
    'Add Lane above': 'Добавить роль выше',
    'Add Lane below': 'Добавить роль ниже',
    'Add lane above': 'Добавить роль выше',
    'Add lane below': 'Добавить роль ниже',
    'Divide into two lanes': 'Разделить на две роли',
    'Divide into three lanes': 'Разделить на три роли',
    'Divide into two Lanes': 'Разделить на две роли',
    'Divide into three Lanes': 'Разделить на три роли',
    'Participant multiplicity': 'Несколько участников',
    'Collection': 'Набор данных',
    'Parallel Multi Instance': 'Параллельное выполнение',
    'Sequential Multi Instance': 'Последовательное выполнение',
    'Parallel multi-instance': 'Параллельное выполнение',
    'Sequential multi-instance': 'Последовательное выполнение',
    'Loop': 'Повторение',
    'Ad-hoc': 'Произвольный порядок',
    'Compensation': 'Компенсация',
    'Transaction': 'Транзакция',
    'Expanded Pool': 'Участник с деталями',
    'Empty Pool': 'Внешний участник без деталей',
    'Exclusive Gateway': 'Развилка «только один путь»',
    'Parallel Gateway': 'Параллельные пути',
    'Inclusive Gateway': 'Один или несколько путей',
    'Complex Gateway': 'Сложная развилка',
    'Event-based Gateway': 'Развилка по событию',
    'User Task': 'Действие человека в системе',
    'Manual Task': 'Ручное действие',
    'Service Task': 'Автоматическое действие системы',
    'Send Task': 'Отправить сообщение',
    'Receive Task': 'Получить сообщение',
    'Business Rule Task': 'Применить бизнес-правило',
    'Script Task': 'Выполнить сценарий',
    'Call Activity': 'Вызвать другой процесс',
    'Sub Process (collapsed)': 'Подпроцесс',
    'Sub Process (expanded)': 'Подпроцесс с деталями',
    'Start Event': 'Начало процесса',
    'End Event': 'Завершение процесса',
    'Intermediate Throw Event': 'Промежуточное отправляющее событие',
    'Intermediate Catch Event': 'Промежуточное ожидающее событие',
    'Boundary Event': 'Граничное событие',
    'Message Start Event': 'Начало по сообщению',
    'Timer Start Event': 'Начало по времени',
    'Signal Start Event': 'Начало по сигналу',
    'Conditional Start Event': 'Начало при условии',
    'Message End Event': 'Завершение с сообщением',
    'Error End Event': 'Завершение с ошибкой',
    'Terminate End Event': 'Немедленное завершение',
    'Escalation End Event': 'Завершение с эскалацией',
    'Signal End Event': 'Завершение с сигналом',
    'Cancel End Event': 'Завершение с отменой',
    'Data Object Reference': 'Документ или данные',
    'Data Store Reference': 'Хранилище данных',
    'Text Annotation': 'Пояснение',
    'Search in diagram': 'Найти на схеме',
    'Align elements': 'Выровнять элементы',
    'Align elements left': 'Выровнять по левому краю',
    'Align elements center': 'Выровнять по центру по горизонтали',
    'Align elements right': 'Выровнять по правому краю',
    'Align elements top': 'Выровнять по верхнему краю',
    'Align elements middle': 'Выровнять по центру по вертикали',
    'Align elements bottom': 'Выровнять по нижнему краю',
    'Distribute elements horizontally': 'Распределить по горизонтали',
    'Distribute elements vertically': 'Распределить по вертикали',
    'Toggle non-interrupting': 'Не прерывать основную работу',
    'Open {element}': 'Открыть: {element}'
  };

  const TRANSLITERATION = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  function interpolate(template, replacements) {
    return String(template).replace(/\{([^}]+)\}/g, (_, key) => replacements?.[key] ?? `{${key}}`);
  }

  function translate(template, replacements) {
    return interpolate(BPMN_TRANSLATIONS[template] || template, replacements);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function readableError(error) {
    if (error?.code === 'META_CONFLICT') return 'Связи процесса уже изменены в другом окне. Обновите процесс и повторите действие.';
    if (error?.status === 409) return 'Процесс уже изменён в другом окне. Обновите его и повторите правки.';
    if (error?.status === 401) return 'Локальная сессия закончилась. Закройте это окно и снова запустите студию.';
    return error?.message || 'Действие не выполнено. Попробуйте ещё раз.';
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (state.token) headers.set('X-Studio-Token', state.token);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error?.message || `Локальный сервис вернул ошибку ${response.status}.`);
      error.status = response.status;
      error.code = payload?.error?.code;
      error.details = payload?.error?.details;
      throw error;
    }
    return payload || {};
  }

  function toast(title, message = '', tone = 'success', timeout = 5200) {
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.innerHTML = `
      <span class="toast-symbol" aria-hidden="true">${tone === 'error' ? '!' : tone === 'warning' ? 'i' : '✓'}</span>
      <span><strong>${escapeHtml(title)}</strong>${message ? `<small>${escapeHtml(message)}</small>` : ''}</span>
      <button type="button" aria-label="Закрыть сообщение">×</button>`;
    $('button', node).addEventListener('click', () => node.remove());
    elements.toastRegion.append(node);
    window.setTimeout(() => node.remove(), timeout);
  }

  function statusParts(process) {
    const status = process?.status || {};
    return {
      technical: status.technical || process?.meta?.status || (typeof status === 'string' ? status : 'draft'),
      business: status.business || process?.meta?.canonicality?.business_status || 'pending_human_decision',
      registered: Boolean(status.registered ?? process?.registered),
      label: status.label || ''
    };
  }

  function statusTone(technical, business) {
    if (business === 'canonical' || technical === 'approved') return 'approved';
    if (technical === 'review-ready') return 'ready';
    if (technical === 'rework') return 'rework';
    if (technical === 'rejected' || business === 'rejected') return 'rejected';
    return 'neutral';
  }

  function shortStatus(process) {
    const { technical, registered } = statusParts(process);
    if (STATUS_TEXT[technical]) return STATUS_TEXT[technical];
    return registered ? 'Зарегистрирован' : 'Черновик';
  }

  function processSlug(process) {
    return process?.slug || process?.short_name || process?.directory || '';
  }

  function isLocalFile() {
    return state.mode === 'file';
  }

  function isManagedProcess() {
    return state.mode === 'managed';
  }

  function readableFileTitle(fileName) {
    return String(fileName || 'Новая схема.bpmn').replace(/\.bpmn$/iu, '') || 'Новая схема';
  }

  function renderProcessList() {
    const query = elements.search.value.trim().toLocaleLowerCase('ru');
    const shown = state.processes.filter((process) =>
      String(process.title || '').toLocaleLowerCase('ru').includes(query)
    );
    elements.list.innerHTML = shown.map((process) => {
      const slug = processSlug(process);
      const status = statusParts(process);
      const tone = statusTone(status.technical, status.business);
      return `<li class="process-item">
        <button type="button" data-process-slug="${escapeHtml(slug)}" aria-current="${slug === state.activeSlug}">
          <span class="process-dot ${tone}" aria-hidden="true"></span>
          <span class="process-item-copy">
            <strong>${escapeHtml(process.title || 'Без названия')}</strong>
            <small>${escapeHtml(shortStatus(process))}</small>
          </span>
          <svg class="process-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
        </button>
      </li>`;
    }).join('');
    elements.listEmpty.hidden = shown.length > 0;
    $$('[data-process-slug]', elements.list).forEach((button) => {
      button.addEventListener('click', () => selectProcess(button.dataset.processSlug));
    });
  }

  function updateSaveState(kind, text) {
    elements.saveState.className = `save-state ${kind || ''}`.trim();
    elements.saveState.lastChild.textContent = text;
    elements.save.disabled = !state.process || kind !== 'dirty' || state.busy;
    elements.saveAs.disabled = !state.process || state.busy;
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    updateSaveState(state.dirty ? 'dirty' : '', state.dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены');
    elements.reload.disabled = !state.process || !state.dirty || state.busy;
    if (state.process) renderMap();
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    elements.check.disabled = state.busy || !state.process;
    elements.lifecycleAction.disabled = state.busy || !state.process;
    elements.buildMap.disabled = state.busy || !state.process;
    elements.rebuildMap.disabled = state.busy || !state.process;
    elements.save.disabled = state.busy || !state.dirty;
    elements.saveTransition.disabled = state.busy || state.transitionLoading
      || transitionFormKind() === 'registered' && elements.registeredTarget.disabled;
    elements.deleteTransition.disabled = state.busy || state.transitionLoading;
    elements.convertToCallActivity.disabled = state.busy;
    elements.futureProcessCreate.disabled = state.busy;
    elements.newFile.disabled = state.busy;
    elements.openFile.disabled = state.busy;
    elements.saveAs.disabled = state.busy || !state.process;
    elements.download.disabled = state.busy || !state.process;
    elements.reload.disabled = state.busy || !state.process || !state.dirty;
  }

  function setCanvasLoading(value) {
    elements.canvasLoading.hidden = !value;
  }

  function renderWorkspace() {
    const process = state.process;
    const hasProcess = Boolean(process);
    elements.headerActions.hidden = false;
    elements.download.disabled = !hasProcess;
    elements.reload.disabled = !hasProcess || !state.dirty;
    elements.welcome.hidden = hasProcess;
    $$('.tab').forEach((tab) => {
      tab.disabled = !hasProcess || tab.classList.contains('managed-tab') && !isManagedProcess();
    });
    $$('.tab-view').forEach((view) => {
      view.hidden = !hasProcess || view.id !== state.activeTab;
    });
    $$('.tab').forEach((tab) => {
      const active = tab.dataset.tab === state.activeTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    if (!process) {
      elements.title.textContent = 'Редактор BPMN';
      elements.subtitle.textContent = 'Создайте схему одним кликом или откройте любой BPMN-файл.';
      elements.status.hidden = true;
      updateSaveState('', 'Файл ещё не открыт');
      return;
    }

    if (isLocalFile()) {
      elements.title.textContent = readableFileTitle(state.fileName);
      elements.subtitle.textContent = state.fileHandle
        ? 'Локальный BPMN-файл — изменения сохраняются в выбранный файл.'
        : 'Локальный BPMN-файл — при сохранении можно выбрать любое имя и папку.';
      elements.status.textContent = 'Локальный файл';
      elements.status.className = 'status-badge status-neutral';
      elements.status.hidden = false;
      if (state.activeTab !== 'diagram-view') state.activeTab = 'diagram-view';
      window.requestAnimationFrame(() => {
        try { state.modeler?.get('canvas').resized(); } catch { /* редактор ещё открывается */ }
      });
      return;
    }

    const status = statusParts(process);
    const tone = statusTone(status.technical, status.business);
    elements.title.textContent = process.title || 'Бизнес-процесс';
    elements.subtitle.textContent = status.label || 'Локальная каноническая BPMN-модель';
    elements.status.textContent = shortStatus(process);
    elements.status.className = `status-badge status-${tone}`;
    elements.status.hidden = false;
    renderMap();
    renderDetails();

    if (state.activeTab === 'diagram-view') {
      window.requestAnimationFrame(() => {
        try { state.modeler?.get('canvas').resized(); } catch { /* редактор ещё открывается */ }
      });
    }
  }

  function switchTab(tabId) {
    if (!state.process) return;
    if (isLocalFile() && tabId !== 'diagram-view') return;
    state.activeTab = tabId;
    renderWorkspace();
  }

  function extractProcess(payload) {
    return payload?.process || payload?.result?.process || payload;
  }

  async function loadBootstrap({ keepSelection = true } = {}) {
    let payload;
    try {
      payload = await api('/api/bootstrap');
    } catch (error) {
      if (error.status !== 404) throw error;
      payload = await api('/api/processes');
    }
    state.processes = Array.isArray(payload.processes) ? payload.processes : Array.isArray(payload.items) ? payload.items : [];
    renderProcessList();

    if (!keepSelection || !state.activeSlug) return;
    const current = state.processes.find((item) => processSlug(item) === state.activeSlug);
    if (current && state.process) state.process = { ...state.process, ...current };
  }

  function confirmDiscard() {
    return !state.dirty || window.confirm('На схеме есть несохранённые изменения. Продолжить без сохранения?');
  }

  async function selectProcess(slug, { force = false } = {}) {
    if (!slug || slug === state.activeSlug && state.process) return;
    if (!force && !confirmDiscard()) return;
    closeTransitionPanel();
    setBusy(true);
    setCanvasLoading(true);
    try {
      const payload = await api(`/api/process/${encodeURIComponent(slug)}`);
      const process = extractProcess(payload);
      if (!process?.xml) throw new Error('Локальный сервис не передал BPMN-схему процесса.');
      state.importing = true;
      await state.modeler.importXML(process.xml);
      state.mode = 'managed';
      state.fileHandle = null;
      state.fileName = null;
      state.fileOriginalXml = null;
      state.process = process;
      state.activeSlug = processSlug(process) || slug;
      state.sha256 = process.sha256 || process.bpmn_sha256 || null;
      state.lastCheck = null;
      state.transitionData = null;
      state.mapUrl = process.views?.archify?.available && process.views.archify.fresh === true
        ? process.views.archify.url
        : null;
      setDirty(false);
      await loadTransitionData({ render: false, quiet: true });
      renderProcessList();
      renderWorkspace();
      window.localStorage.setItem('bpmn-studio-last-process', state.activeSlug);
      window.requestAnimationFrame(() => fitDiagram());
    } catch (error) {
      toast('Не удалось открыть процесс', readableError(error), 'error', 7000);
    } finally {
      state.importing = false;
      setCanvasLoading(false);
      setBusy(false);
    }
  }

  function transliterate(value) {
    return Array.from(String(value ?? '').toLocaleLowerCase('ru'))
      .map((character) => TRANSLITERATION[character] ?? character)
      .join('');
  }

  function toSlug(title) {
    let slug = transliterate(title)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 64)
      .replace(/-+$/g, '');
    if (!/^[a-z]/.test(slug)) slug = `process-${slug || 'new'}`;
    if (slug.length < 3) slug = `${slug}-process`;
    const occupied = new Set(state.processes.map(processSlug));
    if (!occupied.has(slug)) return slug;
    const base = slug.slice(0, 61).replace(/-+$/g, '');
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${base}-${suffix}`.slice(0, 64);
      if (!occupied.has(candidate)) return candidate;
    }
    return `${base.slice(0, 50)}-${Date.now().toString(36)}`.slice(0, 64);
  }

  function openCreateDialog() {
    elements.createForm.reset();
    elements.createDialog.showModal();
    window.setTimeout(() => elements.processName.focus(), 0);
  }

  async function createProcess(title) {
    const slug = toSlug(title);
    elements.createSubmit.disabled = true;
    elements.createSubmit.textContent = 'Создаём…';
    try {
      const payload = await api('/api/processes', {
        method: 'POST',
        body: JSON.stringify({ title, slug })
      });
      const process = extractProcess(payload);
      elements.createDialog.close();
      await loadBootstrap({ keepSelection: false });
      await selectProcess(processSlug(process) || slug, { force: true });
      toast('Основа процесса готова', 'Назовите шаги и соедините их по реальному порядку работы.');
    } catch (error) {
      toast('Процесс не создан', readableError(error), 'error', 7000);
    } finally {
      elements.createSubmit.disabled = false;
      elements.createSubmit.textContent = 'Создать основу';
    }
  }

  function safeBpmnFileName(value) {
    const cleaned = String(value || 'Новая схема.bpmn')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const name = cleaned || 'Новая схема.bpmn';
    return /\.bpmn$/iu.test(name) ? name : `${name}.bpmn`;
  }

  async function openLocalXml(xml, { fileName = 'Новая схема.bpmn', fileHandle = null, dirty = false, force = false } = {}) {
    if (!force && !confirmDiscard()) return false;
    closeTransitionPanel();
    setBusy(true);
    setCanvasLoading(true);
    state.importing = true;
    try {
      await state.modeler.importXML(xml);
      state.mode = 'file';
      state.fileHandle = fileHandle;
      state.fileName = safeBpmnFileName(fileName);
      state.fileOriginalXml = xml;
      state.process = {
        title: readableFileTitle(state.fileName),
        localFile: true,
        xml
      };
      state.activeSlug = null;
      state.sha256 = null;
      state.lastCheck = null;
      state.transitionData = null;
      state.mapUrl = null;
      state.activeTab = 'diagram-view';
      setDirty(dirty);
      renderProcessList();
      renderWorkspace();
      window.requestAnimationFrame(() => fitDiagram());
      return true;
    } catch (error) {
      toast('BPMN-файл не открыт', readableError(error), 'error', 7600);
      return false;
    } finally {
      state.importing = false;
      setCanvasLoading(false);
      setBusy(false);
    }
  }

  async function createLocalDiagram() {
    const opened = await openLocalXml(STARTER_BPMN_XML, {
      fileName: 'Новая схема.bpmn',
      dirty: true
    });
    if (opened) toast('Осмысленная схема готова', 'Измените шаги под свою работу и сохраните файл в удобную папку.');
  }

  async function openLocalFile(file, fileHandle = null) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast('Файл слишком большой', 'Можно открыть BPMN-файл размером до 20 МБ.', 'warning');
      return;
    }
    const xml = await file.text();
    const opened = await openLocalXml(xml, {
      fileName: file.name || 'Открытая схема.bpmn',
      fileHandle,
      dirty: false
    });
    if (opened) toast('BPMN-файл открыт', 'Можно редактировать схему сразу в браузере.');
  }

  async function triggerFileOpen() {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [ handle ] = await window.showOpenFilePicker({
          multiple: false,
          types: [ {
            description: 'BPMN 2.0',
            accept: { 'application/xml': [ '.bpmn' ] }
          } ]
        });
        if (!handle) return;
        await openLocalFile(await handle.getFile(), handle);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    elements.openFileInput.value = '';
    elements.openFileInput.click();
  }

  function downloadXml(xml, fileName) {
    const blob = new Blob([ xml ], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeBpmnFileName(fileName);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function writeXmlFile(xml, { fileName, fileHandle = null, saveAs = false } = {}) {
    let handle = saveAs ? null : fileHandle;
    if (!handle && typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: safeBpmnFileName(fileName),
          types: [ {
            description: 'BPMN 2.0',
            accept: { 'application/xml': [ '.bpmn' ] }
          } ]
        });
      } catch (error) {
        if (error?.name === 'AbortError') return { cancelled: true };
        handle = null;
      }
    }
    if (handle) {
      try {
        const writable = await handle.createWritable();
        await writable.write(xml);
        await writable.close();
        return { handle, name: handle.name || safeBpmnFileName(fileName), downloaded: false };
      } catch {
        downloadXml(xml, fileName);
        return { handle: null, name: safeBpmnFileName(fileName), downloaded: true };
      }
    }
    downloadXml(xml, fileName);
    return { handle: null, name: safeBpmnFileName(fileName), downloaded: true };
  }

  async function saveLocalFile({ saveAs = false } = {}) {
    if (!isLocalFile()) return null;
    setBusy(true);
    updateSaveState('saving', 'Сохраняем BPMN-файл…');
    try {
      const xml = await currentXml();
      const result = await writeXmlFile(xml, {
        fileName: state.fileName,
        fileHandle: state.fileHandle,
        saveAs
      });
      if (result.cancelled) {
        updateSaveState(state.dirty ? 'dirty' : '', state.dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены');
        return null;
      }
      state.fileHandle = result.handle;
      state.fileName = result.name;
      state.process.title = readableFileTitle(result.name);
      state.process.xml = xml;
      state.fileOriginalXml = xml;
      setDirty(false);
      renderWorkspace();
      toast(
        result.downloaded ? 'BPMN-файл скачан' : 'BPMN-файл сохранён',
        result.downloaded ? 'Браузер сохранил копию в папку загрузок.' : `Файл «${result.name}» обновлён.`
      );
      return result;
    } catch (error) {
      updateSaveState('error', 'Не удалось сохранить');
      toast('BPMN-файл не сохранён', readableError(error), 'error', 7600);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrent() {
    return isLocalFile() ? saveLocalFile() : saveProcess();
  }

  async function saveCurrentAs() {
    if (!state.process) return null;
    if (isLocalFile()) return saveLocalFile({ saveAs: true });
    try {
      const xml = await currentXml();
      const result = await writeXmlFile(xml, {
        fileName: `${state.process.title || 'Бизнес-процесс'}.bpmn`,
        saveAs: true
      });
      if (!result.cancelled) toast(result.downloaded ? 'Копия BPMN скачана' : 'Копия BPMN сохранена');
      return result;
    } catch (error) {
      toast('Копия BPMN не сохранена', readableError(error), 'error');
      return null;
    }
  }

  function toPascal(value) {
    return transliterate(value)
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  function typePrefix(type) {
    const plain = String(type || '').replace(/^bpmn:/, '');
    const prefixes = {
      Activity: 'Task', Task: 'Task', UserTask: 'UserTask', ManualTask: 'ManualTask',
      ServiceTask: 'ServiceTask', SendTask: 'SendTask', ReceiveTask: 'ReceiveTask',
      BusinessRuleTask: 'BusinessRuleTask', ScriptTask: 'ScriptTask', CallActivity: 'CallActivity',
      SubProcess: 'SubProcess', StartEvent: 'StartEvent', EndEvent: 'EndEvent',
      IntermediateCatchEvent: 'CatchEvent', IntermediateThrowEvent: 'ThrowEvent', BoundaryEvent: 'BoundaryEvent',
      ExclusiveGateway: 'Gateway', InclusiveGateway: 'Gateway', ParallelGateway: 'Gateway',
      ComplexGateway: 'Gateway', EventBasedGateway: 'Gateway', Participant: 'Participant', Lane: 'Lane',
      DataObjectReference: 'DataObject', DataStoreReference: 'DataStore', TextAnnotation: 'Annotation', Group: 'Group'
    };
    return prefixes[plain] || toPascal(plain) || 'Element';
  }

  function fallbackStem(type) {
    const plain = String(type || '').replace(/^bpmn:/, '');
    if (plain === 'StartEvent') return 'ProcessStart';
    if (plain === 'EndEvent') return 'ProcessEnd';
    if (plain.includes('Gateway')) return 'Decision';
    if (plain === 'Participant') return 'ProcessParticipant';
    if (plain === 'Lane') return 'ResponsibleRole';
    if (plain.includes('Event')) return 'BusinessEvent';
    if (plain === 'TextAnnotation') return 'Explanation';
    if (plain.includes('Data')) return 'BusinessData';
    return 'ProcessStep';
  }

  function isGeneratedId(id) {
    return /^(?:Activity|CallActivity|Collaboration|DataObject|DataStore|Definitions|Event|StartEvent|EndEvent|IntermediateCatchEvent|IntermediateThrowEvent|BoundaryEvent|Flow|Gateway|Lane|Message|MessageFlow|Participant|Process|SequenceFlow|Task|UserTask|ManualTask|ServiceTask|SendTask|ReceiveTask|BusinessRuleTask|ScriptTask|TextAnnotation|Group|SubProcess)_(?:[0-9]+|[0-9a-f]{4,})(?:_di)?$/i.test(String(id || ''));
  }

  function uniqueId(base, used) {
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function idStem(element) {
    const id = String(element?.businessObject?.id || element?.id || '');
    const tail = id.includes('_') ? id.split('_').slice(1).join('') : id;
    return tail.replace(/[^A-Za-z0-9]/g, '') || 'Step';
  }

  function updateElementId(modeling, element, nextId) {
    const di = element.di || element.businessObject?.di;
    modeling.updateProperties(element, { id: nextId });
    if (di?.id && di.id !== `${nextId}_di`) {
      modeling.updateModdleProperties(element, di, { id: `${nextId}_di` });
    }
  }

  function normalizeGeneratedIds() {
    const registry = state.modeler.get('elementRegistry');
    const modeling = state.modeler.get('modeling');
    const all = registry.getAll().filter((element) => element?.businessObject && element.type !== 'label');
    const used = new Set(all.map((element) => element.businessObject.id).filter(Boolean));
    const connections = all.filter((element) => Array.isArray(element.waypoints));
    const shapes = all.filter((element) => !Array.isArray(element.waypoints));

    for (const element of shapes) {
      const current = element.businessObject.id;
      if (!isGeneratedId(current)) continue;
      used.delete(current);
      const readable = element.businessObject.name || element.businessObject.text || '';
      const stem = toPascal(readable) || fallbackStem(element.businessObject.$type);
      const nextId = uniqueId(`${typePrefix(element.businessObject.$type)}_${stem}`, used);
      updateElementId(modeling, element, nextId);
      used.add(nextId);
    }

    for (const connection of connections) {
      const current = connection.businessObject.id;
      if (!isGeneratedId(current)) continue;
      used.delete(current);
      const type = String(connection.businessObject.$type || '');
      const prefix = type.endsWith('MessageFlow') ? 'MessageFlow' : type.endsWith('Association') ? 'Association' : 'Flow';
      const source = idStem(connection.source);
      const target = idStem(connection.target);
      const nextId = uniqueId(`${prefix}_${source}To${target}`, used);
      updateElementId(modeling, connection, nextId);
      used.add(nextId);
    }
  }

  function assertNoGeneratedIds(xml) {
    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    if (documentXml.querySelector('parsererror')) throw new Error('Редактор сформировал некорректный XML. Изменения не записаны.');
    const remaining = $$('[id]', documentXml).filter((node) => isGeneratedId(node.getAttribute('id')));
    if (remaining.length) {
      throw new Error('Не удалось безопасно назначить смысловые внутренние имена новым элементам. Дайте им русские названия и повторите сохранение.');
    }
  }

  async function serializeCurrentXml() {
    const result = await state.modeler.saveXML({ format: true });
    if (!result?.xml) throw new Error('Редактор не сформировал BPMN-файл.');
    assertNoGeneratedIds(result.xml);
    return result.xml;
  }

  async function currentXml() {
    if (isLocalFile()) {
      const result = await state.modeler.saveXML({ format: true });
      if (!result?.xml) throw new Error('Редактор не сформировал BPMN-файл.');
      return result.xml;
    }
    normalizeGeneratedIds();
    return serializeCurrentXml();
  }

  async function saveProcess({ silent = false } = {}) {
    if (!state.process || !state.sha256) throw new Error('Не удалось определить открытую версию BPMN-файла. Обновите процесс.');
    if (!state.dirty && silent) return state.process;
    setBusy(true);
    updateSaveState('saving', 'Сохраняем и проверяем внутреннюю структуру…');
    try {
      const xml = await currentXml();
      const payload = await api(`/api/process/${encodeURIComponent(state.activeSlug)}/bpmn`, {
        method: 'PUT',
        body: JSON.stringify({ xml, expectedSha256: state.sha256 })
      });
      const process = extractProcess(payload);
      state.process = process;
      state.sha256 = process.sha256 || payload.sha256 || state.sha256;
      state.mapUrl = process.views?.archify?.available && process.views.archify.fresh === true
        ? process.views.archify.url
        : null;
      setDirty(false);
      await loadBootstrap();
      renderWorkspace();
      if (!silent) toast('Схема сохранена', payload.notice || 'Изменения записаны в стандартный BPMN-файл.');
      return process;
    } catch (error) {
      updateSaveState('error', 'Не удалось сохранить');
      toast('Изменения не сохранены', readableError(error), 'error', 7600);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function actionResult(payload) {
    return payload?.result || payload;
  }

  async function performAction(action) {
    if (!state.process) return null;
    if (state.dirty) await saveProcess({ silent: true });
    setBusy(true);
    try {
      const payload = await api(`/api/process/${encodeURIComponent(state.activeSlug)}/action`, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      const result = actionResult(payload);
      if (result.process) {
        state.process = result.process;
        state.sha256 = result.process.sha256 || state.sha256;
      }
      await loadBootstrap();
      renderWorkspace();
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function checkLocalProcess() {
    try {
      const xml = await currentXml();
      const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
      if (documentXml.querySelector('parsererror')) throw new Error('XML содержит синтаксическую ошибку.');
      const bpmnNamespace = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
      const count = (name) => documentXml.getElementsByTagNameNS(bpmnNamespace, name).length;
      const issues = [];
      if (!count('process')) issues.push('нет элемента процесса');
      if (!count('startEvent')) issues.push('нет начала процесса');
      if (!count('endEvent')) issues.push('нет результата завершения');
      const readableTypes = [
        'task', 'userTask', 'serviceTask', 'manualTask', 'businessRuleTask',
        'scriptTask', 'sendTask', 'receiveTask', 'callActivity',
        'exclusiveGateway', 'inclusiveGateway', 'parallelGateway'
      ];
      const unnamed = readableTypes.flatMap((type) =>
        Array.from(documentXml.getElementsByTagNameNS(bpmnNamespace, type))
          .filter((node) => !String(node.getAttribute('name') || '').trim())
      );
      if (unnamed.length) issues.push(`не подписаны действия или развилки: ${unnamed.length}`);
      if (issues.length) {
        toast('Схему стоит доработать', issues.join('; '), 'warning', 7600);
        return false;
      }
      toast('Базовая проверка пройдена', 'Файл читается как BPMN 2.0, содержит начало, завершение и понятные подписи.');
      return true;
    } catch (error) {
      toast('Проверка не завершена', readableError(error), 'error', 7000);
      return false;
    }
  }

  async function checkProcess() {
    if (isLocalFile()) return checkLocalProcess();
    try {
      const result = await performAction('check');
      state.lastCheck = result;
      renderDetails();
      if (result?.passed) {
        toast('Техническая проверка пройдена', 'Это ещё не решение владельца процесса.');
      } else {
        switchTab('details-view');
        toast('Есть замечания', 'Откройте список в разделе «Карточка и вопросы».', 'warning', 7000);
      }
    } catch (error) {
      state.lastCheck = {
        action: 'check',
        passed: false,
        requestError: readableError(error),
        checks: []
      };
      switchTab('details-view');
      toast('Проверка не завершена', readableError(error), 'error', 7000);
    }
  }

  function currentArchifyView() {
    return state.process?.views?.archify || null;
  }

  async function buildOrOpenMap({ separate = false } = {}) {
    const currentView = currentArchifyView();
    if (separate && currentView?.fresh === true && state.mapUrl && !state.dirty) {
      window.open(state.mapUrl, '_blank', 'noopener');
      return;
    }
    const pendingWindow = separate ? window.open('about:blank', '_blank') : null;
    try {
      const result = await performAction('open-archify');
      const view = result?.view || result?.process?.views?.archify || currentArchifyView();
      state.mapUrl = view?.available && view?.fresh === true ? view.url : null;
      renderMap();
      if (state.mapUrl && pendingWindow) {
        pendingWindow.opener = null;
        pendingWindow.location.replace(state.mapUrl);
      }
      else if (state.mapUrl) elements.mapFrame.src = state.mapUrl;
      if (!state.mapUrl) {
        pendingWindow?.close();
        toast(
          'Карта пока не считается актуальной',
          view?.reason || 'Студия не смогла подтвердить, что карта построена из текущей версии процесса.',
          'warning',
          7600
        );
        return;
      }
      toast(result?.built ? 'Карта Archify построена' : 'Карта Archify открыта', 'Она предназначена для чтения и обсуждения процесса.');
    } catch (error) {
      pendingWindow?.close();
      toast('Карта не открыта', readableError(error), 'error', 7400);
    }
  }

  function renderMap() {
    if (!state.process) return;
    const view = currentArchifyView();
    const stale = Boolean(view?.available && (view?.fresh !== true || state.dirty));
    const fresh = Boolean(view?.available && view?.fresh === true && view?.url && !state.dirty);
    const staleReason = state.dirty
      ? 'На BPMN-схеме есть несохранённые изменения.'
      : view?.reason;
    state.mapUrl = fresh ? view.url : null;

    elements.mapEmpty.classList.toggle('is-stale', stale);
    elements.mapEmptyTitle.textContent = stale ? 'Карта устарела' : 'Карта ещё не построена';
    elements.mapEmptyCopy.textContent = stale
      ? `${staleReason || 'Исходная BPMN-схема изменилась после последней сборки карты.'} Чтобы не обсуждать старую версию, сначала пересоберите карту.`
      : 'Студия возьмёт текущую BPMN-схему и подготовит обзор. Для сложного процесса результат останется черновиком до проверки аналитиком.';
    elements.buildMap.textContent = stale ? 'Пересобрать карту' : 'Построить карту Archify';
    elements.mapEmpty.hidden = fresh;
    elements.mapFrame.hidden = !fresh;
    elements.rebuildMap.hidden = !fresh;
    elements.openMap.hidden = !fresh;

    if (!fresh && elements.mapFrame.getAttribute('src')) {
      elements.mapFrame.src = 'about:blank';
    }
    if (fresh && elements.mapFrame.src !== new URL(state.mapUrl, window.location.href).href) {
      elements.mapFrame.src = state.mapUrl;
    }
  }

  function cleanCheckOutput(value) {
    return String(value ?? '')
      .replace(/\u001b\[[0-9;]*m/gu, '')
      .replace(/\r\n/gu, '\n')
      .trim();
  }

  function firstOutputLine(output) {
    const lines = cleanCheckOutput(output)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const errorLine = lines.find((line) => /\berror\b|ошиб|не найден|отсутств|must|required|missing|invalid|mismatch/iu.test(line));
    return errorLine || lines[0] || '';
  }

  function humanizeCheckFailure(check) {
    const output = cleanCheckOutput(check?.output);
    const line = firstOutputLine(output);
    const lower = `${line}\n${output}`.toLocaleLowerCase('ru');

    if (/stable semantic ascii|generated or numeric ids|must have a stable semantic ascii id/u.test(lower)) {
      return 'У новых элементов или стрелок остались временные внутренние имена. Дайте элементам понятные русские названия и сохраните схему ещё раз.';
    }
    if (/missing bpmn file|bpmn-файл не найден/u.test(lower)) {
      return 'Не найден основной BPMN-файл процесса.';
    }
    if (/missing referenced file/u.test(lower)) {
      return 'Не найден файл, который указан в комплекте процесса.';
    }
    if (/sha-256 mismatch/u.test(lower)) {
      return 'Один из файлов изменился после фиксации контрольной суммы. Обновите комплект процесса и повторите проверку.';
    }
    if (/label|required.*name|missing.*name/u.test(lower)) {
      return 'У одного из элементов схемы нет понятной подписи. Откройте BPMN-схему и подпишите действие, событие или развилку по-русски.';
    }
    if (/end event|required.*end/u.test(lower)) {
      return 'У одной из веток процесса нет явного результата завершения. Добавьте конечное событие.';
    }
    if (/start event|required.*start/u.test(lower)) {
      return 'У процесса нет одного явного начала. Добавьте начальное событие.';
    }
    if (/gateway.*join.*fork/u.test(lower)) {
      return 'Одна развилка одновременно объединяет и разделяет ветки. Разнесите эти действия на две отдельные развилки.';
    }
    if (line && /\p{Script=Cyrillic}/u.test(line)) {
      return line.replace(/^error:\s*/iu, '').replace(/^ошибка:\s*/iu, '');
    }
    if (check?.id === 'bpmn-lint') {
      return 'В BPMN-схеме найдены нарушения правил моделирования. Ниже можно раскрыть проверку и посмотреть технические подробности.';
    }
    return `Проверка «${check?.title || 'комплекта процесса'}» не пройдена. Ниже можно раскрыть проверку и посмотреть технические подробности.`;
  }

  function appendTechnicalOutput(container, output) {
    const cleaned = cleanCheckOutput(output);
    if (!cleaned) return;
    const details = document.createElement('details');
    details.className = 'technical-output';
    const summary = document.createElement('summary');
    summary.textContent = 'Показать технический вывод для разработчика';
    const pre = document.createElement('pre');
    pre.textContent = cleaned;
    details.append(summary, pre);
    container.append(details);
  }

  function appendCheckResult(check, { open = false } = {}) {
    const passed = Boolean(check?.passed);
    const details = document.createElement('details');
    details.className = `check-result ${passed ? 'passed' : 'failed'}`;
    details.open = open;

    const summary = document.createElement('summary');
    const symbol = document.createElement('span');
    symbol.className = 'check-result-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = passed ? '✓' : '!';
    const copy = document.createElement('span');
    copy.className = 'check-result-copy';
    const title = document.createElement('strong');
    title.textContent = check?.title || 'Техническая проверка';
    const status = document.createElement('small');
    status.textContent = passed ? 'Замечаний не найдено' : 'Найдена проблема — нажмите, чтобы раскрыть';
    copy.append(title, status);
    const chevron = document.createElement('span');
    chevron.className = 'check-result-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    summary.append(symbol, copy, chevron);

    const body = document.createElement('div');
    body.className = 'check-result-body';
    const explanation = document.createElement('p');
    explanation.textContent = passed
      ? 'Эта часть проверки завершилась без замечаний.'
      : humanizeCheckFailure(check);
    body.append(explanation);
    appendTechnicalOutput(body, check?.output);
    details.append(summary, body);
    elements.checkResults.append(details);
  }

  function renderCheckReport() {
    const report = state.lastCheck;
    elements.checkReport.hidden = !report;
    elements.checkResults.replaceChildren();
    if (!report) return;

    const passed = Boolean(report.passed);
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const firstFailedIndex = checks.findIndex((check) => !check?.passed);
    const firstFailure = firstFailedIndex >= 0 ? checks[firstFailedIndex] : null;
    const firstMessage = report.requestError || (firstFailure ? humanizeCheckFailure(firstFailure) : '');

    elements.checkReportTitle.textContent = passed ? 'Проверка пройдена' : 'Проверка обнаружила замечания';
    elements.checkReportStatus.textContent = passed ? 'Пройдено' : 'Нужно исправить';
    elements.checkReportStatus.className = `check-report-status ${passed ? 'passed' : 'failed'}`;
    elements.checkFirstError.hidden = passed || !firstMessage;
    elements.checkFirstError.textContent = firstMessage ? `Сначала исправьте: ${firstMessage}` : '';

    if (report.requestError && checks.length === 0) {
      appendCheckResult({
        id: 'request',
        title: 'Запуск технической проверки',
        passed: false,
        output: report.requestError
      }, { open: true });
      return;
    }
    checks.forEach((check, index) => appendCheckResult(check, { open: index === firstFailedIndex }));
  }

  function transitionList() {
    if (Array.isArray(state.transitionData?.transitions)) return state.transitionData.transitions;
    if (Array.isArray(state.process?.transitions)) return state.process.transitions;
    return Array.isArray(state.process?.meta?.process_links) ? state.process.meta.process_links : [];
  }

  function transitionOpen(transition) {
    return transition?.open && typeof transition.open === 'object'
      ? transition.open
      : { kind: 'none', slug: null, view_url: null };
  }

  function registeredTransitionTargets() {
    const targets = state.transitionData?.targets?.registered;
    return Array.isArray(targets) ? targets.filter((target) => target?.slug !== state.activeSlug) : [];
  }

  function reservedTransitionTargets() {
    const targets = state.transitionData?.targets?.reserved;
    return Array.isArray(targets) ? targets : [];
  }

  function findCatalogProcess({ slug, processId } = {}) {
    return state.processes.find((process) =>
      (slug && processSlug(process) === slug)
      || (processId && process.process_id === processId)
    ) || null;
  }

  function transitionCatalogProcess(transition) {
    const open = transitionOpen(transition);
    const reserved = reservedTargetInfo(transition);
    return findCatalogProcess({
      slug: open.slug || transition?.target_slug || reserved?.slug,
      processId: transition?.target_process_id
    });
  }

  function transitionTargetSlug(transition) {
    const catalog = transitionCatalogProcess(transition);
    if (catalog) return processSlug(catalog);
    const open = transitionOpen(transition);
    return open.slug || transition?.target_slug || reservedTargetInfo(transition)?.slug || '';
  }

  function transitionTargetTitle(transition) {
    const open = transitionOpen(transition);
    const catalog = transitionCatalogProcess(transition);
    if (catalog?.title) return catalog.title;

    const allTargets = [ ...registeredTransitionTargets(), ...reservedTransitionTargets() ];
    const described = allTargets.find((target) =>
      open.slug && target?.slug === open.slug
      || transition?.target_slug && target?.slug === transition.target_slug
      || transition?.target_process_id && target?.process_id === transition.target_process_id
      || transition?.target_ref && target?.target_ref === transition.target_ref
    );
    return transition?.target_title
      || transition?.target?.title
      || described?.title
      || (transition?.target_status === 'unresolved' ? 'Следующий процесс пока неизвестен' : transition?.label)
      || 'Связанный бизнес-процесс';
  }

  function transitionStatusText(transition) {
    const open = transitionOpen(transition);
    if (transition?.target_status === 'canonical') return 'Связь подтверждена владельцем процесса';
    if (transition?.target_status === 'unresolved') return 'Следующий процесс не определён — нужен ответ владельца';
    if (open.kind === 'process' || transition?.target_resolution === 'registered_bpmn') {
      return 'Готовый процесс выбран; связь ожидает подтверждения владельца';
    }
    if (open.kind === 'card' || transition?.target_resolution === 'fallback_card') {
      return 'Будущий процесс зарезервирован; карточка-заготовка сохранена';
    }
    return 'Связь-кандидат ожидает подтверждения владельца';
  }

  function transitionTone(transition) {
    if (transition?.target_status === 'canonical') return 'canonical';
    if (transition?.target_status === 'unresolved') return 'unresolved';
    return 'candidate';
  }

  function renderTransitionsCard() {
    const transitions = transitionList();
    elements.transitionsCount.textContent = String(transitions.length);
    elements.transitionsEmpty.hidden = transitions.length > 0;
    elements.transitionsList.hidden = transitions.length === 0;
    elements.transitionsList.innerHTML = transitions.map((transition) => {
      const open = transitionOpen(transition);
      const sourceId = String(transition?.source_element_id || '');
      const linkId = String(transition?.link_id || '');
      const targetSlug = transitionTargetSlug(transition);
      const catalogTarget = transitionCatalogProcess(transition);
      const reserved = reservedTargetInfo(transition);
      const canOpen = Boolean(targetSlug && (open.kind === 'process' || catalogTarget));
      const canOpenCard = open.kind === 'card' && typeof open.card_markdown === 'string';
      const canCreate = Boolean(open.kind === 'card' && !catalogTarget && linkId && reserved?.slug && reserved?.title);
      return `<article class="transition-card ${transitionTone(transition)}">
        <span class="transition-card-dot" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(transitionTargetTitle(transition))}</strong>
          <small>${escapeHtml(transition?.label || 'Переход в другой процесс')}</small>
          <small>${escapeHtml(transitionStatusText(transition))}</small>
          <div class="transition-card-actions">
            ${canOpen ? `<button type="button" data-open-transition-target="${escapeHtml(targetSlug)}">Открыть процесс</button>` : ''}
            ${canOpenCard ? `<button type="button" data-open-future-card="${escapeHtml(linkId)}">Открыть карточку будущего процесса</button>` : ''}
            ${canCreate ? `<button type="button" data-create-future-process="${escapeHtml(linkId)}">Создать этот процесс</button>` : ''}
            ${sourceId ? `<button type="button" data-edit-transition-source="${escapeHtml(sourceId)}">Показать на схеме</button>` : ''}
          </div>
        </div>
      </article>`;
    }).join('');

    $$('[data-open-transition-target]', elements.transitionsList).forEach((button) => {
      button.addEventListener('click', () => selectProcess(button.dataset.openTransitionTarget));
    });
    $$('[data-open-future-card]', elements.transitionsList).forEach((button) => {
      button.addEventListener('click', () => openFutureProcessCard(button.dataset.openFutureCard));
    });
    $$('[data-create-future-process]', elements.transitionsList).forEach((button) => {
      button.addEventListener('click', () => createReservedProcess(button.dataset.createFutureProcess));
    });
    $$('[data-edit-transition-source]', elements.transitionsList).forEach((button) => {
      button.addEventListener('click', () => selectTransitionSource(button.dataset.editTransitionSource));
    });
  }

  function transitionByLinkId(linkId) {
    return transitionList().find((transition) => transition?.link_id === linkId) || null;
  }

  function openFutureProcessCard(linkId) {
    const transition = transitionByLinkId(linkId);
    const open = transitionOpen(transition);
    if (!transition || open.kind !== 'card' || typeof open.card_markdown !== 'string') {
      toast('Карточка недоступна', 'Обновите процесс и повторите действие.', 'warning');
      return;
    }
    const reserved = reservedTargetInfo(transition);
    const canCreate = Boolean(reserved?.slug && reserved?.title && !transitionCatalogProcess(transition));
    elements.futureProcessTitle.textContent = transitionTargetTitle(transition);
    elements.futureProcessCard.textContent = open.card_markdown;
    elements.futureProcessDialog.dataset.linkId = transition.link_id;
    elements.futureProcessCreate.hidden = !canCreate;
    elements.futureProcessCreate.disabled = state.busy;
    elements.futureProcessDialog.showModal();
  }

  async function createReservedProcess(linkId) {
    if (state.busy) return;
    const transition = transitionByLinkId(linkId);
    const reserved = reservedTargetInfo(transition);
    if (!transition || !reserved?.slug || !reserved?.title) {
      toast('Процесс не создан', 'Не удалось прочитать сохранённое название будущего процесса. Обновите список.', 'warning');
      return;
    }
    const existing = transitionCatalogProcess(transition);
    if (existing) {
      if (elements.futureProcessDialog.open) elements.futureProcessDialog.close();
      await selectProcess(processSlug(existing));
      return;
    }

    setBusy(true);
    try {
      const payload = await api('/api/processes', {
        method: 'POST',
        body: JSON.stringify({ title: reserved.title, slug: reserved.slug })
      });
      const process = extractProcess(payload);
      if (elements.futureProcessDialog.open) elements.futureProcessDialog.close();
      await loadBootstrap();
      await selectProcess(processSlug(process) || reserved.slug);
      toast('Основа будущего процесса создана', 'Сохранённые название и короткое имя использованы без повторного ввода.');
    } catch (error) {
      if (error?.code === 'PROCESS_EXISTS') {
        await loadBootstrap();
        const process = findCatalogProcess({ slug: reserved.slug, processId: reserved.process_id });
        if (process) {
          if (elements.futureProcessDialog.open) elements.futureProcessDialog.close();
          await selectProcess(processSlug(process));
          toast('Процесс уже создан', 'Открыта существующая BPMN-схема с зарезервированным именем.', 'warning');
          return;
        }
      }
      toast('Процесс не создан', readableError(error), 'error', 7000);
    } finally {
      setBusy(false);
    }
  }

  async function loadTransitionData({ render = true, quiet = false } = {}) {
    if (!state.activeSlug || !state.process) return null;
    const requestedSlug = state.activeSlug;
    state.transitionLoading = true;
    setBusy(state.busy);
    try {
      const payload = await api(`/api/process/${encodeURIComponent(requestedSlug)}/transition-targets`);
      if (requestedSlug !== state.activeSlug) return null;
      state.transitionData = payload;
      if (payload?.source?.meta_sha256) state.process.meta_sha256 = payload.source.meta_sha256;
      if (Array.isArray(payload?.transitions)) state.process.transitions = payload.transitions;
      return payload;
    } catch (error) {
      if (requestedSlug === state.activeSlug) {
        state.transitionData = {
          unsupported: error?.status === 404,
          error: readableError(error),
          transitions: state.process?.meta?.process_links || [],
          targets: { registered: [], reserved: [] }
        };
      }
      if (!quiet) throw error;
      return null;
    } finally {
      state.transitionLoading = false;
      setBusy(state.busy);
      if (render && requestedSlug === state.activeSlug) renderDetails();
    }
  }

  function isCallActivity(element) {
    return element?.businessObject?.$type === 'bpmn:CallActivity';
  }

  function isConvertibleTask(element) {
    const type = element?.businessObject?.$type || '';
    return type === 'bpmn:Task' || type.endsWith('Task');
  }

  function selectedElementName(element) {
    return String(element?.businessObject?.name || '').trim() || 'Вызов другого бизнес-процесса';
  }

  function closeTransitionPanel() {
    state.transitionRequest += 1;
    state.selectedTransitionElement = null;
    elements.transitionPanel.hidden = true;
    elements.transitionPanelError.hidden = true;
    elements.transitionConvert.hidden = true;
    elements.transitionForm.dataset.linkId = '';
    elements.transitionForm.dataset.reservedSlug = '';
  }

  function showTransitionPanelError(message) {
    elements.transitionPanelError.textContent = message;
    elements.transitionPanelError.hidden = !message;
  }

  function transitionForElement(element) {
    const sourceId = element?.businessObject?.id || element?.id;
    return transitionList().find((transition) => transition?.source_element_id === sourceId) || null;
  }

  function registeredTargetSlug(transition) {
    const open = transitionOpen(transition);
    if (open.kind === 'process' && open.slug) return open.slug;
    if (transition?.target_slug) return transition.target_slug;
    return registeredTransitionTargets().find((target) => target?.process_id === transition?.target_process_id)?.slug || '';
  }

  function reservedTargetInfo(transition) {
    const open = transitionOpen(transition);
    return reservedTransitionTargets().find((target) =>
      open.slug && target?.slug === open.slug
      || transition?.target_slug && target?.slug === transition.target_slug
      || transition?.target_process_id && target?.process_id === transition.target_process_id
      || transition?.target_ref && target?.target_ref === transition.target_ref
    ) || null;
  }

  function kindForTransition(transition) {
    if (!transition || transition.target_status === 'unresolved') return transition ? 'unknown' : 'registered';
    const open = transitionOpen(transition);
    if (open.kind === 'process' || transition.target_resolution === 'registered_bpmn') return 'registered';
    return 'reserved';
  }

  function populateRegisteredTargetSelect(selectedSlug = '') {
    const targets = registeredTransitionTargets();
    elements.registeredTarget.innerHTML = targets.map((target) => {
      const label = target?.title || 'Бизнес-процесс без названия';
      return `<option value="${escapeHtml(target.slug || '')}"${target.slug === selectedSlug ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    elements.registeredTarget.disabled = targets.length === 0;
    elements.registeredTargetEmpty.hidden = targets.length > 0;
    return targets.length;
  }

  function transitionFormKind() {
    return $('input[name="transition-kind"]:checked', elements.transitionForm)?.value || 'unknown';
  }

  function showTransitionKind(kind) {
    const choice = $(`input[name="transition-kind"][value="${kind}"]`, elements.transitionForm);
    if (choice) choice.checked = true;
    elements.registeredTargetFields.hidden = kind !== 'registered';
    elements.reservedTargetFields.hidden = kind !== 'reserved';
    elements.unknownTargetNote.hidden = kind !== 'unknown';
    elements.registeredTarget.required = kind === 'registered';
    elements.reservedTargetTitle.required = kind === 'reserved';
    elements.saveTransition.disabled = state.busy || state.transitionLoading || kind === 'registered' && elements.registeredTarget.disabled;
  }

  function defaultTransitionLabel(element) {
    return `Открыть процесс «${selectedElementName(element)}»`;
  }

  function renderTransitionForm(element) {
    if (!isCallActivity(element) || element !== state.selectedTransitionElement) return;
    elements.transitionLoading.hidden = true;
    if (state.transitionData?.unsupported) {
      elements.transitionForm.hidden = true;
      showTransitionPanelError('Локальный сервис не поддерживает настройку переходов. Перезапустите локальную студию.');
      return;
    }
    if (state.transitionData?.error && !state.transitionData?.source) {
      elements.transitionForm.hidden = true;
      showTransitionPanelError(state.transitionData.error);
      return;
    }

    const transition = transitionForElement(element);
    const registeredSlug = registeredTargetSlug(transition);
    const registeredCount = populateRegisteredTargetSelect(registeredSlug);
    let kind = kindForTransition(transition);
    if (!transition && kind === 'registered' && registeredCount === 0) kind = 'reserved';
    const reserved = reservedTargetInfo(transition);

    elements.transitionForm.dataset.linkId = transition?.link_id || '';
    elements.transitionForm.dataset.reservedSlug = reserved?.slug || transition?.target_slug || '';
    elements.transitionLabel.value = transition?.label || defaultTransitionLabel(element);
    elements.reservedTargetTitle.value = kind === 'reserved'
      ? (transition ? transitionTargetTitle(transition) : reserved?.title || '')
      : '';
    elements.deleteTransition.hidden = !transition;
    elements.transitionForm.hidden = false;
    showTransitionPanelError('');
    showTransitionKind(kind);
  }

  async function openTransitionPanel(element) {
    if ((!isCallActivity(element) && !isConvertibleTask(element)) || !state.process) return;
    state.selectedTransitionElement = element;
    const request = ++state.transitionRequest;
    elements.transitionPanel.hidden = false;
    elements.transitionSourceName.textContent = `Выбран блок: «${selectedElementName(element)}»`;
    elements.transitionForm.hidden = true;
    elements.transitionConvert.hidden = !isConvertibleTask(element);
    elements.transitionLoading.hidden = isConvertibleTask(element);
    showTransitionPanelError('');
    if (isConvertibleTask(element)) return;
    try {
      if (!state.transitionData || state.transitionData?.source?.slug !== state.activeSlug) {
        await loadTransitionData({ render: false });
      }
      if (request !== state.transitionRequest || element !== state.selectedTransitionElement) return;
      renderTransitionForm(element);
    } catch (error) {
      if (request !== state.transitionRequest) return;
      elements.transitionLoading.hidden = true;
      elements.transitionForm.hidden = true;
      showTransitionPanelError(readableError(error));
    }
  }

  function convertSelectedTaskToCallActivity() {
    const selected = state.selectedTransitionElement;
    if (!isConvertibleTask(selected)) return;
    try {
      const converted = state.modeler.get('bpmnReplace').replaceElement(selected, { type: 'bpmn:CallActivity' });
      if (!isCallActivity(converted)) throw new Error('Редактор не вернул блок вызова процесса.');
      state.selectedTransitionElement = converted;
      elements.transitionConvert.hidden = true;
      state.modeler.get('selection').select(converted);
      openTransitionPanel(converted);
      toast('Шаг преобразован', 'Теперь выберите, какой бизнес-процесс должен открываться дальше.');
    } catch (error) {
      showTransitionPanelError(`Не удалось преобразовать шаг. ${readableError(error)}`);
    }
  }

  function selectTransitionSource(sourceId) {
    switchTab('diagram-view');
    window.requestAnimationFrame(() => {
      const element = state.modeler?.get('elementRegistry').get(sourceId);
      if (!isCallActivity(element)) {
        toast('Блок перехода не найден', 'Обновите процесс и повторите действие.', 'warning');
        return;
      }
      state.modeler.get('selection').select(element);
      try { state.modeler.get('canvas').scrollToElement(element); } catch { /* выбранный блок уже виден после переключения */ }
    });
  }

  function validateTransitionForm() {
    const kind = transitionFormKind();
    const label = elements.transitionLabel.value.trim();
    elements.transitionLabel.setCustomValidity(/[А-ЯЁа-яё]/u.test(label) ? '' : 'Напишите понятное название перехода по-русски.');
    elements.reservedTargetTitle.setCustomValidity('');
    if (kind === 'registered' && !elements.registeredTarget.value) {
      elements.registeredTarget.setCustomValidity('Выберите готовый процесс из каталога.');
    } else {
      elements.registeredTarget.setCustomValidity('');
    }
    return elements.transitionForm.reportValidity();
  }

  function transitionTargetFromForm() {
    const kind = transitionFormKind();
    if (kind === 'registered') return { kind, slug: elements.registeredTarget.value };
    if (kind === 'reserved') {
      const target = { kind, title: elements.reservedTargetTitle.value.trim() };
      if (elements.transitionForm.dataset.reservedSlug) target.slug = elements.transitionForm.dataset.reservedSlug;
      return target;
    }
    return { kind: 'unknown' };
  }

  function transitionHashes() {
    const bpmnSha = state.sha256;
    const metaSha = state.process?.meta_sha256 || state.transitionData?.source?.meta_sha256;
    if (!bpmnSha || !metaSha) {
      throw new Error('Не удалось определить открытую версию схемы и карточки. Обновите процесс и повторите действие.');
    }
    return { bpmnSha, metaSha };
  }

  async function applyTransitionProcess(processData, sourceElementId) {
    if (!processData?.xml) throw new Error('Локальный сервис не вернул обновлённую BPMN-схему.');
    let oldViewbox = null;
    try { oldViewbox = state.modeler.get('canvas').viewbox(); } catch { /* схема ещё не открыта */ }
    state.importing = true;
    try {
      await state.modeler.importXML(processData.xml);
      state.process = processData;
      state.sha256 = processData.sha256 || processData.bpmn_sha256 || null;
      state.transitionData = null;
      setDirty(false);
      await loadBootstrap();
      await loadTransitionData({ render: false, quiet: true });
      renderProcessList();
      renderWorkspace();
      try {
        if (oldViewbox) state.modeler.get('canvas').viewbox(oldViewbox);
      } catch { fitDiagram(); }
    } finally {
      state.importing = false;
    }
    const element = state.modeler.get('elementRegistry').get(sourceElementId);
    if (isCallActivity(element)) state.modeler.get('selection').select(element);
    else closeTransitionPanel();
  }

  async function saveTransition(event) {
    event.preventDefault();
    const selected = state.selectedTransitionElement;
    if (!isCallActivity(selected) || !validateTransitionForm()) return;
    const originalButtonText = elements.saveTransition.textContent;
    setBusy(true);
    elements.saveTransition.textContent = 'Сохраняем…';
    showTransitionPanelError('');
    try {
      const { bpmnSha, metaSha } = transitionHashes();
      const xml = await currentXml();
      const sourceElementId = selected.businessObject.id;
      const linkId = elements.transitionForm.dataset.linkId;
      const path = linkId
        ? `/api/process/${encodeURIComponent(state.activeSlug)}/transitions/${encodeURIComponent(linkId)}`
        : `/api/process/${encodeURIComponent(state.activeSlug)}/transitions`;
      const payload = await api(path, {
        method: linkId ? 'PUT' : 'POST',
        body: JSON.stringify({
          expected_bpmn_sha256: bpmnSha,
          expected_meta_sha256: metaSha,
          xml,
          source_element_id: sourceElementId,
          relation: 'call',
          label: elements.transitionLabel.value.trim(),
          target: transitionTargetFromForm()
        })
      });
      await applyTransitionProcess(payload.process, sourceElementId);
      toast('Связь сохранена', payload.notice || 'Переход добавлен в BPMN-схему и карточку процесса.');
    } catch (error) {
      const message = readableError(error);
      showTransitionPanelError(message);
      toast('Связь не сохранена', message, 'error', 7600);
    } finally {
      elements.saveTransition.textContent = originalButtonText;
      setBusy(false);
    }
  }

  async function deleteTransition() {
    const linkId = elements.transitionForm.dataset.linkId;
    const selected = state.selectedTransitionElement;
    if (!linkId || !isCallActivity(selected)) return;
    if (!window.confirm('Удалить связь с другим процессом? Блок останется на BPMN-схеме как обычный шаг.')) return;
    const originalButtonText = elements.deleteTransition.textContent;
    setBusy(true);
    elements.deleteTransition.textContent = 'Удаляем…';
    showTransitionPanelError('');
    try {
      const { bpmnSha, metaSha } = transitionHashes();
      normalizeGeneratedIds();
      const sourceElementId = selected.businessObject.id;
      const commandStack = state.modeler.get('commandStack');
      let converted = null;
      let xml = null;
      state.transitionDeletePreparing = true;
      try {
        converted = state.modeler.get('bpmnReplace').replaceElement(selected, { type: 'bpmn:Task' });
        if (!isConvertibleTask(converted)) throw new Error('Редактор не вернул обычный шаг.');
        xml = await serializeCurrentXml();
      } finally {
        try {
          if (converted && commandStack.canUndo()) commandStack.undo();
        } finally {
          state.transitionDeletePreparing = false;
          state.selectedTransitionElement = state.modeler.get('elementRegistry').get(sourceElementId) || selected;
        }
      }
      const payload = await api(
        `/api/process/${encodeURIComponent(state.activeSlug)}/transitions/${encodeURIComponent(linkId)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            expected_bpmn_sha256: bpmnSha,
            expected_meta_sha256: metaSha,
            xml
          })
        }
      );
      await applyTransitionProcess(payload.process, sourceElementId);
      toast('Связь удалена', payload.notice || 'На схеме остался обычный шаг без межпроцессной связи.');
    } catch (error) {
      const message = readableError(error);
      showTransitionPanelError(message);
      toast('Связь не удалена', message, 'error', 7600);
    } finally {
      elements.deleteTransition.textContent = originalButtonText;
      setBusy(false);
    }
  }

  function attentionItems(process) {
    const items = [];
    const generated = process?.generated_id_issues || [];
    if (generated.length) items.push('У новых элементов есть временные внутренние имена. Сохраните схему — студия заменит их автоматически.');
    const links = process?.meta?.process_links || [];
    const unresolved = links.filter((link) => link.target_status === 'unresolved');
    if (unresolved.length) items.push(`Не определены переходы в другие процессы: ${unresolved.length}. Нужен ответ владельца.`);
    const candidates = links.filter((link) => link.target_status === 'candidate');
    if (candidates.length) items.push(`Связи-кандидаты требуют подтверждения владельца: ${candidates.length}.`);
    const supporting = process?.supporting;
    const processCard = supporting?.process_card;
    const questions = supporting?.questions;
    const blockingOpen = Number(questions?.counts?.blocking_open || 0);
    if (processCard?.available === false) items.push('Не найдена карточка процесса с понятным описанием для человека.');
    if (questions?.available === false) items.push('Не найден список вопросов владельцу процесса.');
    if (blockingOpen > 0) items.push(`Открыты блокирующие вопросы владельцу: ${blockingOpen}.`);
    if (!process?.meta?.review?.owner_role) items.push('Не указана роль владельца процесса.');
    if (process?.meta?.review?.human_decision === 'not_recorded') items.push('Решение владельца ещё не зафиксировано.');
    if (state.lastCheck && !state.lastCheck.passed) {
      for (const check of state.lastCheck.checks || []) {
        if (!check.passed) items.push(`${check.title}: проверка не пройдена. Подробности показаны ниже.`);
      }
      if (state.lastCheck.requestError) items.push('Техническая проверка не завершилась. Подробности показаны ниже.');
    }
    return [...new Set(items)];
  }

  function readiness(process) {
    const { technical, business } = statusParts(process);
    if (business === 'canonical' || technical === 'approved') return 100;
    if (technical === 'review-ready') return 78;
    if (technical === 'rework') return 55;
    if (technical === 'rejected') return 45;
    return state.lastCheck?.passed ? 62 : 38;
  }

  function factValue(...values) {
    return values.find((value) => typeof value === 'string' && value.trim()) || null;
  }

  function markdownText(value) {
    return String(value ?? '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/`{1,3}([^`]+)`{1,3}/gu, '$1')
      .replace(/\*\*([^*]+)\*\*/gu, '$1')
      .replace(/__([^_]+)__/gu, '$1')
      .replace(/~~([^~]+)~~/gu, '$1')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, '$1')
      .replace(/(?<!_)_([^_]+)_(?!_)/gu, '$1')
      .replace(/\\([\\`*_[\]{}()#+\-.!|>])/gu, '$1')
      .trim();
  }

  function tableCells(line) {
    return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map(markdownText);
  }

  function isTableDivider(line) {
    const cells = tableCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replace(/\s/gu, '')));
  }

  function appendMarkdown(container, markdown) {
    container.replaceChildren();
    const lines = String(markdown || '').replace(/\r\n?/gu, '\n').split('\n');
    let currentList = null;
    let currentListKind = null;

    const closeList = () => {
      currentList = null;
      currentListKind = null;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const line = rawLine.trim();
      if (!line) {
        closeList();
        continue;
      }

      if (line.includes('|') && isTableDivider(lines[index + 1] || '')) {
        closeList();
        const shell = document.createElement('div');
        shell.className = 'process-card-table-shell';
        const table = document.createElement('table');
        table.className = 'process-card-table';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (const value of tableCells(line)) {
          const cell = document.createElement('th');
          cell.scope = 'col';
          cell.textContent = value;
          headerRow.append(cell);
        }
        thead.append(headerRow);
        table.append(thead);
        const tbody = document.createElement('tbody');
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          const row = document.createElement('tr');
          for (const value of tableCells(lines[index])) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
          }
          tbody.append(row);
          index += 1;
        }
        table.append(tbody);
        shell.append(table);
        container.append(shell);
        index -= 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/u);
      if (heading) {
        closeList();
        const level = Math.min(6, 3 + heading[1].length);
        const node = document.createElement(`h${level}`);
        node.textContent = markdownText(heading[2]);
        container.append(node);
        continue;
      }

      const listItem = line.match(/^([-+*])\s+(.+)$/u) || line.match(/^\d+[.)]\s+(.+)$/u);
      if (listItem) {
        const ordered = /^\d/u.test(line);
        const kind = ordered ? 'ol' : 'ul';
        if (!currentList || currentListKind !== kind) {
          currentList = document.createElement(kind);
          currentListKind = kind;
          container.append(currentList);
        }
        const item = document.createElement('li');
        item.textContent = markdownText(listItem[2] || listItem[1]);
        currentList.append(item);
        continue;
      }

      closeList();
      if (/^>{1}\s?/u.test(line)) {
        const quote = document.createElement('blockquote');
        quote.textContent = markdownText(line.replace(/^>\s?/u, ''));
        container.append(quote);
        continue;
      }
      if (/^([-*_])(?:\s*\1){2,}$/u.test(line)) {
        container.append(document.createElement('hr'));
        continue;
      }
      const paragraph = document.createElement('p');
      paragraph.textContent = markdownText(line);
      container.append(paragraph);
    }
  }

  function supportingQuestionCounts(questions) {
    const items = Array.isArray(questions?.items) ? questions.items : [];
    const calculatedOpen = items.filter((item) => String(item?.status || '').toLowerCase() === 'open').length;
    const calculatedBlockingOpen = items.filter((item) => String(item?.status || '').toLowerCase() === 'open' && item?.blocking === true).length;
    const providedOpen = Number(questions?.counts?.open);
    const providedBlockingOpen = Number(questions?.counts?.blocking_open);
    return {
      open: Number.isFinite(providedOpen) && providedOpen >= 0 ? Math.trunc(providedOpen) : calculatedOpen,
      blockingOpen: Number.isFinite(providedBlockingOpen) && providedBlockingOpen >= 0
        ? Math.trunc(providedBlockingOpen)
        : calculatedBlockingOpen
    };
  }

  function questionStatus(value) {
    const technical = String(value || 'open').toLowerCase();
    if (technical === 'open') return { technical, label: 'Открыт', tone: 'open' };
    if ([ 'answered', 'resolved' ].includes(technical)) return { technical, label: 'Есть ответ', tone: 'answered' };
    if ([ 'closed', 'cancelled' ].includes(technical)) return { technical, label: 'Закрыт', tone: 'closed' };
    if (technical === 'deferred') return { technical, label: 'Отложен', tone: 'unknown' };
    return { technical, label: 'Статус не указан', tone: 'unknown' };
  }

  function questionAnswer(item) {
    const answer = item?.answer;
    if (typeof answer === 'string' && answer.trim()) return answer.trim();
    if (Array.isArray(answer)) {
      const parts = answer.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean);
      return parts.length ? parts.join('; ') : null;
    }
    if (answer && typeof answer === 'object') {
      return factValue(answer.text, answer.value, answer.answer, answer.decision, answer.content);
    }
    return factValue(item?.answer_text, item?.decision);
  }

  function renderProcessCard(process) {
    const card = process?.supporting?.process_card;
    const available = card?.available === true && typeof card?.markdown === 'string';
    elements.processCardContent.replaceChildren();
    elements.processCardContent.hidden = !available;
    elements.processCardMissing.hidden = available;
    elements.processCardContent.dataset.sha256 = available && card.sha256 ? String(card.sha256) : '';
    if (!available) return;
    appendMarkdown(elements.processCardContent, card.markdown);
    if (!elements.processCardContent.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'supporting-placeholder';
      empty.textContent = 'Карточка создана, но описание пока не заполнено.';
      elements.processCardContent.append(empty);
    }
  }

  function renderQuestions(process) {
    const questions = process?.supporting?.questions;
    const available = questions?.available === true && Array.isArray(questions?.items);
    const items = available ? questions.items : [];
    const counts = supportingQuestionCounts(questions);
    elements.questionsList.replaceChildren();
    elements.questionsList.hidden = !available || items.length === 0;
    elements.questionsEmpty.hidden = !available || items.length > 0;
    elements.questionsMissing.hidden = available;
    elements.questionsList.dataset.questionCount = String(items.length);
    elements.questionsList.dataset.openCount = String(counts.open);
    elements.questionsList.dataset.blockingOpenCount = String(counts.blockingOpen);

    elements.questionsSummaryCount.className = 'questions-summary-count';
    if (!available) {
      elements.questionsSummaryCount.textContent = 'Нет файла';
    } else if (counts.open > 0) {
      elements.questionsSummaryCount.textContent = `Открыто: ${counts.open}`;
      elements.questionsSummaryCount.classList.add('has-open');
    } else {
      elements.questionsSummaryCount.textContent = items.length ? 'Все закрыты' : 'Вопросов нет';
      elements.questionsSummaryCount.classList.add('is-complete');
    }

    elements.questionsCount.textContent = String(counts.open);
    elements.questionsCount.hidden = !available || counts.open === 0;
    elements.questionsCount.title = available ? `Открытых вопросов: ${counts.open}` : 'Список вопросов не найден';

    items.forEach((question, index) => {
      const status = questionStatus(question?.status);
      const blocking = question?.blocking === true;
      const answer = questionAnswer(question);
      const item = document.createElement('article');
      item.className = 'question-item';
      if (blocking && status.technical === 'open') item.classList.add('is-blocking-open');

      const heading = document.createElement('div');
      heading.className = 'question-item-heading';
      const titleWrap = document.createElement('div');
      titleWrap.className = 'question-title-wrap';
      const number = document.createElement('small');
      number.className = 'question-number';
      number.textContent = factValue(question?.question_id, question?.id) || `Вопрос ${index + 1}`;
      const title = document.createElement('h4');
      title.className = 'question-title';
      title.textContent = factValue(question?.title, question?.question, question?.text) || 'Текст вопроса не заполнен';
      titleWrap.append(number, title);

      const badges = document.createElement('div');
      badges.className = 'question-badges';
      const statusBadge = document.createElement('span');
      statusBadge.className = `question-status is-${status.tone}`;
      statusBadge.textContent = status.label;
      badges.append(statusBadge);
      if (blocking) {
        const blockingBadge = document.createElement('span');
        blockingBadge.className = 'question-blocking';
        blockingBadge.textContent = 'Блокирующий';
        badges.append(blockingBadge);
      }
      heading.append(titleWrap, badges);

      const answerBlock = document.createElement('div');
      answerBlock.className = `question-answer${answer ? '' : ' is-missing'}`;
      const answerLabel = document.createElement('strong');
      answerLabel.textContent = 'Ответ:';
      const answerText = document.createElement('span');
      answerText.textContent = answer || 'пока не зафиксирован';
      answerBlock.append(answerLabel, answerText);
      item.append(heading, answerBlock);
      elements.questionsList.append(item);
    });
  }

  function renderSupporting(process) {
    renderProcessCard(process);
    renderQuestions(process);
  }

  function renderDetails() {
    const process = state.process;
    if (!process) return;
    const status = statusParts(process);
    const percent = readiness(process);
    elements.detailsStatusTitle.textContent = shortStatus(process);
    elements.detailsStatusCopy.textContent = STATUS_COPY[status.technical] || 'Продолжайте описание и проверку процесса.';
    elements.readinessPercent.textContent = `${percent}%`;
    elements.readinessBar.style.width = `${percent}%`;

    const action = status.registered ? 'update' : 'register';
    elements.lifecycleAction.dataset.action = action;
    elements.lifecycleAction.textContent = action === 'register' ? 'Зарегистрировать процесс' : 'Обновить комплект процесса';
    elements.lifecycleNote.textContent = action === 'register'
      ? 'Сначала студия выполнит техническую проверку.'
      : 'Изменения пройдут тот же набор проверок.';

    renderSupporting(process);
    const attention = attentionItems(process);
    elements.attentionCount.textContent = String(attention.length);
    elements.attentionList.innerHTML = attention.map((item) => `<li><span aria-hidden="true">!</span><span>${escapeHtml(item)}</span></li>`).join('');
    elements.attentionList.hidden = attention.length === 0;
    elements.attentionEmpty.hidden = attention.length > 0;
    renderCheckReport();

    const meta = process.meta || {};
    const knownLinks = (meta.process_links || []).filter((link) => [ 'canonical', 'candidate' ].includes(link.target_status));
    const nextProcess = knownLinks.length
      ? knownLinks.map((link) => transitionTargetTitle(link)).join('; ')
      : (meta.process_links || []).length ? 'Есть связи, ожидающие подтверждения' : 'Не определён';
    const facts = [
      [ 'Назначение', factValue(meta.goal, meta.purpose, meta.description) || 'Смотрите карточку процесса' ],
      [ 'Вариант модели', meta.variant === 'to-be' ? 'Будущий процесс' : meta.variant === 'as-is' ? 'Текущий процесс' : 'Не указан' ],
      [ 'Владелец', meta.review?.owner_role || 'Не указан' ],
      [ 'Следующие процессы', nextProcess ],
      [ 'Стандарт файла', meta.bpmn?.standard || 'BPMN 2.0' ],
      [ 'Исполнение', meta.bpmn?.is_executable ? 'Исполняемая модель' : 'Нейтральная модель для согласования' ]
    ];
    elements.processFacts.innerHTML = facts.map(([ label, value ]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    renderTransitionsCard();

    $('#journey-check').classList.toggle('done', Boolean(state.lastCheck?.passed || ['review-ready', 'approved'].includes(status.technical)));
    $('#journey-owner').classList.toggle('done', status.business === 'canonical' || ['approved', 'rejected'].includes(status.technical));
    $('#journey-engine').classList.toggle('done', Boolean(meta.engine));
  }

  function confirmLifecycle() {
    const action = elements.lifecycleAction.dataset.action || 'register';
    const registering = action === 'register';
    elements.confirmDialog.dataset.action = action;
    elements.confirmTitle.textContent = registering ? 'Зарегистрировать процесс?' : 'Обновить комплект процесса?';
    elements.confirmCopy.textContent = registering
      ? 'Студия проверит BPMN-файл, карточку, вопросы и ссылки, затем добавит процесс в общий каталог.'
      : 'Студия повторно проверит комплект и обновит производные файлы каталога.';
    elements.confirmNote.textContent = 'Регистрация или обновление не означает бизнес-утверждение. Решение владельца фиксируется отдельно через npm run decision:owner в tools/bpmn.';
    elements.confirmSubmit.textContent = registering ? 'Проверить и зарегистрировать' : 'Проверить и обновить';
    elements.confirmDialog.showModal();
  }

  async function runLifecycle(action) {
    elements.confirmSubmit.disabled = true;
    elements.confirmSubmit.textContent = 'Выполняем проверку…';
    try {
      const result = await performAction(action);
      elements.confirmDialog.close();
      toast(
        action === 'register' ? 'Процесс зарегистрирован' : 'Комплект процесса обновлён',
        'Решение владельца фиксируется отдельно через npm run decision:owner в tools/bpmn.'
      );
      if (result?.process) renderDetails();
    } catch (error) {
      toast('Действие не выполнено', readableError(error), 'error', 7600);
    } finally {
      elements.confirmSubmit.disabled = false;
    }
  }

  function fitDiagram() {
    try {
      const canvas = state.modeler.get('canvas');
      canvas.zoom('fit-viewport');
      state.zoom = Number(canvas.zoom()) || 1;
    } catch { /* схема ещё не открыта */ }
  }

  function changeZoom(delta) {
    if (!state.process) return;
    try {
      const canvas = state.modeler.get('canvas');
      const current = Number(canvas.zoom()) || state.zoom;
      state.zoom = Math.min(4, Math.max(0.25, current + delta));
      canvas.zoom(state.zoom);
    } catch { /* схема ещё не открыта */ }
  }

  function selectionDescription(element) {
    const type = String(element?.businessObject?.$type || '');
    if (!type) return '';
    if (type.endsWith('StartEvent')) return 'Выбрано начало процесса. Перетащите его, чтобы изменить расположение.';
    if (type.endsWith('EndEvent')) return 'Выбрано завершение процесса. Название должно описывать результат.';
    if (type.includes('Gateway')) return 'Выбрана развилка. Сформулируйте вопрос и подпишите каждый исходящий путь.';
    if (type.endsWith('CallActivity')) return 'Выбран вызов другого бизнес-процесса. Связь должна быть подтверждена владельцем.';
    if (type.endsWith('Task') || type.endsWith('Activity')) return 'Выбрано действие. Назовите его по-русски; если работа продолжится в другом процессе, используйте подсказку справа.';
    if (type.endsWith('Participant') || type.endsWith('Lane')) return 'Выбрана роль или участник. Название должно быть понятно без сокращений.';
    if (type.endsWith('SequenceFlow')) return 'Выбрана стрелка перехода. После развилки обязательно подпишите условие.';
    return 'Элемент выбран. Используйте появившиеся рядом кнопки для продолжения или соединения.';
  }

  function initModeler() {
    if (typeof window.BpmnJS !== 'function') {
      toast('Редактор BPMN не загрузился', 'Перезапустите локальную студию.', 'error', 9000);
      return;
    }
    state.modeler = new window.BpmnJS({
      container: '#bpmn-canvas',
      additionalModules: [ { translate: [ 'value', translate ] } ]
    });
    const eventBus = state.modeler.get('eventBus');
    eventBus.on('commandStack.changed', () => {
      if (!state.importing && state.process) setDirty(true);
    });
    eventBus.on('selection.changed', (event) => {
      if (state.transitionDeletePreparing) return;
      const selected = event.newSelection?.[0];
      const description = selectionDescription(selected);
      elements.selectionHint.textContent = description;
      elements.selectionHint.hidden = !description;
      if (isManagedProcess() && (isCallActivity(selected) || isConvertibleTask(selected))) openTransitionPanel(selected);
      else closeTransitionPanel();
    });
  }

  function downloadBpmn() {
    if (!state.process) return;
    currentXml().then((xml) => {
      const readableName = isLocalFile() ? state.fileName : `${state.process.title || 'Бизнес-процесс'}.bpmn`;
      downloadXml(xml, readableName);
    }).catch((error) => toast('Файл не скачан', readableError(error), 'error'));
  }

  function openHelp() {
    elements.helpPanel.hidden = false;
    elements.backdrop.hidden = false;
    elements.helpButton.setAttribute('aria-expanded', 'true');
    elements.helpClose.focus();
  }

  function closeHelp() {
    elements.helpPanel.hidden = true;
    elements.backdrop.hidden = true;
    elements.helpButton.setAttribute('aria-expanded', 'false');
    elements.helpButton.focus();
  }

  function setAdvancedOpen(value) {
    state.advancedOpen = Boolean(value);
    elements.appShell.classList.toggle('advanced-open', state.advancedOpen);
    elements.advancedToggle.setAttribute('aria-pressed', String(state.advancedOpen));
    elements.advancedToggle.textContent = state.advancedOpen
      ? 'Скрыть процессы проекта'
      : 'Показать процессы проекта';
    if (!state.advancedOpen && state.activeTab !== 'diagram-view') switchTab('diagram-view');
    window.requestAnimationFrame(() => {
      try { state.modeler?.get('canvas').resized(); } catch { /* схема ещё не открыта */ }
    });
  }

  async function discardCurrentChanges() {
    elements.actionMenu.hidden = true;
    elements.more.setAttribute('aria-expanded', 'false');
    if (!state.process || !state.dirty || !window.confirm('Отменить все несохранённые изменения на схеме?')) return;
    if (isLocalFile()) {
      await openLocalXml(state.fileOriginalXml || STARTER_BPMN_XML, {
        fileName: state.fileName,
        fileHandle: state.fileHandle,
        dirty: false,
        force: true
      });
      toast('Несохранённые изменения отменены');
      return;
    }
    const slug = state.activeSlug;
    state.process = null;
    state.activeSlug = null;
    await selectProcess(slug, { force: true });
  }

  function bindEvents() {
    elements.search.addEventListener('input', renderProcessList);
    elements.refresh.addEventListener('click', async () => {
      try {
        await loadBootstrap();
        await loadTransitionData({ render: false, quiet: true });
        renderWorkspace();
        toast('Список обновлён');
      } catch (error) {
        toast('Список не обновлён', readableError(error), 'error');
      }
    });
    elements.create.addEventListener('click', openCreateDialog);
    [ elements.newFile, elements.welcomeCreate ].forEach((button) => button.addEventListener('click', createLocalDiagram));
    [ elements.openFile, elements.welcomeOpen ].forEach((button) => button.addEventListener('click', triggerFileOpen));
    elements.openFileInput.addEventListener('change', () => {
      const [ file ] = Array.from(elements.openFileInput.files || []);
      if (file) openLocalFile(file).catch((error) => toast('BPMN-файл не открыт', readableError(error), 'error'));
    });
    elements.createForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const title = elements.processName.value.trim();
      if (elements.createForm.reportValidity()) createProcess(title);
    });
    elements.processName.addEventListener('input', () => elements.processName.setCustomValidity(''));
    elements.transitionPanelClose.addEventListener('click', closeTransitionPanel);
    elements.convertToCallActivity.addEventListener('click', convertSelectedTaskToCallActivity);
    elements.futureProcessCreate.addEventListener('click', () => {
      createReservedProcess(elements.futureProcessDialog.dataset.linkId);
    });
    $$('input[name="transition-kind"]', elements.transitionForm).forEach((input) => {
      input.addEventListener('change', () => showTransitionKind(transitionFormKind()));
    });
    elements.transitionLabel.addEventListener('input', () => elements.transitionLabel.setCustomValidity(''));
    elements.reservedTargetTitle.addEventListener('input', () => elements.reservedTargetTitle.setCustomValidity(''));
    elements.registeredTarget.addEventListener('change', () => elements.registeredTarget.setCustomValidity(''));
    elements.transitionForm.addEventListener('submit', saveTransition);
    elements.deleteTransition.addEventListener('click', deleteTransition);
    $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
    elements.save.addEventListener('click', () => saveCurrent().catch(() => {}));
    elements.saveAs.addEventListener('click', () => saveCurrentAs());
    elements.check.addEventListener('click', checkProcess);
    elements.reload.addEventListener('click', () => discardCurrentChanges().catch((error) => {
      toast('Изменения не отменены', readableError(error), 'error');
    }));
    elements.download.addEventListener('click', () => {
      elements.actionMenu.hidden = true;
      downloadBpmn();
    });
    elements.more.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = elements.actionMenu.hidden;
      elements.actionMenu.hidden = !open;
      elements.more.setAttribute('aria-expanded', String(open));
    });
    elements.advancedToggle.addEventListener('click', () => {
      setAdvancedOpen(!state.advancedOpen);
      elements.actionMenu.hidden = true;
      elements.more.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', (event) => {
      if (!elements.actionMenu.hidden && !elements.actionMenu.contains(event.target) && event.target !== elements.more) {
        elements.actionMenu.hidden = true;
        elements.more.setAttribute('aria-expanded', 'false');
      }
    });
    $$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    $('.tabs').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const tabs = $$('.tab:not(:disabled)');
      const current = tabs.indexOf(document.activeElement);
      const shift = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(current + shift + tabs.length) % tabs.length];
      next?.focus();
      if (next) switchTab(next.dataset.tab);
      event.preventDefault();
    });
    elements.buildMap.addEventListener('click', () => buildOrOpenMap());
    elements.rebuildMap.addEventListener('click', () => buildOrOpenMap());
    elements.openMap.addEventListener('click', () => buildOrOpenMap({ separate: true }));
    elements.lifecycleAction.addEventListener('click', confirmLifecycle);
    elements.confirmForm.addEventListener('submit', (event) => {
      event.preventDefault();
      runLifecycle(elements.confirmDialog.dataset.action || 'register');
    });
    elements.helpButton.addEventListener('click', openHelp);
    elements.helpClose.addEventListener('click', closeHelp);
    elements.backdrop.addEventListener('click', closeHelp);
    elements.guideClose.addEventListener('click', () => {
      elements.guide.hidden = true;
      window.localStorage.setItem('bpmn-studio-guide-hidden', 'true');
      try { state.modeler?.get('canvas').resized(); } catch { /* схема ещё не открыта */ }
    });
    $('#zoom-out').addEventListener('click', () => changeZoom(-0.15));
    $('#zoom-in').addEventListener('click', () => changeZoom(0.15));
    $('#zoom-reset').addEventListener('click', fitDiagram);
    let fileDragDepth = 0;
    document.addEventListener('dragenter', (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault();
      fileDragDepth += 1;
      elements.fileDropOverlay.hidden = false;
    });
    document.addEventListener('dragover', (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('dragleave', () => {
      if (elements.fileDropOverlay.hidden) return;
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (!fileDragDepth) elements.fileDropOverlay.hidden = true;
    });
    document.addEventListener('drop', (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault();
      fileDragDepth = 0;
      elements.fileDropOverlay.hidden = true;
      const file = Array.from(event.dataTransfer?.files || []).find((item) => /\.bpmn$/iu.test(item.name))
        || Array.from(event.dataTransfer?.files || [])[0];
      if (file) openLocalFile(file).catch((error) => toast('BPMN-файл не открыт', readableError(error), 'error'));
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        if (state.process && !state.busy) {
          const operation = event.shiftKey ? saveCurrentAs() : state.dirty ? saveCurrent() : null;
          operation?.catch?.(() => {});
        }
      }
      if (event.key === 'Escape' && !elements.transitionPanel.hidden) closeTransitionPanel();
      else if (event.key === 'Escape' && !elements.helpPanel.hidden) closeHelp();
    });
    window.addEventListener('beforeunload', (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  async function start() {
    initModeler();
    bindEvents();
    setAdvancedOpen(false);
    renderWorkspace();
    elements.guide.hidden = window.localStorage.getItem('bpmn-studio-guide-hidden') === 'true';
    if (!state.modeler) return;
    try {
      await loadBootstrap({ keepSelection: false });
      renderWorkspace();
      const automaticManagedPreview = query.get('studio-self-test') === '1'
        || query.get('studio-transition-preview') === '1'
        || query.get('studio-details-preview') === '1';
      if (automaticManagedPreview) {
        setAdvancedOpen(true);
        const requested = query.get('process');
        const remembered = window.localStorage.getItem('bpmn-studio-last-process');
        const initial = state.processes.find((process) => processSlug(process) === requested)
          || state.processes.find((process) => processSlug(process) === remembered)
          || state.processes[0];
        if (initial) await selectProcess(processSlug(initial), { force: true });
      }
    } catch (error) {
      toast('Студия не подключилась к локальному сервису', readableError(error), 'error', 9000);
    }
  }

  start();
})();
