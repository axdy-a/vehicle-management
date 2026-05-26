# Fleet vehicle logs

Mobile-first web UI (Vite + React) with **Grab-inspired** colors and map-style chrome: green primary (**#02B150** family), muted ink (**#363A45**), mint accents (**#7BDCB5**). This theme is inspired by regional map/rider-driver apps and is **not** affiliated with Grab™; swap colors if you publish publicly.

## Run locally

```bash
npm install
npm run dev
```

Optional: copy `.env.example` to `.env` and set `VITE_FLEET_PASSWORD` to **override** the built-in default unlock code

## OCR (stay free)

**Tesseract.js** runs **in the browser**. Worker, WASM core, and English data are **copied into `public/ocr/`** by `scripts/copy-ocr-assets.mjs` on **`npm install`** / **`npm run build`** (from `tesseract.js`, `tesseract.js-core`, and `@tesseract.js-data/eng`). That keeps everything **same-origin** as your GitHub Pages app so **mobile Safari/Chrome** are not stuck at 0% loading language packs from a CDN.

Mileage/cash guesses are heuristic — **always confirm** before submitting. No Google Vision or paid OCR APIs.

## Deploy to GitHub Pages

The workflow `.github/workflows/deploy-pages.yml` builds on every push to `main` and publishes `dist/` via **GitHub Actions Pages**.

1. Create the repo (private is fine) and push `main`.
2. In the repo: **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. After the first workflow run, open the site at `https://<owner>.github.io/<repo>/`.  
   CI sets `VITE_BASE_PATH=/<repo>/` so asset URLs match project Pages.

Local build (any base): `npm run build` → `dist/`. For a local preview that matches Pages, run  
`$env:VITE_BASE_PATH='/vehicle-management/'; npm run build` (replace with your repo name).

### Sheet ingest URL (fix “Tap received…” on Submit)

1. In Google: create a Sheet and a tab (e.g. **`Logs`**).
2. Copy **`gas/INGEST_SAMPLE.gs`** into **Apps Script**. Set script properties:
   - **`FLEET_SECRET`** — same value as your app fleet password (`grabmapssg` or **`VITE_FLEET_PASSWORD`**).
   - **`DRIVE_FOLDER_ID`** — optional but required for uploads: either paste into **`gas/INGEST_SAMPLE.gs`** (`const DRIVE_FOLDER_ID = '…'` next to **`SHEET_ID`**) or set the **same-name** Script property (property wins). ID is the segment after `/folders/` in the Drive URL. Same Google account must own the folder; first save/run may ask you to authorize **Drive**.
   - Optionally **`SHEET_ID`** to override the `SHEET_ID` constant in code.
3. Replace **`SHEET_ID`** in `INGEST_SAMPLE.gs` with your spreadsheet ID if you’re not using the script property.
4. **Deploy** → **Web app** (**Execute as: Me**, **who has access: Anyone**).
5. In GitHub: **Settings → Secrets and variables → Actions** → repository **Variable** **`VITE_INGEST_URL`** = Web App URL.
6. Push to **`main`** (or re-run **Deploy to GitHub Pages**) so CI picks up **`VITE_INGEST_URL`**.

Submit sends **`photoUploads`** (`name`, `mimeType`, **base64**) plus row fields; the script saves images to **`DRIVE_FOLDER_ID`** and writes **`photoDriveLinks`** (newline-separated URLs) into the **`Logs`** tab. Large batches / huge photos can hit **Apps Script** POST or timeout limits — keep submits reasonable.

The app POSTs **`fleetSecret`** inside JSON with **`Content-Type: text/plain`** so mobile browsers avoid bad CORS preflights.

**Existing Logs sheet:** if you already have a header row, insert a new column **`photoDriveLinks`** before the next submit so columns line up.

## Google side — what to set up

You have two practical paths. For “drivers have a fleet password, data goes to **my** Sheet,” **Apps Script** is usually enough and touches **Google Cloud** lightly.

### Path A — Google Apps Script (recommended to start)

No separate Cloud Run project is required. You still use Google’s infrastructure.

1. **Google Sheet**  
   Create a spreadsheet. Add a **`Logs`** tab with a header row matching **`gas/INGEST_SAMPLE.gs`** (or let the script create it on first row):  
   `submittedAt | vehicleId | plate | vehicleLabel | purpose | mileageKm | cashcardBalance | photoCount | photoNames | fitToDriveDeclared | photoDriveLinks`

2. **Apps Script project**  
   Use **`gas/INGEST_SAMPLE.gs`** as your `doPost(e)` implementation. It:
   - Parses JSON from `e.postData.contents` (including **`photoUploads`** base64 blobs).
   - Compares **`fleetSecret`** to **Script property** **`FLEET_SECRET`**.
   - Appends rows to your sheet; optionally uploads photos to **Script property** **`DRIVE_FOLDER_ID`** and fills **`photoDriveLinks`**.

3. **Deploy as Web app**  
   Deploy → New deployment → type **Web app**.  
   - Execute as: **Me**  
   - Who has access: **Anyone** (required for anonymous drivers) *or* use a token/IP strategy you control.

4. **CORS**  
   Browsers POST from your GH Pages origin. Apps Script web apps sometimes need a **preflight workaround** or use `no-cors` patterns that are awkward. Common fixes:
   - Proxy through a tiny Cloudflare Worker, **or**
   - Use **`google.script.run`–only flows** won’t apply from static SPA — so prefer a **standalone script** deployed as Web App and test OPTIONS/POST from the browser early.

5. **Drive for photos**  
   Same sample script: set **`DRIVE_FOLDER_ID`** to a folder you own; submit payload includes **`photoUploads`** and the script writes **`photoDriveLinks`** (newline-separated URLs) into the row.

**Google Cloud involvement (optional for Apps Script):**  
Open [Google Cloud Console](https://console.cloud.google.com/) only if you enable extra APIs from script (e.g. Vision for OCR). Then: **enable API** → **billing** link on project → OAuth consent **Internal** vs **External** if you later add OAuth for admins.

---

### Path B — Google Cloud + Sheets/Drive APIs (full control)

Use when you want Cloud Logging, quotas, IAM, OCR (Vision API), Secret Manager.

1. **Create a GCP project** in Cloud Console.

2. **Billing** — attach a billing account (Drive/Sheets API calls are largely free tier–friendly but billing must be enabled for some APIs).

3. **Enable APIs** (APIs & Services → Library):
   - **Google Sheets API**
   - **Google Drive API**
   - Optional: **Cloud Vision API** (server-side OCR — do **not** put API keys in the static app).

4. **Service account**
   - IAM → Service Accounts → Create.
   - Create JSON key → store in **Secret Manager** or CI secrets (**never** in GitHub Pages bundle).
   - Open your Sheet → **Share** → add the service account email as **Editor** (or **Writer** as needed).
   - Same for a **Drive folder** if you upload photos server-side.

5. **Ingest endpoint**
   - Deploy **Cloud Run** or **Cloud Functions (2nd gen)** that:
     - Validates **fleet secret** (from Secret Manager).
     - Accepts `multipart/form-data` or JSON + files.
     - Calls Sheets/Drivewith the service account.
   - Optionally call **Vision API** for mileage/cashcard parsing; return suggested values to the app.

6. **Security**
   - Lock CORS to your `https://<user>.github.io` origin.
   - Rate-limit the function (Cloud Armor / API Gateway or app-level).

---

### What you do **not** need for drivers

- **No Google login** for drivers if your backend runs as **you** (Apps Script) or **service account** (Cloud), and drivers only enter the **fleet access code** checked server-side.

### Env in this repo

The app unlock screen uses `VITE_FLEET_PASSWORD` when set at build time; otherwise the default code is **`grabmapssg`**. Anyone can still read this from shipped JS — treat it as UX-only and validate the fleet secret server-side on Apps Script / Cloud.

---

## License

MIT (adjust as needed).
