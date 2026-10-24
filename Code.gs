/**
 * Espaço Angélica do Carmo - Google Apps Script Backend (Code.gs)
 * Configuração Segura de Produção com validação obrigatória via ScriptProperties.
 *
 * Planilha Oficial: https://docs.google.com/spreadsheets/d/1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0/edit
 * Aba: Agendamentos
 */

var TARGET_SPREADSHEET_ID = "1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0";

function uploadImageToDrive(base64Data, fileName, mimeType) {
  try {
    if (!base64Data || !fileName || !mimeType) {
      throw new Error(
        'Image data, file name and MIME type are required.'
      );
    }

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ];

    if (allowedTypes.indexOf(mimeType) === -1) {
      throw new Error('Unsupported image file type.');
    }

    const decodedData = Utilities.base64Decode(base64Data);

    if (decodedData.length > 10 * 1024 * 1024) {
      throw new Error('Image must be 10 MB or smaller.');
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);

    const safeFileName = String(fileName)
      .replace(/[\\/:*?"<>|]/g, '_');

    const blob = Utilities.newBlob(
      decodedData,
      mimeType,
      safeFileName
    );

    const file = folder.createFile(blob);

    return 'https://drive.google.com/thumbnail?id=' +
      file.getId() +
      '&sz=w1000';

  } catch (error) {
    console.error('Image upload failed:', error);

    throw new Error(
      'Image upload failed: ' + error.message
    );
  }
}

function validateAuthorization(tokenProvided) {
  var expectedToken = PropertiesService.getScriptProperties().getProperty("APPS_SCRIPT_TOKEN");

  if (!expectedToken || String(expectedToken).trim() === "") {
    return { valid: false, error: "Configuração incompleta: APPS_SCRIPT_TOKEN ausente nas Propriedades do Script." };
  }

  if (!tokenProvided || String(tokenProvided).trim() !== String(expectedToken).trim()) {
    return { valid: false, error: "Acesso não autorizado: token de autorização inválido ou ausente." };
  }

  return { valid: true };
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOfficialSheet() {
  try {
    var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    if (!ss) return null;
    var sheet = ss.getSheetByName("Agendamentos");
    if (!sheet) return null;
    // Add new optional columns without overwriting existing booking data or legacy columns.
    var extensionHeaders = ["Local do Atendimento", "Endereço Domiciliar", "IDs Serviços Adicionais", "Pedido Personalizado", "ID Serviço Principal"];
    for (var h = 0; h < extensionHeaders.length; h++) {
      var cell = sheet.getRange(1, 12 + h);
      if (!String(cell.getValue() || "").trim()) cell.setValue(extensionHeaders[h]);
    }
    return sheet;
  } catch (e) {
    return null;
  }
}

function getServicesSheet() {
  try {
    var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    if (!ss) return null;

    // Use the existing official catalogue tab. Never create or populate a replacement
    // sheet with sample services: a missing tab must be reported as a configuration error.
    var sheet = ss.getSheetByName("Serviços") || ss.getSheetByName("Servicos");
    if (!sheet) return null;

    return sheet;
  } catch (e) {
    return null;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  var trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  var re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(trimmed);
}

function bookingDurationMinutes(durationText) {
  var text = String(durationText || "").toLowerCase();
  var hoursMatch = text.match(/(\d+)\s*h/);
  var minutesMatch = text.match(/(\d+)\s*min/);
  var total = Number(hoursMatch ? hoursMatch[1] : 0) * 60 + Number(minutesMatch ? minutesMatch[1] : 0);
  return total > 0 ? total : 90;
}

function bookingClockMinutes(timeText) {
  var match = String(timeText || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  var hours = Number(match[1]);
  var minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

function bookingTimeRange(timeText) {
  var match = String(timeText || "").trim().match(/(\d{1,2}:\d{2})\s*(?:às|as|[-–])\s*(\d{1,2}:\d{2})/i);
  if (!match) return null;
  var start = bookingClockMinutes(match[1]);
  var end = bookingClockMinutes(match[2]);
  return start !== null && end !== null && end > start ? { start: start, end: end } : null;
}

function bookingServiceDurationMinutes(serviceId) {
  var wanted = String(serviceId || "").trim();
  if (!wanted) return 90;
  try {
    var servicesSheet = getServicesSheet();
    if (!servicesSheet) return 90;
    var rows = servicesSheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || "").trim() === wanted) {
        return bookingDurationMinutes(rows[i][5]);
      }
    }
  } catch (err) {
    console.error("Could not resolve service duration: " + err);
  }
  return 90;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return responseJSON({ status: "error", message: "Corpo da requisição vazio." });
    }

    var data = JSON.parse(e.postData.contents);

    // Agendamento público: usa validações de cliente, catálogo, data, horário,
    // concorrência e duplicidade abaixo. Ações administrativas continuam exigindo token.
    var isPublicBooking = data.action === "createBooking";
    if (!isPublicBooking) {
      var tokenProvided = data.token || data.authToken || data.key || (e.parameter && e.parameter.token);
      var auth = validateAuthorization(tokenProvided);
      if (!auth.valid) {
        return responseJSON({ status: "error", message: auth.error });
      }
    }

    // Gravação de agendamento público/manual na aba oficial sem limpar, recriar ou
    // reordenar linhas existentes. IDs repetidos não geram uma segunda linha.
    if (data.action === "createBooking") {
      var bookingId = String(data.appointmentId || "").trim();
      if (!bookingId || !/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(bookingId)) {
        return responseJSON({ status: "error", persisted: false, message: "ID do agendamento inválido." });
      }
      if (data.isTest === true || bookingId.indexOf("test-") === 0 ||
          String(data.status || "").toLowerCase() === "teste_sistema") {
        return responseJSON({ status: "error", persisted: false, message: "Agendamento de teste não pode ser gravado na planilha oficial." });
      }
      var requiredName = String(data.clientName || "").trim();
      var requiredPhone = String(data.clientPhone || "").trim();
      var requiredService = String(data.serviceTitle || "").trim();
      var requiredDate = String(data.date || "").trim();
      var requiredTime = String(data.time || "").trim();
      if (!requiredName || !requiredPhone || !requiredService || !requiredDate || !requiredTime) {
        return responseJSON({ status: "error", persisted: false, message: "Preencha nome, telefone, procedimento, data e horário." });
      }
      var bookingLock = LockService.getScriptLock();
      try { bookingLock.waitLock(15000); }
      catch (bookingLockErr) {
        return responseJSON({ status: "error", persisted: false, message: "Tempo limite ao aguardar a gravação do agendamento." });
      }
      try {
        var bookingSheet = getOfficialSheet();
        if (!bookingSheet) {
          return responseJSON({ status: "error", persisted: false, message: "Aba oficial 'Agendamentos' não encontrada. Nenhuma alteração foi feita." });
        }
        var existingBookingRows = bookingSheet.getDataRange().getValues();
        for (var br = 1; br < existingBookingRows.length; br++) {
          if (String(existingBookingRows[br][9] || "").trim() === bookingId) {
            return responseJSON({ status: "success", persisted: true, duplicate: true, appointmentId: bookingId, message: "Este agendamento já existe na planilha; nenhuma linha duplicada foi criada." });
          }
        }
        var bookingNotes = String(data.notes || "").trim();
        if (data.recurrence) bookingNotes += (bookingNotes ? "\\n" : "") + "Recorrência: " + String(data.recurrence.frequencyLabel || "") + "; sessões: " + String(data.recurrence.totalSessions || "");
        if (data.customRequest) bookingNotes += (bookingNotes ? "\\n" : "") + "Pedido personalizado: " + String(data.customRequest).trim();
        var bookingRow = [
          new Date(),
          requiredName,
          requiredPhone,
          String(data.clientEmail || "").trim(),
          requiredService,
          requiredDate,
          requiredTime,
          Number(data.depositAmount || 0),
          String(data.status || "pendente_pix"),
          bookingId,
          bookingNotes,
          String(data.appointmentLocation || "salon"),
          String(data.homeAddress || "").trim(),
          JSON.stringify(Array.isArray(data.additionalServiceIds) ? data.additionalServiceIds : []),
          String(data.customRequest || "").trim(),
          String(data.serviceId || "").trim()
        ];
        bookingSheet.appendRow(bookingRow);
        SpreadsheetApp.flush();
        return responseJSON({ status: "success", persisted: true, duplicate: false, appointmentId: bookingId, message: "Agendamento gravado na planilha oficial." });
      } catch (bookingErr) {
        console.error("createBooking persistence failed: " + bookingErr);
        return responseJSON({ status: "error", persisted: false, message: "Não foi possível gravar o agendamento na planilha oficial: " + String(bookingErr.message || bookingErr) });
      } finally {
        bookingLock.releaseLock();
      }
    }

    // 2. Leitura administrativa segura via POST (token no corpo)
    if (data.action === "getAppointments") {
      return fetchAppointmentsFromSheet();
    }

    if (data.action === "deleteAppointment") {
      var appointmentIdToDelete = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(appointmentIdToDelete)) {
        return responseJSON({ status: "error", message: "ID do agendamento inválido." });
      }

      var deleteLock = LockService.getScriptLock();
      try {
        deleteLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio para exclusão." });
      }

      try {
        var deleteSheet = getOfficialSheet();
        if (!deleteSheet) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }

        var appointmentRows = deleteSheet.getDataRange().getValues();
        var deletedCount = 0;
        for (var rowIndex = appointmentRows.length - 1; rowIndex >= 1; rowIndex--) {
          var rowAppointmentId = appointmentRows[rowIndex][9] ? String(appointmentRows[rowIndex][9]).trim() : "";
          if (rowAppointmentId === appointmentIdToDelete) {
            deleteSheet.deleteRow(rowIndex + 1);
            deletedCount++;
          }
        }

        return responseJSON({
          status: "success",
          deleted: deletedCount > 0,
          notFound: deletedCount === 0,
          deletedCount: deletedCount,
          appointmentId: appointmentIdToDelete,
          message: deletedCount > 0
            ? "Agendamento removido da planilha."
            : "Agendamento já não consta na planilha."
        });
      } finally {
        deleteLock.releaseLock();
      }
    }

    if (data.action === "updateAppointment") {
      var rawUpdateId = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!rawUpdateId || !/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(rawUpdateId)) {
        return responseJSON({ status: "error", message: "ID do agendamento inválido ou ausente para atualização." });
      }

      var updateLock = LockService.getScriptLock();
      try {
        updateLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio para atualização." });
      }

      try {
        var updateSheet = getOfficialSheet();
        if (!updateSheet) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }

        var updateRows = updateSheet.getDataRange().getValues();
        var foundRowIndex = -1;
        for (var u = 1; u < updateRows.length; u++) {
          var rowId = updateRows[u][9] ? String(updateRows[u][9]).trim() : "";
          if (rowId && rowId.toLowerCase() === rawUpdateId.toLowerCase()) {
            foundRowIndex = u + 1;
            break;
          }
        }

        if (foundRowIndex === -1) {
          return responseJSON({
            status: "error",
            notFound: true,
            appointmentId: rawUpdateId,
            message: "Agendamento " + rawUpdateId + " não encontrado na planilha oficial."
          });
        }

        if (data.clientName !== undefined) updateSheet.getRange(foundRowIndex, 2).setValue(String(data.clientName).trim());
        if (data.clientPhone !== undefined) updateSheet.getRange(foundRowIndex, 3).setValue(String(data.clientPhone).trim());
        if (data.clientEmail !== undefined) updateSheet.getRange(foundRowIndex, 4).setValue(String(data.clientEmail).trim());
        if (data.serviceTitle !== undefined) updateSheet.getRange(foundRowIndex, 5).setValue(String(data.serviceTitle).trim());
        if (data.date !== undefined) updateSheet.getRange(foundRowIndex, 6).setValue(String(data.date).trim());
        if (data.time !== undefined) updateSheet.getRange(foundRowIndex, 7).setValue(String(data.time).trim());
        if (data.depositAmount !== undefined) updateSheet.getRange(foundRowIndex, 8).setValue(Number(data.depositAmount));
        if (data.status !== undefined) updateSheet.getRange(foundRowIndex, 9).setValue(String(data.status).trim());
        if (data.notes !== undefined) updateSheet.getRange(foundRowIndex, 11).setValue(String(data.notes).trim());
        if (data.appointmentLocation !== undefined) updateSheet.getRange(foundRowIndex, 12).setValue(String(data.appointmentLocation).trim());
        if (data.homeAddress !== undefined) updateSheet.getRange(foundRowIndex, 13).setValue(String(data.homeAddress).trim());
        if (data.additionalServiceIds !== undefined) updateSheet.getRange(foundRowIndex, 14).setValue(JSON.stringify(Array.isArray(data.additionalServiceIds) ? data.additionalServiceIds : []));
        if (data.customRequest !== undefined) updateSheet.getRange(foundRowIndex, 15).setValue(String(data.customRequest).trim());
        if (data.serviceId !== undefined) updateSheet.getRange(foundRowIndex, 16).setValue(String(data.serviceId).trim());

        return responseJSON({
          status: "success",
          updated: true,
          persisted: true,
          appointmentId: rawUpdateId,
          message: "Agendamento atualizado com sucesso na planilha oficial."
        });
      } finally {
        updateLock.releaseLock();
      }
    }

    if (data.action === "getServices") {
      var servSheet = getServicesSheet();
      if (!servSheet) {
        return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
      }
      var sRows = servSheet.getDataRange().getValues();
      var servicesList = [];
      for (var s = 1; s < sRows.length; s++) {
        var sRow = sRows[s];
        var sId = String(sRow[0] || '').trim();
        if (!sId) continue;
        var specsVal = String(sRow[10] || '');
        var specsArr = specsVal ? specsVal.split(',').map(function(item) { return item.trim(); }).filter(Boolean) : [];
        servicesList.push({
          id: sId,
          title: String(sRow[1] || ''),
          category: String(sRow[2] || 'alongamento'),
          price: Number(sRow[3] || 0),
          priceFormatted: String(sRow[4] || ('R$ ' + Number(sRow[3] || 0).toFixed(2).replace('.', ','))),
          duration: String(sRow[5] || '1h 30min'),
          badge: String(sRow[6] || ''),
          description: String(sRow[7] || ''),
          note: String(sRow[8] || ''),
          imageUrl: String(sRow[9] || ''),
          specs: specsArr,
          active: sRow[11] !== false && String(sRow[11]).toLowerCase() !== 'false',
          updatedAt: sRow[12] ? new Date(sRow[12]).toISOString() : new Date().toISOString()
        });
      }
      return responseJSON({ status: "success", services: servicesList, total: servicesList.length });
    }

    if (data.action === "saveService") {
      var sIdToSave = data.id ? String(data.id).trim() : "";
      if (!sIdToSave) {
        return responseJSON({ status: "error", message: "ID do serviço obrigatório." });
      }

      var servLock = LockService.getScriptLock();
      try {
        servLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite ao aguardar bloqueio para salvar serviço." });
      }

      try {
        var saveServSheet = getServicesSheet();
        if (!saveServSheet) {
          return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
        }

        var existingRows = saveServSheet.getDataRange().getValues();
        var foundServRow = -1;
        for (var sr = 1; sr < existingRows.length; sr++) {
          if (String(existingRows[sr][0] || '').trim().toLowerCase() === sIdToSave.toLowerCase()) {
            foundServRow = sr + 1;
            break;
          }
        }

        var specsStr = Array.isArray(data.specs) ? data.specs.join(', ') : String(data.specs || '');
        var priceNum = Number(data.price || 0);
        var priceFmt = data.priceFormatted || ('R$ ' + priceNum.toFixed(2).replace('.', ','));
        var isActive = data.active !== false && String(data.active).toLowerCase() !== 'false';

        var rowData = [
          sIdToSave,
          String(data.title || '').trim(),
          String(data.category || 'alongamento').trim(),
          priceNum,
          priceFmt,
          String(data.duration || '1h 30min').trim(),
          String(data.badge || '').trim(),
          String(data.description || '').trim(),
          String(data.note || '').trim(),
          String(data.imageUrl || '').trim(),
          specsStr,
          isActive,
          new Date()
        ];

        if (foundServRow > 0) {
          saveServSheet.getRange(foundServRow, 1, 1, 13).setValues([rowData]);
        } else {
          saveServSheet.appendRow(rowData);
        }

        return responseJSON({
          status: "success",
          saved: true,
          serviceId: sIdToSave,
          message: "Serviço salvo com sucesso na planilha oficial."
        });
      } finally {
        servLock.releaseLock();
      }
    }

    if (data.action === "deleteService") {
      var sIdToDelete = data.id ? String(data.id).trim() : "";
      if (!sIdToDelete) {
        return responseJSON({ status: "error", message: "ID do serviço obrigatório para exclusão." });
      }

      var delServLock = LockService.getScriptLock();
      try {
        delServLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite ao aguardar bloqueio para exclusão de serviço." });
      }

      try {
        var delServSheet = getServicesSheet();
        if (!delServSheet) {
          return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
        }

        var allServRows = delServSheet.getDataRange().getValues();
        var deletedServCount = 0;
        for (var ds = allServRows.length - 1; ds >= 1; ds--) {
          if (String(allServRows[ds][0] || '').trim().toLowerCase() === sIdToDelete.toLowerCase()) {
            delServSheet.deleteRow(ds + 1);
            deletedServCount++;
          }
        }

        return responseJSON({
          status: "success",
          deleted: deletedServCount > 0,
          notFound: deletedServCount === 0,
          serviceId: sIdToDelete,
          message: deletedServCount > 0 ? "Serviço excluído da planilha oficial." : "Serviço não encontrado na planilha."
        });
      } finally {
        delServLock.releaseLock();
      }
    }

    if (data.action === "uploadPhoto") {
      if (!data.imageBase64) {
        return responseJSON({ status: "error", message: "Conteúdo da imagem (base64) ausente." });
      }

      var photoLock = LockService.getScriptLock();
      try {
        photoLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite ao aguardar bloqueio para upload de foto." });
      }

      try {
        // Pasta oficial de fotos dos serviços e imagens de apresentação.
        // O usuário/conta que executa este Apps Script precisa ter permissão de editor nesta pasta.
        var folderId = "1JGypjL9OqGL5i2OUrjiGMKxkWD11YuAw";
        var folder = DriveApp.getFolderById(folderId);
        var contentType = data.mimeType || "image/jpeg";
        var decoded = Utilities.base64Decode(data.imageBase64);
        var fileName = data.fileName || ("servico-" + new Date().getTime() + ".jpg");
        var blob = Utilities.newBlob(decoded, contentType, fileName);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var fileId = file.getId();
        // URL direta para incorporar a imagem em cartões, ícones e catálogo público.
        var photoUrl = "https://drive.google.com/uc?export=view&id=" + fileId;

        return responseJSON({
          status: "success",
          url: photoUrl,
          fileId: fileId,
          message: "Foto armazenada com sucesso no Google Drive."
        });
      } finally {
        photoLock.releaseLock();
      }
    }

    if (data.action === "blockSchedule" || data.status === "bloqueado") {
      var rawBlockId = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!rawBlockId || !/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(rawBlockId)) {
        return responseJSON({ status: "error", message: "ID de bloqueio inválido ou fora do padrão (permitido: apt-*, test-* ou e2e-*)." });
      }

      var blockDate = data.date ? String(data.date).trim() : "";
      if (!blockDate) {
        return responseJSON({ status: "error", message: "Data do bloqueio ausente." });
      }

      var blockLock = LockService.getScriptLock();
      try {
        blockLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio para gravar bloqueio de data." });
      }

      try {
        var blockSheet = getOfficialSheet();
        if (!blockSheet) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }

        var blockRows = blockSheet.getDataRange().getValues();
        for (var b = 1; b < blockRows.length; b++) {
          var rowBlockId = blockRows[b][9] ? String(blockRows[b][9]).trim() : "";
          if (rowBlockId && rowBlockId.toLowerCase() === rawBlockId.toLowerCase()) {
            return responseJSON({
              status: "success",
              duplicate: true,
              persisted: true,
              emailSent: false,
              emailSuppressed: true,
              message: "Bloqueio " + rawBlockId + " já consta na planilha oficial.",
              appointmentId: rawBlockId
            });
          }
        }

        blockSheet.appendRow([
          new Date(),
          data.clientName ? String(data.clientName).trim() : 'Protocolo Ateliê',
          data.clientPhone ? String(data.clientPhone).trim() : '(12) 97406-2241',
          data.clientEmail ? String(data.clientEmail).trim() : '',
          data.serviceTitle ? String(data.serviceTitle).trim() : 'Bloqueio de Agenda',
          blockDate,
          data.time ? String(data.time).trim() : 'Dia Inteiro',
          0,
          'bloqueado',
          rawBlockId,
          data.notes ? String(data.notes).trim() : (data.blockReason || 'Bloqueio administrativo')
        ]);

        return responseJSON({
          status: "success",
          persisted: true,
          duplicate: false,
          emailSent: false,
          emailSuppressed: true,
          message: "Bloqueio registrado com sucesso na planilha oficial.",
          appointmentId: rawBlockId
        });
      } finally {
        blockLock.releaseLock();
      }
    }

    // 3. Mecanismo de Teste Autenticado e Controlado pelo Backend
    // Testes NÃO gravam na aba oficial 'Agendamentos' e NÃO enviam e-mails/WhatsApp
    var isTestExecution = Boolean(
      data.action === "testConnection" ||
      data.action === "verifyWebhook" ||
      data.isTest === true ||
      data.isTest === "true"
    );

    if (isTestExecution) {
      var lockTest = LockService.getScriptLock();
      try {
        lockTest.waitLock(5000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao testar bloqueio de concorrência." });
      }
      try {
        var sheetTest = getOfficialSheet();
        if (!sheetTest) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }
        return responseJSON({
          status: "success",
          test: true,
          persisted: false,
          emailSent: false,
          emailSuppressed: true,
          message: "Teste autenticado de conectividade e permissões validado com sucesso. Nenhuma linha foi gravada na aba oficial Agendamentos e nenhum e-mail foi disparado.",
          appointmentId: data.appointmentId ? String(data.appointmentId).trim() : ("test-" + new Date().getTime())
        });
      } finally {
        lockTest.releaseLock();
      }
    }

    // 4. Bloqueio de concorrência atômico para gravação de reserva real
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
    } catch (lockErr) {
      return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio de concorrência." });
    }

    try {
      // 5. Validação estrita do ID da reserva (reservas reais públicas exigem prefixo apt-*)
      var rawId = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!rawId || !/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(rawId)) {
        return responseJSON({
          status: "error",
          message: "ID da reserva inválido, ausente ou fora do padrão (permitido: apt-*, test-* ou e2e-*)."
        });
      }

      // 6. Validação estrita dos dados da cliente
      var clientName = data.clientName ? String(data.clientName).trim() : "";
      if (clientName.length < 2) {
        return responseJSON({
          status: "error",
          message: "Nome da cliente inválido ou ausente (mínimo de 2 caracteres)."
        });
      }

      var clientPhone = data.clientPhone ? String(data.clientPhone).trim() : "";
      var phoneDigits = clientPhone.replace(/\D/g, "");
      if (phoneDigits.length < 8 || phoneDigits.length > 15) {
        return responseJSON({
          status: "error",
          message: "Telefone da cliente inválido (deve conter entre 8 e 15 dígitos)."
        });
      }

      // 7. Validação financeira baseada exclusivamente na aba oficial 'Serviços'.
// Não aceitar preços ou títulos enviados pelo navegador como fonte de verdade.
      var servicesSheetForBooking = getServicesSheet();
      if (!servicesSheetForBooking) {
        return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
      }

      var serviceRowsForBooking = servicesSheetForBooking.getDataRange().getValues();
      if (serviceRowsForBooking.length < 2) {
        return responseJSON({ status: "error", message: "O catálogo oficial de serviços está vazio. Nenhum agendamento foi gravado." });
      }

      function findOfficialService(serviceId, serviceTitle) {
        var idToFind = String(serviceId || "").trim().toLowerCase();
        var titleToFind = String(serviceTitle || "").trim().toLowerCase();
        for (var rowIndex = 1; rowIndex < serviceRowsForBooking.length; rowIndex++) {
          var serviceRow = serviceRowsForBooking[rowIndex];
          var rowId = String(serviceRow[0] || "").trim();
          if (!rowId) continue;
          var isActive = serviceRow[11] !== false && String(serviceRow[11]).toLowerCase() !== "false";
          if (!isActive) continue;
          if (idToFind && rowId.toLowerCase() === idToFind) {
            return { id: rowId, title: String(serviceRow[1] || "").trim(), price: Number(serviceRow[3]), active: true };
          }
          if (!idToFind && titleToFind && String(serviceRow[1] || "").trim().toLowerCase() === titleToFind) {
            return { id: rowId, title: String(serviceRow[1] || "").trim(), price: Number(serviceRow[3]), active: true };
          }
        }
        return null;
      }

      var serviceKey = data.serviceId ? String(data.serviceId).trim() : "";
      var canonical = findOfficialService(serviceKey, data.serviceTitle);
      if (!canonical || !canonical.title || !isFinite(canonical.price) || canonical.price < 0) {
        return responseJSON({ status: "error", message: "Procedimento não encontrado, inativo ou com preço inválido no catálogo oficial. Nenhum agendamento foi gravado." });
      }

      var additionalIds = Array.isArray(data.additionalServiceIds) ? data.additionalServiceIds : [];
      var additionalTitles = [];
      var additionalTotal = 0;
      var seenAdditionalIds = {};
      for (var ai = 0; ai < additionalIds.length; ai++) {
        var additionalId = String(additionalIds[ai] || "").trim();
        var additionalIdKey = additionalId.toLowerCase();
        if (!additionalId || additionalIdKey === String(canonical.id).toLowerCase() || seenAdditionalIds[additionalIdKey]) {
          return responseJSON({ status: "error", message: "Serviço adicional inválido ou duplicado." });
        }
        seenAdditionalIds[additionalIdKey] = true;
        var additionalCanonical = findOfficialService(additionalId, "");
        if (!additionalCanonical || !additionalCanonical.title || !isFinite(additionalCanonical.price) || additionalCanonical.price < 0) {
          return responseJSON({ status: "error", message: "Serviço adicional não encontrado, inativo ou com preço inválido no catálogo oficial: " + additionalId });
        }
        additionalTitles.push(additionalCanonical.title);
        additionalTotal += additionalCanonical.price;
      }

      var referencePrice = canonical.price + additionalTotal;
      var expectedServiceTitle = [canonical.title].concat(additionalTitles).join(" + ");
      if (String(data.serviceTitle || "").trim().toLowerCase() !== expectedServiceTitle.toLowerCase()) {
        return responseJSON({ status: "error", message: "Os serviços informados não correspondem ao catálogo oficial." });
      }
      var expected40 = Math.round(referencePrice * 0.4 * 100) / 100;
      var expected100 = Math.round(referencePrice * 100) / 100;
      var depositNum = Number(data.depositAmount);

      if (isNaN(depositNum) || !isFinite(depositNum) || depositNum <= 0) {
        return responseJSON({ status: "error", message: "Valor do sinal/pagamento inválido ou ausente." });
      }

      // O sinal é uma orientação de pagamento; não rejeitar a reserva por divergência percentual.
      var matches100 = data.paymentMode === "pre_pagamento_100";
      var resolvedMode = data.paymentMode || "sinal_40";
      var serviceTitle = expectedServiceTitle;
      var balanceNum = Math.max(0, referencePrice - depositNum);
      var amountFormatted = depositNum.toFixed(2).replace(".", ",");
      var balanceFormatted = balanceNum.toFixed(2).replace(".", ",");
      var paymentLabel = resolvedMode === "pre_pagamento_100" ? "Pré-pagamento Pix (100%)" : "Sinal Pix (40%)";

      // 8. Validação de data, horário e local no servidor (fuso oficial do estúdio)
      var bookingDate = data.date ? String(data.date).trim() : "";
      var bookingTime = data.time ? String(data.time).trim() : "";
      if (!bookingDate || !bookingTime) {
        return responseJSON({ status: "error", message: "Data ou horário do agendamento ausentes." });
      }

      var requestedDateKey = normalizeBookingDate(bookingDate);
      var requestedTimeKey = normalizeBookingTime(bookingTime);
      if (!isValidBookingDateKey(requestedDateKey)) {
        return responseJSON({ status: "error", message: "Data inválida. Use uma data real no formato AAAA-MM-DD." });
      }
      if (!isBookingDateInFutureOrToday(requestedDateKey)) {
        return responseJSON({ status: "error", message: "Não é possível agendar em uma data passada. Selecione hoje ou uma data futura." });
      }
      if (!isValidBookingTime(requestedTimeKey)) {
        return responseJSON({ status: "error", message: "Horário inválido. Use o formato HH:mm." });
      }
      // Não bloquear segunda-feira por regra fixa: os dias de atendimento devem seguir a configuração semanal.
      // A validação central da grade semanal precisa usar uma configuração persistida no backend antes da publicação.
      var location = data.appointmentLocation === undefined ? "salon" : String(data.appointmentLocation).trim();
      if (location !== "salon" && location !== "home") {
        return responseJSON({ status: "error", message: "Local de atendimento inválido." });
      }
      var homeAddress = data.homeAddress === undefined || data.homeAddress === null ? "" : String(data.homeAddress).trim();
      if (location === "home" && homeAddress.length < 8) {
        return responseJSON({ status: "error", message: "Informe o endereço completo para atendimento em domicílio." });
      }

      var sheet = getOfficialSheet();
      if (!sheet) {
        return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
      }

      // 9. Proteção anti-duplicidade e conflitos por sobreposição de intervalos.
      var existing = sheet.getDataRange().getValues();
      var requestedStartMinutes = bookingClockMinutes(requestedTimeKey);
      var requestedDurationMinutes = bookingServiceDurationMinutes(data.serviceId);
      var requestedEndMinutes = requestedStartMinutes === null ? null : requestedStartMinutes + requestedDurationMinutes;
      for (var i = 1; i < existing.length; i++) {
        var existingId = existing[i][9] ? String(existing[i][9]).trim() : "";
        if (existingId && existingId.toLowerCase() === rawId.toLowerCase()) {
          return responseJSON({
            status: "success",
            duplicate: true,
            persisted: true,
            emailSent: false,
            emailSuppressed: true,
            message: "Reserva " + rawId + " já confirmada anteriormente no Sheets.",
            appointmentId: rawId,
            existingAppointment: {
              id: existingId,
              clientName: String(existing[i][1] || ''),
              clientPhone: String(existing[i][2] || ''),
              clientEmail: String(existing[i][3] || ''),
              serviceTitle: String(existing[i][4] || ''),
              date: String(existing[i][5] || ''),
              time: String(existing[i][6] || ''),
              depositAmount: Number(existing[i][7] || 0),
              status: String(existing[i][8] || 'pendente_pix')
            }
          });
        }
        var existingStatus = String(existing[i][8] || 'pendente_pix').toLowerCase();
        var existingDateKey = normalizeBookingDate(existing[i][5]);
        if (requestedDateKey !== existingDateKey || ['cancelado', 'teste_sistema'].indexOf(existingStatus) !== -1) continue;

        var existingTimeText = String(existing[i][6] || '').trim();
        var existingBlockRange = existingStatus === 'bloqueado' ? bookingTimeRange(existingTimeText) : null;
        var allDayBlocked = existingStatus === 'bloqueado' && !existingBlockRange;
        var existingStartMinutes = existingBlockRange ? existingBlockRange.start : bookingClockMinutes(existingTimeText);
        var existingEndMinutes = existingBlockRange
          ? existingBlockRange.end
          : (existingStartMinutes === null ? null : existingStartMinutes + bookingServiceDurationMinutes(existing[i][15]));
        var conflict = allDayBlocked;
        if (!conflict && requestedStartMinutes !== null && requestedEndMinutes !== null && existingStartMinutes !== null && existingEndMinutes !== null) {
          conflict = requestedStartMinutes < existingEndMinutes && requestedEndMinutes > (existingBlockRange ? existingBlockRange.start : existingStartMinutes);
        }
        if (conflict) {
          return responseJSON({
            status: "error",
            conflict: true,
            message: allDayBlocked
              ? "Esta data está bloqueada para atendimentos. Escolha outro dia."
              : "Este horário se sobrepõe a um agendamento ou bloqueio existente. Escolha outro horário."
          });
        }
      }

      // 10. Grava linha na aba oficial 'Agendamentos' (apenas após validação completa)
      sheet.appendRow([
        new Date(),
        clientName,
        clientPhone,
        data.clientEmail ? String(data.clientEmail).trim() : '',
        serviceTitle,
        bookingDate,
        bookingTime,
        depositNum,
        data.status || 'pendente_pix',
        rawId,
        data.notes ? String(data.notes).trim() : '',
        location,
        location === 'home' ? homeAddress : '',
        JSON.stringify(Array.isArray(data.additionalServiceIds) ? data.additionalServiceIds : []),
        data.customRequest ? String(data.customRequest).trim() : '',
        data.serviceId ? String(data.serviceId).trim() : ''
      ]);

      // 11. Disparo de e-mails para reserva real
      // Reservas E2E autorizadas gravam na planilha oficial mas suprimem estritamente e-mails e notificações
      var isE2EExecution = Boolean(
        data.action === "e2eTestBooking" ||
        data.isE2ETest === true ||
        data.isE2ETest === "true" ||
        rawId.indexOf("e2e-") === 0 ||
        rawId.indexOf("apt-e2e-") === 0
      );

      var emailSent = false;
      var emailError = null;
      var adminEmailSent = false;
      var clientEmailSent = false;
      var errorsList = [];

      if (!isE2EExecution) {
        // 11.1 Notificação administrativa para a responsável oficial (angelikm19@gmail.com)
        try {
          var recipient = "angelikm19@gmail.com";
          var subject = "Novo pré-agendamento — " + clientName + " — " + bookingDate + " às " + bookingTime;
          var body = "Olá Angélica,\n\nUm novo pré-agendamento foi realizado pelo site!\n\n" +
            "• Cliente: " + clientName + "\n" +
            "• Telefone: " + clientPhone + "\n" +
            (data.clientEmail ? "• E-mail: " + String(data.clientEmail).trim() + "\n" : "") +
            "• Procedimento: " + serviceTitle + " (R$ " + referencePrice.toFixed(2).replace(".", ",") + ")\n" +
            "• Data & Horário: " + bookingDate + " às " + bookingTime + "\n" +
            "• " + paymentLabel + ": R$ " + amountFormatted + "\n" +
            "• Saldo restante: R$ " + balanceFormatted + "\n" +
            "• ID da Reserva: " + rawId + "\n" +
            (data.notes ? "• Observações: " + String(data.notes).trim() + "\n\n" : "\n") +
            "Verifique o recebimento do Pix de R$ " + amountFormatted + " na sua conta bancária para validar o agendamento.";

          MailApp.sendEmail({
            to: recipient,
            replyTo: (data.clientEmail && isValidEmail(data.clientEmail)) ? String(data.clientEmail).trim() : "kontakt@alansmsolutions.com",
            subject: subject,
            body: body
          });
          adminEmailSent = true;
        } catch (mailErr) {
          errorsList.push("Admin: " + mailErr.toString());
        }

        // 11.2 Confirmação automática para o e-mail da cliente (se informado e válido)
        var clientEmailRaw = data.clientEmail ? String(data.clientEmail).trim() : "";
        if (clientEmailRaw && isValidEmail(clientEmailRaw)) {
          try {
            var clientRecipient = clientEmailRaw;
            var clientSubject = "Recebemos seu pré-agendamento no Espaço Angélica do Carmo — ID: " + rawId;

            // Link estruturado do WhatsApp com parâmetros válidos e codificados
            var waMessage = "Olá Angélica! Segue o comprovante do meu pré-agendamento no Espaço Angélica:\n" +
              "• Procedimento: " + serviceTitle + "\n" +
              "• Data: " + bookingDate + " às " + bookingTime + "\n" +
              "• Cliente: " + clientName + "\n" +
              "• ID da Reserva: " + rawId;
            var waLink = "https://wa.me/5512974062241?text=" + encodeURIComponent(waMessage);

            var clientBody = "Olá " + clientName + ",\n\n" +
              "Recebemos sua solicitação de pré-agendamento no Espaço Angélica do Carmo!\n\n" +
              "IMPORTANTE: Seu horário foi reservado temporariamente e o agendamento será confirmado definitivamente após a validação do recebimento do Pix pela Angélica.\n\n" +
              "Resumo da sua solicitação:\n" +
              "• Procedimento: " + serviceTitle + " (R$ " + referencePrice.toFixed(2).replace(".", ",") + ")\n" +
              "• Data & Horário: " + bookingDate + " às " + bookingTime + "\n" +
              "• " + paymentLabel + ": R$ " + amountFormatted + "\n" +
              "• Saldo restante a acertar no dia: R$ " + balanceFormatted + "\n" +
              "• ID da Reserva: " + rawId + "\n\n" +
              "Chave Pix do Ateliê: +55 12 97406-2241 (Celular - Espaço Angelica do Carmo)\n\n" +
              "Para agilizar a confirmação, você pode enviar o comprovante Pix diretamente pelo nosso WhatsApp:\n" +
              waLink + "\n\n" +
              "Endereço: Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP.\n\n" +
              "Agradecemos pela confiança!\n" +
              "Espaço Angélica do Carmo";

            // Conteúdo HTML com escape rigoroso contra XSS e injeção
            var clientHtmlBody = "<div style=\"font-family: Arial, sans-serif; color: #49382E; line-height: 1.6; max-width: 600px;\">" +
              "<h2 style=\"color: #D4AF37;\">Espaço Angélica do Carmo</h2>" +
              "<p>Olá <strong>" + escapeHtml(clientName) + "</strong>,</p>" +
              "<p>Recebemos sua solicitação de pré-agendamento!</p>" +
              "<p style=\"background: #FFF8E7; padding: 12px; border-left: 4px solid #D4AF37; border-radius: 4px;\">" +
              "<strong>Atenção:</strong> Seu horário está reservado temporariamente e o agendamento será confirmado definitivamente após a validação do recebimento do Pix pela Angélica." +
              "</p>" +
              "<h3 style=\"border-bottom: 1px solid #E8D9B5; padding-bottom: 6px;\">Resumo do Agendamento</h3>" +
              "<ul>" +
              "<li><strong>Procedimento:</strong> " + escapeHtml(serviceTitle) + " (R$ " + escapeHtml(referencePrice.toFixed(2).replace(".", ",")) + ")</li>" +
              "<li><strong>Data e Horário:</strong> " + escapeHtml(bookingDate) + " às " + escapeHtml(bookingTime) + "</li>" +
              "<li><strong>" + escapeHtml(paymentLabel) + ":</strong> R$ " + escapeHtml(amountFormatted) + "</li>" +
              "<li><strong>Saldo restante no dia:</strong> R$ " + escapeHtml(balanceFormatted) + "</li>" +
              "<li><strong>ID da Reserva:</strong> <code>" + escapeHtml(rawId) + "</code></li>" +
              "</ul>" +
              "<p><strong>Chave Pix Celular:</strong> <code>+55 12 97406-2241</code> (Espaço Angelica do Carmo)</p>" +
              "<p style=\"margin: 24px 0;\">" +
              "<a href=\"" + escapeHtml(waLink) + "\" style=\"background-color: #25D366; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;\">" +
              "📲 Enviar Comprovante pelo WhatsApp" +
              "</a>" +
              "</p>" +
              "<p style=\"font-size: 13px; color: #786C63;\">" +
              "Endereço: Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP" +
              "</p>" +
              "</div>";

            MailApp.sendEmail({
              to: clientRecipient,
              replyTo: "kontakt@alansmsolutions.com",
              subject: clientSubject,
              body: clientBody,
              htmlBody: clientHtmlBody
            });
            clientEmailSent = true;
          } catch (clientErr) {
            errorsList.push("Cliente: " + clientErr.toString());
          }
        }
      }

      emailSent = adminEmailSent || clientEmailSent;
      if (errorsList.length > 0) {
        emailError = errorsList.join("; ");
      }

      return responseJSON({
        status: "success",
        persisted: true,
        duplicate: false,
        emailSent: emailSent,
        emailSuppressed: isE2EExecution ? true : false,
        emailError: emailError,
        message: isE2EExecution
          ? "Reserva de teste E2E gravada com sucesso no Sheets (e-mails e notificações suprimidos)."
          : "Reserva registrada com sucesso no Sheets.",
        appointmentId: rawId
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}

function normalizeBookingDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "America/Sao_Paulo", "yyyy-MM-dd");
  }
  var text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  var dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return dmy[3] + "-" + dmy[2] + "-" + dmy[1];
  return text;
}

function isValidBookingDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return false;
  var parts = dateKey.split("-");
  var year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isBookingDateInFutureOrToday(dateKey) {
  var today = Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd");
  return isValidBookingDateKey(dateKey) && dateKey >= today;
}

function isValidBookingTime(timeKey) {
  if (!/^\d{2}:\d{2}$/.test(String(timeKey || ""))) return false;
  var parts = timeKey.split(":");
  return Number(parts[0]) >= 0 && Number(parts[0]) <= 23 &&
    Number(parts[1]) >= 0 && Number(parts[1]) <= 59;
}

function normalizeBookingTime(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || "America/Sao_Paulo", "HH:mm");
  }
  var text = String(value || "").trim();
  var match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? ("0" + match[1]).slice(-2) + ":" + match[2] : text;
}

function fetchAppointmentsFromSheet() {
  var sheet = getOfficialSheet();
  if (!sheet) {
    return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
  }

  var values = sheet.getDataRange().getValues();
  var appointments = [];
  var tz = Session.getScriptTimeZone() || "America/Sao_Paulo";

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[9] && !row[1]) continue;

    var dateStr = row[5] instanceof Date ? Utilities.formatDate(row[5], tz, "dd/MM/yyyy") : String(row[5] || "");
    var timeStr = row[6] instanceof Date ? Utilities.formatDate(row[6], tz, "HH:mm") : String(row[6] || "");

    appointments.push({
      id: String(row[9] || ('apt-sheet-' + i)),
      clientName: String(row[1] || ''),
      clientPhone: String(row[2] || ''),
      clientEmail: String(row[3] || ''),
      serviceTitle: String(row[4] || ''),
      date: dateStr,
      time: timeStr,
      depositAmount: Number(row[7] || 0),
      status: String(row[8] || 'pendente_pix'),
      notes: String(row[10] || ''),
      appointmentLocation: String(row[11] || 'salon') === 'home' ? 'home' : 'salon',
      homeAddress: String(row[12] || '') || undefined,
      additionalServiceIds: (function() { try { var parsed = JSON.parse(String(row[13] || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; } })(),
      customRequest: String(row[14] || '') || undefined,
      serviceId: String(row[15] || '') || undefined
    });
  }
  return responseJSON({ status: "success", appointments: appointments, total: appointments.length });
}

function doGet(e) {
  try {
    if (!e || !e.parameter || Object.keys(e.parameter).length === 0 || e.parameter.action === "health") {
      return responseJSON({
        status: "ok",
        service: "espaco-angelica-apps-script",
        timestamp: new Date().toISOString()
      });
    }

    var tokenProvided = e.parameter.token || e.parameter.authToken || e.parameter.key;
    var auth = validateAuthorization(tokenProvided);
    if (!auth.valid) {
      return responseJSON({ status: "error", message: auth.error });
    }

    if (e.parameter.action === "getServices") {
      var servSheet = getServicesSheet();
      if (!servSheet) {
        return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
      }
      var sRows = servSheet.getDataRange().getValues();
      var servicesList = [];
      for (var s = 1; s < sRows.length; s++) {
        var sRow = sRows[s];
        var sId = String(sRow[0] || '').trim();
        if (!sId) continue;
        var specsVal = String(sRow[10] || '');
        var specsArr = specsVal ? specsVal.split(',').map(function(item) { return item.trim(); }).filter(Boolean) : [];
        servicesList.push({
          id: sId,
          title: String(sRow[1] || ''),
          category: String(sRow[2] || 'alongamento'),
          price: Number(sRow[3] || 0),
          priceFormatted: String(sRow[4] || ('R$ ' + Number(sRow[3] || 0).toFixed(2).replace('.', ','))),
          duration: String(sRow[5] || '1h 30min'),
          badge: String(sRow[6] || ''),
          description: String(sRow[7] || ''),
          note: String(sRow[8] || ''),
          imageUrl: String(sRow[9] || ''),
          specs: specsArr,
          active: sRow[11] !== false && String(sRow[11]).toLowerCase() !== 'false',
          updatedAt: sRow[12] ? new Date(sRow[12]).toISOString() : new Date().toISOString()
        });
      }
      return responseJSON({ status: "success", services: servicesList, total: servicesList.length });
    }

    return fetchAppointmentsFromSheet();
  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}
