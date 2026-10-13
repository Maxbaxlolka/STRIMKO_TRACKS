# STRIMKO TRACKS — ID-based MVP

Отдельная мини-платформа заказа YouTube-треков для STRIMKO. Интерфейс публикуется через GitHub Pages, а проверка прогресса, ограничений и заказов выполняется Firebase Cloud Functions.

## Как работает зрительская часть

1. На основном сайте STRIMKO автоматически создаётся Firebase Anonymous Auth UID.
2. Cloud Function выдаёт зрителю случайный ID формата `SK-` + 24 hex-символа. ID отображается под плеером и копируется одной кнопкой.
3. Пока основной плеер реально играет, вкладка видима, а пользователь не ставил видео на паузу, основной сайт отправляет heartbeat на сервер каждые 20 секунд.
4. На странице STRIMKO TRACKS зритель вводит ID. Регистрация по email не нужна.
5. Сервер проверяет прогресс, общий порог просмотра, паузу между заказами и лимит треков в очереди. Ссылка YouTube проверяется по ID видео.
6. OBS Browser Source использует `overlay.html`; после завершения текущего трека функция завершает заказ и активирует следующий.

## Настройка перед публикацией

### 1. Firebase Authentication

В Firebase Console → Authentication → Sign-in method:
- включи **Anonymous** для зрителей основного STRIMKO;
- оставь Email/Password включённым для отдельного аккаунта администратора.

В Authentication → Settings → Authorized domains добавь домен GitHub Pages (`maxbaxlolka.github.io`) и свой домен STRIMKO, если он отсутствует.

### 2. Realtime Database rules

Сохрани текущие правила Firebase (чат, счётчик зрителей и другие ветки STRIMKO). Влей только фрагмент `database.rules.tracks-snippet.json` в корень текущего JSON, не перезаписывая другие ветки. Новые ветки `tracks` должны быть закрыты для прямой записи из браузера; запись выполняют Cloud Functions через Admin SDK.

### 3. Cloud Functions

Требуется Firebase Blaze (оплата по использованию). В каталоге проекта выполни:

```bash
firebase login
firebase use strimko-676be
cd functions
npm install
cd ..
firebase deploy --only functions
```

Новые функции ID: `tracksGetOrCreateViewerId`, `tracksGetViewerProgress`, `tracksStopWatch`, `tracksRequestByViewerId`. Существующие функции админки и OBS сохраняются.

### 4. Администратор

Создай обычного Firebase Auth пользователя с Email/Password, затем выдай ему custom claim `admin: true` с помощью инструкции в `scripts/set-admin.js` (нужны service-account credentials). После назначения роли выйди из панели и войди заново. Админ-вход находится внизу страницы STRIMKO TRACKS.

### 5. GitHub Pages и OBS

Загрузи содержимое папки в корень нового репозитория `STRIMKO-TRACKS` и включи GitHub Pages на ветке `main`, каталог `/(root)`.

- Страница зрителя: `https://maxbaxlolka.github.io/STRIMKO-TRACKS/`
- OBS Browser Source: `https://maxbaxlolka.github.io/STRIMKO-TRACKS/overlay.html`
- Рекомендуемый размер OBS: 1920×1080.

## Важные ограничения

- ID — секретный bearer-идентификатор. Не публикуй его и не отправляй посторонним: обладатель ID может отправлять заказы от имени этого ID. Добавление восстановления/отзыва ID можно сделать следующим этапом.
- Очистка данных браузера может потерять локальную анонимную Firebase-сессию. Пока тот же браузер хранит Firebase Auth persistence, ID остаётся связан с той же сессией.
- Учёт времени не является DRM и не доказывает, что человек внимательно смотрит экран. Heartbeat проверяет серверные интервалы, но модифицированный браузер теоретически может имитировать действия.
- Некоторые видео YouTube запрещают встраивание или автозапуск. Такие видео не получится воспроизвести в OBS этим способом.
- Cloud Functions требуют развёртывания; одних файлов GitHub Pages недостаточно.
