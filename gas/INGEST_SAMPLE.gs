/**
 * Fleet log ingest — paste into Apps Script (script.google.com), bind to the same
 * Google account that owns the target Sheet + Drive folder.
 *
 * Setup:
 * 1. Script properties → FLEET_SECRET (must match app's fleet password at build).
 * 2. Drive uploads: paste your folder ID in DRIVE_FOLDER_ID below — same pattern as SHEET_ID.
 *    Example URL .../folders/1abcXYZ... → id is `1abcXYZ...`
 *    Or set Script property DRIVE_FOLDER_ID (overrides the constant).
 * 3. Replace SHEET_ID below (or use Script property SHEET_ID).
 * 4. Deploy → Web app → Execute as Me, Who has access: Anyone.
 * 5. VITE_INGEST_URL = web app URL.
 *
 * Large photos / many files can hit Apps Script payload or runtime limits — keep batches reasonable.
 */
const SHEET_ID = 'REPLACE_WITH_SPREADSHEET_ID';
/** Paste folder id from URL: drive.google.com/drive/folders/THIS_PART — or leave placeholder and use Script property DRIVE_FOLDER_ID. */
const DRIVE_FOLDER_ID = 'REPLACE_WITH_DRIVE_FOLDER_ID';
const SHEET_TAB = 'Logs';

/**
 * @param {string} folderId
 * @param {Array<{name?: string, mimeType?: string, base64?: string}>} uploads
 * @returns {string} newline-separated Drive URLs (single cell; click to open)
 */
function uploadPhotosToDrive_(folderId, uploads) {
  if (!folderId || !uploads || !uploads.length) {
    return '';
  }
  var folder = DriveApp.getFolderById(folderId);
  var stamp =
    Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyyMMdd-HHmmss',
    ) + '-' + Math.floor(Math.random() * 1e6);
  var links = [];
  for (var i = 0; i < uploads.length; i++) {
    var p = uploads[i];
    var raw = (p && p.base64) || '';
    if (!raw) {
      continue;
    }
    var name = safeFileName_(p.name || 'photo-' + i + '.jpg', stamp, i);
    var mime = (p.mimeType && String(p.mimeType)) || 'image/jpeg';
    var bytes = Utilities.base64Decode(raw);
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = folder.createFile(blob);
    links.push(file.getUrl());
  }
  return links.join('\n');
}

function safeFileName_(original, stamp, index) {
  var name = String(original || 'photo.jpg');
  var clean = name
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[\s._]+/, '')
    .slice(0, 100);
  if (!clean.length) {
    clean = 'photo.jpg';
  }
  var hasExt = /\.(jpe?g|png|gif|webp|heic)$/i.test(clean);
  if (!hasExt) {
    clean += '.jpg';
  }
  return stamp + '_' + index + '_' + clean;
}

function sheetId_() {
  return (
    PropertiesService.getScriptProperties().getProperty('SHEET_ID') || SHEET_ID
  );
}

function folderId_() {
  var id =
    PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID') ||
    DRIVE_FOLDER_ID;
  id = (id && String(id).trim()) || '';
  if (!id || id === 'REPLACE_WITH_DRIVE_FOLDER_ID') {
    return '';
  }
  return id;
}

function doPost(e) {
  var lock =
    PropertiesService.getScriptProperties().getProperty('FLEET_SECRET') || '';

  /** @type {object} */
  var data = {};
  try {
    data = JSON.parse(e.postData.contents || '{}');
  } catch (ignore) {
    return jsonOut(false, 'Invalid JSON body');
  }

  if (!data || data.fleetSecret !== lock || !lock) {
    return jsonOut(false, 'Unauthorized');
  }

  try {
    var sid = sheetId_();
    if (!sid || sid === 'REPLACE_WITH_SPREADSHEET_ID') {
      return jsonOut(
        false,
        'Configure SHEET_ID in the script constant or Script property SHEET_ID',
      );
    }

    var ss = SpreadsheetApp.openById(sid);
    var sheet = ss.getSheetByName(SHEET_TAB) || ss.insertSheet(SHEET_TAB);

    var uploads = Array.isArray(data.photoUploads) ? data.photoUploads : [];
    var folder = folderId_();
    var driveLinksCell = '';

    if (uploads.length > 0) {
      if (!folder || folder.trim() === '') {
        driveLinksCell =
          '[Photos not uploaded: add Script property DRIVE_FOLDER_ID]';
      } else {
        driveLinksCell = uploadPhotosToDrive_(folder.trim(), uploads);
      }
    }

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'submittedAt',
        'vehicleId',
        'plate',
        'vehicleLabel',
        'tripKind',
        'purpose',
        'mileageKm',
        'cashcardBalance',
        'photoCount',
        'photoNames',
        'fitToDriveDeclared',
        'photoDriveLinks',
      ]);
    }

    sheet.appendRow([
      data.submittedAt || '',
      data.vehicleId || '',
      data.plate || '',
      data.vehicleLabel || '',
      data.tripKind === 'return' ? 'return' : data.tripKind === 'draw' ? 'draw' : '',
      data.purpose || '',
      data.mileageKm || '',
      data.cashcardBalance || '',
      data.photoCount != null ? data.photoCount : '',
      Array.isArray(data.photoNames) ? data.photoNames.join(', ') : '',
      data.fitToDriveDeclared === true ? true : false,
      driveLinksCell,
    ]);

    return jsonOut(true);
  } catch (err) {
    return jsonOut(false, String(err && err.message ? err.message : err));
  }
}

function jsonOut(ok, message) {
  /** @type {GoogleAppsScript.Content.TextOutput} */
  var payload = JSON.stringify(
    ok ? { ok: true } : { ok: false, error: message },
  );
  var out = ContentService.createTextOutput(payload);
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}
