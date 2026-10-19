import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// -----------------------------------------------------------------------------
// CORS Configuration for Production Frontend (GitHub Pages) & Development
// -----------------------------------------------------------------------------
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  'https://alansmorais.github.io',
  'https://alanp.github.io',
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean) as string[];

app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;

  if (origin) {
    const isAllowed =
      allowedOrigins.includes(origin) ||
      process.env.NODE_ENV !== 'production';

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// -----------------------------------------------------------------------------
// In-Memory Rate Limiter for Booking Notifications (max 10 requests / 60 seconds per IP)
// -----------------------------------------------------------------------------
const notificationRateLimitMap = new Map<string, number[]>();

function checkNotificationRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;

  const timestamps = notificationRateLimitMap.get(ip) || [];
  const recent = timestamps.filter(t => now - t < windowMs);

  if (recent.length >= maxRequests) {
    return false;
  }

  recent.push(now);
  notificationRateLimitMap.set(ip, recent);
  return true;
}

// -----------------------------------------------------------------------------
// Server-Side Anti-Duplication Store for Booking Notifications
// Prevents duplicate dispatches to Google Apps Script and duplicate Google Sheets writes
// -----------------------------------------------------------------------------
const processedAppointmentIds = new Set<string>();

// In-memory message dispatch log
export interface WhatsAppMessageLog {
  id: string;
  recipientPhone: string;
  recipientName: string;
  appointmentId?: string;
  serviceTitle?: string;
  dateTime?: string;
  status: 'sent' | 'simulated' | 'failed';
  timestamp: string;
  messageText: string;
  apiResponse?: any;
  error?: string;
}

const messageLogs: WhatsAppMessageLog[] = [];

// Helper to normalize Brazilian phone numbers to international standard E.164
function normalizePhone(phone: string): { normalized: string; valid: boolean; error?: string } {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) {
    return { normalized: '', valid: false, error: 'Número de telefone vazio.' };
  }

  // If already starts with 55 (Brazil country code)
  if (digits.startsWith('55')) {
    if (digits.length === 12 || digits.length === 13) {
      return { normalized: digits, valid: true };
    }
    if (digits.length > 13) {
      return { normalized: digits.slice(0, 13), valid: true };
    }
  }

  // If 10 or 11 digits (DDD + phone, e.g. 12984521920)
  if (digits.length === 10 || digits.length === 11) {
    return { normalized: `55${digits}`, valid: true };
  }

  // If 8 or 9 digits without DDD, default to regional DDD 12 (São Sebastião - SP)
  if (digits.length === 8 || digits.length === 9) {
    return { normalized: `5512${digits}`, valid: true };
  }

  return { normalized: digits, valid: digits.length >= 10 };
}

// Build confirmation message text
function buildConfirmationMessage(data: {
  clientName: string;
  serviceTitle: string;
  servicePrice?: string;
  date: string;
  time: string;
  studioAddress?: string;
  depositAmount?: number;
  paymentMode?: string;
  depositStatus?: string;
  customTemplate?: string;
}): string {
  const address = data.studioAddress || 'Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP';
  const priceInfo = data.servicePrice ? `\n💳 *Valor do Procedimento:* ${data.servicePrice}` : '';
  const depositInfo = data.depositAmount
    ? `\n💰 *Sinal / Pagamento:* R$ ${data.depositAmount},00 (${data.depositStatus === 'liquidado' ? 'Confirmado via Pix' : 'Aguardando validação'})`
    : '';

  if (data.customTemplate && data.customTemplate.trim()) {
    return data.customTemplate
      .replace(/{cliente}/g, data.clientName)
      .replace(/{servico}/g, data.serviceTitle)
      .replace(/{data}/g, data.date)
      .replace(/{horario}/g, data.time)
      .replace(/{valor}/g, data.servicePrice || '')
      .replace(/{endereco}/g, address)
      .replace(/{sinal}/g, data.depositAmount ? `R$ ${data.depositAmount},00` : '');
  }

  return `✨ *Confirmação de Agendamento • Espaço Angélica do Carmo* ✨\n\n` +
    `Olá, *${data.clientName}*! Seu horário no nosso atelier privativo foi *CONFIRMADO* com sucesso na grade. 💅✨\n\n` +
    `📋 *Detalhes do seu atendimento:*\n` +
    `• *Procedimento:* ${data.serviceTitle}\n` +
    `• *Data:* ${data.date}\n` +
    `• *Horário:* às ${data.time}` +
    priceInfo +
    depositInfo +
    `\n\n📍 *Endereço:* ${address}\n\n` +
    `ℹ️ *Orientações importantes:*\n` +
    `• Pedimos a gentileza de chegar com 5 a 10 minutos de antecedência.\n` +
    `• Em caso de necessidade de remarcação, avise com antecedência mínima de 24 horas.\n\n` +
    `Qualquer dúvida ou caso queira enviar uma foto de referência de nail art, pode responder a esta mensagem. Mal podemos esperar para cuidar de você! 💕`;
}

// -----------------------------------------------------------------------------
// WhatsApp Business API Routes
// -----------------------------------------------------------------------------

app.get('/api/whatsapp/status', (_req: Request, res: Response) => {
  const token = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN || process.env.META_WA_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v20.0';

  const isConfigured = Boolean(token && phoneNumberId);

  res.json({
    status: isConfigured ? 'configured' : 'sandbox_simulation',
    mode: isConfigured ? 'Meta WhatsApp Cloud API (Oficial)' : 'Modo Simulação Inteligente (Pronto para Chaves Meta)',
    isConfigured,
    phoneNumberIdConfigured: Boolean(phoneNumberId),
    tokenConfigured: Boolean(token),
    businessAccountIdConfigured: Boolean(businessAccountId),
    apiVersion,
    totalLogs: messageLogs.length,
    lastLog: messageLogs.length > 0 ? messageLogs[0] : null
  });
});

app.get('/api/whatsapp/logs', (_req: Request, res: Response) => {
  res.json({
    logs: messageLogs.slice(0, 50)
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'espaco-angelica-backend',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/notifications/status', (_req: Request, res: Response) => {
  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycby3s6UC86UjTAJtAjtyQF634z8NMv9LORG_IrzxCb4X_RQx0lLCyetz__QGT0-9B3jJ/exec';
  const hasToken = Boolean(process.env.APPS_SCRIPT_TOKEN || process.env.WEBHOOK_SECRET);
  res.json({
    status: 'ok',
    mode: 'secure_server_proxy',
    configured: Boolean(webhookUrl && hasToken),
    webhookUrlConfigured: Boolean(webhookUrl),
    tokenConfigured: hasToken,
    targetSender: 'kontakt@alansmsolutions.com',
    targetRecipient: 'angelikm19@gmail.com'
  });
});

app.post('/api/notifications/new-booking', async (req: Request, res: Response) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    // 1. Rate Limiting Check (Anti-spam/abuse)
    if (!checkNotificationRateLimit(clientIp)) {
      console.warn(`[Notification Warning] Rate limit excedido para IP ${clientIp}`);
      return res.status(429).json({
        success: false,
        error: 'Limite de requisições excedido. Por favor, aguarde alguns instantes.'
      });
    }

    const payload = req.body;

    // 2. Strict Request Validation
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Carga de requisição inválida.'
      });
    }

    const { clientName, clientPhone, date, time, depositAmount, appointmentId } = payload;

    if (!clientName || typeof clientName !== 'string' || clientName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Nome da cliente inválido ou ausente.'
      });
    }

    if (!clientPhone || typeof clientPhone !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Telefone da cliente ausente.'
      });
    }

    const { valid } = normalizePhone(clientPhone);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: 'Telefone da cliente possui formato inválido.'
      });
    }

    if (!date || typeof date !== 'string' || !time || typeof time !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Data ou horário de atendimento ausentes.'
      });
    }

    if (depositAmount !== undefined && (typeof depositAmount !== 'number' || depositAmount !== 50)) {
      return res.status(400).json({
        success: false,
        error: 'Valor do sinal divergente da política oficial (R$ 50,00).'
      });
    }

    if (!appointmentId || typeof appointmentId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'ID da reserva ausente.'
      });
    }

    // 3. Server-Side Anti-Duplication Protection
    // Evita chamadas repetidas ao Google Apps Script e gravações duplicadas no Google Sheets
    if (processedAppointmentIds.has(appointmentId)) {
      console.log(`[Notification Info] Notificação duplicada evitada para reserva ${appointmentId}`);
      return res.json({
        success: true,
        delivered: false,
        duplicate: true,
        message: `Notificação para a reserva ${appointmentId} já havia sido processada anteriormente. Gravação duplicada no Sheets prevenida.`,
        from: 'kontakt@alansmsolutions.com',
        to: 'angelikm19@gmail.com'
      });
    }

    processedAppointmentIds.add(appointmentId);
    if (processedAppointmentIds.size > 1000) {
      const first = processedAppointmentIds.values().next().value;
      if (first) processedAppointmentIds.delete(first);
    }

    console.log(`[Notification] Novo pré-agendamento recebido no servidor: ${clientName.trim()} (${clientPhone.trim()}) • ${payload.serviceTitle || 'Nail Design'} • ${date} às ${time}`);

    const webhookUrl =
      process.env.APPS_SCRIPT_WEBHOOK_URL ||
      'https://script.google.com/macros/s/AKfycby3s6UC86UjTAJtAjtyQF634z8NMv9LORG_IrzxCb4X_RQx0lLCyetz__QGT0-9B3jJ/exec';
    const serverToken = process.env.APPS_SCRIPT_TOKEN || process.env.WEBHOOK_SECRET || '';

    // If Google Apps Script webhook URL is available, forward securely server-to-server
    if (webhookUrl) {
      const authorizedBody = {
        ...payload,
        from: 'kontakt@alansmsolutions.com',
        to: 'angelikm19@gmail.com',
        depositAmount: depositAmount || 50,
        status: payload.status || 'pendente_pix',
        // Injeta os tokens e credenciais apenas no lado do servidor
        ...(serverToken ? { token: serverToken, authToken: serverToken, key: serverToken } : {})
      };

      try {
        const scriptResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(authorizedBody),
          signal: AbortSignal.timeout(15000)
        });

        if (scriptResponse.ok) {
          const responseText = await scriptResponse.text();
          let jsonRes: any = null;
          try {
            jsonRes = JSON.parse(responseText);
          } catch {}

          if (jsonRes && jsonRes.status === 'error') {
            console.warn(`[Notification Warning] Google Apps Script recusou a notificação: ${jsonRes.message}`);
            return res.status(200).json({
              success: false,
              delivered: false,
              error: `Google Apps Script recusou: ${jsonRes.message || 'Erro não especificado'}`
            });
          }

          console.log(`[Notification Success] Google Apps Script confirmou o disparo para angelikm19@gmail.com!`);
          return res.json({
            success: true,
            delivered: true,
            message: `Notificação enviada com sucesso para angelikm19@gmail.com via Google Apps Script (remetente: kontakt@alansmsolutions.com).`,
            from: 'kontakt@alansmsolutions.com',
            to: 'angelikm19@gmail.com'
          });
        } else {
          return res.status(200).json({
            success: false,
            delivered: false,
            error: `HTTP ${scriptResponse.status} retornado pelo Google Apps Script.`
          });
        }
      } catch (scriptErr: any) {
        console.error(`[Notification Error] Falha ao conectar ao Google Apps Script:`, scriptErr);
        const isTimeout = scriptErr.name === 'TimeoutError' || scriptErr.name === 'AbortError' || scriptErr.message?.includes('timeout');
        return res.status(200).json({
          success: false,
          delivered: false,
          error: isTimeout
            ? 'Tempo limite esgotado (15s) ao aguardar resposta do Google Apps Script.'
            : `Falha de rede ao conectar com o Google Apps Script: ${scriptErr.message}`
        });
      }
    }

    return res.json({
      success: true,
      delivered: false,
      message: `Pré-agendamento registrado no servidor. Notificação gravada (nenhum Webhook configurado).`,
      from: 'kontakt@alansmsolutions.com',
      to: 'angelikm19@gmail.com'
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Erro interno ao processar notificação de agendamento.',
      details: err.message
    });
  }
});

app.post('/api/whatsapp/send-confirmation', async (req: Request, res: Response) => {
  try {
    const {
      appointmentId,
      clientName,
      clientPhone,
      serviceTitle,
      servicePrice,
      date,
      time,
      studioAddress,
      depositAmount,
      paymentMode,
      depositStatus,
      customTemplate
    } = req.body;

    if (!clientName || !clientPhone) {
      return res.status(400).json({
        success: false,
        error: 'Nome e telefone da cliente são obrigatórios para envio da confirmação.'
      });
    }

    const { normalized, valid, error } = normalizePhone(clientPhone);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: error || 'Número de telefone inválido para envio via WhatsApp.'
      });
    }

    const messageText = buildConfirmationMessage({
      clientName,
      serviceTitle: serviceTitle || 'Procedimento de Nail Design',
      servicePrice,
      date: date || 'Hoje',
      time: time || 'Horário agendado',
      studioAddress,
      depositAmount,
      paymentMode,
      depositStatus,
      customTemplate
    });

    const token = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN || process.env.META_WA_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v20.0';

    const logEntry: WhatsAppMessageLog = {
      id: `wa-log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      recipientPhone: normalized,
      recipientName: clientName,
      appointmentId,
      serviceTitle,
      dateTime: `${date} às ${time}`,
      status: 'simulated',
      timestamp: new Date().toISOString(),
      messageText
    };

    // If Meta Cloud API credentials are provided, call Meta Graph API
    if (token && phoneNumberId) {
      try {
        const metaUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
        const metaPayload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalized,
          type: 'text',
          text: {
            preview_url: false,
            body: messageText
          }
        };

        const response = await fetch(metaUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(metaPayload)
        });

        const resData = await response.json();
        if (response.ok) {
          logEntry.status = 'sent';
          logEntry.apiResponse = resData;
          messageLogs.unshift(logEntry);

          return res.json({
            success: true,
            status: 'sent',
            normalizedPhone: normalized,
            metaResponse: resData,
            message: `Mensagem de confirmação enviada com sucesso para ${clientName} (${normalized}) via WhatsApp Business API!`,
            log: logEntry
          });
        } else {
          logEntry.status = 'failed';
          logEntry.error = resData.error?.message || 'Erro retornado pela API do Meta WhatsApp';
          logEntry.apiResponse = resData;
          messageLogs.unshift(logEntry);

          return res.status(200).json({
            success: false,
            status: 'failed',
            error: resData.error?.message || 'Falha no envio via Meta WhatsApp Cloud API.',
            metaError: resData,
            normalizedPhone: normalized,
            fallbackUrl: `https://wa.me/${normalized}?text=${encodeURIComponent(messageText)}`,
            log: logEntry
          });
        }
      } catch (metaErr: any) {
        logEntry.status = 'failed';
        logEntry.error = metaErr.message || 'Erro de rede na chamada ao Meta WhatsApp';
        messageLogs.unshift(logEntry);

        return res.status(200).json({
          success: false,
          status: 'failed',
          error: 'Falha de comunicação com o servidor da Meta.',
          details: metaErr.message,
          normalizedPhone: normalized,
          fallbackUrl: `https://wa.me/${normalized}?text=${encodeURIComponent(messageText)}`,
          log: logEntry
        });
      }
    }

    // Otherwise: Sandbox / Simulation Mode (ready for credentials)
    logEntry.status = 'simulated';
    messageLogs.unshift(logEntry);

    return res.json({
      success: true,
      status: 'simulated',
      mode: 'sandbox_simulation',
      normalizedPhone: normalized,
      notice: 'Ambiente de desenvolvimento/simulação ativo. Configure WHATSAPP_API_TOKEN e WHATSAPP_PHONE_NUMBER_ID no .env para envio direto via servidores da Meta.',
      message: `Confirmação registrada automaticamente para ${clientName} (${normalized})!`,
      previewText: messageText,
      fallbackUrl: `https://wa.me/${normalized}?text=${encodeURIComponent(messageText)}`,
      log: logEntry
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Erro interno ao processar confirmação de WhatsApp.',
      details: err.message
    });
  }
});

// -----------------------------------------------------------------------------
// Vite Middleware / Static Serving
// -----------------------------------------------------------------------------

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {}
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexPath = path.resolve(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.json({
          status: 'ok',
          service: 'espaco-angelica-backend',
          message: 'Espaço Angélica do Carmo API Server is online.',
          endpoints: {
            health: '/health',
            notificationStatus: '/api/notifications/status',
            whatsappStatus: '/api/whatsapp/status'
          }
        });
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Espaço Angélica Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
