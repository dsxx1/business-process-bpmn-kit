# Подключение локального BPMN MCP

Один локальный stdio-сервер даёт Codex, Claude Code/Claude Desktop, Cursor и любому другому MCP-клиенту одинаковый безопасный доступ к BPMN-пакетам этого репозитория. Сервер не вызывает AI сам, не создаёт отдельный формат и использует существующие мастера Studio/create/update/register/validate/Archify.

## Подготовка и проверка

Нужен Node.js 22.12 или новее. Зависимости сервера зафиксированы точно: `@modelcontextprotocol/server@2.0.0` и `zod@4.4.3`.

Во всех примерах ниже замените `<ПУТЬ-К-ПРОЕКТУ>` на папку, куда вы распаковали или клонировали `business-process-bpmn-kit`, например `C:\Путь\business-process-bpmn-kit`. Команда `node` должна быть доступна через `PATH`; отдельный жёстко заданный путь к `node.exe` не нужен.

```powershell
Set-Location -LiteralPath '<ПУТЬ-К-ПРОЕКТУ>\tools\bpmn'
npm ci
npm run test:mcp
```

Универсальная команда запуска:

```powershell
node '<ПУТЬ-К-ПРОЕКТУ>\tools\bpmn\bpmn-mcp-server.mjs' `
  --project-root '<ПУТЬ-К-ПРОЕКТУ>'
```

Из каталога `tools\bpmn` то же самое запускается как `npm run mcp:start`. Сервер работает по stdio: stdout зарезервирован только для MCP-сообщений, диагностика пишется в stderr.

Путь к проекту можно передать через `BPMN_PROJECT_ROOT`, но явный `--project-root` предпочтительнее и имеет приоритет. Сервер приводит корень к `realpath` до начала работы.

## Codex

Добавление через CLI:

```powershell
codex mcp add bpmn-local -- `
  node '<ПУТЬ-К-ПРОЕКТУ>\tools\bpmn\bpmn-mcp-server.mjs' `
  --project-root '<ПУТЬ-К-ПРОЕКТУ>'
codex mcp list
```

Эквивалентная запись в конфигурации Codex TOML:

```toml
[mcp_servers.bpmn_local]
command = "node"
args = [
  "<ПУТЬ-К-ПРОЕКТУ>\\tools\\bpmn\\bpmn-mcp-server.mjs",
  "--project-root",
  "<ПУТЬ-К-ПРОЕКТУ>"
]
startup_timeout_sec = 20
tool_timeout_sec = 300
```

Актуальный синтаксис и расположение конфигурации сверяйте с [официальной документацией Codex MCP](https://developers.openai.com/codex/mcp/).

## Claude Code

Добавление в проектную конфигурацию:

```powershell
claude mcp add --transport stdio --scope project bpmn-local -- `
  node '<ПУТЬ-К-ПРОЕКТУ>\tools\bpmn\bpmn-mcp-server.mjs' `
  --project-root '<ПУТЬ-К-ПРОЕКТУ>'
claude mcp get bpmn-local
```

Эквивалентный `.mcp.json` в корне проекта:

```json
{
  "mcpServers": {
    "bpmn-local": {
      "type": "stdio",
      "command": "node",
      "args": [
        "<ПУТЬ-К-ПРОЕКТУ>\\tools\\bpmn\\bpmn-mcp-server.mjs",
        "--project-root",
        "<ПУТЬ-К-ПРОЕКТУ>"
      ]
    }
  }
}
```

Claude Code запрашивает доверие к project-scoped серверу. Это ожидаемая защита клиента; проверяйте команду и путь перед подтверждением. Подробности — в [официальной документации Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp).

## Claude Desktop

Если установленная версия Claude Desktop поддерживает ручную локальную конфигурацию разработчика, добавьте тот же объект `mcpServers` в `%APPDATA%\Claude\claude_desktop_config.json` и полностью перезапустите приложение:

```json
{
  "mcpServers": {
    "bpmn-local": {
      "command": "node",
      "args": [
        "<ПУТЬ-К-ПРОЕКТУ>\\tools\\bpmn\\bpmn-mcp-server.mjs",
        "--project-root",
        "<ПУТЬ-К-ПРОЕКТУ>"
      ]
    }
  }
}
```

В новых версиях Claude Desktop Anthropic продвигает Extensions/DXT, поэтому экран и способ подключения могут отличаться. Исполняемая команда сервера остаётся той же; при ручной конфигурации ориентируйтесь на документацию именно вашей версии Claude Desktop.

## Cursor

Создайте `.cursor/mcp.json` в корне проекта для проектной настройки или используйте глобальный `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bpmn-local": {
      "command": "node",
      "args": [
        "<ПУТЬ-К-ПРОЕКТУ>\\tools\\bpmn\\bpmn-mcp-server.mjs",
        "--project-root",
        "<ПУТЬ-К-ПРОЕКТУ>"
      ]
    }
  }
}
```

После перезапуска или обновления MCP Servers проверьте, что сервер `bpmn-local` и его инструменты видны. Формат и расположение конфигурации могут меняться между версиями; актуальные сведения — в [официальной документации Cursor MCP](https://docs.cursor.com/context/model-context-protocol).

## Возможности сервера

Сначала вызывайте `bpmn_get_capabilities`: он машинно фиксирует границы AI, канонический источник, URI ресурсов и запрет бизнес-утверждения.

| Инструмент | Назначение |
| --- | --- |
| `bpmn_get_capabilities` | Возможности, границы и контракт конкурентной записи |
| `bpmn_list_processes` | Каталог процессов со статусами, summary и SHA-256 |
| `bpmn_get_process` | Метаданные, summary, SHA-256 и опционально XML |
| `bpmn_create_draft` | Новый черновик из репозиторного шаблона |
| `bpmn_save_xml` | Разбор и атомарное сохранение XML с `expected_sha256` |
| `bpmn_list_transition_targets` | Доступные цели и уже настроенные межпроцессные вызовы, включая оба актуальных SHA-256 |
| `bpmn_set_process_transition` | Создать или обновить Call Activity «вызвать другой процесс и вернуться» одновременно в BPMN и metadata |
| `bpmn_remove_process_transition` | Удалить межпроцессный вызов из BPMN и metadata, не удаляя заметки будущего процесса |
| `bpmn_validate` | Существующие package validation и bpmnlint |
| `bpmn_build_human_map` | Производная человекочитаемая карта через Archify |
| `bpmn_update_package` | Существующий мастер обновления пакета |
| `bpmn_register_draft` | Техническая регистрация готового черновика |

Ресурсы:

- `bpmn://catalog` — сводный каталог;
- `bpmn://process/{slug}/meta` — metadata, summary, статусы и SHA-256;
- `bpmn://process/{slug}/xml` — канонический BPMN XML;
- `bpmn://process/{slug}/questions` — вопросы владельцу;
- `bpmn://process/{slug}/links` — связи процессов.

Клиенты по-разному показывают MCP resources и templates. Если UI клиента не отображает ресурс, те же данные доступны через `bpmn_list_processes` и `bpmn_get_process`.

## Рекомендуемый безопасный сценарий

1. Получить `bpmn_get_capabilities`, затем список и нужный процесс.
2. Для обычного сохранения XML прочитать свежий SHA-256 через `bpmn_get_process`, передать полный XML и этот SHA-256 в `bpmn_save_xml`.
3. Для перехода вызвать `bpmn_list_transition_targets`: он возвращает зарегистрированные цели, будущие зарезервированные цели, текущие переходы и свежие `bpmn_sha256`/`meta_sha256`.
4. Передать в `bpmn_set_process_transition` полный текущий XML, ID выбранного `CallActivity`, понятную русскую подпись, цель и оба SHA-256. Цель выбирается как `{ "kind": "registered", "slug": "..." }`, `{ "kind": "reserved", "title": "...", "slug": "..." }` или `{ "kind": "unknown" }`.
5. Для удаления сначала в локальной модели превратить бывший `CallActivity` в обычную `Task` (или удалить блок), затем передать изменённый полный XML, `link_id` и оба свежих SHA-256 в `bpmn_remove_process_transition`. Сервер отвергнет схему с осиротевшим `CallActivity`. Эти две мутации не помечены идемпотентными: после сетевого сбоя сначала перечитайте переходы, а не повторяйте вызов вслепую.
6. При `BPMN_CONFLICT` или `META_CONFLICT` перечитать процесс и вручную объединить правки; сервер не делает last-writer-wins.
7. Запустить `bpmn_validate`, затем при необходимости `bpmn_build_human_map`.
8. Проверить diff и карту человеком. `bpmn_update_package` и `bpmn_register_draft` могут изменить несколько файлов и должны вызываться только в явно поставленной задаче.

Канонический BPMN обязан иметь `isExecutable=false`. Техническая проверка, сборка карты и регистрация не означают бизнес-утверждение. Инструментов `bpmn_approve` и `bpmn_record_owner_decision` намеренно нет: решение владельца фиксирует только человек вне MCP.

Все мутации одного процесса используют общий cross-process lock со Studio. Запись XML дополнительно требует optimistic SHA-256 и выполняется атомарной заменой. Доступ ограничен обычными файлами внутри `processes/<slug>`; traversal, junction/symlink и произвольные пути отвергаются структурированной русской ошибкой.

## Почему используется тонкий адаптер, а не готовый BPMN MCP

Перед реализацией проверены существующие открытые проекты. Код из них не копировался и не вендорился.

| Проект | Что уже умеет | Почему не заменяет этот сервер |
| --- | --- | --- |
| [dattmavis/BPMN-MCP](https://github.com/dattmavis/BPMN-MCP) | MIT, генерация BPMN через MCP | SDK v1 и собственная in-memory модель; нет жизненного цикла пакетов репозитория, optimistic SHA и границы approval |
| [oisee/mcp-bpmn](https://github.com/oisee/mcp-bpmn) | Универсальная генерация Mermaid/BPMN | SDK v1; в package заявлен MIT, но при аудите отдельный LICENSE не найден; нет локального create/update/register-контракта |
| [iamtheavoc1/mcp-bpmn](https://github.com/iamtheavoc1/mcp-bpmn) | Универсальные BPMN-инструменты | SDK v1; при аудите отдельный LICENSE не найден; другой файловый и lifecycle-контракт |
| [Djaler/bpmn-inspector-mcp](https://github.com/Djaler/bpmn-inspector-mcp) | MIT, инспекция, layout и render | SDK v1 и произвольные пути к файлам; нет управляемого пакета и бизнес-границ этого репозитория |

Ни одно решение не совмещает официальный MCP SDK v2, безопасный workspace root, текущие `studio-core/create/update/register/validate/archify`, общий lock, optimistic SHA и запрет агентского approval. Поэтому минимальный слой регистрации MCP-инструментов построен на официальном SDK, а вся предметная работа делегируется существующему core и мастерам репозитория. Собственный протокол или BPMN-движок не создавался.

## Ограничения

- Это локальный stdio-сервер одного проекта, без HTTP, сетевой публикации и удалённой аутентификации.
- Клиенты имеют разные форматы конфигурации, механизмы доверия и поддержку resources; сервер и команда запуска при этом одни.
- Archify строит производное представление. BPMN XML и metadata остаются каноническим источником; после изменения источников карта помечается устаревшей до новой сборки.
- `update`/`register` используют существующие репозиторные мастера и могут выполняться несколько минут.
- Не удаляйте файл `.bpmn-operation-<slug>.lock`, пока Studio или MCP выполняет операцию. Lock умершего процесса восстанавливается автоматически; спорный файл сначала нужно проверить вручную.
- Сервер не редактирует глобальные пользовательские конфигурации автоматически. Примеры выше пользователь применяет осознанно.
