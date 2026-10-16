# STRIMKO TRACKS — Cloudflare Worker edition

Эта версия использует Cloudflare Workers для серверной проверки заказов. Firebase Cloud Functions для работы этой версии не нужны, тариф Blaze подключать ради Worker не требуется.

## Что изменено

- Проверка STRIMKO ID и прогресса через Worker.
- Заказ принимается на сервере только если прогресс просмотра достиг настроенного лимита.
- После принятого заказа сервер сбрасывает `watchSeconds` в `0`.
- Лимит активных треков на одного зрителя (`maxPending`) проверяется на сервере.
- Очередь воспроизводится FIFO: сначала самый ранний заказ, затем следующий.
- В панели администратора отображаются статусы: «Ожидает», «Сейчас играет», «Уже сыграл», «Отклонён», «Пропущен», «Отключён».
- Кнопка «Отключить» в реальном времени останавливает текущий трек и запускает следующий ожидающий.
- Громкость OBS сохраняется в настройках и применяется к плееру.

## 1. Подготовить service account для Firebase Realtime Database

1. Открой Google Cloud Console для проекта `strimko-676be`: https://console.cloud.google.com/iam-admin/serviceaccounts?project=strimko-676be
2. Создай отдельный service account, например `strimko-tracks-worker`, либо выбери уже существующий служебный аккаунт.
3. Выдай ему роль, позволяющую администрировать Firebase Realtime Database (например, **Firebase Realtime Database Admin**).
4. Создай JSON-ключ и скачай файл на компьютер.
5. **Не добавляй этот JSON-ключ в GitHub, ZIP для публикации или публичные чаты.** Он будет добавлен только в секреты Cloudflare.

## 2. Опубликовать Worker

1. Установи Node.js LTS, если ещё не установлен.
2. Открой терминал в папке `STRIMKO_TRACKS-main`.
3. Выполни:

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

После публикации Wrangler покажет адрес примерно такого вида:

`https://strimko-tracks-api.<имя-аккаунта>.workers.dev`

## 3. Добавить секреты Worker

В той же папке выполни команды. Когда Wrangler попросит значение, вставь его и нажми Enter:

```bash
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
wrangler secret put FIREBASE_DATABASE_URL
wrangler secret put FIREBASE_API_KEY
wrangler secret put ADMIN_EMAIL
```

Значения:

- `FIREBASE_SERVICE_ACCOUNT_JSON` — **всё содержимое скачанного JSON-ключа service account**. Вставляй целиком, не публикуй его.
- `FIREBASE_DATABASE_URL` — `https://strimko-676be-default-rtdb.europe-west1.firebasedatabase.app`
- `FIREBASE_API_KEY` — значение `apiKey` из `firebase-config.js`.
- `ADMIN_EMAIL` — email администратора Firebase, например `strimko@gmail.com`, если это тот аккаунт, которым ты входишь в панель.

Если меняешь секреты после публикации, Worker использует их автоматически; при необходимости снова выполни `wrangler deploy`.

## 4. Подключить сайт и OBS к Worker

Открой `worker-config.js` и замени:

```js
window.STRIMKO_WORKER_URL = 'PASTE_CLOUDFLARE_WORKER_URL_HERE';
```

на URL, который показал Wrangler, например:

```js
window.STRIMKO_WORKER_URL = 'https://strimko-tracks-api.example.workers.dev';
```

Сохрани файл и загрузи в GitHub Pages новые файлы сайта.

## 5. Обновить файлы сайта в GitHub

Замени в корне репозитория:

- `app.js`
- `index.html`
- `overlay.js`
- `overlay.html`
- `worker-config.js` (новый файл)
- `database.rules.tracks-snippet.json` (новый фрагмент правил для Firebase)

`style.css` и `firebase-config.js` можно оставить текущими. Папку `functions` можно оставить в репозитории, но для этой версии её не нужно развёртывать. Команда `firebase deploy --only functions` не нужна.

## 6. Обязательно закрыть прямую запись в Firebase

Иначе посетитель сможет обойти Worker и напрямую записать заказ в Realtime Database.

1. Открой Firebase Console → Realtime Database → Rules.
2. Вставь правила из `database.rules.tracks-snippet.json` **внутрь существующего объекта `rules`**, сохранив правила других частей базы, если они используются.
3. Убедись, что записи в `tracks/queue`, `tracks/active`, `tracks/users`, `tracks/userOrders`, `tracks/orderOwners`, `tracks/viewerIds` и `tracks/meta` запрещены клиентам. Worker использует service account и сможет изменять эти данные.
4. Нажми **Publish**.

Важно: сначала проверь, что основной сайт STRIMKO обновляет прогресс просмотра через серверные функции, а не пишет `tracks/users` прямо из браузера. Эти правила блокируют клиентскую запись в `tracks/users`, чтобы нельзя было подделать прогресс.

## 7. Проверка

- Открой `https://<адрес-worker>/health` — должен вернуться JSON с `"ok": true`.
- Войди в админку STRIMKO TRACKS, измени громкость и сохрани.
- Добавь несколько тестовых треков: они должны идти по времени заказа — от самого раннего к самому новому.
- Установи `maxPending = 1` и попробуй заказать второй трек с тем же ID, пока первый ещё в очереди. Сервер должен отказать.
- Нажми «Отключить» на текущем треке — он должен остановиться, а следующий ожидающий запуститься автоматически.

## Важные замечания

- Worker и его бесплатный лимит зависят от актуальных условий Cloudflare; для обычного небольшого проекта обычно хватает бесплатного тарифа, но ограничения платформы могут меняться.
- Проверка подтверждает накопленный прогресс, который записывает основной сайт STRIMKO. Она не может самостоятельно доказать, что пользователь действительно смотрит видео, если основной сайт не отправляет корректные серверные heartbeat-события.
- Не отправляй service account JSON-ключ в чат и не коммить его в репозиторий.
