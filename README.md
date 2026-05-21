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

Open:

```text
http://127.0.0.1:3000/
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
