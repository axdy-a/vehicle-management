/**
 * Fleet log ingest — paste into Apps Script (script.google.com), bind to the same
 * Google account that owns the target Sheet.
 *
 * Setup:
 * 1. File → Project settings → Script properties → add FLEET_SECRET (e.g. grabmapssg or a stronger value).
 * 2. Replace SHEET_ID with your spreadsheet ID from the URL.
 * 3. Add a sheet tab named "Logs" or change SHEET_TAB below.
 * 4. Deploy → New deployment → Web app → Execute as Me, Who has access: Anyone.
 * 5. Copy the Web app URL into VITE_INGEST_URL when building the Vite app.
 */
const SHEET_ID = 'REPLACE_WITH_SPREADSHEET_ID';
const SHEET_TAB = 'Logs';

function doPost(e) {
  const lock =
    PropertiesService.getScriptProperties().getProperty('FLEET_SECRET') || '';

  /** @type {object} */
  let data = {};
  try {
    data = JSON.parse(e.postData.contents || '{}');
  } catch (ignore) {
    return jsonOut(false, 'Invalid JSON body');
  }

  if (!data || data.fleetSecret !== lock || !lock) {
    return jsonOut(false, 'Unauthorized');
  }

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_TAB) || ss.insertSheet(SHEET_TAB);

    // Header row created once — adjust columns to taste.
    // Existing sheets (old header): add column J title 'fitToDriveDeclared' manually, or recreate tab.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'submittedAt',
        'vehicleId',
        'plate',
        'vehicleLabel',
        'purpose',
        'mileageKm',
        'cashcardBalance',
        'photoCount',
        'photoNames',
        'fitToDriveDeclared',
      ]);
    }

    sheet.appendRow([
      data.submittedAt || '',
      data.vehicleId || '',
      data.plate || '',
      data.vehicleLabel || '',
      data.purpose || '',
      data.mileageKm || '',
      data.cashcardBalance || '',
      data.photoCount != null ? data.photoCount : '',
      Array.isArray(data.photoNames) ? data.photoNames.join(', ') : '',
      data.fitToDriveDeclared === true ? true : false,
    ]);

    return jsonOut(true);
  } catch (err) {
    return jsonOut(false, String(err && err.message ? err.message : err));
  }
}

function jsonOut(ok, message) {
  /** @type {GoogleAppsScript.Content.TextOutput} */
  const payload = JSON.stringify(ok ? { ok: true } : { ok: false, error: message });
  const out = ContentService.createTextOutput(payload);
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}
