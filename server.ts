import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import { areDatesEqual } from './src/services/notificationTemplates';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envStagingPath = path.resolve(__dirname, '.env.staging');
const envDefaultPath = path.resolve(__dirname, '.env');
const hasStagingFlag = process.argv.includes('--staging');
const isStagingRequested =
  hasStagingFlag ||
  process.env.APP_ENV === 'staging' ||
  process.env.NODE_ENV === 'staging' ||
  (process.env.NODE_ENV !== 'production' && !fs.existsSync(envDefaultPath) && fs.existsSync(envStagingPath));

if (isStagingRequested) {
  if (fs.existsSync(envStagingPath)) {
    dotenv.config({ path: envStagingPath, override: true });
  }
  process.env.APP_ENV = 'staging';
} else {
  dotenv.config();
}

const PRODUCTION_APPS_SCRIPT_DEPLOYMENT_ID =
  'AKfycbysNBMLthA_GvAZJR1irBGcS-3Lspbfz0NIsvz0P2ax6jzE4M01RwVJ0za6zFsq8bGojw';
const DEFAULT_PRODUCTION_APPS_SCRIPT_URL =
  `https://script.google.com/macros/s/${PRODUCTION_APPS_SCRIPT_DEPLOYMENT_ID}/exec`;
const PRODUCTION_RECIPIENT_EMAIL = 'angelikm19@gmail.com';
const STAGING_RECIPIENT_EMAIL = 'kontakt@alansmsolutions.com';

function isPlaceholderValue(value: string): boolean {
  if (!value) return true;
  const upper = value.toUpperCase();
  return (
    upper.includes('REPLACE_WITH_') ||
    upper.includes('YOUR_') ||
    upper.startsWith('MY_')
  );
}

function resolveNotificationRecipient(isStaging: boolean, isTest?: boolean): string {
  if (isTest) {
    return STAGING_RECIPIENT_EMAIL;
  }
  if (!isStaging) {
    return PRODUCTION_RECIPIENT_EMAIL;
  }
  const recipientOverride = (process.env.STAGING_NOTIFICATION_RECIPIENT || '').trim();
  if (
    recipientOverride &&
    !isPlaceholderValue(recipientOverride) &&
    recipientOverride.toLowerCase() !== PRODUCTION_RECIPIENT_EMAIL &&
    recipientOverride.toLowerCase() === STAGING_RECIPIENT_EMAIL
  ) {
    return recipientOverride;
  }
  return STAGING_RECIPIENT_EMAIL;
}

function resolveAppsScriptConfig() {
  const appEnv = isStagingRequested
    ? 'staging'
    : process.env.APP_ENV || process.env.NODE_ENV || 'development';
  const isStaging = appEnv === 'staging';
  const rawUrl = (process.env.APPS_SCRIPT_WEBHOOK_URL || '').trim();
  const rawToken = (process.env.APPS_SCRIPT_TOKEN || '').trim();

  const hasExplicitUrl = Boolean(rawUrl && !isPlaceholderValue(rawUrl));
  const hasExplicitToken = Boolean(rawToken && !isPlaceholderValue(rawToken));
  const isProductionUrl = rawUrl.includes(PRODUCTION_APPS_SCRIPT_DEPLOYMENT_ID);

  if (isStaging && isProductionUrl) {
    return {
      appEnv,
      isStaging,
      configured: false,
      webhookUrl: '',
      token: '',
      webhookUrlConfigured: false,
      tokenConfigured: hasExplicitToken,
      safetyError:
        'Segurança: URL de produção do Google Apps Script detectada e bloqueada. Configure exclusivamente a URL de teste em .env.staging.'
    };
  }

  const webhookUrl = isStaging
    ? hasExplicitUrl
      ? rawUrl
      : ''
    : hasExplicitUrl
    ? rawUrl
    : DEFAULT_PRODUCTION_APPS_SCRIPT_URL;
  const token = hasExplicitToken ? rawToken : '';

  return {
    appEnv,
    isStaging,
    configured: isStaging ? Boolean(webhookUrl && token) : Boolean(webhookUrl),
    webhookUrl,
    token,
    webhookUrlConfigured: Boolean(webhookUrl),
    tokenConfigured: Boolean(token),
    safetyError: !webhookUrl
      ? 'APPS_SCRIPT_WEBHOOK_URL explícita não configurada.'
      : isStaging && !token
      ? 'APPS_SCRIPT_TOKEN explícito não configurado.'
      : undefined
  };
}

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -----------------------------------------------------------------------------
// CORS Configuration for Production Frontend (GitHub Pages) & Development
// -----------------------------------------------------------------------------
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  'https://espacoangelica.alansmsolutions.com',
  'https://www.espacoangelica.alansmsolutions.com',
  'https://alansmorais.github.io',
  'https://alanp.github.io',
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean) as string[];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/$/, '');
  return (
    allowedOrigins.some(allowed => allowed.trim().replace(/\/$/, '') === normalized) ||
    process.env.NODE_ENV !== 'production'
  );
}

app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    res.setHeader('Access-Control-Max-Age', '86400');
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
function formatCurrencyServerBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

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
  const depositFormatted = data.depositAmount ? `R$ ${formatCurrencyServerBRL(data.depositAmount)}` : '';
  const paymentLabel =
    data.paymentMode === 'pre_pagamento_100'
      ? 'Pré-pagamento (100%)'
      : 'Sinal (40%)';
  const depositInfo = data.depositAmount
    ? `\n💰 *${paymentLabel}:* ${depositFormatted} (${data.depositStatus === 'liquidado' ? 'Confirmado via Pix' : 'Aguardando validação'})`
    : '';

  let balanceInfo = '';
  if (data.servicePrice && data.depositAmount !== undefined && data.paymentMode !== 'pre_pagamento_100') {
    const parsedPrice = parseBRLString(data.servicePrice);
    if (parsedPrice !== null) {
      const remaining = Math.max(0, Math.round((parsedPrice - data.depositAmount) * 100) / 100);
      balanceInfo = `\n💵 *Saldo Restante no Atendimento:* R$ ${formatCurrencyServerBRL(remaining)}`;
    }
  }

  if (data.customTemplate && data.customTemplate.trim()) {
    return data.customTemplate
      .replace(/{cliente}/g, data.clientName)
      .replace(/{servico}/g, data.serviceTitle)
      .replace(/{data}/g, data.date)
      .replace(/{horario}/g, data.time)
      .replace(/{valor}/g, data.servicePrice || '')
      .replace(/{endereco}/g, address)
      .replace(/{sinal}/g, depositFormatted);
  }

  return `✨ *Confirmação de Agendamento • Espaço Angélica do Carmo* ✨\n\n` +
    `Olá, *${data.clientName}*! Seu horário no nosso atelier privativo foi *CONFIRMADO* com sucesso na grade. 💅✨\n\n` +
    `📋 *Detalhes do seu atendimento:*\n` +
    `• *Procedimento:* ${data.serviceTitle}\n` +
    `• *Data:* ${data.date}\n` +
    `• *Horário:* às ${data.time}` +
    priceInfo +
    depositInfo +
    balanceInfo +
    `\n\n📍 *Endereço:* ${address}\n\n` +
    `ℹ️ *Orientações importantes:*\n` +
    `• Pedimos a gentileza de chegar com 5 a 10 minutos de antecedência.\n` +
    `• Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago.\n` +
    `• Em caso de desistência ou não comparecimento, o sinal não é reembolsado.\n\n` +
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
    totalLogs: messageLogs.length
  });
});

app.get('/api/whatsapp/logs', (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }
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
  const cfg = resolveAppsScriptConfig();
  const targetRecipient = resolveNotificationRecipient(cfg.isStaging);

  res.json({
    status: 'ok',
    environment: cfg.appEnv,
    mode: cfg.isStaging ? 'staging_isolated_proxy' : 'secure_server_proxy',
    configured: cfg.configured,
    webhookUrlConfigured: cfg.webhookUrlConfigured,
    tokenConfigured: cfg.tokenConfigured,
    safetyError: cfg.safetyError || null,
    targetSender: 'kontakt@alansmsolutions.com',
    targetRecipient
  });
});

export interface ServerStoredAppointment {
  id: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceId: string;
  serviceTitle: string;
  servicePrice: string;
  date: string;
  time: string;
  status: string;
  depositAmount: number;
  depositStatus: string;
  paymentMode: 'sinal_40' | 'pre_pagamento_100';
  timestamp: string;
  notes?: string;
  nailCondition?: string;
}

export const serverAppointments: ServerStoredAppointment[] = [];
const deletedAppointmentIds = new Set<string>();

export function recordServerAppointment(apt: ServerStoredAppointment): void {
  deletedAppointmentIds.delete(apt.id);
  const existingIdx = serverAppointments.findIndex(a => a.id === apt.id);
  if (existingIdx >= 0) {
    serverAppointments[existingIdx] = apt;
  } else {
    serverAppointments.unshift(apt);
    if (serverAppointments.length > 500) {
      serverAppointments.pop();
    }
  }
}

const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function getAdminSessionSigningSecret(): string {
  return (process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN || process.env.ADMIN_PASSWORD || '').trim();
}

function signAdminSession(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function verifyAdminSession(token: string): boolean {
  const secret = getAdminSessionSigningSecret();
  if (!secret || !token.startsWith('session.')) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = parts[1];
  const suppliedSignature = Buffer.from(parts[2], 'base64url');
  const expectedSignature = Buffer.from(signAdminSession(payload, secret), 'base64url');
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data?.exp > Date.now() && data?.scope === 'admin';
  } catch {
    return false;
  }
}

app.post('/api/admin/session', (req: Request, res: Response) => {
  const supplied = String(req.body?.password || '').trim();
  const configuredToken = (process.env.ADMIN_TOKEN || '').trim();
  const configuredPassword = (process.env.ADMIN_PASSWORD || '').trim();
  const signingSecret = getAdminSessionSigningSecret();
  if (!supplied || !signingSecret ||
      !((configuredToken && supplied === configuredToken) || (configuredPassword && supplied === configuredPassword))) {
    return res.status(401).json({ success: false, error: 'Credencial administrativa inválida.' });
  }
  const payload = Buffer.from(JSON.stringify({ scope: 'admin', exp: Date.now() + ADMIN_SESSION_TTL_MS })).toString('base64url');
  const token = `session.${payload}.${signAdminSession(payload, signingSecret)}`;
  return res.json({ success: true, token, expiresInSeconds: ADMIN_SESSION_TTL_MS / 1000 });
});

app.delete('/api/admin/session', (_req: Request, res: Response) => {
  // Signed sessions expire after eight hours. Stateless tokens need no in-memory revocation store.
  return res.json({ success: true });
});

function isAuthorizedAdminRequest(req: Request): boolean {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken = (req.headers['x-admin-token'] as string || '').trim();
  const provided = bearerToken || headerToken;

  // Stateless signed sessions work across Cloud Run instances and expire automatically.
  if (provided && verifyAdminSession(provided)) return true;
  // Segurança estrita: NUNCA aceita credenciais administrativas via query string (req.query)
  if (!provided) return false;

  // Segurança estrita: NUNCA usa APPS_SCRIPT_TOKEN ou WEBHOOK_SECRET como credencial do painel
  // Apenas credenciais dedicadas de administração: ADMIN_TOKEN ou ADMIN_PASSWORD
  const serverAdminToken = (process.env.ADMIN_TOKEN || '').trim();
  const serverAdminPassword = (process.env.ADMIN_PASSWORD || '').trim();

  // Falha segura/fechada: se nenhuma credencial administrativa estiver configurada no ambiente,
  // recusa todo acesso administrativo (sem senhas padrão nem fallbacks no código).
  if (!serverAdminToken && !serverAdminPassword) {
    return false;
  }

  if (serverAdminToken && provided === serverAdminToken) {
    return true;
  }
  if (serverAdminPassword && provided === serverAdminPassword) {
    return true;
  }

  return false;
}

app.get('/api/public/availability', async (_req: Request, res: Response) => {
  // Public-safe availability only: never return client names, phone numbers, email, notes, or payment data.
  res.setHeader('Cache-Control', 'no-store');
  const cfg = resolveAppsScriptConfig();
  if (!cfg.configured || !cfg.webhookUrl) {
    return res.status(503).json({ success: false, error: 'A disponibilidade oficial não está configurada.' });
  }
  try {
    const scriptRes = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getAppointments', token: cfg.token }),
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    const data = await scriptRes.json().catch(() => null);
    if (!scriptRes.ok || data?.status !== 'success' || !Array.isArray(data?.appointments)) {
      return res.status(503).json({ success: false, error: 'Não foi possível confirmar a disponibilidade na agenda oficial.' });
    }
    const authoritative = data.appointments.filter((a: any) => a?.id && !deletedAppointmentIds.has(String(a.id)));
    // Refresh server snapshot used by the final pre-check.
    serverAppointments.splice(0, serverAppointments.length, ...authoritative);
    const slots = authoritative
      .filter((a: any) => !['cancelado', 'teste_sistema'].includes(String(a.status)))
      .map((a: any) => ({
        id: String(a.id || ''),
        date: String(a.date || ''),
        time: String(a.time || ''),
        status: String(a.status || 'pendente_pix')
      }));
    const blockedDates = Array.from(new Set(slots.filter((a: any) => a.status === 'bloqueado').map((a: any) => a.date)));
    return res.json({ success: true, slots, blockedDates, updatedAt: new Date().toISOString() });
  } catch {
    return res.status(503).json({ success: false, error: 'A agenda oficial está temporariamente inacessível. Não exibiremos horários sem confirmação.' });
  }
});

app.get('/api/appointments', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }

  try {
    const cfg = resolveAppsScriptConfig();
    let externalAppointments: any[] = [];
    let hasAuthoritativeSheetData = false;

    if (cfg.configured && cfg.webhookUrl) {
      try {
        // Comunicação segura via POST com token no corpo criptografado (elimina token na query string)
        const scriptRes = await fetch(cfg.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify({
            action: 'getAppointments',
            token: cfg.token
          }),
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        if (scriptRes.ok) {
          const rawText = await scriptRes.text();
          let resData: any = null;
          try {
            resData = JSON.parse(rawText);
          } catch {}
          if (resData?.status === 'success' && Array.isArray(resData?.appointments)) {
            externalAppointments = resData.appointments;
            hasAuthoritativeSheetData = true;
          }
        }
      } catch {
        // Apps Script fallback to server cache
      }
    }

    if (hasAuthoritativeSheetData) {
      const appointments = externalAppointments.filter(
        apt => apt.id && !deletedAppointmentIds.has(String(apt.id))
      );
      return res.json({
        success: true,
        appointments,
        source: 'sheets_synced',
        total: appointments.length
      });
    }

    const mergedMap = new Map<string, any>();
    for (const apt of serverAppointments) {
      if (!deletedAppointmentIds.has(apt.id)) {
        mergedMap.set(apt.id, apt);
      }
    }
    for (const ext of externalAppointments) {
      if (ext.id && !deletedAppointmentIds.has(String(ext.id))) {
        mergedMap.set(ext.id, { ...mergedMap.get(ext.id), ...ext });
      }
    }

    return res.json({
      success: true,
      appointments: Array.from(mergedMap.values()),
      source: externalAppointments.length > 0 ? 'sheets_synced' : 'server_cache',
      total: mergedMap.size
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar agendamentos do servidor.',
      details: err.message
    });
  }
});

app.delete('/api/appointments/:appointmentId', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }

  const appointmentId = String(req.params.appointmentId || '').trim();
  if (!/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(appointmentId)) {
    return res.status(400).json({
      success: false,
      error: 'ID do agendamento inválido.'
    });
  }

  const cfg = resolveAppsScriptConfig();
  if (!cfg.configured || !cfg.webhookUrl) {
    return res.status(503).json({
      success: false,
      error: cfg.safetyError || 'Integração com Google Apps Script não configurada.'
    });
  }

  try {
    const scriptRes = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action: 'deleteAppointment',
        appointmentId,
        token: cfg.token
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });

    const rawText = await scriptRes.text();
    let scriptData: any;
    try {
      scriptData = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        success: false,
        error: 'Resposta inválida do Google Apps Script ao excluir o agendamento.'
      });
    }

    if (!scriptRes.ok || scriptData?.status !== 'success' || (!scriptData.deleted && !scriptData.notFound)) {
      return res.status(502).json({
        success: false,
        error: scriptData?.message || `Google Apps Script recusou a exclusão (HTTP ${scriptRes.status}).`
      });
    }

    deletedAppointmentIds.add(appointmentId);
    const cachedIndex = serverAppointments.findIndex(apt => apt.id === appointmentId);
    if (cachedIndex >= 0) {
      serverAppointments.splice(cachedIndex, 1);
    }

    return res.json({
      success: true,
      deleted: Boolean(scriptData.deleted),
      alreadyDeleted: Boolean(scriptData.notFound),
      appointmentId,
      message: scriptData.message
    });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      error: `Falha ao comunicar com Google Apps Script: ${err.message || 'erro desconhecido'}.`
    });
  }
});

app.put('/api/appointments/:appointmentId', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }

  const appointmentId = String(req.params.appointmentId || '').trim();
  if (!isValidAppointmentId(appointmentId)) {
    return res.status(400).json({
      success: false,
      error: 'ID do agendamento inválido.'
    });
  }

  const cfg = resolveAppsScriptConfig();
  if (!cfg.configured || !cfg.webhookUrl) {
    return res.status(503).json({
      success: false,
      error: cfg.safetyError || 'Integração com Google Apps Script não configurada.'
    });
  }

  const updates = req.body || {};

  try {
    const scriptRes = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action: 'updateAppointment',
        appointmentId,
        token: cfg.token,
        clientName: updates.clientName,
        clientPhone: updates.clientPhone,
        clientEmail: updates.clientEmail,
        serviceTitle: updates.serviceTitle,
        date: updates.date,
        time: updates.time,
        depositAmount: updates.depositAmount !== undefined ? Number(updates.depositAmount) : undefined,
        status: updates.status,
        notes: updates.notes,
        appointmentLocation: updates.appointmentLocation,
        homeAddress: updates.homeAddress,
        additionalServiceIds: updates.additionalServiceIds,
        customRequest: updates.customRequest,
        serviceId: updates.serviceId
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });

    const rawText = await scriptRes.text();
    let scriptData: any;
    try {
      scriptData = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        success: false,
        error: 'Resposta inválida do Google Apps Script ao atualizar o agendamento.'
      });
    }

    if (!scriptRes.ok || scriptData?.status !== 'success' || !scriptData.updated) {
      return res.status(502).json({
        success: false,
        error: scriptData?.message || `Google Apps Script recusou a atualização (HTTP ${scriptRes.status}).`
      });
    }

    // Atualiza cache em memória
    deletedAppointmentIds.delete(appointmentId);
    const cachedIndex = serverAppointments.findIndex(apt => apt.id === appointmentId);
    let updatedRecord: ServerStoredAppointment;
    if (cachedIndex >= 0) {
      serverAppointments[cachedIndex] = {
        ...serverAppointments[cachedIndex],
        ...(updates.clientName !== undefined && { clientName: String(updates.clientName).trim() }),
        ...(updates.clientPhone !== undefined && { clientPhone: String(updates.clientPhone).trim() }),
        ...(updates.clientEmail !== undefined && { clientEmail: String(updates.clientEmail).trim() }),
        ...(updates.serviceTitle !== undefined && { serviceTitle: String(updates.serviceTitle).trim() }),
        ...(updates.date !== undefined && { date: String(updates.date).trim() }),
        ...(updates.time !== undefined && { time: String(updates.time).trim() }),
        ...(updates.depositAmount !== undefined && { depositAmount: Number(updates.depositAmount) }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.notes !== undefined && { notes: String(updates.notes).trim() })
      };
      updatedRecord = serverAppointments[cachedIndex];
    } else {
      updatedRecord = {
        id: appointmentId,
        clientName: String(updates.clientName || 'Cliente').trim(),
        clientPhone: String(updates.clientPhone || '').trim(),
        clientEmail: String(updates.clientEmail || '').trim(),
        serviceId: String(updates.serviceId || 'alongamento-fibra-slim'),
        serviceTitle: String(updates.serviceTitle || 'Procedimento').trim(),
        servicePrice: String(updates.servicePrice || 'R$ 0,00'),
        date: String(updates.date || '').trim(),
        time: String(updates.time || '').trim(),
        status: updates.status || 'pendente_pix',
        depositAmount: Number(updates.depositAmount || 0),
        depositStatus: String(updates.depositStatus || 'pendente'),
        paymentMode: (updates.paymentMode === 'pre_pagamento_100' ? 'pre_pagamento_100' : 'sinal_40'),
        timestamp: new Date().toISOString(),
        notes: String(updates.notes || '').trim()
      };
      serverAppointments.push(updatedRecord);
    }

    return res.json({
      success: true,
      persisted: true,
      appointment: updatedRecord,
      message: scriptData.message || 'Agendamento atualizado com sucesso.'
    });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      error: `Falha ao comunicar com Google Apps Script: ${err.message || 'erro desconhecido'}.`
    });
  }
});

app.post('/api/appointments/block', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'Carga de bloqueio inválida.'
    });
  }

  const { date, reason, time, notes } = payload;
  let appointmentId = payload.appointmentId;
  if (!appointmentId || typeof appointmentId !== 'string') {
    appointmentId = `apt-block-${Date.now()}`;
  }

  if (!isValidAppointmentId(appointmentId)) {
    return res.status(400).json({
      success: false,
      error: 'ID do bloqueio inválido ou fora do formato esperado (deve iniciar com apt-).'
    });
  }

  if (!date || typeof date !== 'string' || !date.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Data do bloqueio ausente.'
    });
  }

  const blockReason = (reason && typeof reason === 'string' && reason.trim()) ? reason.trim() : 'Bloqueio de Agenda';
  const blockTime = (time && typeof time === 'string' && time.trim()) ? time.trim() : 'Dia Inteiro';
  const blockDate = date.trim();
  const blockNotes = (notes && typeof notes === 'string' && notes.trim()) ? notes.trim() : blockReason;

  const blockRecord: ServerStoredAppointment = {
    id: appointmentId,
    clientName: 'Protocolo Ateliê',
    clientPhone: '(12) 97406-2241',
    serviceId: 'bloqueio-agenda',
    serviceTitle: `Bloqueio: ${blockReason}`,
    servicePrice: 'R$ 0,00',
    date: blockDate,
    time: blockTime,
    status: 'bloqueado',
    depositAmount: 0,
    depositStatus: 'liquidado',
    paymentMode: 'sinal_40',
    timestamp: new Date().toISOString(),
    notes: blockNotes
  };

  const cfg = resolveAppsScriptConfig();
  if (cfg.configured && cfg.webhookUrl) {
    try {
      const scriptRes = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          action: 'blockSchedule',
          appointmentId,
          date: blockDate,
          time: blockTime,
          clientName: 'Protocolo Ateliê',
          clientPhone: '(12) 97406-2241',
          serviceTitle: `Bloqueio: ${blockReason}`,
          status: 'bloqueado',
          notes: blockNotes,
          blockReason,
          token: cfg.token
        }),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });

      const rawText = await scriptRes.text();
      let scriptData: any = null;
      try {
        scriptData = JSON.parse(rawText);
      } catch {}

      if (!scriptRes.ok || (scriptData?.status !== 'success' && scriptData?.persisted !== true)) {
        return res.status(502).json({
          success: false,
          persisted: false,
          error: scriptData?.message || `Google Apps Script recusou a gravação do bloqueio (HTTP ${scriptRes.status}).`
        });
      }

      recordServerAppointment(blockRecord);
      return res.json({
        success: true,
        persisted: true,
        duplicate: Boolean(scriptData.duplicate),
        appointment: blockRecord,
        message: scriptData.message || 'Bloqueio de data registrado com sucesso na planilha oficial.'
      });
    } catch (err: any) {
      return res.status(502).json({
        success: false,
        persisted: false,
        error: `Falha de rede ao conectar com Google Apps Script: ${err.message || 'erro desconhecido'}.`
      });
    }
  }

  // Se o Google Apps Script não estiver configurado, falha fechado para evitar falso sucesso
  return res.status(503).json({
    success: false,
    persisted: false,
    error: cfg.safetyError || 'Integração com Google Apps Script não configurada para gravação oficial de bloqueios.'
  });
});

app.get('/api/appointments/blocked-dates', async (_req: Request, res: Response) => {
  try {
    const blockedDates = new Set<string>();
    for (const apt of serverAppointments) {
      if (!deletedAppointmentIds.has(apt.id) && apt.status === 'bloqueado' && apt.date) {
        blockedDates.add(apt.date.trim());
      }
    }

    const cfg = resolveAppsScriptConfig();
    if (cfg.configured && cfg.webhookUrl) {
      try {
        const scriptRes = await fetch(cfg.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify({
            action: 'getAppointments',
            token: cfg.token
          }),
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        if (scriptRes.ok) {
          const rawText = await scriptRes.text();
          let resData: any = null;
          try {
            resData = JSON.parse(rawText);
          } catch {}
          if (resData?.status === 'success' && Array.isArray(resData?.appointments)) {
            for (const apt of resData.appointments) {
              if (apt && apt.id && !deletedAppointmentIds.has(String(apt.id)) && apt.status === 'bloqueado' && apt.date) {
                blockedDates.add(String(apt.date).trim());
              }
            }
          }
        }
      } catch {}
    }

    return res.json({
      success: true,
      blockedDates: Array.from(blockedDates)
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar datas bloqueadas.',
      details: err.message
    });
  }
});

export interface CanonicalCatalogService {
  id: string;
  title: string;
  price: number;
  priceFormatted: string;
}

export const OFFICIAL_SERVICES_BY_ID: Record<string, CanonicalCatalogService> = {
  'alongamento-fibra-slim': {
    id: 'alongamento-fibra-slim',
    title: 'Alongamento em Fibra Slim',
    price: 220,
    priceFormatted: 'R$ 220,00'
  },
  'manutencao-fibra-vidro': {
    id: 'manutencao-fibra-vidro',
    title: 'Manutenção Fibra de Vidro',
    price: 140,
    priceFormatted: 'R$ 140,00'
  },
  'blindagem-diamante': {
    id: 'blindagem-diamante',
    title: 'Blindagem Diamante & Banho Gel',
    price: 130,
    priceFormatted: 'R$ 130,00'
  },
  'esmaltacao-gel-premium': {
    id: 'esmaltacao-gel-premium',
    title: 'Esmaltação em Gel Premium',
    price: 95,
    priceFormatted: 'R$ 95,00'
  },
  'nail-art-encapsulada': {
    id: 'nail-art-encapsulada',
    title: 'Nail Art Autoral & Encapsulada',
    price: 30,
    priceFormatted: 'A partir de R$ 30,00'
  },
  'spa-das-maos-ouro': {
    id: 'spa-das-maos-ouro',
    title: 'Spa das Mãos & Esfoliação',
    price: 85,
    priceFormatted: 'R$ 85,00'
  }
};

export const OFFICIAL_SERVICES_BY_TITLE: Record<string, CanonicalCatalogService> = Object.values(
  OFFICIAL_SERVICES_BY_ID
).reduce((acc, item) => {
  acc[item.title.toLowerCase()] = item;
  return acc;
}, {} as Record<string, CanonicalCatalogService>);

export const OFFICIAL_CATALOG_PRICES: Record<string, number> = Object.values(
  OFFICIAL_SERVICES_BY_ID
).reduce((acc, item) => {
  acc[item.id] = item.price;
  acc[item.title.toLowerCase()] = item.price;
  return acc;
}, {} as Record<string, number>);

export const DYNAMIC_SERVICES_BY_ID: Record<string, CanonicalCatalogService> = {};
export const DYNAMIC_SERVICES_BY_TITLE: Record<string, CanonicalCatalogService> = {};

export function registerDynamicService(service: CanonicalCatalogService) {
  if (service && service.id) {
    DYNAMIC_SERVICES_BY_ID[service.id] = service;
    if (service.title) {
      DYNAMIC_SERVICES_BY_TITLE[service.title.toLowerCase().trim()] = service;
    }
  }
}

export function parseBRLString(raw?: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function validateBookingPaymentCoherence(payload: any): {
  valid: boolean;
  error?: string;
  verifiedServiceId?: string;
  verifiedServiceTitle?: string;
  verifiedDepositAmount?: number;
  verifiedServicePrice?: string;
  verifiedPaymentMode?: 'sinal_40' | 'pre_pagamento_100';
} {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      error: 'Carga de pagamento inválida.'
    };
  }

  const { serviceId, serviceTitle, servicePrice, depositAmount, paymentMode, status } = payload;
  const additionalServiceIds: string[] = Array.isArray(payload.additionalServiceIds)
    ? Array.from(new Set<string>(payload.additionalServiceIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '')))
    : [];

  if (typeof depositAmount !== 'number' || !Number.isFinite(depositAmount) || depositAmount <= 0) {
    return {
      valid: false,
      error: 'Valor do sinal/pré-pagamento inválido ou ausente (deve corresponder a 40% ou 100% do valor oficial do procedimento).'
    };
  }

  if (
    paymentMode !== undefined &&
    paymentMode !== 'sinal_40' &&
    paymentMode !== 'pre_pagamento_100'
  ) {
    return {
      valid: false,
      error: 'Modalidade de pagamento inválida. Use sinal_40 (40%) ou pre_pagamento_100 (100%).'
    };
  }

  let canonicalService: CanonicalCatalogService | undefined;

  if (serviceId !== undefined && serviceId !== null && String(serviceId).trim() !== '') {
    if (typeof serviceId !== 'string') {
      return {
        valid: false,
        error: 'ID do procedimento inválido.'
      };
    }
    const normalizedId = serviceId.trim();
    canonicalService = DYNAMIC_SERVICES_BY_ID[normalizedId];
    if (!canonicalService) {
      return {
        valid: false,
        error: `ID de procedimento desconhecido ("${normalizedId}").`
      };
    }

    if (typeof serviceTitle === 'string' && serviceTitle.trim() !== '' && additionalServiceIds.length === 0) {
      const normalizedTitle = serviceTitle.trim().toLowerCase();
      if (normalizedTitle !== canonicalService.title.toLowerCase()) {
        return {
          valid: false,
          error: `Nome do procedimento ("${serviceTitle}") diverge do ID oficial ("${canonicalService.id}").`
        };
      }
    }
  } else if (typeof serviceTitle === 'string' && serviceTitle.trim() !== '') {
    const normalizedTitle = serviceTitle.trim().toLowerCase();
    canonicalService = DYNAMIC_SERVICES_BY_TITLE[normalizedTitle];
    if (!canonicalService) {
      return {
        valid: false,
        error: `Procedimento desconhecido ("${serviceTitle}"). Somente serviços do catálogo oficial são aceitos.`
      };
    }
  } else {
    return {
      valid: false,
      error: 'Identificação do procedimento (serviceId) ausente.'
    };
  }

  // Resolve every additional service against the server-side catalogue. Never trust browser-supplied prices.
  const additionalServices = additionalServiceIds.map(id => DYNAMIC_SERVICES_BY_ID[id]);
  if (additionalServices.some(service => !service)) {
    return { valid: false, error: 'Um ou mais serviços adicionais não existem no catálogo oficial.' };
  }
  if (additionalServiceIds.includes(String(serviceId || ''))) {
    return { valid: false, error: 'O procedimento principal não pode ser repetido como serviço adicional.' };
  }
  const referencePrice = canonicalService.price + additionalServices.reduce((sum, service) => sum + service!.price, 0);
  const expectedTitle = [canonicalService.title, ...additionalServices.map(service => service!.title)].join(' + ');
  if (additionalServices.length > 0 && typeof serviceTitle === 'string' && serviceTitle.trim().toLowerCase() !== expectedTitle.toLowerCase()) {
    return { valid: false, error: 'Os nomes dos serviços não correspondem ao catálogo oficial.' };
  }

  // Reject spoofed or unparseable combined price if sent by the browser.
  if (servicePrice !== undefined && servicePrice !== null && String(servicePrice).trim() !== '') {
    const parsedPrice = parseBRLString(String(servicePrice));
    if (parsedPrice === null || Math.abs(parsedPrice - referencePrice) > 0.01) {
      return {
        valid: false,
        error: `Preço informado (${servicePrice}) diverge da soma oficial dos serviços selecionados (R$ ${formatCurrencyServerBRL(referencePrice)}).`
      };
    }
  }

  const expected40 = Math.round(referencePrice * 0.4 * 100) / 100;
  const expected100 = Math.round(referencePrice * 100) / 100;
  const matches40 = Math.abs(depositAmount - expected40) < 0.01;
  const matches100 = Math.abs(depositAmount - expected100) < 0.01;

  if (paymentMode === 'sinal_40' && !matches40) {
    return {
      valid: false,
      error: `Valor do sinal (R$ ${formatCurrencyServerBRL(depositAmount)}) diverge de 40% do total oficial (esperado: R$ ${formatCurrencyServerBRL(expected40)}).`
    };
  }
  if (paymentMode === 'pre_pagamento_100' && !matches100) {
    return {
      valid: false,
      error: `Valor do pré-pagamento 100% diverge do total oficial sem descontos (esperado: R$ ${formatCurrencyServerBRL(expected100)}).`
    };
  }
  if (!matches40 && !matches100) {
    return {
      valid: false,
      error: `Valor enviado não corresponde a 40% (R$ ${formatCurrencyServerBRL(expected40)}) nem a 100% (R$ ${formatCurrencyServerBRL(expected100)}) do total.`
    };
  }

  const resolvedMode: 'sinal_40' | 'pre_pagamento_100' =
    paymentMode || (matches100 ? 'pre_pagamento_100' : 'sinal_40');
  const resolvedDeposit = resolvedMode === 'pre_pagamento_100' ? expected100 : expected40;

  return {
    valid: true,
    verifiedServiceId: canonicalService.id,
    verifiedServiceTitle: expectedTitle,
    verifiedDepositAmount: resolvedDeposit,
    verifiedServicePrice: `R$ ${formatCurrencyServerBRL(referencePrice)}`,
    verifiedPaymentMode: resolvedMode
  };
}

export const APPOINTMENT_ID_REGEX = /^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/;

export function isValidAppointmentId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  return trimmed.length >= 5 && trimmed.length <= 70 && APPOINTMENT_ID_REGEX.test(trimmed);
}

export function parseAppsScriptResponse(jsonRes: any, appEnv: string = 'production'): {
  isSuccess: boolean;
  persisted: boolean;
  test?: boolean;
  delivered: boolean;
  duplicate: boolean;
  message: string;
  error?: string;
  emailSent?: boolean;
  emailSuppressed?: boolean;
  emailError?: string;
} {
  const isSuccess = Boolean(
    jsonRes &&
    (jsonRes.status === 'success' || jsonRes.persisted === true || jsonRes.ok === true || jsonRes.success === true || jsonRes.test === true) &&
    jsonRes.status !== 'error'
  );

  if (!isSuccess) {
    const errReason = jsonRes?.message || jsonRes?.error || 'Resposta inválida ou não autorizada do Google Apps Script.';
    return {
      isSuccess: false,
      persisted: false,
      delivered: false,
      duplicate: false,
      message: errReason,
      error: `Google Apps Script recusou: ${errReason}`
    };
  }

  const isTest = Boolean(jsonRes.test === true);
  const isDuplicate = Boolean(jsonRes.duplicate);
  const isPersisted = Boolean(!isTest && (jsonRes.persisted === true || isDuplicate));

  return {
    isSuccess: true,
    persisted: isPersisted,
    test: isTest,
    delivered: jsonRes.emailSent !== undefined ? Boolean(jsonRes.emailSent) : (!isTest && !isDuplicate),
    duplicate: isDuplicate,
    emailSent: jsonRes.emailSent !== undefined ? Boolean(jsonRes.emailSent) : false,
    emailSuppressed: Boolean(jsonRes.emailSuppressed || isTest || isDuplicate),
    emailError: jsonRes.emailError || undefined,
    message: jsonRes.message || (isPersisted ? `Reserva persistida com sucesso no Google Sheets (${appEnv}).` : 'Operação de teste concluída com sucesso.')
  };
}

let dynamicServicesCache: any[] = []; // No seeded/mock catalogue; populated only from the official Google Sheets tab.

function updateDynamicCatalogsFromServices(services: any[]) {
  if (!Array.isArray(services)) return;
  // Replace the snapshot rather than retaining deleted or outdated prices from a prior request.
  for (const key of Object.keys(DYNAMIC_SERVICES_BY_ID)) delete DYNAMIC_SERVICES_BY_ID[key];
  for (const key of Object.keys(DYNAMIC_SERVICES_BY_TITLE)) delete DYNAMIC_SERVICES_BY_TITLE[key];
  for (const s of services) {
    if (s && s.id && s.price !== undefined && Number.isFinite(Number(s.price)) && Number(s.price) > 0) {
      registerDynamicService({
        id: String(s.id).trim(),
        title: String(s.title || s.id).trim(),
        price: Number(s.price),
        priceFormatted: s.priceFormatted || `R$ ${Number(s.price).toFixed(2).replace('.', ',')}`
      });
    }
  }
}

async function refreshOfficialServiceCatalog(): Promise<boolean> {
  const cfg = resolveAppsScriptConfig();
  if (!cfg.configured || !cfg.webhookUrl || !cfg.token) return false;
  try {
    const response = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getServices', token: cfg.token }),
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });
    const data: any = await response.json().catch(() => null);
    if (!response.ok || data?.status !== 'success' || !Array.isArray(data.services) || data.services.length === 0) return false;
    updateDynamicCatalogsFromServices(data.services);
    return true;
  } catch {
    return false;
  }
}

app.get('/api/services', async (_req: Request, res: Response) => {
  const cfg = resolveAppsScriptConfig();
  if (!cfg.configured || !cfg.webhookUrl || !cfg.token) {
    return res.status(503).json({ success: false, error: 'Catálogo oficial indisponível: integração com Google Sheets não configurada.', services: [] });
  }

  try {
    const scriptRes = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getServices', token: cfg.token }),
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    const data: any = await scriptRes.json().catch(() => null);
    if (!scriptRes.ok || data?.status !== 'success' || !Array.isArray(data.services)) {
      return res.status(502).json({ success: false, error: data?.message || 'Não foi possível ler o catálogo oficial do Google Sheets.', services: [] });
    }

    // An empty official catalogue is a valid empty result, not permission to fall back to mock data.
    dynamicServicesCache = data.services;
    updateDynamicCatalogsFromServices(data.services);
    return res.json({ success: true, services: dynamicServicesCache });
  } catch {
    return res.status(502).json({ success: false, error: 'Falha de comunicação ao consultar o catálogo oficial do Google Sheets.', services: [] });
  }
});

app.post('/api/services', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado.' });
  }
  const s = req.body;
  if (!s || !s.title || !s.price) {
    return res.status(400).json({ success: false, error: 'Dados do serviço inválidos (título e preço obrigatórios).' });
  }
  const newService = {
    id: s.id || `serv-${Date.now()}`,
    title: String(s.title).trim(),
    category: String(s.category || 'alongamento').trim(),
    price: Number(s.price),
    priceFormatted: s.priceFormatted || `R$ ${Number(s.price).toFixed(2).replace('.', ',')}`,
    duration: String(s.duration || '1h 30min').trim(),
    badge: String(s.badge || '').trim(),
    description: String(s.description || '').trim(),
    note: String(s.note || '').trim(),
    imageUrl: String(s.imageUrl || '').trim(),
    specs: Array.isArray(s.specs) ? s.specs : [],
    active: s.active !== false
  };

  const cfg = resolveAppsScriptConfig();
  if (cfg.configured && cfg.webhookUrl) {
    try {
      const scriptRes = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveService', token: cfg.token, ...newService }),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      const data = JSON.parse(await scriptRes.text());
      if (!scriptRes.ok || data.status !== 'success') {
        return res.status(502).json({ success: false, error: data?.message || 'Falha ao salvar serviço no Google Sheets.' });
      }
    } catch (err: any) {
      return res.status(502).json({ success: false, error: `Falha de rede ao persistir serviço: ${err.message}` });
    }
  }

  const idx = dynamicServicesCache.findIndex(item => item.id === newService.id);
  if (idx >= 0) dynamicServicesCache[idx] = newService;
  else dynamicServicesCache.unshift(newService);
  updateDynamicCatalogsFromServices([newService]);

  return res.json({ success: true, saved: true, service: newService });
});

app.put('/api/services/:id', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado.' });
  }
  const id = String(req.params.id || '').trim();
  const s = req.body;
  if (!id || !s) {
    return res.status(400).json({ success: false, error: 'ID do serviço e dados para atualização são obrigatórios.' });
  }

  const updatedService = {
    ...s,
    id,
    price: Number(s.price || 0),
    priceFormatted: s.priceFormatted || `R$ ${Number(s.price || 0).toFixed(2).replace('.', ',')}`,
    active: s.active !== false
  };

  const cfg = resolveAppsScriptConfig();
  if (cfg.configured && cfg.webhookUrl) {
    try {
      const scriptRes = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveService', token: cfg.token, ...updatedService }),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      const data = JSON.parse(await scriptRes.text());
      if (!scriptRes.ok || data.status !== 'success') {
        return res.status(502).json({ success: false, error: data?.message || 'Falha ao atualizar serviço no Google Sheets.' });
      }
    } catch (err: any) {
      return res.status(502).json({ success: false, error: `Falha de rede ao atualizar serviço: ${err.message}` });
    }
  }

  const idx = dynamicServicesCache.findIndex(item => item.id === id);
  if (idx >= 0) dynamicServicesCache[idx] = updatedService;
  else dynamicServicesCache.push(updatedService);
  updateDynamicCatalogsFromServices([updatedService]);

  return res.json({ success: true, saved: true, service: updatedService });
});

app.delete('/api/services/:id', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado.' });
  }
  const id = String(req.params.id || '').trim();
  if (!id) {
    return res.status(400).json({ success: false, error: 'ID do serviço obrigatório para exclusão.' });
  }

  const cfg = resolveAppsScriptConfig();
  if (cfg.configured && cfg.webhookUrl) {
    try {
      const scriptRes = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'deleteService', token: cfg.token, id }),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      const data = JSON.parse(await scriptRes.text());
      if (!scriptRes.ok || data.status !== 'success') {
        return res.status(502).json({ success: false, error: data?.message || 'Falha ao excluir serviço no Google Sheets.' });
      }
    } catch (err: any) {
      return res.status(502).json({ success: false, error: `Falha de rede ao excluir serviço: ${err.message}` });
    }
  }

  dynamicServicesCache = dynamicServicesCache.filter(item => item.id !== id);
  return res.json({ success: true, deleted: true, serviceId: id });
});

app.post('/api/upload-photo', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado.' });
  }

  const { imageBase64, fileName, mimeType } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ success: false, error: 'Dados da imagem (base64) ausentes ou inválidos.' });
  }

  const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!mimeType || !validMimes.includes(mimeType)) {
    return res.status(400).json({ success: false, error: 'Formato de imagem não suportado. Utilize JPEG, PNG ou WebP.' });
  }

  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  if (cleanBase64.length > 7.5 * 1024 * 1024) {
    return res.status(400).json({ success: false, error: 'A imagem excede o tamanho máximo permitido de 5MB.' });
  }

  const cfg = resolveAppsScriptConfig();
  if (!cfg.configured || !cfg.webhookUrl || !cfg.token) {
    return res.status(503).json({
      success: false,
      error: 'Upload para o Google Drive não está configurado no backend. Nenhuma foto foi salva.'
    });
  }

  try {
    const scriptRes = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'uploadPhoto',
        token: cfg.token,
        imageBase64: cleanBase64,
        fileName: fileName || `foto-${Date.now()}.jpg`,
        mimeType
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });

    const rawText = await scriptRes.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {}

    if (!scriptRes.ok || data?.status !== 'success' || typeof data?.url !== 'string' || !data.url.startsWith('https://')) {
      return res.status(502).json({
        success: false,
        error: data?.message || `Google Apps Script não confirmou o upload para o Google Drive (HTTP ${scriptRes.status}). Nenhuma URL temporária foi salva.`
      });
    }

    return res.json({ success: true, url: data.url, storage: 'google_drive' });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      error: `Falha ao enviar foto para o Google Drive: ${err.message || 'servidor indisponível'}. Nenhuma foto foi salva como URL temporária.`
    });
  }
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

    const { clientName, clientPhone, date, time, appointmentId } = payload;

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

    if (!isValidAppointmentId(appointmentId)) {
      return res.status(400).json({
        success: false,
        error: 'ID da reserva ausente, inválido ou fora do formato esperado (prefixos permitidos: apt-* ou test-*).'
      });
    }

    const isAdmin = isAuthorizedAdminRequest(req);

    // Public requests must use a real future date in São Sebastião and the studio's Tuesday–Saturday schedule.
    if (!isAdmin) {
      const todayInSaoSebastiao = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
      const dateKey = String(date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < todayInSaoSebastiao) {
        return res.status(400).json({ success: false, error: 'Selecione uma data válida a partir de hoje.' });
      }
      const requestedDate = new Date(`${dateKey}T12:00:00-03:00`);
      const weekday = requestedDate.getUTCDay();
      if (weekday === 0 || weekday === 1) {
        return res.status(400).json({ success: false, error: 'O salão atende de terça-feira a sábado. Selecione outro dia.' });
      }
      if (payload.appointmentLocation === 'home' && (typeof payload.homeAddress !== 'string' || payload.homeAddress.trim().length < 8)) {
        return res.status(400).json({ success: false, error: 'O endereço completo é obrigatório para atendimento em domicílio.' });
      }
    }

    // Identificadores de teste (test-*, e2e-*) e modo de teste são permitidos EXCLUSIVAMENTE para administradores autenticados
    if (!isAdmin && typeof appointmentId === 'string' && (appointmentId.startsWith('test-') || appointmentId.startsWith('e2e-'))) {
      return res.status(400).json({
        success: false,
        error: 'Identificadores com prefixo test-* ou e2e-* são reservados para testes administrativos autenticados.'
      });
    }

    // Refresh authoritative prices immediately before validating a booking so this Cloud Run
    // instance cannot reject the same service total using a stale/incomplete catalogue snapshot.
    await refreshOfficialServiceCatalog();
    const paymentCheck = validateBookingPaymentCoherence(payload);
    if (!paymentCheck.valid) {
      return res.status(400).json({
        success: false,
        error: paymentCheck.error
      });
    }

    // 2.1 Verificação de data bloqueada
    const isDateBlocked = serverAppointments.some(
      a => !deletedAppointmentIds.has(a.id) &&
        a.status === 'bloqueado' &&
        areDatesEqual(a.date, String(date))
    );

    if (isDateBlocked) {
      return res.status(400).json({
        success: false,
        error: `A data "${date}" está bloqueada para novos agendamentos.`
      });
    }

    // Prevent two active appointments from taking the same date/time in the server's current appointment snapshot.
    const conflictingAppointment = serverAppointments.find(a =>
      a.id !== appointmentId &&
      !deletedAppointmentIds.has(a.id) &&
      areDatesEqual(a.date, String(date)) &&
      String(a.time).trim() === String(time).trim() &&
      !['cancelado', 'bloqueado', 'teste_sistema'].includes(String(a.status))
    );
    if (conflictingAppointment) {
      return res.status(409).json({
        success: false,
        error: 'Este horário acabou de ser reservado. Atualize a agenda e escolha outro horário.'
      });
    }

    // 3. Explicit Staging / Server Configuration Check (Never fall back to production URL or credentials)
    const cfg = resolveAppsScriptConfig();
    if (!cfg.configured) {
      console.warn(`[Notification Blocked] Configuração explícita ausente ou bloqueada (${cfg.appEnv}): ${cfg.safetyError}`);
      return res.status(200).json({
        success: false,
        delivered: false,
        environment: cfg.appEnv,
        error:
          cfg.safetyError ||
          'APPS_SCRIPT_WEBHOOK_URL e APPS_SCRIPT_TOKEN explícitos são obrigatórios (sem fallback para produção).'
      });
    }

    // 4. Server-Side Anti-Duplication Protection
    // Evita chamadas repetidas ao Google Apps Script e gravações duplicadas no Google Sheets
    if (processedAppointmentIds.has(appointmentId)) {
      console.log(`[Notification Info] Notificação duplicada evitada para reserva ${appointmentId}`);
      return res.json({
        success: true,
        delivered: false,
        persisted: true,
        duplicate: true,
        environment: cfg.appEnv,
        message: `Notificação para a reserva ${appointmentId} já havia sido processada anteriormente. Gravação duplicada no Sheets prevenida.`
      });
    }

    processedAppointmentIds.add(appointmentId);
    if (processedAppointmentIds.size > 1000) {
      const first = processedAppointmentIds.values().next().value;
      if (first) processedAppointmentIds.delete(first);
    }

    console.log(`[Notification][${cfg.appEnv}] Novo pré-agendamento recebido no servidor: ${clientName.trim()} (${clientPhone.trim()}) • ${paymentCheck.verifiedServiceTitle || 'Nail Design'} • ${date} às ${time}`);

    // Segurança do modo de teste: Usuários públicos NUNCA podem classificar uma reserva como teste
    // O modo teste só é ativado se for explicitamente solicitado por um administrador autenticado
    const isTestBooking = Boolean(
      isAdmin && (
        payload.isTest === true ||
        payload.isTest === 'true' ||
        payload.status === 'teste_sistema' ||
        payload.action === 'testConnection' ||
        (typeof appointmentId === 'string' && appointmentId.startsWith('test-'))
      )
    );

    const isE2EBooking = Boolean(
      isAdmin && (
        payload.action === 'e2eTestBooking' ||
        payload.isE2ETest === true ||
        payload.isE2ETest === 'true' ||
        (typeof appointmentId === 'string' && appointmentId.startsWith('e2e-'))
      )
    );

    const bookingStatus = isTestBooking
      ? 'teste_sistema'
      : (payload.status === 'teste_sistema' ? 'pendente_pix' : (payload.status || 'pendente_pix'));
    const targetRecipient = resolveNotificationRecipient(cfg.isStaging, isTestBooking);
    const { to: _ignoredClientTo, isTest: _ignoredClientIsTest, ...safePayloadWithoutTo } = payload;

    const authorizedBody = {
      ...safePayloadWithoutTo,
      action: isTestBooking ? 'testConnection' : (isE2EBooking ? 'e2eTestBooking' : undefined),
      isTest: isTestBooking,
      isE2ETest: isE2EBooking,
      from: 'kontakt@alansmsolutions.com',
      to: targetRecipient,
      serviceId: paymentCheck.verifiedServiceId,
      serviceTitle: paymentCheck.verifiedServiceTitle,
      servicePrice: paymentCheck.verifiedServicePrice,
      depositAmount: paymentCheck.verifiedDepositAmount,
      paymentMode: paymentCheck.verifiedPaymentMode,
      status: bookingStatus,
      environment: cfg.appEnv,
      // Injeta os tokens e credenciais apenas no lado do servidor
      ...(cfg.token ? { token: cfg.token, authToken: cfg.token, key: cfg.token } : {})
    };

    try {
      const scriptResponse = await fetch(cfg.webhookUrl, {
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

        const parsed = parseAppsScriptResponse(jsonRes, cfg.appEnv);

        if (!parsed.isSuccess) {
          processedAppointmentIds.delete(appointmentId);
          console.warn(`[Notification Warning] Google Apps Script recusou a notificação: ${parsed.message}`);
          return res.status(200).json({
            success: false,
            delivered: false,
            persisted: false,
            environment: cfg.appEnv,
            error: parsed.error
          });
        }

        if (isTestBooking) {
          console.log(`[Notification Info][${cfg.appEnv}] Teste administrativo ${appointmentId} concluído com sucesso (sem persistência e sem e-mails).`);
          return res.json({
            success: true,
            test: true,
            delivered: false,
            persisted: false,
            duplicate: false,
            emailSent: false,
            emailSuppressed: true,
            environment: cfg.appEnv,
            message: parsed.message || 'Teste administrativo concluído com sucesso. Nenhuma linha foi gravada na aba oficial Agendamentos e nenhum e-mail foi disparado.',
            appointmentId
          });
        }

        console.log(`[Notification Success][${cfg.appEnv}] Google Apps Script confirmou persistência da reserva ${appointmentId}!`);
        recordServerAppointment({
          id: appointmentId,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          clientEmail: payload.clientEmail?.trim() || undefined,
          serviceId: paymentCheck.verifiedServiceId!,
          serviceTitle: paymentCheck.verifiedServiceTitle!,
          servicePrice: paymentCheck.verifiedServicePrice!,
          date: date.trim(),
          time: time.trim(),
          status: bookingStatus,
          depositAmount: paymentCheck.verifiedDepositAmount!,
          depositStatus: payload.depositStatus || 'pendente',
          paymentMode: paymentCheck.verifiedPaymentMode!,
          timestamp: payload.timestamp || new Date().toISOString(),
          notes: payload.notes || undefined,
          nailCondition: payload.nailCondition || undefined
        });
        return res.json({
          success: true,
          delivered: parsed.delivered,
          persisted: parsed.persisted,
          duplicate: parsed.duplicate,
          emailSent: parsed.emailSent,
          emailSuppressed: parsed.emailSuppressed,
          emailError: parsed.emailError,
          environment: cfg.appEnv,
          message: parsed.message
        });
      } else {
        processedAppointmentIds.delete(appointmentId);
        return res.status(200).json({
          success: false,
          delivered: false,
          environment: cfg.appEnv,
          error: `HTTP ${scriptResponse.status} retornado pelo Google Apps Script.`
        });
      }
    } catch (scriptErr: any) {
      processedAppointmentIds.delete(appointmentId);
      console.error(`[Notification Error] Falha ao conectar ao Google Apps Script:`, scriptErr);
      const isTimeout = scriptErr.name === 'TimeoutError' || scriptErr.name === 'AbortError' || scriptErr.message?.includes('timeout');
      return res.status(200).json({
        success: false,
        delivered: false,
        environment: cfg.appEnv,
        error: isTimeout
          ? 'Tempo limite esgotado (15s) ao aguardar resposta do Google Apps Script.'
          : `Falha de rede ao conectar com o Google Apps Script: ${scriptErr.message}`
      });
    }
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Erro interno ao processar notificação de agendamento.',
      details: err.message
    });
  }
});

// Endpoint administrativo para teste seguro de conexão com Google Apps Script
// Não grava na planilha oficial Agendamentos e não dispara e-mails
app.post('/api/notifications/test-connection', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }

  try {
    const cfg = resolveAppsScriptConfig();
    if (!cfg.configured || !cfg.webhookUrl) {
      return res.status(400).json({
        success: false,
        error: cfg.safetyError || 'APPS_SCRIPT_WEBHOOK_URL ou APPS_SCRIPT_TOKEN não configurados no servidor.'
      });
    }

    const scriptResponse = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action: 'testConnection',
        isTest: true,
        appointmentId: `test-admin-${Date.now()}`,
        token: cfg.token,
        authToken: cfg.token,
        key: cfg.token
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (scriptResponse.ok) {
      const responseText = await scriptResponse.text();
      let jsonRes: any = null;
      try {
        jsonRes = JSON.parse(responseText);
      } catch {}

      if (jsonRes && (jsonRes.status === 'success' || jsonRes.test === true)) {
        return res.json({
          success: true,
          test: true,
          persisted: false,
          emailSent: false,
          emailSuppressed: true,
          message: jsonRes.message || 'Conexão segura com Google Apps Script validada com sucesso (nenhum dado gravado na aba Agendamentos e nenhum e-mail enviado).'
        });
      }

      return res.status(400).json({
        success: false,
        error: jsonRes?.message || 'Google Apps Script recusou a validação de teste.'
      });
    }

    return res.status(scriptResponse.status).json({
      success: false,
      error: `Google Apps Script retornou HTTP ${scriptResponse.status}.`
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Falha na comunicação de teste com o Google Apps Script.',
      details: err.message
    });
  }
});

// Endpoint administrativo para teste E2E controlado de persistência na planilha
// Grava linha sintética na aba oficial Agendamentos, mas SUPRIME estritamente e-mails e WhatsApp
app.post('/api/notifications/e2e-test-booking', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }

  try {
    const cfg = resolveAppsScriptConfig();
    if (!cfg.configured || !cfg.webhookUrl) {
      return res.status(400).json({
        success: false,
        error: cfg.safetyError || 'APPS_SCRIPT_WEBHOOK_URL ou APPS_SCRIPT_TOKEN não configurados no servidor.'
      });
    }

    const testId = `e2e-test-${Date.now()}`;
    const syntheticPayload = {
      action: 'e2eTestBooking',
      isE2ETest: true,
      appointmentId: testId,
      clientName: '[TESTE E2E — NÃO É CLIENTE REAL]',
      clientPhone: '(12) 99999-0000',
      clientEmail: '',
      serviceId: 'alongamento-fibra-slim',
      serviceTitle: 'Alongamento em Fibra Slim',
      servicePrice: 'R$ 220,00',
      depositAmount: 88,
      paymentMode: 'sinal_40',
      date: '2026-10-31',
      time: '10:00',
      status: 'pendente_pix',
      notes: '[TESTE E2E — NÃO É CLIENTE REAL] Validação autorizada de persistência em planilha de produção',
      token: cfg.token,
      authToken: cfg.token,
      key: cfg.token
    };

    const scriptResponse = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(syntheticPayload),
      signal: AbortSignal.timeout(15000)
    });

    if (scriptResponse.ok) {
      const responseText = await scriptResponse.text();
      let jsonRes: any = null;
      try {
        jsonRes = JSON.parse(responseText);
      } catch {}

      if (jsonRes && (jsonRes.status === 'success' || jsonRes.persisted === true)) {
        recordServerAppointment({
          id: testId,
          clientName: syntheticPayload.clientName,
          clientPhone: syntheticPayload.clientPhone,
          serviceId: syntheticPayload.serviceId,
          serviceTitle: syntheticPayload.serviceTitle,
          servicePrice: syntheticPayload.servicePrice,
          date: syntheticPayload.date,
          time: syntheticPayload.time,
          status: 'pendente_pix',
          depositAmount: 88,
          depositStatus: 'pendente',
          paymentMode: 'sinal_40',
          timestamp: new Date().toISOString(),
          notes: syntheticPayload.notes
        });

        return res.json({
          success: true,
          test: true,
          e2e: true,
          persisted: true,
          emailSent: false,
          emailSuppressed: true,
          appointmentId: testId,
          message: jsonRes.message || 'Reserva de teste E2E gravada com sucesso no Sheets (e-mails e notificações suprimidos).'
        });
      }

      return res.status(400).json({
        success: false,
        error: jsonRes?.message || 'Google Apps Script recusou a gravação do teste E2E.'
      });
    }

    return res.status(scriptResponse.status).json({
      success: false,
      error: `Google Apps Script retornou HTTP ${scriptResponse.status}.`
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Falha na comunicação de teste E2E com o Google Apps Script.',
      details: err.message
    });
  }
});

app.post('/api/whatsapp/send-confirmation', async (req: Request, res: Response) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
    });
  }
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

    const isTestAppointment = Boolean(
      (typeof appointmentId === 'string' && appointmentId.startsWith('test-')) ||
      depositStatus === 'teste_sistema' ||
      (typeof clientName === 'string' && clientName.toLowerCase().includes('teste_sistema'))
    );

    // If Meta Cloud API credentials are provided, call Meta Graph API (never call for test appointments)
    if (token && phoneNumberId && !isTestAppointment) {
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

  const uploadsDir = path.resolve(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
  }
  app.use('/uploads', express.static(uploadsDir));

  const distUploadsDir = path.resolve(__dirname, 'dist', 'uploads');
  if (!fs.existsSync(distUploadsDir)) {
    try { fs.mkdirSync(distUploadsDir, { recursive: true }); } catch {}
  }
  app.use('/uploads', express.static(distUploadsDir));

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
            whatsappStatus: '/api/whatsapp/status',
            appointments: '/api/appointments'
          }
        });
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Espaço Angélica Server] Running on http://0.0.0.0:${PORT}`);
  });
}

export {
  app,
  allowedOrigins,
  isOriginAllowed,
  buildConfirmationMessage,
  isAuthorizedAdminRequest,
  resolveNotificationRecipient
};

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  startServer();
}
