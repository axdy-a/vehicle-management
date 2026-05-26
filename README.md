# Fleet vehicle logs

Mobile-first web UI (Vite + React) with **Grab-inspired** colors and map-style chrome: green primary (**#02B150** family), muted ink (**#363A45**), mint accents (**#7BDCB5**). This theme is inspired by regional map/rider-driver apps and is **not** affiliated with Grab™; swap colors if you publish publicly.

## Run locally

```bash
npm install
npm run dev
```

Optional: copy `.env.example` to `.env` and set `VITE_FLEET_PASSWORD` to **override** the built-in default unlock code (`grabmapssg` when the env var is unset).

## Deploy to GitHub Pages

The workflow `.github/workflows/deploy-pages.yml` builds on every push to `main` and publishes `dist/` via **GitHub Actions Pages**.

1. Create the repo (private is fine) and push `main`.
2. In the repo: **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. After the first workflow run, open the site at `https://<owner>.github.io/<repo>/`.  
   CI sets `VITE_BASE_PATH=/<repo>/` so asset URLs match project Pages.

Local build (any base): `npm run build` → `dist/`. For a local preview that matches Pages, run  
`$env:VITE_BASE_PATH='/vehicle-management/'; npm run build` (replace with your repo name).

## Google side — what to set up

You have two practical paths. For “drivers have a fleet password, data goes to **my** Sheet,” **Apps Script** is usually enough and touches **Google Cloud** lightly.

### Path A — Google Apps Script (recommended to start)

No separate Cloud Run project is required. You still use Google’s infrastructure.

1. **Google Sheet**  
   Create a spreadsheet. Add header row, e.g.  
   `timestamp | vehicle_id | mileage_km | cashcard | photo_links | submitted_by_hint`

2. **Apps Script project**  
   Extensions → Apps Script (or script.google.com). Add a `doPost(e)` handler that:
   - Reads JSON body (vehicle, mileage, cashcard, optional base64 blobs or Drive file IDs).
   - Compares `Authorization` header or body field against a **fleet secret** stored in **Project Settings → Script properties** (`FLEET_SECRET`), not in the repo.
   - Appends rows to your sheet via Spreadsheet ID.

3. **Deploy as Web app**  
   Deploy → New deployment → type **Web app**.  
   - Execute as: **Me**  
   - Who has access: **Anyone** (required for anonymous drivers) *or* use a token/IP strategy you control.

4. **CORS**  
   Browsers POST from your GH Pages origin. Apps Script web apps sometimes need a **preflight workaround** or use `no-cors` patterns that are awkward. Common fixes:
   - Proxy through a tiny Cloudflare Worker, **or**
   - Use **`google.script.run`–only flows** won’t apply from static SPA — so prefer a **standalone script** deployed as Web App and test OPTIONS/POST from the browser early.

5. **Drive for photos** (optional)  
   In the same script, create files in a folder you own (`Drive.Files.insert` advanced service or DriveApp). Store links in the sheet.

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
