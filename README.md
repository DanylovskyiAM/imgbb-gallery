# ImgBB Gallery

Small gallery app that reads public ImgBB albums, displays images from external storage, and can upload images to ImgBB through a server-side API key.

## Requirements

- Node.js 18+
- npm
- ImgBB API key for uploads

## Install

Install root development tools:

```bash
npm install
```

Install server dependencies:

```bash
npm install --prefix server
```

## Configure ImgBB API key

Create a `.env` file in the project root:

```bash
IMGBB_API_KEY=your_imgbb_api_key
```

You can also configure multiple ImgBB API keys. The server rotates to another key after
every 100 uploaded files. When ImgBB returns a rate-limit error, the current key is marked
blocked, the server logs the blocked key's last four characters, and uploads continue with
the next available key. The management page shows available keys as `available/total`.

```bash
IMGBB_API_KEYS=first_key,second_key,third_key
```

Keys that return an explicit rate-limit response are skipped temporarily and retried after
one hour. Override the cooldown when needed:

```bash
IMGBB_KEY_COOLDOWN_SECONDS=3600
```

Generic ImgBB code `100` errors, maintenance responses, internal upload errors, and invalid
image data do not block or rotate API keys.

The management-page **Refresh** button performs a real health check by uploading one 1×1
PNG per configured key. These check images are not added to the gallery database and expire
from ImgBB after 60 seconds.

The server loads `.env` automatically in local development.

Do not commit `.env`. It is already listed in `.gitignore`.

## Database Storage

SQLite is the default storage driver. On first start, the server creates `server/data/db.sqlite` and automatically migrates existing `server/data/db.json` data into it. Export/import still uses the same backup JSON structure, so existing backups remain compatible. Exports do not include active sessions.

To temporarily use the old JSON file storage instead:

```bash
DB_DRIVER=json
```

The supported drivers are `sqlite` and `json`.

## Run Locally

Run the single Express server:

```bash
npm run server
```

Run the server with automatic restart after file changes:

```bash
npm run server:watch
```

Run server watch mode and the local client together:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000/
```

Open the management page:

```text
http://127.0.0.1:3000/manage.html
```

The first visit to the management page redirects to `login.html`. If no admin account exists yet, the login page asks you to create the first account. Account and session data are stored in the local server database file.

## Action Logs

The server stores the latest main app actions in `server/data/db.json` under the `logs` key. Logs are capped to the latest 1000 entries and include auth events, database import/export, folder changes, file approvals/deletions, and uploads.

Fetch recent logs while signed in as an admin:

```text
GET /api/logs?limit=200
```

Clear logs:

```text
DELETE /api/logs
```

Open a gallery directly:

```text
http://127.0.0.1:3000/?id=TMrN4x
```

Open the upload page:

```text
http://127.0.0.1:3000/upload.html
```

## Create Folder Structure

The project includes a helper script that creates the predefined camp folder tree in bulk.

Start the local server first:

```bash
npm run server
```

Then, in another terminal, run:

```bash
npm run seed:folders
```

The script creates root folders, `Summer - Week 1` through `Summer - Week 7`, and the activity folders inside each week. It skips folders that already exist in the same parent folder, so it is safe to run again.

## Parse MYA Stages

The project includes a parser for MYA holiday camp data. It reads the MYA Stages listings for Promosport and Actionsport, opens each event, then reads the real booking groups for that event. The output is import-friendly records with company, site, period, English discipline name, group time, dates, address, price, and source IDs.

Export all stage disciplines as JSON:

```bash
npm run parse:mya -- --out mya-stages.json
```

The default parser includes both branded MYA stage listings: Promosport from `pr1` and Actionsport from `pr2`.

Export only Mixed games rows:

```bash
npm run parse:mya -- --discipline "Mixed games" --out mya-mixed-games.json
```

Export CSV instead of JSON:

```bash
npm run parse:mya -- --discipline "Mixed games" --format csv --out mya-mixed-games.csv
```

Export company, site, and period rows from the manual period source, enriched with MYA dates and addresses where available:

```bash
npm run parse:mya-periods -- --out mya-periods.json
```

The periods-only parser reads `mya-periods.txt` by default. That file uses `Company:` headers and `Site ; Period` rows. The parser keeps that list as the source of truth, enriches matching rows from the MYA API, and falls back to known period dates and site addresses for rows that MYA does not expose through the public listing.

Import the periods-only JSON into the app as folders:

```bash
npm run import:mya-periods -- --file mya-periods.json --username admin --password "your-password"
```

This creates only the top-level camp structure:

```text
Company
└── Site
    └── Period
```

If you only need to convert a manually copied period list without API enrichment, save it as plain text with `Company:` headers and `Site ; Period` rows:

```text
Actionsport:
Auderghem – Athénée Royal ; Eté - semaine 1

Promosport:
Braine-l'Alleud – Cardinal Mercier ; Eté - semaine 1
```

```bash
npm run convert:mya-periods -- --file mya-periods.txt --out mya-periods.json
```

For a file that contains only one company and no header:

```bash
npm run convert:mya-periods -- --file promosport.txt --default-company Promosport --out mya-periods.json
```

Example row:

```json
{
  "company": "Promosport",
  "site": "Hamme-Mille – Ecole autonome",
  "period": "Summer - Week 1",
  "discipline": "Mixed games (6 - 12 years)",
  "groupTime": "09:00 - 12:00",
  "eventId": 678,
  "groupId": 32922,
  "disciplineId": 91,
  "startDate": "2026-07-06",
  "endDate": "2026-07-10"
}
```

Import the generated JSON into the app as folders:

```bash
npm run server
```

Then, in another terminal, run:

```bash
npm run import:mya -- --file mya-stages.json --username admin --password "your-password"
```

You can also set `MYA_ADMIN_USERNAME` and `MYA_ADMIN_PASSWORD` instead of passing credentials in the command.

Preview the import without creating folders:

```bash
npm run import:mya -- --file mya-stages.json --dry-run
```

Import only one discipline:

```bash
npm run import:mya -- --file mya-stages.json --discipline "Mixed games"
```

The importer creates folders in this structure:

```text
Company
└── Site
    └── Period
        └── Discipline Group time
```

It skips folders that already exist in the same parent folder, so it is safe to run again.

## API

Get album data:

```text
GET /api/album/:id
```

Force refresh cached album data:

```text
GET /api/album/:id?refresh=1
```

Download an image through the server:

```text
GET /api/download?url=<i.ibb.co image url>&filename=<filename>
```

Upload images to ImgBB:

```text
POST /api/upload
Content-Type: application/json
```

Body:

```json
{
  "images": [
    {
      "name": "photo.jpg",
      "data": "data:image/jpeg;base64,..."
    }
  ]
}
```

Upload requires `IMGBB_API_KEY` or `IMGBB_API_KEYS`.

## Phone Testing

Find your computer IP on the same Wi-Fi, then open:

```text
http://YOUR_LOCAL_IP:3000/?id=TMrN4x
```

Example:

```text
http://192.168.1.244:3000/?id=TMrN4x
```

If it does not open, check macOS firewall and make sure the phone is on the same Wi-Fi.

## Deploy

This app can run as one Node/Express service. The server serves both:

- API routes under `/api`
- static frontend files from `client/`

Set this environment variable in your cloud provider:

```bash
IMGBB_API_KEY=your_imgbb_api_key
# or
IMGBB_API_KEYS=first_key,second_key,third_key
```

Build command:

```bash
npm install --prefix server
```

Start command:

```bash
npm start --prefix server
```

The repository also includes a `Dockerfile` for Docker-based hosts.

### Telegram Status Notifications on Oracle Cloud

The server can send a Telegram report containing:

- available ImgBB API keys;
- the total number of files waiting for approval;
- pending counts grouped by full folder location;
- a link to the management page.

The repository includes an Oracle-friendly systemd timer that sends the report every day
at `14:00` and `20:00` in the `Europe/Kyiv` timezone.

#### 1. Create the Telegram bot and chat

1. Open `@BotFather` in Telegram and create a bot with `/newbot`.
2. Copy the bot token.
3. Open the new bot and send it `/start`.
4. Open the following URL with the token inserted:

   ```text
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```

5. Copy `message.chat.id` from the response. Group chat IDs are usually negative.

#### 2. Configure the application

Generate a private scheduler secret on the Oracle VM:

```bash
openssl rand -hex 32
```

Add these values to the project `.env` file:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_CRON_SECRET=the_generated_random_secret
TELEGRAM_TIME_ZONE=Europe/Kyiv
PUBLIC_BASE_URL=https://your-gallery-domain.example
```

Keep `.env` readable only by the account that runs the gallery:

```bash
chmod 600 .env
```

Restart the gallery server so it loads the new environment variables. Then send a manual
test report from the project directory:

```bash
npm run notify:telegram
```

The command calls the gallery through `127.0.0.1`, so the notification endpoint does not
need to be exposed through Nginx. If the server uses a port other than `3000`, set `PORT`
in `.env`. `TELEGRAM_NOTIFY_URL` can override the complete local endpoint URL when needed.

#### 3. Install the Oracle systemd timer

The included templates assume:

- the Oracle VM user is `ubuntu`;
- the repository is installed at `/home/ubuntu/imgbb-gallery`;
- `npm` is located at `/usr/bin/npm`.

These paths match the current Oracle VM configuration.

```bash
sudo cp deploy/oracle/mya-gallery-notify.service /etc/systemd/system/
sudo cp deploy/oracle/mya-gallery-notify.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mya-gallery-notify.timer
```

Confirm the next afternoon and evening runs:

```bash
systemctl list-timers mya-gallery-notify.timer
```

Run it immediately and inspect its logs:

```bash
sudo systemctl start mya-gallery-notify.service
sudo journalctl -u mya-gallery-notify.service --since today
```

`Persistent=true` means systemd sends a missed report after the VM comes back online.
The endpoint requires `TELEGRAM_CRON_SECRET`; it does not use or store an administrator
password. Bot credentials and full ImgBB API keys are never included in the report.

### Oracle VM with Nginx

If uploads work locally but fail on the Oracle cloud VM for files around `1 MB` or larger, Nginx may be rejecting the request before it reaches Node. Base64 upload JSON is larger than the original image file.

Edit your Nginx site config:

```bash
sudo nano /etc/nginx/sites-available/imgbb-gallery
```

Add this inside the `server { ... }` block:

```nginx
client_max_body_size 25M;
```

Then test and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

After pulling app updates on the VM, restart PM2:

```bash
git pull
npm install
pm2 restart imgbb-gallery
```
