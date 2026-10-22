/**
 * Espaço Angélica do Carmo - Google Apps Script Backend (Code.gs)
 * Configuração Segura de Produção com validação obrigatória via ScriptProperties.
 *
 * Planilha Oficial: https://docs.google.com/spreadsheets/d/1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0/edit
 * Aba: Agendamentos
 */

var TARGET_SPREADSHEET_ID = "1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0";

// Catálogo Oficial Canônico de Procedimentos e Preços
var OFFICIAL_CATALOG = {
  "alongamento-fibra-slim": { title: "Alongamento em Fibra Slim", price: 220 },
  "manutencao-fibra-vidro": { title: "Manutenção Fibra de Vidro", price: 140 },
  "manutencao-fibra": { title: "Manutenção Fibra de Vidro", price: 140 },
  "blindagem-diamante": { title: "Blindagem Diamante & Banho Gel", price: 130 },
  "esmaltacao-gel-premium": { title: "Esmaltação em Gel Premium", price: 95 },
  "nail-art-encapsulada": { title: "Nail Art Autoral & Encapsulada", price: 50 },
  "spa-das-maos-ouro": { title: "Spa das Mãos & Esfoliação", price: 85 }
};

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
    return ss.getSheetByName("Agendamentos");
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

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return responseJSON({ status: "error", message: "Corpo da requisição vazio." });
    }

    var data = JSON.parse(e.postData.contents);

    // 1. Validação de autenticação estrita: aceita exclusivamente APPS_SCRIPT_TOKEN
    var tokenProvided = data.token || data.authToken || data.key || (e.parameter && e.parameter.token);
    var auth = validateAuthorization(tokenProvided);
    if (!auth.valid) {
      return responseJSON({ status: "error", message: auth.error });
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

      // 7. Validação financeira baseada no catálogo canônico
      var serviceKey = data.serviceId ? String(data.serviceId).trim().toLowerCase() : "";
      var canonical = OFFICIAL_CATALOG[serviceKey];
      if (!canonical && data.serviceTitle) {
        var titleLower = String(data.serviceTitle).trim().toLowerCase();
        for (var k in OFFICIAL_CATALOG) {
          if (OFFICIAL_CATALOG[k].title.toLowerCase() === titleLower) {
            canonical = OFFICIAL_CATALOG[k];
            break;
          }
        }
      }

      if (!canonical) {
        return responseJSON({
          status: "error",
          message: "Procedimento desconhecido ou fora do catálogo oficial do ateliê."
        });
      }

      var referencePrice = canonical.price;
      var expected40 = Math.round(referencePrice * 0.4 * 100) / 100;
      var expected100 = Math.round(referencePrice * 100) / 100;
      var depositNum = Number(data.depositAmount);

      if (isNaN(depositNum) || !isFinite(depositNum) || depositNum <= 0) {
        return responseJSON({
          status: "error",
          message: "Valor do sinal/pagamento inválido ou ausente."
        });
      }

      var matches40 = Math.abs(depositNum - expected40) < 0.01;
      var matches100 = Math.abs(depositNum - expected100) < 0.01;

      if (!matches40 && !matches100) {
        return responseJSON({
          status: "error",
          message: "Valor do sinal/pagamento (R$ " + depositNum.toFixed(2) + ") não corresponde a 40% (R$ " + expected40.toFixed(2) + ") nem a 100% (R$ " + expected100.toFixed(2) + ") do preço oficial de " + canonical.title + "."
        });
      }

      if (data.paymentMode === "sinal_40" && !matches40) {
        return responseJSON({
          status: "error",
          message: "Valor diverge de 40% do procedimento oficial."
        });
      }

      if (data.paymentMode === "pre_pagamento_100" && !matches100) {
        return responseJSON({
          status: "error",
          message: "Valor diverge de 100% do procedimento oficial."
        });
      }

      var resolvedMode = data.paymentMode || (matches100 ? "pre_pagamento_100" : "sinal_40");
      var serviceTitle = canonical.title;
      var balanceNum = Math.max(0, referencePrice - depositNum);
      var amountFormatted = depositNum.toFixed(2).replace(".", ",");
      var balanceFormatted = balanceNum.toFixed(2).replace(".", ",");
      var paymentLabel = resolvedMode === "pre_pagamento_100" ? "Pré-pagamento Pix (100%)" : "Sinal Pix (40%)";

      // 8. Validação de data e horário
      var bookingDate = data.date ? String(data.date).trim() : "";
      var bookingTime = data.time ? String(data.time).trim() : "";
      if (!bookingDate || !bookingTime) {
        return responseJSON({
          status: "error",
          message: "Data ou horário do agendamento ausentes."
        });
      }

      var sheet = getOfficialSheet();
      if (!sheet) {
        return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
      }

      // 9. Proteção anti-duplicidade atômica na planilha (Coluna J: ID Agendamento)
      var existing = sheet.getDataRange().getValues();
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
        data.notes ? String(data.notes).trim() : ''
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
      notes: String(row[10] || '')
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
    return fetchAppointmentsFromSheet();
  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}
