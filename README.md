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

The server loads `.env` automatically in local development.

Do not commit `.env`. It is already listed in `.gitignore`.

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

Upload requires `IMGBB_API_KEY`.

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
