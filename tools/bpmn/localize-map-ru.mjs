import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const target = resolve(process.argv[2] || '../../processes/skupka-zolota/map/process-map.html');
let html = readFileSync(target, 'utf8');

// Archify generates a self-contained interactive viewer. This deterministic
// postprocessor keeps its behavior intact and replaces only reader-facing text.
const replacements = [
  [ 'content: "SIGNAL FLOW"', 'content: "ПОТОК"' ],
  [ 'content: "BLUEPRINT / REV 01"', 'content: "ЧЕРТЁЖ / ВЕРСИЯ 01"' ],
  [ 'content: "EDITORIAL / FIELD NOTE"', 'content: "ПУБЛИКАЦИЯ / РАБОЧАЯ ЗАМЕТКА"' ],
  [ 'content: "ARCHIFY / PLATE 04"', 'content: "СХЕМА / ЛИСТ 04"' ],
  [ 'aria-label="Focus ', 'aria-label="Выбрать: ' ],
  [ 'aria-label="Clear route probe"', 'aria-label="Очистить поиск маршрута"' ],
  [ 'title="Close"', 'title="Закрыть"' ],
  [ 'Trace a route before exporting a Route Share Card', 'Сначала постройте маршрут, затем экспортируйте его карточку' ],
  [ 'Trace route before exporting a Route Share Card', 'Сначала постройте маршрут, затем экспортируйте его карточку' ],
  [ 'Проследить маршрут before exporting a Route Share Card', 'Сначала постройте маршрут, затем экспортируйте его карточку' ],
  [ 'Trace authored reach before exporting a Reach Share Card', 'Сначала покажите связанные элементы, затем экспортируйте их карточку' ],
  [ 'Clipboard image write not supported in this browser.', 'Браузер не поддерживает запись изображения в буфер обмена.' ],
  [ 'Live preview enabled · yielding to ', 'Анимация включена · управление у режима: ' ],
  [ 'Automatic journey requires Live motion', 'Для автоматического показа маршрута включите анимацию' ],
  [ 'Relationship Preview', 'Просмотр связи' ],
  [ 'Intent Trace', 'Просмотр переходов' ],
  [ 'Open chapter ', 'Открыть раздел ' ],
  [ '. Chapter focus delta: ', '. Изменение состава раздела: ' ],
  [ 'Grouped transition · no direct authored link', 'Сгруппированный переход · прямой связи нет' ],
  [ 'through one authored forward relationship.', 'через одну заданную связь вперёд.' ],
  [ '; the authored relationship points from ', '; заданная связь направлена от ' ],
  [ 'authored relationships; shown without arbitrary motion.', 'заданных связей; показано без искусственного движения.' ],
  [ 'with no direct authored relationship.', 'без прямой заданной связи.' ],
  [ 'Authored starting point', 'Заданная начальная точка' ],
  [ 'authored direction: ', 'направление связи: ' ],
  [ 'Play guided story (P)', 'Показать маршрут по шагам (P)' ],
  [ 'Play guided story', 'Показать маршрут по шагам' ],
  [ 'Full diagram detail', 'Все подробности схемы' ],
  [ 'reset view (0)', 'исходный вид (0)' ],
  [ 'from Semantic Radar', 'на мини-карте' ],
  [ 'from Мини-карта', 'на мини-карте' ],
  [ 'shortest authored route', 'кратчайший заданный маршрут' ],
  [ 'Pick a highlighted destination.', 'Выберите подсвеченный конечный элемент.' ],
  [ 'available. Pick a highlighted node.', 'доступно. Выберите подсвеченный элемент.' ],
  [ 'Inspect relationship ', 'Просмотреть связь ' ],
  [ '. Press Enter for details.', '. Нажмите Enter, чтобы открыть подробности.' ],
  [ 'Self loops', 'Возвраты к тому же элементу' ],
  [ 'loops back', 'возвращается к' ],
  [ 'connects to', 'ведёт к' ],
  [ 'connects from', 'приходит от' ],
  [ 'Grouped from ', 'Сгруппировано от ' ],
  [ 'Destination from ', 'Конец маршрута от ' ],
  [ 'message bus', 'обмен сообщениями' ],
  [ "'the guided story'", "'пошаговый показ'" ],
  [ "'the active chapter'", "'текущий раздел'" ],
  [ "'the chapter delta preview'", "'предпросмотр изменений раздела'" ],
  [ "'the chapter handoff'", "'переход между разделами'" ],
  [ "'semantic focus'", "'выбранный элемент'" ],
  [ "'legend preview'", "'предпросмотр легенды'" ],
  [ "'reader interaction'", "'действие пользователя'" ],
  [ "' verified source'", "' подтверждённый источник'" ],
  [ "'; focus this node to inspect'", "'; выберите элемент для просмотра'" ],
  [ "'SRC '", "'ИСТОЧНИК '" ],
  [ "' verified source reference'", "' ссылка на подтверждённый источник'" ],
  [ "' upstream authored node'", "' предыдущий элемент'" ],
  [ "' downstream authored node'", "' следующий элемент'" ],
  [ "' at revision '", "', версия '" ],
  [ "' relation'", "' связь'" ],
  [ "' connected relationship'", "' связанную связь'" ],
  [ "' outgoing · '", "' исходящая · '" ],
  [ "' incoming'", "' входящая'" ],
  [ "' loop'", "' цикл'" ],
  [ "' selected nodes'", "' выбранных элементов'" ],
  [ "' outgoing, '", "' исходящая, '" ],
  [ "' self loop'", "' возврат к себе'" ],
  [ "' connection'", "' связь'" ],
  [ "' stops'", "' шагов'" ],
  [ "' — current chapter, '", "' — текущий раздел, '" ],
  [ "' stay, '", "' без изменений, '" ],
  [ "' enter, '", "' добавлено, '" ],
  [ "' leave'", "' скрыто'" ],
  [ "' chapter focus'", "' состав раздела'" ],
  [ "'Step '", "'Шаг '" ],
  [ "' · Static moment'", "' · статичный кадр'" ],
  [ "' steps complete · '", "' шагов завершено · '" ],
  [ "' steps · Static path'", "' шагов · статичный маршрут'" ],
  [ "' steps · Ready'", "' шагов · готово'" ],
  [ "' chapter '", "' раздел '" ],
  [ "'Beat '", "'Этап '" ],
  [ "'\u00b7 starting point'", "'\u00b7 начальная точка'" ],
  [ "'\u00b7 reverse authored link'", "'\u00b7 обратная заданная связь'" ],
  [ "' authored links'", "' заданных связей'" ],
  [ "'\u00b7 grouped \u00b7 no direct link'", "'\u00b7 группа \u00b7 прямой связи нет'" ],
  [ "'From '", "'От '" ],
  [ "' through '", "' через '" ],
  [ "' authored relationships'", "' заданных связей'" ],
  [ "' more'", "' ещё'" ],
  [ "' beats'", "' этапов'" ],
  [ "'AUTO '", "'АВТО '" ],
  [ "'Focus '", "'Выбрать: '" ],
  [ "' nodes · full map'", "' элементов · вся схема'" ],
  [ "'full map'", "'вся схема'" ],
  [ "'% width'", "'% ширины'" ],
  [ "'% viewport'", "'% окна'" ],
  [ "' nodes · '", "' элементов · '" ],
  [ "' directed hops'", "' направленных переходов'" ],
  [ "'Route: '", "'Маршрут: '" ],
  [ "'Authored '", "'Заданное: '" ],
  [ "' from '", "' от '" ],
  [ "' links · max '", "' связей · глубина '" ],
  [ "' hops'", "' переходов'" ],
  [ "'ARCHIFY · ROUTE · '", "'СХЕМА · МАРШРУТ · '" ],
  [ "'ARCHIFY · '", "'СХЕМА · '" ],
  [ "'HOPS'", "'ПЕРЕХОДОВ'" ],
  [ "'REACH'", "'СВЯЗИ'" ],
  [ "'Share Card'", "'Карточка схемы'" ],
  [ "' nodes'", "' элементов'" ],
  [ "' route sources'", "' начальных элементов маршрута'" ],
  [ "' reachable destinations'", "' доступных конечных элементов'" ],
  [ "' hop'", "' переход'" ],
  [ "' directed destination'", "' доступный конечный элемент'" ],
  [ "' to '", "' → '" ],
  [ "' is not reachable from '", "' недоступен из '" ],
  [ "' node'", "' элемент'" ],
  [ "' direct relationship'", "' прямая связь'" ],
  [ "' touching relationship'", "' связанная связь'" ],
  [ "' · connected peers remain visible'", "' · связанные элементы остаются видимыми'" ],
  [ "'Inspect '", "'Просмотреть: '" ],
  [ "'Show '", "'Показать '" ],
  [ "'Choose '", "'Выбрать: '" ],
  [ "' as route start'", "' как начало маршрута'" ],
  [ "' as route destination, '", "' как конец маршрута, '" ],
  [ "' related connection'", "' связанная связь'" ],
  [ "'nodes'", "'элементов'" ],
  [ "'route sources'", "'начальных элементов маршрута'" ],
  [ "'reachable destinations'", "'доступных конечных элементов'" ],
  [ "' of '", "' из '" ],
  [ "'Playing'", "'Показ'" ],
  [ "'Complete'", "'Завершено'" ],
  [ "'Inspecting'", "'Просмотр'" ],
  [ "'Settled'", "'Завершено'" ],
  [ "'Paused'", "'Пауза'" ],
  [ "'Pinned'", "'Закреплено'" ],
  [ 'Search labels, responsibilities, kinds, and stable IDs.', 'Ищите по названию, роли, типу или смысловому идентификатору.' ],
  [ 'Ask how two semantic nodes connect in authored direction.', 'Покажите путь между двумя элементами в заданном направлении.' ],
  [ 'Open Semantic Radar with a live viewport and stable nodes.', 'Откройте мини-карту и быстро перейдите к нужному элементу.' ],
  [ 'Count roles, reveal their traffic, and compare direct authored links.', 'Сравните роли и прямые связи между элементами.' ],
  [ 'Walk the authored chapters and real relationships.', 'Пройдите подготовленные разделы и подтверждённые связи.' ],
  [ 'Give the live diagram the viewport without changing export.', 'Разверните схему для показа без изменения исходного файла.' ],
  [ 'Choose up to two semantic kinds. One reveals its real traffic; two compare only direct authored relationships.', 'Выберите один или два типа элементов. Один показывает все его связи, два — только прямые связи между ними.' ],
  [ 'Diagram overview. Click a node to focus it, or use arrow keys to pan.', 'Обзор схемы. Нажмите на элемент, чтобы перейти к нему, или используйте стрелки для перемещения.' ],
  [ 'Use arrow keys to explore relationships. Press Enter or Space to pin details; Escape clears.', 'Используйте стрелки для просмотра связей. Enter или пробел закрепляет карточку, Escape закрывает её.' ],
  [ 'Choose the source, then the destination. Direction matters.', 'Сначала выберите начало, затем конец маршрута. Направление важно.' ],
  [ 'Choose a kind to inspect its nodes and touching relationships.', 'Выберите тип, чтобы увидеть его элементы и связи.' ],
  [ 'No outgoing route starts here. Clear and choose another source.', 'Отсюда нет исходящего маршрута. Очистите выбор и укажите другое начало.' ],
  [ 'A route needs two distinct semantic nodes.', 'Для маршрута нужны два разных элемента.' ],
  [ 'Pick two semantic nodes on the diagram', 'Выберите на схеме два элемента' ],
  [ 'Pick a semantic node on the diagram', 'Выберите элемент на схеме' ],
  [ 'Select the source. The next step will reveal only directed destinations.', 'Выберите начало. Затем будут показаны только доступные направления.' ],
  [ 'Search reachable destinations', 'Искать доступные конечные элементы' ],
  [ 'No matching reachable destinations', 'Подходящие конечные элементы не найдены' ],
  [ 'Reachable route destinations', 'Доступные конечные элементы' ],
  [ 'Find a reachable route destination', 'Найти доступный конец маршрута' ],
  [ 'Search route sources', 'Искать начальные элементы' ],
  [ 'No matching route sources', 'Подходящие начальные элементы не найдены' ],
  [ 'Nodes that can start a route', 'Элементы, с которых можно начать маршрут' ],
  [ 'Choose a different destination', 'Выберите другой конечный элемент' ],
  [ 'Choose a destination from ', 'Выберите конечный элемент из ' ],
  [ 'Choose route start', 'Выберите начало маршрута' ],
  [ 'Choose a start node', 'Выберите начальный элемент' ],
  [ 'Trace authored reachability', 'Показать доступные связи' ],
  [ 'Trace upstream authored reachability', 'Показать предыдущие элементы' ],
  [ 'Trace downstream authored reachability', 'Показать следующие элементы' ],
  [ 'No upstream authored nodes', 'Предыдущих элементов нет' ],
  [ 'No downstream authored nodes', 'Следующих элементов нет' ],
  [ 'Verified source evidence', 'Подтверждающие источники' ],
  [ 'Open verified repository revision ', 'Открыть подтверждённую версию в репозитории ' ],
  [ 'Open verified source ', 'Открыть подтверждённый источник ' ],
  [ 'Verified source', 'Проверенный источник' ],
  [ 'Close semantic passport', 'Закрыть карточку элемента' ],
  [ 'Copy link to focused node', 'Скопировать ссылку на выбранный элемент' ],
  [ 'Copy link to pinned relationship', 'Скопировать ссылку на выбранную связь' ],
  [ 'Show connected relationships', 'Показать связанные переходы' ],
  [ 'Hide connected relationships', 'Скрыть связанные переходы' ],
  [ 'Connected relationships', 'Связанные переходы' ],
  [ 'No connected relationships', 'Связанных переходов нет' ],
  [ 'Pinned relationship link copied', 'Ссылка на выбранную связь скопирована' ],
  [ 'Focused node link copied', 'Ссылка на выбранный элемент скопирована' ],
  [ 'Could not copy pinned relationship link', 'Не удалось скопировать ссылку на выбранную связь' ],
  [ 'Could not copy focused node link', 'Не удалось скопировать ссылку на выбранный элемент' ],
  [ 'Pinned relationship · ', 'Выбранная связь · ' ],
  [ 'Reverse authored relationship', 'Обратное направление связи' ],
  [ 'Authored relationship', 'Заданная связь' ],
  [ 'Direct relationship explorer', 'Просмотр прямых связей' ],
  [ 'Node metadata', 'Свойства элемента' ],
  [ 'Semantic passport', 'Карточка элемента' ],
  [ 'Authored reach', 'Связи элемента' ],
  [ 'Copy relation', 'Копировать связь' ],
  [ 'Copy node', 'Копировать элемент' ],
  [ 'Copy link to source node', 'Скопировать ссылку на исходный элемент' ],
  [ 'Copy link to traced route', 'Скопировать ссылку на найденный маршрут' ],
  [ 'Traced route link copied', 'Ссылка на маршрут скопирована' ],
  [ 'Could not copy traced route link', 'Не удалось скопировать ссылку на маршрут' ],
  [ 'Clear traced route', 'Очистить найденный маршрут' ],
  [ 'Previous route position', 'Предыдущий шаг маршрута' ],
  [ 'Next route position', 'Следующий шаг маршрута' ],
  [ 'Show complete route overview', 'Показать весь маршрут' ],
  [ 'Pause route journey', 'Приостановить показ маршрута' ],
  [ 'Play route journey', 'Показать маршрут по шагам' ],
  [ 'Replay route journey', 'Повторить показ маршрута' ],
  [ 'Traced route', 'Найденный маршрут' ],
  [ 'Route journey controls', 'Управление показом маршрута' ],
  [ 'Find a route start', 'Найти начало маршрута' ],
  [ 'Find start', 'Найти начало' ],
  [ 'Find target', 'Найти конец' ],
  [ 'Route probe', 'Поиск маршрута' ],
  [ 'Route Probe', 'Поиск маршрута' ],
  [ 'Trace a directed route', 'Проследить направленный маршрут' ],
  [ 'Trace route', 'Проследить маршрут' ],
  [ 'Trace a route', 'Проследить маршрут' ],
  [ 'Route position ', 'Шаг маршрута ' ],
  [ 'No directed route to ', 'Нет направленного маршрута к ' ],
  [ 'Path settled for reading.', 'Маршрут показан для чтения.' ],
  [ 'Starting point.', 'Начальная точка.' ],
  [ 'Starting point', 'Начальная точка' ],
  [ 'Compare system roles', 'Сравнить типы элементов' ],
  [ 'Compare semantic kinds', 'Сравнить типы элементов' ],
  [ 'Semantic kinds', 'Типы элементов' ],
  [ 'Clear semantic lens', 'Очистить сравнение типов' ],
  [ 'Copy link to semantic lens', 'Скопировать ссылку на сравнение типов' ],
  [ 'Open active semantic lens', 'Открыть выбранное сравнение типов' ],
  [ 'Open semantic lens', 'Открыть сравнение типов' ],
  [ 'Close semantic lens', 'Закрыть сравнение типов' ],
  [ 'Semantic legend', 'Легенда типов' ],
  [ 'Semantic lens', 'Сравнение типов' ],
  [ 'Semantic Lens', 'Сравнение типов' ],
  [ 'Semantic camera active · ', 'Выбранный фрагмент схемы · ' ],
  [ 'Open semantic radar', 'Открыть мини-карту' ],
  [ 'Close semantic radar', 'Закрыть мини-карту' ],
  [ 'Semantic diagram radar nodes', 'Элементы мини-карты' ],
  [ 'Semantic radar', 'Мини-карта' ],
  [ 'Semantic Radar', 'Мини-карта' ],
  [ 'Building overview', 'Строится обзор' ],
  [ 'Click node', 'Нажмите на элемент' ],
  [ 'Drag to pan', 'Перетащите для перемещения' ],
  [ 'Diagram view controls', 'Управление схемой' ],
  [ 'Reset diagram view', 'Вернуть исходный вид схемы' ],
  [ 'Reset view', 'Исходный вид' ],
  [ 'Zoom in again to reveal tags and annotations', 'Увеличьте ещё раз, чтобы увидеть пометки и пояснения' ],
  [ 'Zoom in to reveal relationship labels and node context', 'Увеличьте, чтобы увидеть подписи связей и пояснения' ],
  [ 'Zoom in', 'Увеличить' ],
  [ 'Zoom out', 'Уменьшить' ],
  [ 'Find any node', 'Найти элемент' ],
  [ 'Find a node', 'Найти элемент' ],
  [ 'Search labels or IDs', 'Поиск по названию или идентификатору' ],
  [ 'Search diagram nodes', 'Искать элементы схемы' ],
  [ 'Diagram nodes', 'Элементы схемы' ],
  [ 'No matching nodes', 'Ничего не найдено' ],
  [ 'Close node finder', 'Закрыть поиск элементов' ],
  [ 'Open diagram guide', 'Открыть помощь по схеме' ],
  [ 'Close diagram guide', 'Закрыть помощь по схеме' ],
  [ 'Diagram exploration actions', 'Действия для изучения схемы' ],
  [ 'Diagram guide', 'Помощь по схеме' ],
  [ 'Inspecting compiled semantics', 'Считаем элементы и связи' ],
  [ 'See the whole system', 'Показать всю схему' ],
  [ 'Play the guided story', 'Показать маршрут по шагам' ],
  [ 'Pause guided story', 'Приостановить пошаговый показ' ],
  [ 'Replay guided story', 'Повторить пошаговый показ' ],
  [ 'No authored guided story in this diagram.', 'Для этой схемы не подготовлен пошаговый показ.' ],
  [ 'This diagram has no authored guided story.', 'Для этой схемы не подготовлен пошаговый показ.' ],
  [ 'Story playback unavailable while motion is Still', 'Пошаговый показ недоступен, пока анимация выключена' ],
  [ 'Switch motion to Live to play the guided story', 'Включите анимацию, чтобы запустить пошаговый показ' ],
  [ 'Select a Story Beat to copy its exact link', 'Выберите шаг, чтобы скопировать точную ссылку' ],
  [ 'Copy link to current story moment: Beat ', 'Скопировать ссылку на текущий шаг: ' ],
  [ 'Could not copy story moment link', 'Не удалось скопировать ссылку на шаг' ],
  [ 'Moment link copied', 'Ссылка на шаг скопирована' ],
  [ 'Copy moment', 'Копировать шаг' ],
  [ 'Enter Presentation Stage', 'Включить режим показа' ],
  [ 'Enter presentation stage', 'Включить режим показа' ],
  [ 'Exit presentation stage (F or Escape)', 'Выйти из режима показа (F или Escape)' ],
  [ 'Exit presentation stage', 'Выйти из режима показа' ],
  [ 'Presentation stage (F)', 'Режим показа (F)' ],
  [ 'Additional keyboard shortcuts', 'Дополнительные сочетания клавиш' ],
  [ 'Guided chapter', 'Раздел маршрута' ],
  [ 'Current chapter ', 'Текущий раздел ' ],
  [ 'Story beat ', 'Шаг маршрута ' ],
  [ 'Story trail for ', 'Пошаговый маршрут для ' ],
  [ 'Chapter 01 / 01', 'Раздел 01 / 01' ],
  [ "'Chapter '", "'Раздел '" ],
  [ 'Visual style: ', 'Стиль оформления: ' ],
  [ '. Choose visual style', '. Выбрать стиль оформления' ],
  [ 'Choose visual style (S cycles)', 'Выбрать стиль оформления (S — следующий)' ],
  [ 'Motion paused by reduced-motion preference', 'Анимация отключена настройками системы' ],
  [ 'Motion paused while this page is hidden', 'Анимация приостановлена, пока страница скрыта' ],
  [ 'Pause motion; currently yielding to ', 'Приостановить анимацию; сейчас управление у режима: ' ],
  [ 'Pause motion', 'Приостановить анимацию' ],
  [ 'Resume motion', 'Возобновить анимацию' ],
  [ 'Recording 6 seconds of motion…', 'Записываем 6 секунд анимации…' ],
  [ 'Motion capture unavailable in this browser', 'Запись анимации недоступна в этом браузере' ],
  [ 'Open ↗', 'Открыть ↗' ],
  [ 'Copy failed', 'Не удалось скопировать' ],
  [ 'Copied', 'Скопировано' ],
  [ 'Export failed: ', 'Ошибка экспорта: ' ],
  [ 'Not supported by this browser', 'Не поддерживается этим браузером' ],
  [ 'Clipboard image write not supported by this browser.', 'Браузер не поддерживает копирование изображения в буфер.' ],
  [ 'Clipboard image write not supported by this browser', 'Браузер не поддерживает копирование изображения в буфер' ],
  [ 'Downloaded Share Card', 'Карточка схемы сохранена' ],
  [ 'Downloaded Route Share Card', 'Карточка маршрута сохранена' ],
  [ 'Downloaded Reach Share Card', 'Карточка связей сохранена' ],
  [ 'Downloaded WebM', 'Видео WebM сохранено' ],
  [ 'Copied Share Card', 'Карточка схемы скопирована' ],
  [ 'Share Card export could not remove temporary viewer state', 'Не удалось очистить временное состояние перед экспортом карточки' ],
  [ 'Route Card export could not preserve the resolved route safely', 'Не удалось корректно сохранить выбранный маршрут в карточке' ],
  [ 'Reach Card export could not preserve authored reach safely', 'Не удалось корректно сохранить выбранные связи в карточке' ],
  [ 'Share Card variants cannot be combined', 'Варианты карточек нельзя объединять' ],
  [ 'Unknown Share Card variant: ', 'Неизвестный вариант карточки: ' ],
  [ 'Route Share Card export failed: ', 'Ошибка экспорта карточки маршрута: ' ],
  [ 'Reach Share Card export failed: ', 'Ошибка экспорта карточки связей: ' ],
  [ 'WebM motion export requires a trace animation and browser MediaRecorder support', 'Для экспорта WebM нужны анимация маршрута и поддержка MediaRecorder браузером' ],
  [ 'WebM unavailable in this browser', 'WebM недоступен в этом браузере' ],
  [ 'MediaRecorder produced an empty WebM', 'MediaRecorder создал пустой файл WebM' ],
  [ 'MediaRecorder failed', 'Ошибка MediaRecorder' ],
  [ 'SVG background could not be loaded for WebM export', 'Не удалось загрузить фон SVG для экспорта WebM' ],
  [ 'Canvas unavailable for ', 'Canvas недоступен для ' ],
  [ '2D canvas context unavailable for ', 'Двумерный контекст Canvas недоступен для ' ],
  [ 'canvas.toBlob unavailable for ', 'canvas.toBlob недоступен для ' ],
  [ 'toBlob returned null for Share Card', 'toBlob вернул пустой результат для карточки схемы' ],
  [ 'toBlob returned null for ', 'toBlob вернул пустой результат для ' ],
  [ '>Ready<', '>Готово<' ],
  [ "'Ready'", "'Готово'" ],
  [ "'Journey'", "'По шагам'" ],
  [ '>Journey<', '>По шагам<' ],
  [ "'Overview'", "'Весь маршрут'" ],
  [ '>Overview<', '>Весь маршрут<' ],
  [ "'Relations'", "'Связи'" ],
  [ '>Relations<', '>Связи<' ],
  [ "'Upstream'", "'Предыдущие'" ],
  [ '>Upstream<', '>Предыдущие<' ],
  [ "'Downstream'", "'Следующие'" ],
  [ '>Downstream<', '>Следующие<' ],
  [ "'Incoming'", "'Входящие'" ],
  [ "'Outgoing'", "'Исходящие'" ],
  [ 'Copy link', 'Копировать ссылку' ],
  [ 'Find start', 'Найти начало' ],
  [ "'Clear'", "'Очистить'" ],
  [ '>Clear<', '>Очистить<' ],
  [ '<kbd>0</kbd> Reset', '<kbd>0</kbd> Сбросить' ],
  [ '<kbd>T</kbd> Theme', '<kbd>T</kbd> Тема' ],
  [ '<kbd>S</kbd> Style', '<kbd>S</kbd> Стиль' ],
  [ '<kbd>E</kbd> Export', '<kbd>E</kbd> Экспорт' ],
  [ '<kbd>Esc</kbd> Close', '<kbd>Esc</kbd> Закрыть' ],
  [ "'Pause'", "'Пауза'" ],
  [ "'Replay'", "'Повторить'" ],
  [ "'Live'", "'Анимация'" ],
  [ "'Still'", "'Без движения'" ],
  [ "'Copied'", "'Скопировано'" ]
].sort((left, right) => right[0].length - left[0].length);

for (const [ source, translated ] of replacements) {
  html = html.split(source).join(translated);
}

// The map must open without external font requests inside the company network.
html = html.replace(/\s*<!-- Async font load:[\s\S]*?<\/noscript>\s*/m, '\n');

if (!html.includes('RUSSIAN_READER_COMPACT')) {
  html = html.replace(
    '</style>',
    `  /* RUSSIAN_READER_COMPACT: keep the complete map on ordinary laptop screens. */
    @media (min-width: 768px) and (max-height: 920px) {
      body { padding-top: 1rem; padding-bottom: 1rem; }
    }
  </style>`
  );
}

if (!html.includes('function russianCount(')) {
  html = html.replace(
    '    var Archify = {};',
    `    var Archify = {};

    function russianCount(value, one, few, many) {
      var absolute = Math.abs(Number(value)) % 100;
      var last = absolute % 10;
      var form = absolute > 10 && absolute < 20 ? many : (last === 1 ? one : (last >= 2 && last <= 4 ? few : many));
      return value + ' ' + form;
    }`
  );
}

if (!html.includes('function russianKindLabel(')) {
  html = html.replace(
    '    function russianCount(',
    `    function russianKindLabel(value) {
      var labels = {
        frontend: 'Обращение клиента',
        backend: 'Рабочее действие',
        database: 'Оформление',
        cloud: 'Передача и хранение',
        security: 'Контроль или завершение',
        messagebus: 'Обмен сообщениями',
        external: 'Связанный процесс',
        neutral: 'Элемент',
        start: 'Начало',
        success: 'Успешное завершение',
        failure: 'Завершение с отказом',
        decision: 'Решение',
        active: 'Действие',
        waiting: 'Ожидание'
      };
      return labels[String(value || 'neutral').toLowerCase()] || 'Элемент';
    }

    function russianCount(`
  );
}

if (!html.includes('function russianDirectionLabel(')) {
  html = html.replace(
    '    function russianCount(',
    `    function russianDirectionLabel(value) {
      return value === 'upstream' ? 'Предыдущие' : value === 'downstream' ? 'Следующие' : 'Связи';
    }

    function russianCount(`
  );
}

html = html.replace(
  /stats\.textContent = nodes \+ ' semantic node'[\s\S]*?views \+ ' guided view' \+ \(views === 1 \? '' : 's'\);/,
  `stats.textContent = russianCount(nodes, 'элемент', 'элемента', 'элементов') + ' · ' +
          russianCount(relationships, 'связь', 'связи', 'связей') + ' · ' +
          russianCount(views, 'раздел', 'раздела', 'разделов');`
);
html = html.replace(
  /storyCopy\.textContent = views[\s\S]*?: 'Для этой схемы не подготовлен пошаговый показ\.';/,
  `storyCopy.textContent = views
          ? 'Подготовлено: ' + russianCount(views, 'раздел', 'раздела', 'разделов') + ' с подтверждёнными связями.'
          : 'Для этой схемы не подготовлен пошаговый показ.';`
);
html = html.replace(
  /reachStatus\.textContent = directionLabel \+ ' · ' \+ reachableCount \+ ' node'[\s\S]*?\(result\.maxDepth === 1 \? '' : 's'\);/,
  `reachStatus.textContent = directionLabel + ' · ' +
          russianCount(reachableCount, 'элемент', 'элемента', 'элементов') + ' · ' +
          russianCount(result.edgeKeys.length, 'связь', 'связи', 'связей') + ' · глубина ' + result.maxDepth;`
);

html = html.replace(
  /var subtitle = routeSnapshot[\s\S]*?: 'СХЕМА · ' \+ presetLabel \+ ' · ' \+ theme\.toUpperCase\(\);/,
  `var subtitle = routeSnapshot
                ? 'Маршрут: ' + routeSnapshot.source.label + ' → ' + routeSnapshot.target.label + ' · ' +
                  russianCount(routeSnapshot.hops, 'направленный переход', 'направленных перехода', 'направленных переходов')
                : reachSnapshot
                  ? 'Связи: ' + russianDirectionLabel(reachSnapshot.direction).toLowerCase() + ' от ' + reachSnapshot.origin.label + ' · ' +
                    russianCount(reachSnapshot.nodeIds.length - 1, 'элемент', 'элемента', 'элементов') + ' · ' +
                    russianCount(reachSnapshot.edges.length, 'связь', 'связи', 'связей') + ' · глубина ' +
                    russianCount(reachSnapshot.maxDepth, 'переход', 'перехода', 'переходов')
                  : subtitleNode ? subtitleNode.textContent : '';
              var preset = document.documentElement.getAttribute('data-preset') || 'classic';
              var theme = document.documentElement.getAttribute('data-theme') || 'dark';
              var presetLabels = { 'signal-flow': 'ПОТОК', classic: 'КЛАССИКА', blueprint: 'ЧЕРТЁЖ', editorial: 'ПУБЛИКАЦИЯ' };
              var themeLabels = { dark: 'ТЁМНАЯ', light: 'СВЕТЛАЯ' };
              var presetLabel = presetLabels[preset] || 'СХЕМА';
              var themeLabel = themeLabels[theme] || 'ОФОРМЛЕНИЕ';
              var cardLabel = routeSnapshot
                ? 'СХЕМА · МАРШРУТ · ' + russianCount(routeSnapshot.hops, 'ПЕРЕХОД', 'ПЕРЕХОДА', 'ПЕРЕХОДОВ')
                : reachSnapshot
                  ? 'СХЕМА · ' + russianDirectionLabel(reachSnapshot.direction).toUpperCase() + ' · СВЯЗИ'
                  : 'СХЕМА · ' + presetLabel + ' · ' + themeLabel;`
);
html = html.replaceAll("'unknown'", "'неизвестная ошибка'");

html = html.replace(
  /var label = count \+ ' подтверждённый источник'[\s\S]*?'; выберите элемент для просмотра';/,
  `var label = russianCount(count, 'подтверждённый источник', 'подтверждённых источника', 'подтверждённых источников') + '; выберите элемент для просмотра';`
);
html = html.replace(
  /node\.setAttribute\('aria-label', \(originalLabel \? originalLabel \+ ', ' : ''\) \+ count \+ ' ссылка на подтверждённый источник'[\s\S]*?\);/,
  `node.setAttribute('aria-label', (originalLabel ? originalLabel + ', ' : '') +
            russianCount(count, 'ссылка на подтверждённый источник', 'ссылки на подтверждённые источники', 'ссылок на подтверждённые источники'));`
);
html = html.replace(
  /upstreamBtn\.setAttribute\('aria-label', upstreamReach[\s\S]*?: 'Следующих элементов нет'\);/,
  `upstreamBtn.setAttribute('aria-label', upstreamReach
          ? 'Показать ' + russianCount(upstreamReach, 'предыдущий элемент', 'предыдущих элемента', 'предыдущих элементов')
          : 'Предыдущих элементов нет');
        downstreamBtn.setAttribute('aria-label', downstreamReach
          ? 'Показать ' + russianCount(downstreamReach, 'следующий элемент', 'следующих элемента', 'следующих элементов')
          : 'Следующих элементов нет');`
);

html = html.replace(
  /var badge = context\.badges[\s\S]*?button\.setAttribute\('aria-label', action\);/,
  `var badge = context.badges && context.badges[item.id]
            ? context.badges[item.id]
            : context.kind === 'focus'
              ? russianCount(item.links, 'связь', 'связи', 'связей')
              : String(item.links);
          var action = context.kind === 'route-source'
            ? 'Выбрать «' + item.label + '» как начало маршрута'
            : context.kind === 'route-target'
              ? 'Выбрать «' + item.label + '» как конец маршрута, ' + badge
              : 'Выбрать «' + item.label + '», ' + russianCount(item.links, 'связь', 'связи', 'связей');
          button.setAttribute('aria-label', action);`
);
html = html.replace(
  /relationsBtn\.textContent = relationships\.length[\s\S]*?relationsBtn\.setAttribute\('aria-label',[\s\S]*?\);/,
  `relationsBtn.textContent = russianCount(relationships.length, 'связь', 'связи', 'связей');
        relationsBtn.setAttribute('aria-label', 'Показать ' + russianCount(relationships.length, 'связанную связь', 'связанные связи', 'связанных связей'));`
);
html = html.replace(
  /summary\.textContent = counts\.out \+ ' исходящая[\s\S]*?\);/,
  `summary.textContent = russianCount(counts.out, 'исходящая связь', 'исходящие связи', 'исходящих связей') + ' · ' +
          russianCount(counts.in, 'входящая связь', 'входящие связи', 'входящих связей') +
          (counts.loop ? ' · ' + russianCount(counts.loop, 'возврат', 'возврата', 'возвратов') : '');`
);
html = html.replace(
  "direction.textContent = relationship.direction === 'out' ? 'OUT →' : relationship.direction === 'in' ? '← IN' : 'LOOP';",
  "direction.textContent = relationship.direction === 'out' ? 'Исходящая →' : relationship.direction === 'in' ? '← Входящая' : 'Возврат';"
);
html = html.replace(
  /status\.textContent = nodeLabel\(selected, id\) \+ '\. ' \+ counts\.out[\s\S]*?'\. Нажмите Enter, чтобы открыть подробности\.';/,
  `status.textContent = nodeLabel(selected, id) + '. ' +
            russianCount(counts.out, 'исходящая связь', 'исходящие связи', 'исходящих связей') + ', ' +
            russianCount(counts.in, 'входящая связь', 'входящие связи', 'входящих связей') +
            (counts.loop ? ', ' + russianCount(counts.loop, 'возврат', 'возврата', 'возвратов') : '') +
            '. Всего ' + russianCount(total, 'связь', 'связи', 'связей') + '. Нажмите Enter, чтобы открыть подробности.';`
);
html = html.replace("var showDetailLevel = resolvedLevel !== 'READ';", "var showDetailLevel = semantic || detail !== 'read';");
html = html.replace(
  "if (step.relation === 'start') return 'Этап ' + position + ' / ' + countValue + ' \\u00b7 ' + step.nodeLabel + ' \\u00b7 starting point';",
  "if (step.relation === 'start') return 'Этап ' + position + ' / ' + countValue + ' \\u00b7 ' + step.nodeLabel + ' \\u00b7 начальная точка';"
);
html = html.replace(
  "if (step.relation === 'reverse') return 'Этап ' + position + ' / ' + countValue + ' \\u00b7 ' + step.nodeLabel + ' \\u2192 ' + step.previousLabel + ' \\u00b7 reverse authored link';",
  "if (step.relation === 'reverse') return 'Этап ' + position + ' / ' + countValue + ' \\u00b7 ' + step.nodeLabel + ' \\u2192 ' + step.previousLabel + ' \\u00b7 обратная заданная связь';"
);
html = html.replace(
  "return 'Этап ' + position + ' / ' + countValue + ' \\u00b7 ' + step.previousLabel + ' \\u00b7 ' + step.nodeLabel + ' \\u00b7 grouped \\u00b7 no direct link';",
  "return 'Этап ' + position + ' / ' + countValue + ' \\u00b7 ' + step.previousLabel + ' \\u00b7 ' + step.nodeLabel + ' \\u00b7 группа \\u00b7 прямой связи нет';"
);
html = html.replace(
  "meta.textContent = [item.type, item.id, item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');",
  "meta.textContent = [russianKindLabel(item.type), item.id, item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');"
);
html = html.replace(
  "meta.title = [item.type, item.id, item.context, item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');",
  "meta.title = [russianKindLabel(item.type), item.id, item.context, item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');"
);
html = html.replace(
  "meta.textContent = [russianKindLabel(item.type), item.id, item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');",
  "meta.textContent = [russianKindLabel(item.type), item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');"
);
html = html.replace(
  "meta.title = [russianKindLabel(item.type), item.id, item.context, item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');",
  "meta.title = [russianKindLabel(item.type), item.context, item.sublabel, item.tag].filter(Boolean).join(' \\u00b7 ');"
);
html = html.replace(
  "semanticId.textContent = id;\n        semanticId.hidden = false;",
  "semanticId.textContent = '';\n        semanticId.hidden = true;"
);
html = html.replace(
  "item.title = nodeLabel(byId[id], id) + ' · ' + id;",
  "item.title = nodeLabel(byId[id], id);"
);
html = html.replace(
  "setPassportValue(kind, node.getAttribute('data-node-kind') || 'node');",
  "setPassportValue(kind, russianKindLabel(node.getAttribute('data-node-kind') || 'node'));"
);
html = html.replace(
  /status\.textContent = query\s*\?[\s\S]*?: available\.length \+ ' ' \+ context\.availableNoun;/,
  `status.textContent = query
          ? 'Найдено ' + visibleItems.length + ' из ' + available.length
          : russianCount(available.length, 'элемент', 'элемента', 'элементов');`
);

html = html.replace(
  /function routeOverviewStatus\(\) \{[\s\S]*?\n\s*\}/,
  `function routeOverviewStatus() {
        return russianCount(activeNodeIds.length, 'элемент', 'элемента', 'элементов') + ' · ' +
          russianCount(activeEdges.length, 'переход', 'перехода', 'переходов') + ' · кратчайший заданный маршрут';
      }`
);
html = html.replace(
  /status\.textContent = count\s*\?[\s\S]*?: 'Отсюда нет исходящего маршрута\. Очистите выбор и укажите другое начало\.';/,
  `status.textContent = count
          ? russianCount(count, 'доступный конечный элемент', 'доступных конечных элемента', 'доступных конечных элементов') + '. Выберите подсвеченный элемент.'
          : 'Отсюда нет исходящего маршрута. Очистите выбор и укажите другое начало.';`
);
html = html.replace("sourceIds.forEach(function (id) { sourceBadges[id] = 'start'; });", "sourceIds.forEach(function (id) { sourceBadges[id] = 'начало'; });");
html = html.replace(
  /targetBadges\[id\] = distances\[id\] \+ ' переход'[\s\S]*?;/,
  `targetBadges[id] = russianCount(distances[id], 'переход', 'перехода', 'переходов');`
);

html = html.replace(
  /function kindLabel\(value\) \{[\s\S]*?\n\s*\}/,
  `function kindLabel(value) {
        return russianKindLabel(value);
      }`
);
html = html.replace(
  "button.setAttribute('aria-label', kind.label + ', ' + kind.nodes.length + ' элемент' + (kind.nodes.length === 1 ? '' : 's'));",
  "button.setAttribute('aria-label', kind.label + ', ' + russianCount(kind.nodes.length, 'элемент', 'элемента', 'элементов'));"
);
html = html.replace(
  "entry.setAttribute('aria-label', 'Просмотреть: ' + visibleLabel + ', ' + count + ' элемент' + (count === 1 ? '' : 's'));",
  "entry.setAttribute('aria-label', 'Просмотреть: ' + visibleLabel + ', ' + russianCount(count, 'элемент', 'элемента', 'элементов'));"
);
html = html.replace(
  /if \(crossKind\) \{\s*var total = forward \+ reverse;[\s\S]*?' · связанные элементы остаются видимыми';\s*\}/,
  `if (crossKind) {
          var total = forward + reverse;
          status.textContent = kindLabel(selectedKinds[0]) + ' → ' + kindLabel(selectedKinds[1]) + ': ' + forward + ' · ' +
            kindLabel(selectedKinds[1]) + ' → ' + kindLabel(selectedKinds[0]) + ': ' + reverse + ' · ' +
            russianCount(total, 'прямая связь', 'прямые связи', 'прямых связей');
        } else {
          var nodeCount = collectKinds().filter(function (kind) { return kind.id === selectedKinds[0]; })[0].nodes.length;
          status.textContent = russianCount(nodeCount, 'элемент', 'элемента', 'элементов') + ' · ' + kindLabel(selectedKinds[0]) + ' · ' +
            russianCount(touching, 'связанная связь', 'связанные связи', 'связанных связей') + ' · соседние элементы остаются видимыми';
        }`
);

writeFileSync(target, html, 'utf8');
console.log(`Русская локализация карты применена: ${target}`);
