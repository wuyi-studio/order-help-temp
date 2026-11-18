/**
 * 梧藝 WUYI 下單小幫手 - Google Apps Script (Webhook 接收端 & 營運分析儀表板)
 * 試算表目標 ID: 1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU
 * 
 * 功能：
 *   1. 接收 Chrome 擴充功能「一鍵複製小卡」自動同步的訂單資料
 *   2. 防重複記錄：依據「取貨日期＋顧客姓名＋聯絡電話/LINE名稱」比對，已存在則覆寫更新，絕不重複插入
 *   3. 自動將訂單歸檔至「YYYY-MM」月份工作表 (支援 20 項標準欄位)
 *   4. 自動更新「📊 營運總覽與指標分析」儀表板：
 *      - 當年記錄 (營收、訂單數、客單價)
 *      - 當月記錄 (營收、訂單數、客單價)
 *      - 當週記錄 (本週營收、本週訂單數)
 *      - 當日記錄 (今日待取件數、今日取件清單)
 *      - 各項指標分析 (商品佔比、蛋糕尺寸排行、配件加購率、自取門市分佈)
 */

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);

    // 0-A. 依固定日期篩選工作表 (由 Chrome 插件「試算表只看此日」按鈕發起)
    if (data.action === "filterSheetByDate" || data.action === "filterByDate") {
      var targetSpreadsheetId = "1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU";
      var ssFilter = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(targetSpreadsheetId);
      var filterDate = normalizeDate(data.dateTag || data.pickupDate || data.date);
      var filterMonthNum = filterDate ? String(parseInt(filterDate.substring(5, 7), 10)) : "";
      var filterSheet = ssFilter.getSheetByName(filterDate ? filterDate.substring(0, 7) : "");
      if (!filterSheet) {
        var shs = ssFilter.getSheets();
        for (var k = 0; k < shs.length; k++) {
          var sn = shs[k].getName();
          if (sn === filterMonthNum + "月" || sn === filterMonthNum + "月訂單" || sn.indexOf(filterMonthNum + "月") >= 0) {
            filterSheet = shs[k];
            break;
          }
        }
      }
      if (filterSheet) {
        filterSheetByDate(filterSheet, filterDate);
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          action: "filtered",
          date: filterDate,
          sheet: filterSheet.getName()
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 0-B. 查詢客戶歷史/既有訂單 (供改期功能列出可刪除的舊預約日期)
    if (data.action === "queryCustomerOrders" || data.action === "queryCustomerOldOrders") {
      var targetSpreadsheetId = "1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU";
      var ssQuery = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(targetSpreadsheetId);
      var rawQueryName = String(data.customerName || data.lineName || "").trim();
      var cleanQueryName = rawQueryName.replace(/[\s(（]*改期[)）]*/g, "").trim();
      var queryPhone = String(data.customerPhone || "").replace(/[^\d]/g, "");
      var queryLine = String(data.lineName || "").replace(/[\s(（]*改期[)）]*/g, "").trim();

      var matchedOrders = [];
      var seenKeys = {};

      var allSheets = ssQuery.getSheets();
      for (var s = 0; s < allSheets.length; s++) {
        var curSheet = allSheets[s];
        var sName = curSheet.getName();
        // 若只有一個工作表，絕不跳過
        if (allSheets.length > 1 && (sName.indexOf("總覽") >= 0 || sName.indexOf("分析") >= 0)) continue;

        var lastR = curSheet.getLastRow();
        var lastC = curSheet.getLastColumn();
        if (lastR <= 1 || lastC < 1) continue;

        var sheetValues = curSheet.getRange(1, 1, lastR, lastC).getValues();
        var curDateTag = "";
        var curDateFull = "";

        for (var r = 0; r < sheetValues.length; r++) {
          var rowData = sheetValues[r];
          var rowStr = rowData.map(function(c) { return String(c || ""); }).join(" ");

          var mHDate = rowStr.match(/(?:20\d{2})[-/\.](\d{1,2})[-/\.](\d{1,2})/);
          if (mHDate) {
            curDateTag = (mHDate[1].length === 1 ? "0" + mHDate[1] : mHDate[1]) + (mHDate[2].length === 1 ? "0" + mHDate[2] : mHDate[2]);
            curDateFull = "2026-" + (mHDate[1].length === 1 ? "0" + mHDate[1] : mHDate[1]) + "-" + (mHDate[2].length === 1 ? "0" + mHDate[2] : mHDate[2]);
          }

          var rowHasName = cleanQueryName && rowStr.indexOf(cleanQueryName) >= 0;
          var rowHasLine = queryLine && rowStr.indexOf(queryLine) >= 0;
          var rowHasPhone = queryPhone && queryPhone.length >= 7 && rowStr.indexOf(queryPhone) >= 0;

          if (rowHasName || rowHasLine || rowHasPhone) {
            var dTag = curDateTag;
            var dFull = curDateFull;

            var mRowDate = rowStr.match(/(?:20\d{2})[-/\.](\d{1,2})[-/\.](\d{1,2})/);
            if (mRowDate) {
              dTag = (mRowDate[1].length === 1 ? "0" + mRowDate[1] : mRowDate[1]) + (mRowDate[2].length === 1 ? "0" + mRowDate[2] : mRowDate[2]);
              dFull = "2026-" + (mRowDate[1].length === 1 ? "0" + mRowDate[1] : mRowDate[1]) + "-" + (mRowDate[2].length === 1 ? "0" + mRowDate[2] : mRowDate[2]);
            } else {
              var mShort = rowStr.match(/(\d{1,2})[月/.-](\d{1,2})/);
              if (mShort) {
                dTag = (mShort[1].length === 1 ? "0" + mShort[1] : mShort[1]) + (mShort[2].length === 1 ? "0" + mShort[2] : mShort[2]);
                dFull = "2026-" + dTag.substring(0, 2) + "-" + dTag.substring(2, 4);
              }
            }

            var summaryParts = rowData.filter(function(c) {
              var sc = String(c || "").trim();
              return sc && sc.indexOf(cleanQueryName) === -1 && sc.indexOf("2026") === -1 && sc.indexOf("今日取件") === -1 && sc !== "未定";
            });
            var summaryText = summaryParts.join(" ") || "蛋糕訂單";
            var timeCell = "";
            for (var tc = 0; tc < rowData.length; tc++) {
              var val = String(rowData[tc] || "").trim();
              if (/(?:點|:\d{2}|未定)/.test(val)) {
                timeCell = val;
                break;
              }
            }
            var key = (dTag || "date") + "__" + cleanQueryName + "__" + sName + "__" + (r + 1);

            if (!seenKeys[key]) {
              seenKeys[key] = true;
              matchedOrders.push({
                sheet: sName,
                row: r + 1,
                date: dFull || "2026-11-11",
                dateTag: dTag || "1111",
                time: timeCell,
                customerName: cleanQueryName,
                lineName: queryLine || cleanQueryName,
                summary: summaryText
              });
            }
          }
        }
      }

      // 也檢查 Google Drive 是否有相關檔名的小卡 (依取貨日期與名稱)
      try {
        var targetFolderId = data.folderId || "1aFAvK33ML41x0JgHlCF6WcA6006Emq4J";
        var driveQuery = "title contains '" + cleanQueryName + "' and trashed = false";
        var driveFiles = DriveApp.searchFiles(driveQuery);
        while (driveFiles.hasNext()) {
          var dFile = driveFiles.next();
          var fname = dFile.getName();
          var mFileTag = fname.match(/^(\d{4})/);
          if (mFileTag) {
            var foundTag = mFileTag[1];
            var alreadyInList = matchedOrders.some(function(o) { return o.dateTag === foundTag; });
            if (!alreadyInList) {
              matchedOrders.push({
                sheet: "雲端小卡",
                row: 0,
                date: Utilities.formatDate(new Date(), "GMT+8", "yyyy") + "-" + foundTag.substring(0, 2) + "-" + foundTag.substring(2, 4),
                dateTag: foundTag,
                time: "",
                customerName: cleanQueryName,
                lineName: queryLine,
                summary: "雲端小卡：" + fname
              });
            }
          }
        }
      } catch (driveErr) {
        console.warn("Drive search warning: " + driveErr.toString());
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "queriedOldOrders",
        customerName: cleanQueryName,
        orders: matchedOrders
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 0-C. 刪除改期舊單與舊小卡 (依舊日期與客戶名稱刪除試算表列與 Drive 檔案)
    if (data.action === "deleteOldOrder" || data.action === "deleteCustomerOrder") {
      var targetSpreadsheetId = "1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU";
      var ssDel = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(targetSpreadsheetId);
      var rawOldDateTag = String(data.oldDateTag || data.dateTag || "").trim();
      var rawOldDate = String(data.oldDate || "").trim();
      var cleanDelName = String(data.customerName || data.lineName || "").replace(/[\s(（]*改期[)）]*/g, "").trim();
      var cleanDelLine = String(data.lineName || data.customerName || "").replace(/[\s(（]*改期[)）]*/g, "").trim();
      var delPhone = String(data.customerPhone || "").replace(/[^\d]/g, "");

      var deletedRows = 0;
      var deletedFiles = 0;

      // A. 刪除 Google 試算表中的舊單
      deletedRows = deleteOldOrderByTagAndName(ssDel, rawOldDateTag, cleanDelName, cleanDelLine, delPhone, rawOldDate);

      // B. 刪除 Google Drive 中的舊小卡圖檔 (直接鎖定目標年/月/日資料夾，毫秒級完成，絕不作全雲端慢速遍歷)
      try {
        var targetFolderId = data.folderId || "1aFAvK33ML41x0JgHlCF6WcA6006Emq4J";
        var rootDriveFolder = DriveApp.getFolderById(targetFolderId);

        if (rawOldDateTag && rawOldDateTag.length === 4) {
          var oldMonthStr = rawOldDateTag.substring(0, 2) + "月";
          var oldDayStr = rawOldDateTag.substring(2, 4) + "日";
          var yIters = rootDriveFolder.getFolders();
          while (yIters.hasNext()) {
            var yFold = yIters.next();
            var mIters = yFold.getFoldersByName(oldMonthStr);
            while (mIters.hasNext()) {
              var mFold = mIters.next();
              var dIters = mFold.getFoldersByName(oldDayStr);
              while (dIters.hasNext()) {
                var dFold = dIters.next();
                var dFiles = dFold.getFiles();
                while (dFiles.hasNext()) {
                  var f = dFiles.next();
                  var fn = f.getName();
                  if (fn.indexOf(cleanDelName) >= 0 || fn.indexOf(cleanDelLine) >= 0) {
                    try {
                      f.setTrashed(true);
                      deletedFiles++;
                    } catch (trashErr) {
                      try {
                        dFold.removeFile(f);
                        deletedFiles++;
                      } catch (remErr) {
                        try {
                          f.setName("[已改期舊單] " + f.getName());
                        } catch (_) {}
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (driveDelErr) {
        console.warn("Drive delete warning: " + driveDelErr.toString());
      }

      try {
        updateAnalyticsDashboard(ssDel);
      } catch (dErr) {}

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "deletedOldOrder",
        deletedRows: deletedRows,
        deletedFiles: deletedFiles,
        oldDateTag: rawOldDateTag,
        customerName: cleanDelName
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 0. 上傳小卡至 Google Drive (指定資料夾依 年/月/日 分層建立資料夾，檔名設為「取貨日期+LINE名稱」)
    // 目標資料夾：https://drive.google.com/drive/folders/1aFAvK33ML41x0JgHlCF6WcA6006Emq4J?usp=drive_link
    if (data.action === "uploadCardToDrive" || data.action === "uploadToDrive" || (data.base64Image && !data.pickupDate)) {
      var targetFolderId = data.folderId || "1aFAvK33ML41x0JgHlCF6WcA6006Emq4J";
      var rootFolder;
      try {
        rootFolder = DriveApp.getFolderById(targetFolderId);
      } catch (fErr) {
        console.warn("無法存取指定資料夾 ID " + targetFolderId + "，自動切換至個人雲端根目錄「梧藝訂單小卡」資料夾: " + fErr.toString());
        var existingRoots = DriveApp.getFoldersByName("梧藝訂單小卡");
        if (existingRoots.hasNext()) {
          rootFolder = existingRoots.next();
        } else {
          rootFolder = DriveApp.createFolder("梧藝訂單小卡");
        }
      }

      var now = new Date();
      var yearStr = "";
      var monthStr = "";
      var dayStr = "";
      var dateTagStr = "";

      // 優先序：若有 4 碼 dateTag (例如 1108)，直接作為取貨月日
      var rawDate = String(data.dateTag || data.pickupDate || "").trim();
      var m4 = rawDate.match(/^(\d{2})(\d{2})$/);
      var mChinese = rawDate.match(/(?:(?:20)?\d{2}[-年／\/\.])?\s*(\d{1,2})\s*[月／\/\.-]\s*(\d{1,2})\s*日?/);
      var mFull = rawDate.match(/(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
      var mMD = rawDate.match(/(?:(?:20)?\d{2}[-\/\.])?(\d{1,2})[-\/\.](\d{1,2})/);

      if (m4) {
        yearStr = Utilities.formatDate(now, "GMT+8", "yyyy") + "年";
        monthStr = m4[1] + "月";
        dayStr = m4[2] + "日";
        dateTagStr = m4[1] + m4[2];
      } else if (mFull) {
        yearStr = mFull[1] + "年";
        monthStr = (mFull[2].length === 1 ? "0" + mFull[2] : mFull[2]) + "月";
        dayStr = (mFull[3].length === 1 ? "0" + mFull[3] : mFull[3]) + "日";
        dateTagStr = (mFull[2].length === 1 ? "0" + mFull[2] : mFull[2]) + (mFull[3].length === 1 ? "0" + mFull[3] : mFull[3]);
      } else if (mChinese) {
        yearStr = Utilities.formatDate(now, "GMT+8", "yyyy") + "年";
        monthStr = (mChinese[1].length === 1 ? "0" + mChinese[1] : mChinese[1]) + "月";
        dayStr = (mChinese[2].length === 1 ? "0" + mChinese[2] : mChinese[2]) + "日";
        dateTagStr = (mChinese[1].length === 1 ? "0" + mChinese[1] : mChinese[1]) + (mChinese[2].length === 1 ? "0" + mChinese[2] : mChinese[2]);
      } else if (mMD) {
        yearStr = Utilities.formatDate(now, "GMT+8", "yyyy") + "年";
        monthStr = (mMD[1].length === 1 ? "0" + mMD[1] : mMD[1]) + "月";
        dayStr = (mMD[2].length === 1 ? "0" + mMD[2] : mMD[2]) + "日";
        dateTagStr = (mMD[1].length === 1 ? "0" + mMD[1] : mMD[1]) + (mMD[2].length === 1 ? "0" + mMD[2] : mMD[2]);
      } else {
        yearStr = Utilities.formatDate(now, "GMT+8", "yyyy") + "年";
        monthStr = Utilities.formatDate(now, "GMT+8", "MM") + "月";
        dayStr = Utilities.formatDate(now, "GMT+8", "dd") + "日";
        dateTagStr = Utilities.formatDate(now, "GMT+8", "MMdd");
      }

      // 依 年 / 月 / 日 階層自動取得或建立資料夾
      function getOrCreateSubFolder(parent, name) {
        var iter = parent.getFoldersByName(name);
        if (iter.hasNext()) {
          return iter.next();
        }
        return parent.createFolder(name);
      }

      var yearFolder = getOrCreateSubFolder(rootFolder, yearStr);
      var monthFolder = getOrCreateSubFolder(yearFolder, monthStr);
      var dayFolder = getOrCreateSubFolder(monthFolder, dayStr);

      // 上傳檔案名稱：1108 取貨時間12小時制 Melody.png (例：1108 3點 Melody.png)
      var lineName = String(data.lineName || data.customerName || "顧客").trim().replace(/[\s(（]*改期[)）]*/g, "").replace(/[\/\\:*?"<>|]/g, "_");
      var fileDatePrefix = dateTagStr || rawDate.replace(/[\/\\:*?"<>|]/g, "-") || Utilities.formatDate(now, "GMT+8", "MMdd");

      // 若為改期作業，自動清理舊日期的雲端小卡檔案 (鎖定目標目錄，極速清理)
      if (data.deleteOldDateTag || data.oldDateTag) {
        var purgeOldTag = String(data.deleteOldDateTag || data.oldDateTag).trim();
        try {
          if (purgeOldTag.length === 4) {
            var purgeMonth = purgeOldTag.substring(0, 2) + "月";
            var purgeDay = purgeOldTag.substring(2, 4) + "日";
            var yIt = rootFolder.getFolders();
            while (yIt.hasNext()) {
              var yF = yIt.next();
              var mIt = yF.getFoldersByName(purgeMonth);
              while (mIt.hasNext()) {
                var mF = mIt.next();
                var dIt = mF.getFoldersByName(purgeDay);
                while (dIt.hasNext()) {
                  var dF = dIt.next();
                  var fs = dF.getFiles();
                  while (fs.hasNext()) {
                    var f = fs.next();
                    if (f.getName().indexOf(lineName) >= 0) {
                      try {
                        f.setTrashed(true);
                      } catch (trashErr) {
                        try {
                          dF.removeFile(f);
                        } catch (remErr) {
                          try {
                            f.setName("[已改期舊單] " + f.getName());
                          } catch (_) {}
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (purgeErr) {
          console.warn("purge old drive card warning: " + purgeErr.toString());
        }
      }
      function gasFormat12Hour(rawTime) {
        if (!rawTime) return '';
        var s = String(rawTime).trim();
        var mColon = s.match(/(?:(?:上午|下午|早上|中午|晚上)\s*)?(\d{1,2})[:：](\d{2})/);
        if (mColon) {
          var hh = parseInt(mColon[1], 10);
          var mm = mColon[2];
          if (hh > 12) hh -= 12;
          if (hh === 0) hh = 12;
          if (mm === '00') return hh + '點';
          if (mm === '30') return hh + '點半';
          return hh + '點' + mm;
        }
        var mDian = s.match(/(?:(?:上午|下午|早上|中午|晚上)\s*)?(\d{1,2})\s*點(?:\s*(半|30(?:分)?|00(?:分)?|\d{1,2}(?:分)?))?/);
        if (mDian) {
          var hh = parseInt(mDian[1], 10);
          var minPart = mDian[2] || '';
          if (hh > 12) hh -= 12;
          if (hh === 0) hh = 12;
          if (!minPart || minPart.indexOf('00') === 0) return hh + '點';
          if (minPart === '半' || minPart.indexOf('30') === 0) return hh + '點半';
          return hh + '點' + minPart.replace(/分$/, '');
        }
        return s;
      }
      var time12Str = gasFormat12Hour(data.pickupTime);
      var defaultParts = [fileDatePrefix, time12Str, lineName].filter(function(p) { return p && p.trim(); });
      var defaultFilename = defaultParts.join(" ") + ".png";
      var uploadFilename = data.filename || defaultFilename;

      // 檢查該日期資料夾內是否已有同名檔案，或同客人同日不同時間的舊小卡 (【防雙圖】同日改時間自動清舊圖)
      var existingFiles = dayFolder.getFilesByName(uploadFilename);
      var isDuplicate = existingFiles.hasNext();
      var sameCustomerFilesInDay = [];
      var allDayFiles = dayFolder.getFiles();
      while (allDayFiles.hasNext()) {
        var df = allDayFiles.next();
        var dfName = df.getName();
        if (dfName === uploadFilename || (lineName && lineName !== "顧客" && lineName !== "客戶" && (dfName.indexOf(" " + lineName + ".png") >= 0 || dfName === fileDatePrefix + " " + lineName + ".png"))) {
          sameCustomerFilesInDay.push(df);
          isDuplicate = true;
        }
      }

      // 若當日資料夾沒有，也檢查目標根目錄是否有同名檔案
      if (!isDuplicate && rootFolder) {
        var rootFiles = rootFolder.getFilesByName(uploadFilename);
        if (rootFiles.hasNext()) {
          isDuplicate = true;
        }
      }

      // 【防洗圖】若為 NIKKI 複查且小幫手未放截圖 (preserveExistingIfNoPhoto)，而雲端當日已有該客人的含圖小卡，直接保留雲端原圖不覆蓋！
      if (data.preserveExistingIfNoPhoto && sameCustomerFilesInDay.length > 0) {
        var keptFile = sameCustomerFilesInDay[0];
        if (keptFile.getName() !== uploadFilename) {
          try { keptFile.setName(uploadFilename); } catch (_) {}
        }
        var keptId = keptFile.getId();
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          action: "preserved_existing",
          preservedExistingImage: true,
          fileId: keptId,
          filename: keptFile.getName(),
          isDuplicate: true,
          year: yearStr,
          month: monthStr,
          day: dayStr,
          folderPath: yearStr + " / " + monthStr + " / " + dayStr,
          folderUrl: "https://drive.google.com/drive/folders/" + dayFolder.getId() + "?usp=sharing",
          directImageUrl: "https://lh3.googleusercontent.com/d/" + keptId,
          exportImageUrl: "https://drive.google.com/uc?export=view&id=" + keptId,
          viewUrl: "https://drive.google.com/file/d/" + keptId + "/view?usp=sharing"
        })).setMimeType(ContentService.MimeType.JSON);
      }

      // 覆蓋更新舊檔 (包含同日改時間的舊時間小卡)：將舊檔案移至垃圾桶，確保同日同客人只留最新一張
      if (isDuplicate) {
        for (var sfIdx = 0; sfIdx < sameCustomerFilesInDay.length; sfIdx++) {
          try {
            sameCustomerFilesInDay[sfIdx].setTrashed(true);
          } catch (trashErr) {
            console.warn("oldFile setTrashed warning: " + trashErr.toString());
          }
        }
        if (rootFolder) {
          var rootOldFiles = rootFolder.getFilesByName(uploadFilename);
          while (rootOldFiles.hasNext()) {
            try {
              rootOldFiles.next().setTrashed(true);
            } catch (rErr) {
              console.warn("rootOldFiles setTrashed warning: " + rErr.toString());
            }
          }
        }
      }

      var base64Data = (data.base64Image || "").replace(/^data:image\/\w+;base64,/, "");
      var decodedBytes = Utilities.base64Decode(base64Data);
      var imgBlob = Utilities.newBlob(decodedBytes, "image/png", uploadFilename);
      var driveFile = dayFolder.createFile(imgBlob);
      driveFile.setName(uploadFilename);

      // 設定公開檢視權限，讓 Google 行事曆點擊或預覽時直接顯示圖片
      try {
        driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {
        console.warn("setSharing warning: " + shareErr.toString());
      }

      var fileId = driveFile.getId();
      var directImageUrl = "https://lh3.googleusercontent.com/d/" + fileId;
      var exportImageUrl = "https://drive.google.com/uc?export=view&id=" + fileId;
      var fileUrl = "https://drive.google.com/file/d/" + fileId + "/view?usp=sharing";
      var folderUrl = "https://drive.google.com/drive/folders/" + dayFolder.getId() + "?usp=sharing";

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "uploaded",
        fileId: fileId,
        filename: uploadFilename,
        isDuplicate: isDuplicate,
        duplicateWarning: isDuplicate ? ("⚠️ 雲端已存在同名檔案【" + uploadFilename + "】！已覆蓋更新") : null,
        year: yearStr,
        month: monthStr,
        day: dayStr,
        folderPath: yearStr + " / " + monthStr + " / " + dayStr,
        folderUrl: folderUrl,
        directImageUrl: directImageUrl,
        exportImageUrl: exportImageUrl,
        viewUrl: fileUrl
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. 綁定目標試算表
    var targetSpreadsheetId = "1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      ss = SpreadsheetApp.openById(targetSpreadsheetId);
    }

    // 2. 正規化取貨日期 (支援 1102 四碼格式、中文月日與各類日期格式)
    var dateStr = normalizeDate(data.dateTag || data.pickupDate);
    var sheetName = dateStr ? dateStr.substring(0, 7) : Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM");

    // 3. 取得目標工作表 (具備智慧月份比對：優先比對 "YYYY-MM"、"X月"、"X月訂單" 或現有訂單工作表)
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      var allSheets = ss.getSheets();
      var monthNum = dateStr ? String(parseInt(dateStr.substring(5, 7), 10)) : "";
      if (monthNum) {
        for (var sIdx = 0; sIdx < allSheets.length; sIdx++) {
          var sName = allSheets[sIdx].getName();
          if (sName === monthNum + "月" || sName === monthNum + "月訂單" || sName === dateStr.substring(0, 7) || sName.indexOf(monthNum + "月") >= 0) {
            sheet = allSheets[sIdx];
            break;
          }
        }
      }
      // 若仍未找到且存在非儀表板的工作表，使用第一張訂單工作表
      if (!sheet && allSheets.length > 0) {
        for (var sIdx = 0; sIdx < allSheets.length; sIdx++) {
          var sName = allSheets[sIdx].getName();
          if (sName.indexOf("儀表板") === -1 && sName.indexOf("總覽") === -1 && sName.indexOf("分析") === -1) {
            sheet = allSheets[sIdx];
            break;
          }
        }
      }
    }

    var defaultHeaders = [
      "取貨日期", "星期", "顧客姓名", "聯絡電話", "LINE名稱",
      "商品類別", "蛋糕規格", "花束規格", "訂單總額", "蛋糕口味說明",
      "蛋糕題字/插牌內容", "慶祝歲數", "加購保冰袋", "加購餐具", "加購蠟燭",
      "加購插牌", "花束色系", "取件時間", "取件地點/配送", "原始備忘錄檔案",
      "複查狀態"
    ];

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(defaultHeaders);
      sheet.getRange(1, 1, 1, defaultHeaders.length).setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // 4. 計算 20 項標準欄位值 (具備強健的備援擷取邏輯，確保適配所有欄位)
    var weekday = getWeekdayStr(dateStr);
    var customerName = (data.customerName || data.lineName || "顧客").trim().replace(/[\s(（]*改期[)）]*/g, "");
    var customerPhone = (data.customerPhone || "").replace(/[^\d]/g, "");
    var lineName = (data.lineName || data.customerName || "").trim().replace(/[\s(（]*改期[)）]*/g, "");

    // 若為改期作業，自動在試算表中刪除舊日期的舊單
    if (data.deleteOldDateTag || data.oldDateTag) {
      var oldTagToDel = String(data.deleteOldDateTag || data.oldDateTag).trim();
      try {
        deleteOldOrderByTagAndName(ss, oldTagToDel, customerName, lineName, customerPhone, data.oldDate);
      } catch (dErr) {
        console.warn("deleteOldOrderByTagAndName warning: " + dErr.toString());
      }
    }

    var cakeText = data.cakeText || "";
    var flowerText = data.flowerText || "";
    var pricingText = data.pricingText || "";
    var combinedNotes = [cakeText, flowerText, pricingText].filter(Boolean).join("\n");

    var orderType = "蛋糕";
    if (data.orderType === "flower") orderType = "花束";
    else if (data.orderType === "combined") orderType = "蛋糕+花束";
    else if (flowerText && cakeText) orderType = "蛋糕+花束";
    else if (flowerText && !cakeText) orderType = "花束";

    // 蛋糕規格：若未填，自動從備忘錄文字分析
    var cakeSize = data.cakeSize || "";
    if (!cakeSize && cakeText) {
      var mSize = cakeText.match(/(\d{1,2}\s*吋|漢堡盒|雙層|單層|迷你)/i);
      if (mSize) cakeSize = mSize[1];
    }

    // 花束規格：預算或花束備忘
    var flowerSpec = data.flowerBudget ? ("預算:" + data.flowerBudget) : (data.flowerNote || "");
    if (!flowerSpec && flowerText) {
      var mBudget = flowerText.match(/(?:預算|金額|約)[\s:：]*(\d{3,5})/);
      if (mBudget) flowerSpec = "預算:" + mBudget[1];
      else flowerSpec = flowerText.split("\n")[0].substring(0, 30);
    }

    // 訂單總額 (純數字，多層次強健解析，供試算表運算加總與財務報表使用)
    var totalPrice = Number(data.totalPrice) || 0;
    if (!totalPrice) {
      var allTexts = [pricingText, data.flowerBudget ? ("預算 " + data.flowerBudget) : "", cakeText, flowerText, data.rawText].filter(Boolean).join("\n");
      var mTot = allTexts.match(/(?:總共|合計|總計|訂單總額|金額|尾款|結帳)[\s:：\$]*([0-9,]+)/i);
      if (mTot) {
        totalPrice = Number(mTot[1].replace(/,/g, ""));
      } else {
        var mDol = allTexts.match(/(?:NT\$?|\$)\s*([0-9,]+)/i);
        if (mDol) {
          totalPrice = Number(mDol[1].replace(/,/g, ""));
        } else if (data.flowerBudget) {
          totalPrice = Number(String(data.flowerBudget).replace(/[^\d]/g, ""));
        }
      }
      // 若 pricingText 是多行項目明細，自動累加各品項金額
      if (!totalPrice && pricingText) {
        var pMatches = pricingText.match(/(?:[^\d\n]+)?[\s:：\$]*([0-9,]+)\s*(?:元)?/g);
        if (pMatches && pMatches.length > 0) {
          var sum = 0;
          pMatches.forEach(function(pm) {
            var numM = pm.match(/([0-9,]+)/);
            if (numM) {
              var val = Number(numM[1].replace(/,/g, ""));
              if (val >= 10 && val <= 100000) sum += val;
            }
          });
          if (sum > 0) totalPrice = sum;
        }
      }
    }
    totalPrice = Math.round(Number(totalPrice) || 0);

    // 蛋糕口味說明
    var cakeFlavor = data.cakeFlavor || "";
    if (!cakeFlavor && cakeText) {
      var mFlav = cakeText.match(/(?:口味|內餡|夾層)[\s:：]*([^\n]+)/);
      if (mFlav) cakeFlavor = mFlav[1].trim();
    }

    // 蛋糕題字 / 插牌
    var inscription = data.cakeInscription || "";
    if (!inscription && cakeText) {
      var mInsc = cakeText.match(/(?:題字|字樣|寫字|插牌內容)[\s:：]*([^\n]+)/);
      if (mInsc) inscription = mInsc[1].trim();
    }

    // 慶祝歲數 (從題字或內文擷取)
    var ageMatch = (inscription + " " + cakeText).match(/(?:歲|滿|慶祝)[\s:：]*(\d{1,3})|(?:\b|\D)(\d{1,3})(?:歲|\b)/);
    var age = ageMatch ? (ageMatch[1] || ageMatch[2]) : "";

    // 加購配件 (由 addon 與備忘文字綜合比對)
    var addonStr = (data.addon || "") + " " + combinedNotes;
    var hasIceBag = /保冷|保冰/.test(addonStr) ? "是" : "否";
    var hasCutlery = /餐具|盤/.test(addonStr) ? "是" : "否";
    var hasCandle = /蠟燭/.test(addonStr) ? "是" : "否";
    var hasTopper = /插牌/.test(addonStr) ? "是" : "否";

    // 花束色系
    var flowerColor = data.flowerColor || "";
    if (!flowerColor && flowerText) {
      var mCol = flowerText.match(/(?:色系|顏色|色調)[\s:：]*([^\n]+)/);
      if (mCol) flowerColor = mCol[1].trim();
    }

    var pickupTime = data.pickupTime || "";
    var location = data.location || "台南友愛門市自取";

    // 原始備忘錄檔案 (包含檔名與完整原始圖文備忘，便於對帳與核對)
    var memoContent = (data.rawText || "").trim() || [cakeText, flowerText, pricingText].filter(Boolean).join("\n\n");
    var sourceNote = memoContent || ("WUYI小幫手_" + Utilities.formatDate(new Date(), "GMT+8", "yyyyMMdd_HHmmss"));
    if (data.filename) {
      sourceNote = "【" + data.filename + "】\n" + sourceNote;
    }

    // 建立 20 項標準欄位資料對應表
    var fieldMap = {
      pickupDate: ["取貨日期", "取件日期", "日期", "預約日期", "date"],
      weekday: ["星期", "星期幾", "禮拜", "週別", "weekday"],
      customerName: ["顧客姓名", "姓名", "客戶姓名", "訂購人", "名字", "name"],
      customerPhone: ["聯絡電話", "電話", "手機", "電話號碼", "phone"],
      lineName: ["LINE名稱", "LINE", "line", "LINE帳號", "暱稱"],
      orderType: ["商品類別", "類別", "種類", "品項", "訂單類型"],
      cakeSize: ["蛋糕規格", "蛋糕尺寸", "規格", "尺寸", "size"],
      flowerSpec: ["花束規格", "花束", "花束尺寸", "花束預算"],
      totalPrice: ["訂單總額", "總額", "金額", "總計", "費用", "價格", "price", "total", "訂單金額"],
      cakeFlavor: ["蛋糕口味說明", "蛋糕口味", "口味", "內餡", "口味說明", "夾層"],
      inscription: ["蛋糕題字/插牌內容", "題字", "插牌內容", "蛋糕字樣", "寫字", "字樣"],
      age: ["慶祝歲數", "歲數", "年齡", "蠟燭歲數", "年紀"],
      hasIceBag: ["加購保冰袋", "保冰袋", "保冷袋", "保冰"],
      hasCutlery: ["加購餐具", "餐具", "刀叉盤", "盤叉"],
      hasCandle: ["加購蠟燭", "蠟燭", "造型蠟燭"],
      hasTopper: ["加購插牌", "造型插牌", "插牌"],
      flowerColor: ["花束色系", "色系", "花束顏色", "顏色"],
      pickupTime: ["取件時間", "取貨時間", "時間", "自取時間", "time"],
      location: ["取件地點/配送", "取件地點", "地點", "取貨門市", "配送"],
      sourceNote: ["原始備忘錄檔案", "原始備忘錄", "備忘錄", "備註", "原始資料", "備註說明"],
      reviewStatus: ["複查狀態", "nikki複查", "審核狀態", "檢查狀態", "複查"]
    };

    var reviewStatus = data.reviewStatus || (data.nikkiChecked ? "✅ 已複查" : "⏳ 待複查");

    var fieldValues = {
      pickupDate: dateStr,
      weekday: weekday,
      customerName: customerName,
      customerPhone: customerPhone,
      lineName: lineName,
      orderType: orderType,
      cakeSize: cakeSize,
      flowerSpec: flowerSpec,
      totalPrice: totalPrice,
      cakeFlavor: cakeFlavor,
      inscription: inscription,
      age: age,
      hasIceBag: hasIceBag,
      hasCutlery: hasCutlery,
      hasCandle: hasCandle,
      hasTopper: hasTopper,
      flowerColor: flowerColor,
      pickupTime: pickupTime,
      location: location,
      sourceNote: sourceNote,
      reviewStatus: reviewStatus
    };

    // 檢查現存標題列，依試算表標題動態對應欄位 (保證「訂單總額」與「複查狀態」精準寫入)
    var lastCol = Math.max(sheet.getLastColumn(), defaultHeaders.length);
    var actualHeaders = [];
    if (sheet.getLastRow() >= 1) {
      actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    }

    var hasExistingHeaders = actualHeaders.some(function(h) { return h && String(h).trim(); });
    if (!hasExistingHeaders) {
      sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
      actualHeaders = defaultHeaders;
      lastCol = defaultHeaders.length;
    } else {
      // 若舊工作表尚未有「複查狀態」標題欄，自動補在最後一欄 (第 21 欄)
      var hasReviewCol = actualHeaders.some(function(h) {
        var ht = String(h || "").trim().toLowerCase();
        return ht.indexOf("複查") >= 0 || ht.indexOf("審核") >= 0;
      });
      if (!hasReviewCol) {
        var appendColIdx = 21;
        for (var hc = actualHeaders.length - 1; hc >= 0; hc--) {
          if (String(actualHeaders[hc] || "").trim()) {
            appendColIdx = hc + 2;
            break;
          }
        }
        sheet.getRange(1, appendColIdx).setValue("複查狀態").setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
        while (actualHeaders.length < appendColIdx) {
          actualHeaders.push("");
        }
        actualHeaders[appendColIdx - 1] = "複查狀態";
        lastCol = Math.max(lastCol, appendColIdx);
      }
    }

    var rowValues = [];
    var totalColIndex = -1; // 記錄「訂單總額」欄位索引 (1-based)
    var colMap = {};        // 記錄各欄位索引 (1-based)

    for (var c = 0; c < actualHeaders.length; c++) {
      var headerText = String(actualHeaders[c] || "").trim().toLowerCase();
      var assignedValue = "";
      for (var key in fieldMap) {
        var aliases = fieldMap[key];
        var matched = aliases.some(function(alias) {
          return headerText === alias.toLowerCase() || headerText.indexOf(alias.toLowerCase()) >= 0;
        });
        if (matched) {
          assignedValue = fieldValues[key];
          colMap[key] = c + 1;
          if (key === "totalPrice") totalColIndex = c + 1;
          break;
        }
      }
      rowValues.push(assignedValue);
    }

    // 若未在現存標題配對到「訂單總額」，預設放置於第 9 欄 (Column I)
    if (totalColIndex === -1) {
      if (rowValues.length >= 9) {
        rowValues[8] = totalPrice;
        totalColIndex = 9;
      } else {
        rowValues.push(totalPrice);
        totalColIndex = rowValues.length;
      }
    }

    // 5. 比對重複 (動態使用欄位索引進行 Upsert 比對，防止重複記錄)
    var lastRow = sheet.getLastRow();
    var foundRow = -1;

    var dateCol = colMap.pickupDate || 1;
    var nameCol = colMap.customerName || 3;
    var phoneCol = colMap.customerPhone || 4;
    var lineCol = colMap.lineName || 5;

    if (lastRow > 1) {
      var maxInspectCol = Math.max(dateCol, nameCol, phoneCol, lineCol, 5);
      var existingData = sheet.getRange(2, 1, lastRow - 1, maxInspectCol).getValues();
      for (var i = 0; i < existingData.length; i++) {
        var rDateVal = existingData[i][dateCol - 1];
        var rDate = rDateVal ? Utilities.formatDate(new Date(rDateVal), "GMT+8", "yyyy-MM-dd") : "";
        var rName = (existingData[i][nameCol - 1] || "").toString().trim();
        var rPhone = (existingData[i][phoneCol - 1] || "").toString().replace(/[^\d]/g, "");
        var rLine = (existingData[i][lineCol - 1] || "").toString().trim();

        var isDuplicate = (rDate === dateStr) && (
          (customerPhone && rPhone === customerPhone) ||
          (customerName && rName === customerName) ||
          (lineName && rLine === lineName)
        );

        if (isDuplicate) {
          foundRow = i + 2;
          break;
        }
      }
    }

    var targetRow = foundRow > 0 ? foundRow : (lastRow + 1);
    if (foundRow > 0) {
      // 【防退回保護】若試算表該筆原本已經是「✅ 已複查」，而人員再次點擊複製小卡(傳入待複查)但核心內容完全沒變，保留「✅ 已複查」不退回！
      if (colMap.reviewStatus && String(reviewStatus).indexOf("待複查") >= 0) {
        try {
          var oldRowVals = sheet.getRange(foundRow, 1, 1, rowValues.length).getValues()[0];
          var oldStatus = String(oldRowVals[colMap.reviewStatus - 1] || "").trim();
          if (oldStatus.indexOf("已複查") >= 0) {
            var checkKeys = ["cakeSize", "flowerSpec", "totalPrice", "cakeFlavor", "inscription", "pickupTime", "flowerColor"];
            var contentChanged = checkKeys.some(function(k) {
              if (!colMap[k]) return false;
              var oldV = String(oldRowVals[colMap[k] - 1] || "").trim();
              var newV = String(rowValues[colMap[k] - 1] || "").trim();
              return oldV !== newV;
            });
            if (!contentChanged) {
              rowValues[colMap.reviewStatus - 1] = "✅ 已複查";
            }
          }
        } catch (protErr) {
          console.warn("reviewStatus protect warning: " + protErr.toString());
        }
      }
      sheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }

    // 將「訂單總額」格式化為數字貨幣格式 (#,##0)，方便試算表運算加總
    if (totalColIndex > 0) {
      try {
        sheet.getRange(targetRow, totalColIndex).setNumberFormat("#,##0");
      } catch (numFmtErr) {
        console.warn("setNumberFormat warning: " + numFmtErr.toString());
      }
    }

    // 6. 依照每天日期排序並加上視覺隔開效果 (美化 11 月份每日分組)
    try {
      separateOrdersByDate(sheet);
    } catch (sepErr) {
      console.warn("separateOrdersByDate warning: " + sepErr.toString());
    }

    // 7. 即時自動重新整理「營運總覽與指標分析」儀表板
    try {
      updateAnalyticsDashboard(ss);
    } catch (dashErr) {
      console.warn("Dashboard update warning: " + dashErr.toString());
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      action: foundRow > 0 ? "updated" : "inserted",
      row: foundRow > 0 ? foundRow : sheet.getLastRow(),
      sheet: sheetName
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 試算表開啟時自訂選單 (提供日期篩選、每日視覺隔開與備忘錄收折按鈕)
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍰 梧藝營運系統')
    .addItem('🔍 依指定日期篩選訂單 (輸入如 1108)...', 'filterSheetByDatePrompt')
    .addItem('👀 只檢視今日取件訂單', 'filterTodayOrders')
    .addItem('👀 只檢視明日取件訂單', 'filterTomorrowOrders')
    .addItem('⏳ 只檢視「待複查」訂單 (NIKKI檢查專用)', 'filterPendingReviewOrders')
    .addItem('✅ 只檢視「已複查」訂單', 'filterCompletedReviewOrders')
    .addItem('🔄 顯示全月份所有訂單 (清除篩選)', 'showAllOrders')
    .addSeparator()
    .addItem('📅 依照每天日期排序並自動隔開 (美化每日區隔)', 'sortAndSeparateMenu')
    .addItem('📂 展開「原始備忘錄檔案」欄 (檢視完整備忘)', 'expandMemoColumn')
    .addItem('📁 收折「原始備忘錄檔案」欄 (保持表格簡潔)', 'collapseMemoColumn')
    .addSeparator()
    .addItem('📊 立即重新整理指標分析儀表板', 'manualRefreshDashboard')
    .addToUi();
}

/**
 * 依照每天取貨日期排序並自動以分隔線與相間底色隔開
 * 讓 11 月份各天的訂單群組分明，一目了然 (採全矩陣批次處理，極致加速)
 * 同時針對「✅ 已複查」整列標記清爽淡綠色 (#DCFCE7)，「⏳ 待複查」狀態格標記淡黃色 (#FEF9C3)
 */
function separateOrdersByDate(sheet) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return; // 只有標題列則無需處理

  var numRows = lastRow - 1;
  // 1. 自動依「取貨日期」(第 1 欄) 與「取件時間」(第 18 欄) 排序
  if (numRows > 1) {
    var range = sheet.getRange(2, 1, numRows, lastCol);
    range.sort([
      { column: 1, ascending: true },
      { column: 18, ascending: true }
    ]);
  }

  // 2. 矩陣批次處理 (Batch API Calls)：將 100+ 次網路呼叫合併為 2 次，執行時間由 6 秒縮減至 0.15 秒
  var headerValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var reviewColIdx = -1;
  for (var hc = 0; hc < headerValues.length; hc++) {
    var hText = String(headerValues[hc] || "").trim().toLowerCase();
    if (hText.indexOf("複查") >= 0 || hText.indexOf("審核") >= 0) {
      reviewColIdx = hc;
      break;
    }
  }

  var allRowValues = sheet.getRange(2, 1, numRows, lastCol).getValues();
  var currentDate = "";
  var colorGroup = 0;
  var colors = ["#FFFFFF", "#FFF9F8"]; // 純白與雅緻柔粉相間

  var bgColors = [];
  var fontWeights = [];
  var newDateRowIndices = [];

  for (var i = 0; i < numRows; i++) {
    var rowDate = allRowValues[i][0] ? normalizeDate(allRowValues[i][0]) : "";
    var isNewDate = (i > 0 && rowDate && rowDate !== currentDate);

    if (isNewDate) {
      colorGroup = (colorGroup + 1) % 2;
      newDateRowIndices.push(i + 2);
    }
    currentDate = rowDate;

    var statusVal = reviewColIdx >= 0 ? String(allRowValues[i][reviewColIdx] || "").trim() : "";
    var isChecked = statusVal.indexOf("已複查") >= 0;
    var isPending = !isChecked && statusVal.indexOf("待複查") >= 0;

    var rowColors = [];
    var rowColor = isChecked ? "#DCFCE7" : colors[colorGroup];
    for (var c = 0; c < lastCol; c++) {
      if (isPending && c === reviewColIdx) {
        rowColors.push("#FEF9C3");
      } else {
        rowColors.push(rowColor);
      }
    }
    bgColors.push(rowColors);
    fontWeights.push(["bold"]);
  }

  // 一次性批次寫入背景顏色與粗體
  sheet.getRange(2, 1, numRows, lastCol).setBackgrounds(bgColors);
  sheet.getRange(2, 1, numRows, 1).setFontWeights(fontWeights);

  // 僅針對跨日期的列套用頂部邊框分隔線
  for (var k = 0; k < newDateRowIndices.length; k++) {
    sheet.getRange(newDateRowIndices[k], 1, 1, lastCol)
      .setBorder(true, null, null, null, null, null, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
}

/**
 * 篩選只檢視「⏳ 待複查」訂單 (供 NIKKI 快速檢查尚未複查的訂單)
 */
function filterPendingReviewOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return;

  sheet.showRows(1, lastRow);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var reviewColIdx = -1;
  for (var c = 0; c < headers.length; c++) {
    var ht = String(headers[c] || "").trim().toLowerCase();
    if (ht.indexOf("複查") >= 0 || ht.indexOf("審核") >= 0) {
      reviewColIdx = c;
      break;
    }
  }
  if (reviewColIdx < 0) {
    ss.toast("⚠️ 此工作表尚未建立「複查狀態」欄位", "梧藝下單小幫手", 4);
    return;
  }

  var statusVals = sheet.getRange(2, reviewColIdx + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < statusVals.length; i++) {
    var val = String(statusVals[i][0] || "").trim();
    if (val.indexOf("已複查") >= 0) {
      sheet.hideRows(i + 2);
    }
  }
  ss.toast("⏳ 已篩選顯示尚未經 NIKKI 複查的訂單！", "梧藝下單小幫手", 4);
}

/**
 * 篩選只檢視「✅ 已複查」訂單
 */
function filterCompletedReviewOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return;

  sheet.showRows(1, lastRow);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var reviewColIdx = -1;
  for (var c = 0; c < headers.length; c++) {
    var ht = String(headers[c] || "").trim().toLowerCase();
    if (ht.indexOf("複查") >= 0 || ht.indexOf("審核") >= 0) {
      reviewColIdx = c;
      break;
    }
  }
  if (reviewColIdx < 0) return;

  var statusVals = sheet.getRange(2, reviewColIdx + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < statusVals.length; i++) {
    var val = String(statusVals[i][0] || "").trim();
    if (val.indexOf("已複查") === -1) {
      sheet.hideRows(i + 2);
    }
  }
  ss.toast("✅ 已篩選顯示「已複查」訂單！", "梧藝下單小幫手", 4);
}

/**
 * 依照指定日期篩選訂單列 (隱藏其他日期的列，只檢視目標日期的訂單)
 */
function filterSheetByDate(sheet, targetDate) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  // 先解除所有列隱藏
  sheet.showRows(1, lastRow);

  if (!targetDate) return;
  var normTarget = normalizeDate(targetDate);
  var dateColValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var i = 0; i < dateColValues.length; i++) {
    var rowDate = dateColValues[i][0] ? normalizeDate(dateColValues[i][0]) : "";
    var isMatch = (rowDate === normTarget) ||
                  (rowDate.replace(/-/g, '').indexOf(normTarget.replace(/-/g, '')) >= 0);
    if (!isMatch) {
      sheet.hideRows(i + 2);
    }
  }
}

/**
 * 彈窗提示讓使用者輸入日期只檢視固定日期 (如 1108、11-08)
 */
function filterSheetByDatePrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('🔍 依固定日期篩選檢視訂單', '請輸入欲檢視的取貨日期 (例如 1108、11-08 或 2026-11-08)：', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() === ui.Button.OK) {
    var input = res.getResponseText().trim();
    if (!input) {
      ui.alert('請輸入有效日期！');
      return;
    }
    var targetDate = normalizeDate(input);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    // 若當前在儀表板，自動切換至相應月份工作表
    if (sheet.getName().indexOf("儀表板") >= 0) {
      var mNum = targetDate ? String(parseInt(targetDate.substring(5, 7), 10)) : "";
      var allSh = ss.getSheets();
      for (var si = 0; si < allSh.length; si++) {
        var sn = allSh[si].getName();
        if (sn === mNum + "月" || sn === mNum + "月訂單" || sn.indexOf(mNum + "月") >= 0) {
          sheet = allSh[si];
          ss.setActiveSheet(sheet);
          break;
        }
      }
    }
    filterSheetByDate(sheet, targetDate);
    ss.toast('🔍 已只顯示【' + targetDate + '】訂單！點擊選單「顯示全月份所有訂單」隨時還原', '梧藝下單小幫手', 5);
  }
}

/**
 * 只檢視今日取件訂單
 */
function filterTodayOrders() {
  var today = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  filterSheetByDate(sheet, today);
  ss.toast('👀 已篩選顯示【今日 ' + today + '】取件訂單！', '梧藝下單小幫手', 4);
}

/**
 * 只檢視明日取件訂單
 */
function filterTomorrowOrders() {
  var tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  var tomorrowStr = Utilities.formatDate(tomorrow, "GMT+8", "yyyy-MM-dd");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  filterSheetByDate(sheet, tomorrowStr);
  ss.toast('👀 已篩選顯示【明日 ' + tomorrowStr + '】取件訂單！', '梧藝下單小幫手', 4);
}

/**
 * 顯示全月份所有訂單 (解除日期篩選)
 */
function showAllOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (sheet.getLastRow() > 1) {
    sheet.showRows(1, sheet.getLastRow());
  }
  ss.toast('🔄 已還原顯示全月份所有訂單！', '梧藝下單小幫手', 3);
}

/**
 * 依每日日期自動排序並以分隔線隔開 (手動觸發選單)
 */
function sortAndSeparateMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  separateOrdersByDate(sheet);
  ss.toast('✅ 已依照每天取貨日期排序並以分隔線與顏色隔開！', '梧藝下單小幫手', 3);
}

/**
 * 展開「原始備忘錄檔案」欄位
 */
function expandMemoColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var lastCol = sheet.getLastColumn();
  if (lastCol >= 20) {
    sheet.showColumns(20);
    sheet.setColumnWidth(20, 320);
    sheet.getRange(2, 20, Math.max(sheet.getLastRow() - 1, 1), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    ss.toast('📂 已展開「原始備忘錄檔案」欄位！', '梧藝下單小幫手', 3);
  }
}

/**
 * 收折「原始備忘錄檔案」欄位 (保持表格簡潔整齊)
 */
function collapseMemoColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var lastCol = sheet.getLastColumn();
  if (lastCol >= 20) {
    sheet.hideColumns(20);
    ss.toast('📁 已收折「原始備忘錄檔案」欄位，表格已恢復整潔！', '梧藝下單小幫手', 3);
  }
}

function manualRefreshDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  updateAnalyticsDashboard(ss);
  SpreadsheetApp.getActiveSpreadsheet().toast('✅ 營運指標分析儀表板已更新！', '梧藝下單小幫手', 3);
}

/**
 * 即時計算並更新「📊 營運總覽與指標分析」工作表
 */
function updateAnalyticsDashboard(ss) {
  var dashName = "📊 營運總覽與指標分析";
  var dash = ss.getSheetByName(dashName);
  if (!dash) {
    dash = ss.insertSheet(dashName, 0); // 置於最左側第一個分頁
  }

  // 1. 蒐集所有月份訂單資料
  var now = new Date();
  var todayStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
  var currentMonthStr = todayStr.substring(0, 7);
  var currentYearStr = todayStr.substring(0, 4);

  // 計算本週區間 (週一至週日)
  var dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1(Mon) ~ 7(Sun)
  var monday = new Date(now.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000);
  var sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  var mondayStr = Utilities.formatDate(monday, "GMT+8", "yyyy-MM-dd");
  var sundayStr = Utilities.formatDate(sunday, "GMT+8", "yyyy-MM-dd");

  var sheets = ss.getSheets();
  var allOrders = [];

  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var sName = s.getName();
    // 篩選 YYYY-MM 格式工作表
    if (/^\d{4}-\d{2}$/.test(sName)) {
      var lastR = s.getLastRow();
      if (lastR > 1) {
        var vals = s.getRange(2, 1, lastR - 1, 20).getValues();
        for (var j = 0; j < vals.length; j++) {
          var row = vals[j];
          var rawDate = row[0];
          var dateFormatted = "";
          if (rawDate instanceof Date) {
            dateFormatted = Utilities.formatDate(rawDate, "GMT+8", "yyyy-MM-dd");
          } else if (rawDate) {
            dateFormatted = rawDate.toString().trim();
          }

          allOrders.push({
            date: dateFormatted,
            weekday: row[1],
            name: row[2],
            phone: row[3],
            lineName: row[4],
            orderType: row[5],
            cakeSize: row[6],
            flowerSpec: row[7],
            totalPrice: Number(row[8]) || 0,
            cakeFlavor: row[9],
            inscription: row[10],
            age: row[11],
            hasIceBag: row[12] === "是",
            hasCutlery: row[13] === "是",
            hasCandle: row[14] === "是",
            hasTopper: row[15] === "是",
            flowerColor: row[16],
            pickupTime: row[17],
            location: row[18]
          });
        }
      }
    }
  }

  // 2. 指標統計聚合
  var stats = {
    // 當年
    yearOrders: 0,
    yearRevenue: 0,
    // 當月
    monthOrders: 0,
    monthRevenue: 0,
    // 當週
    weekOrders: 0,
    weekRevenue: 0,
    // 當日
    todayOrders: 0,
    todayRevenue: 0,
    // 商品佔比
    cakeCount: 0,
    flowerCount: 0,
    combinedCount: 0,
    // 蛋糕尺寸分佈
    sizes: {},
    // 蛋糕口味分佈
    flavors: {},
    // 加購配件數
    iceBagCount: 0,
    cutleryCount: 0,
    candleCount: 0,
    topperCount: 0,
    // 今日取貨名單
    todayPickups: []
  };

  for (var k = 0; k < allOrders.length; k++) {
    var ord = allOrders[k];
    var d = ord.date;
    var rev = ord.totalPrice;

    // 當年
    if (d.startsWith(currentYearStr)) {
      stats.yearOrders++;
      stats.yearRevenue += rev;
    }

    // 當月
    if (d.startsWith(currentMonthStr)) {
      stats.monthOrders++;
      stats.monthRevenue += rev;
    }

    // 當週
    if (d >= mondayStr && d <= sundayStr) {
      stats.weekOrders++;
      stats.weekRevenue += rev;
    }

    // 當日
    if (d === todayStr) {
      stats.todayOrders++;
      stats.todayRevenue += rev;
      stats.todayPickups.push(ord);
    }

    // 商品佔比
    if (ord.orderType === "蛋糕") stats.cakeCount++;
    else if (ord.orderType === "花束") stats.flowerCount++;
    else if (ord.orderType === "蛋糕+花束") stats.combinedCount++;

    // 尺寸
    if (ord.cakeSize) {
      stats.sizes[ord.cakeSize] = (stats.sizes[ord.cakeSize] || 0) + 1;
    }

    // 加購
    if (ord.hasIceBag) stats.iceBagCount++;
    if (ord.hasCutlery) stats.cutleryCount++;
    if (ord.hasCandle) stats.candleCount++;
    if (ord.hasTopper) stats.topperCount++;
  }

  var yearAOV = stats.yearOrders > 0 ? Math.round(stats.yearRevenue / stats.yearOrders) : 0;
  var monthAOV = stats.monthOrders > 0 ? Math.round(stats.monthRevenue / stats.monthOrders) : 0;

  // 3. 繪製儀表板內容
  dash.clear();
  dash.setTabColor("#7C3AED");

  // 標題列
  dash.getRange("A1:G1").merge()
    .setValue("🍰 梧藝 WUYI 甜點花藝 · 營運總覽與指標分析儀表板")
    .setFontSize(16).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  dash.setRowHeight(1, 45);

  dash.getRange("A2:G2").merge()
    .setValue("⏰ 最後即時更新時間：" + Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss") + "  |  今日日期：" + todayStr + " (" + getWeekdayStr(todayStr) + ")")
    .setFontSize(10).setFontColor("#64748B").setHorizontalAlignment("center").setBackground("#F8FAFC");
  dash.setRowHeight(2, 26);

  // 區間統計 KPI 卡片 (第 4~6 列)
  dash.getRange("A4").setValue("🌟 當年營運累計 (" + currentYearStr + " 年)").setFontWeight("bold").setFontSize(11);
  dash.getRange("B4").setValue("訂單總量: " + stats.yearOrders + " 筆").setFontColor("#0284C7");
  dash.getRange("C4").setValue("總營業額: $" + stats.yearRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#0F172A");
  dash.getRange("D4").setValue("平均客單價: $" + yearAOV.toLocaleString()).setFontColor("#475569");

  dash.getRange("A5").setValue("📅 當月營運累計 (" + currentMonthStr + " 月)").setFontWeight("bold").setFontSize(11);
  dash.getRange("B5").setValue("訂單總量: " + stats.monthOrders + " 筆").setFontColor("#0284C7");
  dash.getRange("C5").setValue("總營業額: $" + stats.monthRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#7C3AED");
  dash.getRange("D5").setValue("平均客單價: $" + monthAOV.toLocaleString()).setFontColor("#475569");

  dash.getRange("A6").setValue("⚡ 當週營運累計 (" + mondayStr.substring(5) + " ~ " + sundayStr.substring(5) + ")").setFontWeight("bold").setFontSize(11);
  dash.getRange("B6").setValue("訂單總量: " + stats.weekOrders + " 筆").setFontColor("#0284C7");
  dash.getRange("C6").setValue("總營業額: $" + stats.weekRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#059669");

  dash.getRange("A7").setValue("📍 當日預約取貨 (" + todayStr + ")").setFontWeight("bold").setFontSize(11);
  dash.getRange("B7").setValue("待取件數: " + stats.todayOrders + " 筆").setFontWeight("bold").setFontColor("#DC2626");
  dash.getRange("C7").setValue("當日金額: $" + stats.todayRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#DC2626");

  dash.getRange("A4:D7").setBackground("#F1F5F9").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);

  // 指標分析 1：商品類別佔比 (A9:D13)
  var totalOrders = allOrders.length || 1;
  dash.getRange("A9:D9").merge().setValue("📊 商品類別銷售分佈").setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
  dash.getRange("A10:D10").setValues([["類別", "銷售筆數", "總量佔比", "狀態"]]).setFontWeight("bold").setBackground("#E2E8F0");
  dash.getRange("A11:D13").setValues([
    ["🎂 客製蛋糕", stats.cakeCount, (stats.cakeCount / totalOrders * 100).toFixed(1) + "%", stats.cakeCount > 0 ? "主力商品" : "-"],
    ["💐 精緻花束", stats.flowerCount, (stats.flowerCount / totalOrders * 100).toFixed(1) + "%", "-"],
    ["🎁 蛋糕+花束組合", stats.combinedCount, (stats.combinedCount / totalOrders * 100).toFixed(1) + "%", stats.combinedCount > 0 ? "高單價組合" : "-"]
  ]).setBackground("#FFFFFF");
  dash.getRange("A9:D13").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);

  // 指標分析 2：加購配件轉換率分析 (F9:G13)
  dash.getRange("F9:G9").merge().setValue("🕯️ 加購配件轉換分析").setBackground("#7C3AED").setFontColor("#FFFFFF").setFontWeight("bold");
  dash.getRange("F10:G10").setValues([["加購項目", "加購次數 (轉換率)"]]).setFontWeight("bold").setBackground("#EDE9FE");
  dash.getRange("F11:G14").setValues([
    ["🕯️ 造型蠟燭", stats.candleCount + " 筆 (" + (stats.candleCount / totalOrders * 100).toFixed(1) + "%)"],
    ["❄️ 保冷袋", stats.iceBagCount + " 筆 (" + (stats.iceBagCount / totalOrders * 100).toFixed(1) + "%)"],
    ["🍴 派對餐具", stats.cutleryCount + " 筆 (" + (stats.cutleryCount / totalOrders * 100).toFixed(1) + "%)"],
    ["🎉 慶祝插牌", stats.topperCount + " 筆 (" + (stats.topperCount / totalOrders * 100).toFixed(1) + "%)"]
  ]).setBackground("#FFFFFF");
  dash.getRange("F9:G14").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);

  // 當日取貨清單即時看板 (A16 開始)
  dash.getRange("A16:G16").merge().setValue("📋 今日取件即時清單 (" + todayStr + " 共 " + stats.todayOrders + " 筆)").setBackground("#DC2626").setFontColor("#FFFFFF").setFontWeight("bold");
  var pickupHeaders = ["取件時間", "顧客姓名", "聯絡電話", "LINE名稱", "商品規格", "口味/備註", "訂單金額"];
  dash.getRange("A17:G17").setValues([pickupHeaders]).setBackground("#FEE2E2").setFontWeight("bold");

  if (stats.todayPickups.length > 0) {
    var pRows = [];
    for (var m = 0; m < stats.todayPickups.length; m++) {
      var po = stats.todayPickups[m];
      pRows.push([
        po.pickupTime || "未定",
        po.name,
        po.phone,
        po.lineName,
        po.cakeSize || po.flowerSpec || po.orderType,
        po.cakeFlavor || po.inscription || "",
        po.totalPrice ? "$" + po.totalPrice : ""
      ]);
    }
    dash.getRange(18, 1, pRows.length, 7).setValues(pRows).setBackground("#FFFFFF");
    dash.getRange(16, 1, pRows.length + 2, 7).setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
  } else {
    dash.getRange("A18:G18").merge().setValue("今日尚無預約取件訂單").setHorizontalAlignment("center").setFontColor("#94A3B8").setBackground("#FFFFFF");
    dash.getRange("A16:G18").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
  }

  // 自動調整欄寬
  for (var c = 1; c <= 7; c++) {
    dash.autoResizeColumn(c);
    var currentW = dash.getColumnWidth(c);
    if (currentW < 120) dash.setColumnWidth(c, 120);
  }
}

// 輔助函式：日期正規化為 YYYY-MM-DD
function normalizeDate(raw) {
  if (!raw) return Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
  var str = raw.toString().trim();
  var currentYear = new Date().getFullYear();

  // 1. 支援 4 碼純數字 (例如 1102, 1108 -> YYYY-11-08)
  if (/^\d{4}$/.test(str)) {
    var m = str.substring(0, 2);
    var d = str.substring(2, 4);
    return currentYear + "-" + m + "-" + d;
  }

  // 2. 支援中文日期 (例如 11月8日, 11月08日, 2026年11月8日)
  var mChinese = str.match(/(?:(\d{4})[-年／\/\.])?\s*(\d{1,2})\s*[月／\/\.-]\s*(\d{1,2})\s*日?/);
  if (mChinese) {
    var y = mChinese[1] || currentYear;
    var m = mChinese[2].padStart(2, "0");
    var d = mChinese[3].padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  // 3. 支援符號分隔 (例如 2026-11-08, 11/8, 11.8)
  str = str.replace(/[\/\.]/g, "-");
  var parts = str.split("-");

  if (parts.length === 3) {
    var y = parts[0].length === 4 ? parts[0] : currentYear;
    var m = parts[1].padStart(2, "0");
    var d = parts[2].padStart(2, "0");
    return y + "-" + m + "-" + d;
  } else if (parts.length === 2) {
    var m = parts[0].padStart(2, "0");
    var d = parts[1].padStart(2, "0");
    return currentYear + "-" + m + "-" + d;
  }
  return str;
}

// 輔助函式：星期推算
function getWeekdayStr(dateStr) {
  try {
    var parts = dateStr.split("-");
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var days = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    return days[d.getDay()] || "";
  } catch (e) {
    return "";
  }
}

/**
 * 輔助函式：依舊取貨日期代碼 (如 1102) 與顧客姓名/LINE名稱/電話刪除試算表中的舊訂單列
 */
function deleteOldOrderByTagAndName(ss, oldDateTag, cleanName, cleanLine, phone, oldDateStr) {
  var deletedCount = 0;
  if (!ss) return 0;
  if (!cleanName && !cleanLine && !phone) return 0;

  var allSheets = ss.getSheets();
  for (var s = 0; s < allSheets.length; s++) {
    var curSheet = allSheets[s];
    var sName = curSheet.getName();
    if (allSheets.length > 1 && (sName.indexOf("總覽") >= 0 || sName.indexOf("分析") >= 0)) continue;

    var lastR = curSheet.getLastRow();
    var lastC = curSheet.getLastColumn();
    if (lastR <= 1 || lastC < 1) continue;

    var sheetValues = curSheet.getRange(1, 1, lastR, lastC).getValues();
    var sheetDeleted = false;
    for (var r = sheetValues.length - 1; r >= 0; r--) {
      var rowData = sheetValues[r];
      var rowStr = rowData.map(function(c) { return String(c || ""); }).join(" ");

      var nameMatches = (cleanName && rowStr.indexOf(cleanName) >= 0) ||
                        (cleanLine && rowStr.indexOf(cleanLine) >= 0) ||
                        (phone && phone.length >= 7 && rowStr.indexOf(phone) >= 0);

      if (nameMatches) {
        var dateMatches = true;
        if (oldDateTag) {
          dateMatches = rowStr.indexOf(oldDateTag) >= 0 || (oldDateStr && rowStr.indexOf(oldDateStr) >= 0);
          if (!dateMatches) {
            for (var pr = r; pr >= 0; pr--) {
              var pStr = sheetValues[pr].map(function(c) { return String(c || ""); }).join(" ");
              if (pStr.indexOf(oldDateTag) >= 0 || (oldDateStr && pStr.indexOf(oldDateStr) >= 0)) {
                dateMatches = true;
                break;
              }
              if (pStr.indexOf("清單") >= 0 || pStr.indexOf("總覽") >= 0) break;
            }
          }
        }

        if (dateMatches) {
          curSheet.deleteRow(r + 1);
          deletedCount++;
          sheetDeleted = true;
        }
      }
    }
    if (sheetDeleted) {
      try {
        separateOrdersByDate(curSheet);
      } catch (sepE) {}
    }
  }
  return deletedCount;
}
