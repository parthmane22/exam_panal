// =============================================================
//  EXAM SUPERVISOR PANEL — Google Apps Script Backend
//  Version: 2.0  (Full database — sessions, teachers, duties,
//                  peons, peon_duties)
// =============================================================
//
//  FIRST-TIME SETUP:
//  1. Open your Google Sheet
//  2. Extensions → Apps Script → delete all existing code
//  3. Paste this entire file → Save (Ctrl+S)
//  4. Run  initSheets()  once from the editor to create all sheets
//  5. Deploy → New Deployment
//       Type       : Web App
//       Execute as : Me
//       Who access : Anyone           ← IMPORTANT (not "signed-in")
//  6. Authorize → copy the Web App URL
//  7. Paste that URL into app.js  →  const GS_URL = "..."
//
//  AFTER EVERY CODE CHANGE:
//  Deploy → Manage Deployments → Edit → Version: New version → Deploy
// =============================================================

// ── Sheet names & their column headers ───────────────────────
var SCHEMA = {
  sessions: [
    "id", "term", "etype", "sem",
    "d1", "d2",   // exam date range (YYYY-MM-DD)
    "t1", "t2"    // exam time range (HH:MM)
  ],
  teachers: [
    "id", "name"
  ],
  duties: [
    "id", "session_id", "date", "teacher_id",
    "role", "hours", "rate", "amount",
    "block_no", "duty_t1", "duty_t2"
  ],
  peons: [
    "id", "name"
  ],
  peon_duties: [
    "id", "session_id", "date", "peon_id",
    "role", "duty_t1", "duty_t2",
    "block_floor", "amount", "sr_no",
    "floor_no", "blocks", "is_extra"
  ],
  peon_duty_floors: [
    "date", "session", "floor", "blocks", "peons"
  ],
  users: [
    "id", "mail", "password", "role"
  ]
};

// ── Create sheets if missing ──────────────────────────────────
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      Logger.log("Created sheet: " + name);
    }
    // Write header row only if sheet is completely empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(SCHEMA[name]);
      sheet.getRange(1, 1, 1, SCHEMA[name].length)
           .setFontWeight("bold")
           .setBackground("#d9e1f2");
      Logger.log("Added header to: " + name);
    }
  });
  Logger.log("initSheets complete.");
}

// ── Get sheet — throws if missing ────────────────────────────
function getSheet(name) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!s) throw new Error("Sheet not found: " + name);
  return s;
}

// ── Format raw cell value for JSON output ────────────────────
function formatCell(sheetName, colName, val) {
  if (val === null || val === undefined || val === "") return "";

  if (val instanceof Date) {
    var tz = Session.getScriptTimeZone();
    var timeColumns = ["t1", "t2", "duty_t1", "duty_t2"];
    var dateColumns = ["d1", "d2", "date"];
    if (timeColumns.indexOf(colName) !== -1) {
      return Utilities.formatDate(val, tz, "HH:mm");
    }
    if (dateColumns.indexOf(colName) !== -1) {
      return Utilities.formatDate(val, tz, "yyyy-MM-dd");
    }
    return Utilities.formatDate(val, tz, "yyyy-MM-dd HH:mm:ss");
  }

  return String(val);
}

// ── READ all rows from a sheet ────────────────────────────────
function getAllRows(sheetName) {
  var sheet   = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var data    = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  return data
    .filter(function (row) { return row[0] !== "" && row[0] !== null; })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) {
        obj[h] = formatCell(sheetName, h, row[i]);
      });
      return obj;
    });
}

// ── INSERT one row ────────────────────────────────────────────
function insertRow(sheetName, data) {
  var headers = SCHEMA[sheetName];
  if (!headers) return { status: "error", message: "Unknown sheet: " + sheetName };
  var row = headers.map(function (k) { return data[k] !== undefined ? data[k] : ""; });
  getSheet(sheetName).appendRow(row);
  return { status: "ok", id: data.id };
}

// ── INSERT many rows at once ──────────────────────────────────
function insertManyRows(sheetName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { status: "ok", inserted: 0 };
  rows.forEach(function (d) { insertRow(sheetName, d); });
  return { status: "ok", inserted: rows.length };
}

// ── UPDATE one row (matched by id) ───────────────────────────
function updateRow(sheetName, data) {
  var sheet   = getSheet(sheetName);
  var headers = SCHEMA[sheetName];
  if (!headers) return { status: "error", message: "Unknown sheet: " + sheetName };

  var idCol   = headers.indexOf("id") + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: "not_found" };

  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat().map(String);
  var idx = ids.indexOf(String(data.id));
  if (idx === -1) return { status: "not_found", searched: data.id };

  var row = headers.map(function (k) { return data[k] !== undefined ? data[k] : ""; });
  sheet.getRange(idx + 2, 1, 1, headers.length).setValues([row]);
  return { status: "ok", id: data.id };
}

// ── DELETE one row by id ──────────────────────────────────────
function deleteRow(sheetName, id) {
  var sheet   = getSheet(sheetName);
  var headers = SCHEMA[sheetName];
  var idCol   = headers.indexOf("id") + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: "not_found" };

  var ids      = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat().map(String);
  var searchId = String(id).trim();
  var idx      = ids.indexOf(searchId);
  if (idx === -1) {
    Logger.log("deleteRow: id not found: [" + searchId + "]  available: " + JSON.stringify(ids));
    return { status: "not_found", searched: searchId };
  }
  sheet.deleteRow(idx + 2);
  return { status: "ok", deleted: searchId };
}

// ── DELETE many rows by id array ─────────────────────────────
function deleteManyRows(sheetName, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { status: "ok", deleted: 0 };

  var sheet   = getSheet(sheetName);
  var headers = SCHEMA[sheetName];
  var idCol   = headers.indexOf("id") + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: "ok", deleted: 0 };

  var allIds = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat().map(String);
  var rowNums = [];
  ids.forEach(function (id) {
    var i = allIds.indexOf(String(id));
    if (i !== -1) rowNums.push(i + 2);
  });
  // Delete from bottom to top so row numbers stay valid
  rowNums.sort(function (a, b) { return b - a; });
  rowNums.forEach(function (r) { sheet.deleteRow(r); });
  return { status: "ok", deleted: rowNums.length };
}

// ── DELETE all rows linked to a session ──────────────────────
function deleteBySessionId(sheetName, sessionId) {
  var sheet   = getSheet(sheetName);
  var headers = SCHEMA[sheetName];
  var sCol    = headers.indexOf("session_id") + 1;
  if (sCol === 0) return { status: "error", message: "No session_id column in " + sheetName };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: "ok", deleted: 0 };

  var searchSid = String(sessionId).trim();
  var sids      = sheet.getRange(2, sCol, lastRow - 1, 1).getValues().flat().map(String);
  var rowNums   = [];
  sids.forEach(function (sid, idx) {
    if (sid.trim() === searchSid) rowNums.push(idx + 2);
  });
  rowNums.sort(function (a, b) { return b - a; });
  rowNums.forEach(function (r) { sheet.deleteRow(r); });
  Logger.log("deleteBySessionId: [" + searchSid + "] deleted=" + rowNums.length + " from " + sheetName);
  return { status: "ok", deleted: rowNums.length };
}

// ── Login verification — plain-text password (called via write payload) ──
function loginUser(params) {
  var mail     = params.mail     || "";
  var password = params.password || "";

  if (!mail.endsWith("@ves.ac.in")) {
    return { success: false, message: "Only VES email allowed" };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("users");
  if (!sheet || sheet.getLastRow() < 2) {
    return { success: false, message: "No users found" };
  }

  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === mail.trim() &&
        String(data[i][2]).trim() === password) {
      return { success: true, role: data[i][3], mail: mail };
    }
  }

  return { success: false, message: "Invalid email or password" };
}

// ── Route a write action ──────────────────────────────────────
function routeWrite(body) {
  var action    = body.action    || "";
  var sheetName = body.sheet     || "";
  var data      = body.data      || {};

  switch (action) {
    case "insert":                   return insertRow(sheetName, data);
    case "insertMany":               return insertManyRows(sheetName, data);
    case "update":                   return updateRow(sheetName, data);
    case "delete":                   return deleteRow(sheetName, data.id);
    case "deleteMany":               return deleteManyRows(sheetName, data.ids);
    case "deleteBySessionId":        return deleteBySessionId(sheetName, data.session_id);
    case "insertPeonDutyFloorWise":  return insertPeonDutyFloorWise(data);
    case "insertPeonBatch":          return insertPeonBatch(data);
    case "loginUser":                return loginUser(body);
    default:                         return { status: "error", message: "Unknown action: " + action };
  }
}

// ── Peon rule: 1-2 blocks → 1 peon, 3-4 → 2 peons, 5+ → 3 peons ──
function getPeonsForBlocks(blocks) {
  if (blocks <= 0) return 0;
  if (blocks <= 2) return 1;
  if (blocks <= 4) return 2;
  return 3; // 5 or more blocks always = 3 peons
}

// ── Insert floor-wise peon duty summary rows ─────────────────
// Expected data: { session, date, blocks: [2,3,1] }
// Inserts one row per floor into peon_duty_floors sheet.
function insertPeonDutyFloorWise(data) {
  var session  = data.session || "";
  var date     = data.date    || "";
  var blocks   = data.blocks  || [];

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { status: "error", message: "blocks array is empty or missing" };
  }

  var sheet = getSheet("peon_duty_floors");
  var inserted = 0;

  blocks.forEach(function(b, i) {
    var floorNum   = i + 1;
    var blockCount = parseInt(b) || 0;
    var peonCount  = getPeonsForBlocks(blockCount);
    sheet.appendRow([date, session, floorNum, blockCount, peonCount]);
    inserted++;
  });

  Logger.log("insertPeonDutyFloorWise: inserted=" + inserted + " rows for date=" + date);
  return { status: "ok", inserted: inserted };
}

// ── Batch-insert peon duty rows from the new JSON format ─────
// Accepts: { date, session, session_id, block_floor, peons:[{id,name,role,rate,is_extra}] }
// Inserts one row per peon into peon_duties.
function insertPeonBatch(data) {
  var date       = data.date       || "";
  var sessionId  = data.session_id || "";
  var blockFloor = data.block_floor || "";
  var dutyT1     = data.duty_t1    || "";
  var dutyT2     = data.duty_t2    || "";
  var peonArr    = data.peons      || [];

  if (!Array.isArray(peonArr) || peonArr.length === 0) {
    return { status: "error", message: "peons array is empty or missing" };
  }

  var inserted = 0;
  peonArr.forEach(function(p, i) {
    var row = {
      id:          String(Date.now() + i),
      session_id:  sessionId,
      date:        date,
      peon_id:     p.id     || "",
      role:        p.role   || "Peon",
      duty_t1:     dutyT1,
      duty_t2:     dutyT2,
      block_floor: blockFloor,
      amount:      p.rate   || 40,
      sr_no:       String(i + 1).padStart(2, "0"),
      floor_no:    "",
      blocks:      "",
      is_extra:    p.is_extra ? "yes" : "no"
    };
    insertRow("peon_duties", row);
    inserted++;
  });

  Logger.log("insertPeonBatch: inserted=" + inserted + " rows for date=" + date);
  return { status: "ok", inserted: inserted };
}

// ── JSONP helper ─────────────────────────────────────────────
function jsonpResponse(callback, data) {
  var json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ── doGet  — handles both reads (getAll) and writes (write) ──
//    The frontend uses JSONP via GET for both, since GAS does
//    not support custom CORS headers on POST.
function doGet(e) {
  try {
    var action   = e.parameter.action   || "";
    var sheet    = e.parameter.sheet    || "";
    var callback = e.parameter.callback || "";
    var result;

    // ── READ ──────────────────────────────────────────────────
    if (action === "getAll" && sheet) {
      result = getAllRows(sheet);

    // ── WRITE (tunneled through GET as JSON payload) ──────────
    } else if (action === "write") {
      // NOTE: e.parameter values are already URL-decoded by GAS.
      // Do NOT call decodeURIComponent() again — it corrupts JSON special chars.
      var payloadStr = e.parameter.payload || "";
      var body;
      try {
        body = JSON.parse(payloadStr);
      } catch (parseErr) {
        // Fallback: try decoding once in case the client double-encoded
        try {
          body = JSON.parse(decodeURIComponent(payloadStr));
        } catch (_) {
          return jsonpResponse(callback, { status: "error", message: "Cannot parse payload: " + parseErr.message });
        }
      }
      result = routeWrite(body);

    } else {
      result = { status: "error", message: "Bad parameters. Use action=getAll&sheet=X or action=write&payload=..." };
    }

    return jsonpResponse(callback, result);

  } catch (err) {
    Logger.log("doGet error: " + err.message);
    return jsonpResponse(e.parameter.callback || "", { status: "error", message: err.message });
  }
}

// ── doPost — fetch/CORS endpoint (preferred for writes) ─────
//    Frontend sends: POST with JSON body  { action, sheet, data }
//    GAS cannot set arbitrary CORS headers, but "Anyone" deployment
//    makes it accessible from Netlify via fetch with no-cors mode.
//    For full CORS (reading the response), the response below works
//    because GAS sets Access-Control-Allow-Origin: * automatically
//    for Web Apps deployed as "Anyone".
function doPost(e) {
  try {
    var raw  = e.postData && e.postData.contents ? e.postData.contents : "";
    var body;

    // Try JSON body first
    try { body = JSON.parse(raw); } catch (_) {}

    // Fall back to form-encoded  data=<urlencoded-json>
    if (!body) {
      var m = raw.match(/(?:^|&)data=([^&]*)/);
      if (m) {
        try { body = JSON.parse(decodeURIComponent(m[1].replace(/\+/g, " "))); } catch (_) {}
      }
    }

    if (!body) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Cannot parse request body" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var result = routeWrite(body);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Utility: run from editor to verify everything ────────────
function TEST_RUN() {
  initSheets();

  // Insert test records
  Logger.log(JSON.stringify(insertRow("teachers",    { id: "t_test", name: "Test Teacher" })));
  Logger.log(JSON.stringify(insertRow("peons",       { id: "p_test", name: "Test Peon" })));
  Logger.log(JSON.stringify(insertRow("sessions",    { id: "s_test", term: "I", etype: "Regular", sem: "1", d1: "2025-01-01", d2: "2025-01-10", t1: "10:00", t2: "12:00" })));
  Logger.log(JSON.stringify(insertRow("duties",      { id: "d_test", session_id: "s_test", date: "2025-01-01", teacher_id: "t_test", role: "Chief Conductor", hours: "2", rate: "200", amount: "400", block_no: "01", duty_t1: "10:00", duty_t2: "12:00" })));
  Logger.log(JSON.stringify(insertRow("peon_duties", { id: "pd_test", session_id: "s_test", date: "2025-01-01", peon_id: "p_test", role: "Peon", duty_t1: "10:00", duty_t2: "12:00", block_floor: "B1F1", amount: "40", sr_no: "1" })));

  // Read back
  Logger.log("Sessions: "    + JSON.stringify(getAllRows("sessions")));
  Logger.log("Teachers: "    + JSON.stringify(getAllRows("teachers")));
  Logger.log("Duties: "      + JSON.stringify(getAllRows("duties")));
  Logger.log("Peons: "       + JSON.stringify(getAllRows("peons")));
  Logger.log("Peon Duties: " + JSON.stringify(getAllRows("peon_duties")));

  // Clean up test data
  deleteRow("duties",      "d_test");
  deleteRow("peon_duties", "pd_test");
  deleteBySessionId("duties",      "s_test");
  deleteBySessionId("peon_duties", "s_test");
  deleteRow("sessions",    "s_test");
  deleteRow("teachers",    "t_test");
  deleteRow("peons",       "p_test");
  Logger.log("TEST_RUN complete — all test records cleaned up.");
}

// ── Utility: wipe all data rows (keeps headers) ──────────────
//    Use carefully — only for resetting during development!
function CLEAR_ALL_DATA() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
      Logger.log("Cleared: " + name);
    }
  });
  Logger.log("CLEAR_ALL_DATA done.");
}
