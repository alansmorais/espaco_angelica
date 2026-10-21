import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

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

app.use(express.json());

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

export function recordServerAppointment(apt: ServerStoredAppointment): void {
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

function isAuthorizedAdminRequest(req: Request): boolean {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken = (req.headers['x-admin-token'] as string || '').trim();
  const provided = bearerToken || headerToken;

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
          if (Array.isArray(resData?.appointments)) {
            externalAppointments = resData.appointments;
          }
        }
      } catch {
        // Apps Script fallback to server cache
      }
    }

    const mergedMap = new Map<string, any>();
    for (const apt of serverAppointments) {
      mergedMap.set(apt.id, apt);
    }
    for (const ext of externalAppointments) {
      if (ext.id) {
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
    price: 50,
    priceFormatted: 'A partir de R$ 50,00'
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
    canonicalService = OFFICIAL_SERVICES_BY_ID[normalizedId];
    if (!canonicalService) {
      return {
        valid: false,
        error: `ID de procedimento desconhecido ("${normalizedId}").`
      };
    }

    if (typeof serviceTitle === 'string' && serviceTitle.trim() !== '') {
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
    canonicalService = OFFICIAL_SERVICES_BY_TITLE[normalizedTitle];
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

  // Reject spoofed or unparseable servicePrice if sent by the browser
  if (servicePrice !== undefined && servicePrice !== null && String(servicePrice).trim() !== '') {
    const parsedPrice = parseBRLString(String(servicePrice));
    if (parsedPrice === null || Math.abs(parsedPrice - canonicalService.price) > 0.01) {
      return {
        valid: false,
        error: `Preço informado (${servicePrice}) diverge da tabela oficial para "${canonicalService.title}" (R$ ${formatCurrencyServerBRL(canonicalService.price)}).`
      };
    }
  }

  const referencePrice = canonicalService.price;
  const expected40 = Math.round(referencePrice * 0.4 * 100) / 100;
  const expected100 = Math.round(referencePrice * 100) / 100;
  const matches40 = Math.abs(depositAmount - expected40) < 0.01;
  const matches100 = Math.abs(depositAmount - expected100) < 0.01;

  if (paymentMode === 'sinal_40' && !matches40) {
    return {
      valid: false,
      error: `Valor do sinal (R$ ${formatCurrencyServerBRL(depositAmount)}) diverge de 40% do procedimento (esperado: R$ ${formatCurrencyServerBRL(expected40)}).`
    };
  }

  if (paymentMode === 'pre_pagamento_100' && !matches100) {
    return {
      valid: false,
      error: `Valor do pré-pagamento 100% (R$ ${formatCurrencyServerBRL(depositAmount)}) diverge do total oficial do procedimento sem descontos (esperado: R$ ${formatCurrencyServerBRL(expected100)}).`
    };
  }

  if (!matches40 && !matches100) {
    return {
      valid: false,
      error: `Valor enviado (R$ ${formatCurrencyServerBRL(depositAmount)}) não corresponde a 40% (R$ ${formatCurrencyServerBRL(expected40)}) nem a 100% (R$ ${formatCurrencyServerBRL(expected100)}) do procedimento.`
    };
  }

  const resolvedMode: 'sinal_40' | 'pre_pagamento_100' =
    paymentMode || (matches100 ? 'pre_pagamento_100' : 'sinal_40');
  const resolvedDeposit = resolvedMode === 'pre_pagamento_100' ? expected100 : expected40;

  return {
    valid: true,
    verifiedServiceId: canonicalService.id,
    verifiedServiceTitle: canonicalService.title,
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

    // Identificadores de teste (test-*, e2e-*) e modo de teste são permitidos EXCLUSIVAMENTE para administradores autenticados
    if (!isAdmin && typeof appointmentId === 'string' && (appointmentId.startsWith('test-') || appointmentId.startsWith('e2e-'))) {
      return res.status(400).json({
        success: false,
        error: 'Identificadores com prefixo test-* ou e2e-* são reservados para testes administrativos autenticados.'
      });
    }

    const paymentCheck = validateBookingPaymentCoherence(payload);
    if (!paymentCheck.valid) {
      return res.status(400).json({
        success: false,
        error: paymentCheck.error
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
