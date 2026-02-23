# Ограничения платформы расширений браузеров

Проблемные моменты и лимиты фоновой работы расширения в разных браузерах. Учитывать при разработке и при диагностике обрывов стрима, таймаутов и «молчаливого» завершения worker’а.

---

## Chrome / Edge (Manifest V3, Service Worker)

Источник: [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

| Условие | Ограничение |
|--------|--------------|
| **Простой (idle)** | Worker останавливается через **30 секунд** без событий и вызовов API. Любое событие или вызов API сбрасывает таймер. |
| **Ответ fetch()** | Если ответ не начал приходить дольше **30 секунд**, worker может быть остановлен. Ожидание первого байта стрима (например, пока LM Studio обрабатывает промпт) считается «нет ответа». |
| **Один запрос** | Один обработчик события или один вызов API не должен выполняться дольше **5 минут**. |

Что продлевает жизнь worker’а (сбрасывает таймеры):

- События расширения и вызовы extension API (Chrome 110+).
- Долгоживущий порт (`chrome.runtime.connect`) — с Chrome 114 порт держит worker живым.
- Активный WebSocket (Chrome 116) — отправка/получение сбрасывают idle-таймер.

**Важно для PageAI:** длинный стрим через один `fetch()` в background: пока LM Studio «думает» и не шлёт байты, проходит 30+ секунд → Chrome может завершить worker и разорвать соединение (в логах LM Studio: «Client disconnected»). Пинг по порту сбрасывает только idle-таймер; ожидание `reader.read()` без прихода данных под ограничение «ответ fetch не начался за 30 с» всё равно подпадает. Надёжный обход — не держать долгий стрим в service worker: выполнять fetch/reader в контексте страницы (panel/popup или offscreen document).

---

## Firefox

- **Manifest V2:** фон может быть persistent — живёт, пока расширение включено.
- **Manifest V3 (event page):** фон неперсистентный — запускается по событию и выгружается при простое. Жёсткого «30 секунд на fetch» в документации нет, но длинные фоновые операции не гарантируют, что скрипт не выгрузится.

Рекомендация: не полагаться на неограниченное время жизни фона; важное состояние хранить в `chrome.storage` или IndexedDB.

---

## Safari (в т.ч. iOS)

- На **iOS** фон нередко завершался примерно через **30 секунд** (в т.ч. до версий 17.6.1); после этого worker мог не перезапускаться до перезапуска расширения или устройства.
- Слишком частые сообщения (например, каждые 1–3 с) иногда ускоряли завершение; реже (4+ с) — работа дольше.
- Safari на macOS обычно ведёт себя мягче, чем на iOS.

При поддержке Safari учитывать возможную выгрузку фона и не восстанавливающийся worker.

---

## Рекомендации для проекта

1. **Долгий стрим (чат без MCP):** по возможности выполнять `fetch` и цикл `reader.read()` в контексте panel/popup (или offscreen document), а не в background — тогда лимит «30 с до первого байта» к стриму не применяется.
2. **Offscreen keepalive для пингов:** при стриме в background создаётся невидимый offscreen-документ (`ping-runner.html`), который раз в 15 с шлёт сообщения в background по порту `pageai-stream-keepalive`. Это сбрасывает 30-секундный idle-таймер service worker. Документ не создаёт окна и не показывается пользователю; по окончании стрима закрывается через `chrome.offscreen.closeDocument()`. См. `openStreamKeepaliveOffscreen()` в background и `src/ui/ping-runner.html`.
3. **Состояние и история:** хранить в `chrome.storage` / IndexedDB, не в глобальных переменных background — они теряются при остановке worker’а.
4. **Уведомление при закрытом popup:** если стрим идёт в background и popup закрыли — не прерывать стрим по `onDisconnect`; по завершении сохранять ответ в storage и показывать уведомление (см. текущую реализацию в background). Если уведомления не появляются: проверьте разрешения для расширения в `chrome://settings/content/notifications` и системные настройки уведомлений ОС (macOS: Системные настройки → Уведомления → Chrome).
5. **Тестирование:** проверять длинные запросы (thinking-модели, медленный ответ) в Chrome с открытой панелью и с закрытым popup.

---

## Ссылки

- [The extension service worker lifecycle \| Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Longer extension service worker lifetimes \| Chrome for Developers](https://developer.chrome.com/blog/longer-esw-lifetimes)
- [Background scripts \| MDN WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts)
