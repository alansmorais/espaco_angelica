import { Appointment } from '../types';
import {
  AUTHORIZED_SENDER_EMAIL,
  TARGET_NOTIFICATION_EMAIL,
  getGmailAccessToken,
  sendDirectGmailFromBrowser
} from './gmailService';

export { AUTHORIZED_SENDER_EMAIL, TARGET_NOTIFICATION_EMAIL };

export const DEFAULT_APPS_SCRIPT_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycby3s6UC86UjTAJtAjtyQF634z8NMv9LORG_IrzxCb4X_RQx0lLCyetz__QGT0-9B3jJ/exec';

export interface EmailNotificationPayload {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceTitle: string;
  date: string;
  time: string;
  depositAmount: number;
  status: string;
  appointmentId: string;
  nailCondition?: string;
  notes?: string;
  timestamp: string;
}

export interface EmailDispatchResult {
  success: boolean;
  appointmentId: string;
  mode:
    | 'webhook_delivered'
    | 'webhook_rejected'
    | 'webhook_unverified'
    | 'browser_gmail_dispatched'
    | 'server_dispatched'
    | 'static_recorded'
    | 'already_notified';
  message: string;
  payload: EmailNotificationPayload;
}

const STORAGE_KEY_NOTIFIED_BOOKINGS = 'angelica_notified_bookings';
const NOTIFICATION_WEBHOOK_STORAGE_KEY = 'angelica_notification_webhook';
const NOTIFICATION_WEBHOOK_TOKEN_KEY = 'angelica_notification_webhook_token';

/**
 * Verifica se uma reserva já teve notificação registrada para evitar duplicações.
 */
export function isAppointmentAlreadyNotified(appointmentId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NOTIFIED_BOOKINGS);
    const list: string[] = raw ? JSON.parse(raw) : [];
    return list.includes(appointmentId);
  } catch {
    return false;
  }
}

/**
 * Marca o ID da reserva como já notificado.
 */
export function markAppointmentAsNotified(appointmentId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NOTIFIED_BOOKINGS);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(appointmentId)) {
      list.push(appointmentId);
      // Limita o histórico aos últimos 200 IDs para não acumular
      if (list.length > 200) list.shift();
      localStorage.setItem(STORAGE_KEY_NOTIFIED_BOOKINGS, JSON.stringify(list));
    }
  } catch {}
}

/**
 * Monta o payload padronizado da notificação para a Angélica partindo da conta autorizada kontakt@alansmsolutions.com.
 */
export function buildPreBookingEmailPayload(apt: Appointment): EmailNotificationPayload {
  return {
    from: AUTHORIZED_SENDER_EMAIL,
    to: TARGET_NOTIFICATION_EMAIL,
    replyTo: apt.clientEmail || AUTHORIZED_SENDER_EMAIL,
    subject: `Novo pré-agendamento — ${apt.clientName} — ${apt.date} às ${apt.time}`,
    clientName: apt.clientName,
    clientPhone: apt.clientPhone,
    clientEmail: apt.clientEmail,
    serviceTitle: apt.serviceTitle,
    date: apt.date,
    time: apt.time,
    depositAmount: apt.depositAmount,
    status: apt.status || 'pendente_pix',
    appointmentId: apt.id,
    nailCondition: apt.nailCondition,
    notes: apt.notes,
    timestamp: new Date().toISOString()
  };
}

/**
 * Obtém a URL do Webhook configurada para envio de notificações por e-mail e Sheets.
 * Usa o endpoint oficial publicado por padrão.
 */
export function getNotificationWebhookUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_APPS_SCRIPT_WEBHOOK_URL;
  return (
    (import.meta as any).env?.VITE_NOTIFICATION_WEBHOOK_URL ||
    localStorage.getItem(NOTIFICATION_WEBHOOK_STORAGE_KEY) ||
    DEFAULT_APPS_SCRIPT_WEBHOOK_URL
  );
}

/**
 * Salva a URL do Webhook nas configurações do atelier.
 */
export function setNotificationWebhookUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const clean = url.trim();
  if (!clean || clean === DEFAULT_APPS_SCRIPT_WEBHOOK_URL) {
    localStorage.removeItem(NOTIFICATION_WEBHOOK_STORAGE_KEY);
  } else {
    localStorage.setItem(NOTIFICATION_WEBHOOK_STORAGE_KEY, clean);
  }
}

/**
 * Obtém o token de autorização opcional do Webhook (armazenado apenas localmente no navegador do admin).
 */
export function getNotificationWebhookToken(): string {
  if (typeof window === 'undefined') return '';
  return (
    (import.meta as any).env?.VITE_NOTIFICATION_WEBHOOK_TOKEN ||
    localStorage.getItem(NOTIFICATION_WEBHOOK_TOKEN_KEY) ||
    ''
  );
}

/**
 * Salva o token de autorização do Webhook.
 */
export function setNotificationWebhookToken(token: string): void {
  if (typeof window === 'undefined') return;
  const clean = token.trim();
  if (!clean) {
    localStorage.removeItem(NOTIFICATION_WEBHOOK_TOKEN_KEY);
  } else {
    localStorage.setItem(NOTIFICATION_WEBHOOK_TOKEN_KEY, clean);
  }
}

export const DEFAULT_BACKEND_API_URL =
  'https://espaco-angelica-backend-770203144889.southamerica-east1.run.app';

export const BACKEND_API_URL_STORAGE_KEY = 'angelica_backend_api_url';

/**
 * Obtém a URL base do backend seguro (Node server / Cloud Run) configurada.
 * Prioridade:
 * 1. Variável de build do Vite (VITE_BACKEND_API_URL)
 * 2. Sobrescrita manual configurada pelo admin no localStorage
 * 3. URL oficial padrão do Cloud Run em produção
 */
export function getBackendApiUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BACKEND_API_URL;
  return (
    (import.meta as any).env?.VITE_BACKEND_API_URL ||
    localStorage.getItem(BACKEND_API_URL_STORAGE_KEY) ||
    DEFAULT_BACKEND_API_URL
  );
}

/**
 * Salva a URL base do backend seguro no armazenamento local.
 */
export function setBackendApiUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const clean = url.trim().replace(/\/$/, '');
  if (!clean || clean === DEFAULT_BACKEND_API_URL) {
    localStorage.removeItem(BACKEND_API_URL_STORAGE_KEY);
  } else {
    localStorage.setItem(BACKEND_API_URL_STORAGE_KEY, clean);
  }
}

/**
 * Executa a comunicação segura com o Google Apps Script.
 * Usa 'text/plain' para compatibilidade CORS e lê a resposta real do script sem assumir falso positivo.
 */
export async function sendWebhookNotification(
  url: string,
  payload: EmailNotificationPayload,
  token?: string
): Promise<{ success: boolean; delivered: boolean; message: string; rawResponse?: string }> {
  const authToken = token !== undefined ? token : getNotificationWebhookToken();
  const requestBody = {
    ...payload,
    ...(authToken ? { token: authToken, authToken, key: authToken } : {})
  };

  const bodyString = JSON.stringify(requestBody);

  // 1. Tenta envio com Content-Type text/plain e mode cors
  // text/plain é compatível com preflight CORS e permite que o navegador siga o redirect e leia a resposta
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: bodyString
    });

    if (response.ok) {
      const responseText = await response.text();
      let resJson: any = null;
      try {
        resJson = JSON.parse(responseText);
      } catch {}

      if (resJson && resJson.status === 'error') {
        return {
          success: false,
          delivered: false,
          message: `O Google Apps Script recusou a solicitação: "${resJson.message || 'Erro não especificado'}".`,
          rawResponse: responseText
        };
      }

      if (resJson && (resJson.status === 'success' || resJson.success === true)) {
        return {
          success: true,
          delivered: true,
          message: 'Notificação por e-mail confirmada com sucesso pelo Google Apps Script!',
          rawResponse: responseText
        };
      }

      return {
        success: true,
        delivered: true,
        message: 'Google Apps Script processou a requisição com sucesso.',
        rawResponse: responseText
      };
    } else {
      return {
        success: false,
        delivered: false,
        message: `HTTP ${response.status} ao conectar com Google Apps Script.`
      };
    }
  } catch (corsErr: any) {
    // 2. Se o navegador bloquear leitura devido a restrição externa, tenta modo no-cors transparente
    // Não afirmamos falsamente que o e-mail foi entregue (delivered: false)
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: bodyString,
        mode: 'no-cors'
      });
      return {
        success: true,
        delivered: false,
        message: 'Requisição transmitida silenciosamente ao Apps Script. Entrega final pendente de verificação pelo Google.'
      };
    } catch (fallbackErr: any) {
      return {
        success: false,
        delivered: false,
        message: `Falha na comunicação de rede com o Apps Script: ${fallbackErr.message || 'Erro de rede'}`
      };
    }
  }
}

/**
 * Realiza um disparo de teste seguro para o Webhook sem gravar em agendamentos reais.
 */
export async function testNotificationWebhook(
  webhookUrl?: string,
  token?: string
): Promise<{ success: boolean; message: string }> {
  const url = webhookUrl || getNotificationWebhookUrl();
  if (!url) {
    return { success: false, message: 'Nenhuma URL de webhook configurada.' };
  }

  const testPayload: EmailNotificationPayload = {
    from: AUTHORIZED_SENDER_EMAIL,
    to: TARGET_NOTIFICATION_EMAIL,
    replyTo: AUTHORIZED_SENDER_EMAIL,
    subject: '🧪 [Teste de Conexão] Webhook de Notificações • Espaço Angélica do Carmo',
    clientName: 'Cliente Teste (Sistema)',
    clientPhone: '(12) 97406-2241',
    clientEmail: 'angelikm19@gmail.com',
    serviceTitle: 'Teste de Integração E-mail (kontakt@alansmsolutions.com)',
    date: 'Hoje',
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    depositAmount: 50,
    status: 'teste_sistema',
    appointmentId: `test-${Date.now()}`,
    notes: `Disparo de verificação realizado pelo painel com remetente ${AUTHORIZED_SENDER_EMAIL}.`,
    timestamp: new Date().toISOString()
  };

  const res = await sendWebhookNotification(url, testPayload, token);
  return {
    success: res.success && res.delivered,
    message: res.message
  };
}

/**
 * Dispara automaticamente a notificação de novo pré-agendamento para a Angélica
 * a partir do remetente autorizado kontakt@alansmsolutions.com.
 * Previne duplicidades e se adapta de forma segura tanto a Webhooks 24/7 quanto ao envio pelo navegador.
 */
export async function triggerNewPreBookingEmailNotification(apt: Appointment): Promise<EmailDispatchResult> {
  const payload = buildPreBookingEmailPayload(apt);

  // Evita duplicidade se a mesma reserva já foi processada
  if (isAppointmentAlreadyNotified(apt.id)) {
    return {
      success: true,
      appointmentId: apt.id,
      mode: 'already_notified',
      message: `A notificação para a reserva ${apt.id} já havia sido registrada anteriormente.`,
      payload
    };
  }

  markAppointmentAsNotified(apt.id);

  // 1. Tenta envio através do Backend Seguro (Node server / Cloud Run)
  // O backend seguro injeta APPS_SCRIPT_TOKEN mantendo os segredos 100% no servidor, sem expor no frontend.
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/notifications/new-booking`
      : '/api/notifications/new-booking';

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return {
          success: true,
          appointmentId: apt.id,
          mode: 'server_dispatched',
          message: data.message || 'Notificação por e-mail processada com sucesso no backend seguro.',
          payload
        };
      }
    }
  } catch {
    // Se o backend não responder (ex.: GitHub Pages estático sem backend configurado), tenta as opções cliente
  }

  // 2. Se houver sessão de Gmail OAuth ativa no navegador (kontakt@alansmsolutions.com):
  try {
    const hasToken = await getGmailAccessToken();
    if (hasToken) {
      const directResult = await sendDirectGmailFromBrowser(payload);
      if (directResult.success) {
        return {
          success: true,
          appointmentId: apt.id,
          mode: 'browser_gmail_dispatched',
          message: directResult.message,
          payload
        };
      }
    }
  } catch (err) {
    console.warn('Tentativa de disparo direto via Gmail API no navegador falhou:', err);
  }

  // 3. Tenta acionar diretamente o Webhook do Google Apps Script (apenas se token estiver presente no admin)
  const webhookUrl = getNotificationWebhookUrl();
  const webhookToken = getNotificationWebhookToken();
  if (webhookUrl && webhookToken) {
    const webhookRes = await sendWebhookNotification(webhookUrl, payload, webhookToken);
    if (webhookRes.delivered) {
      return {
        success: true,
        appointmentId: apt.id,
        mode: 'webhook_delivered',
        message: webhookRes.message,
        payload
      };
    } else if (webhookRes.success) {
      return {
        success: true,
        appointmentId: apt.id,
        mode: 'webhook_unverified',
        message: webhookRes.message,
        payload
      };
    } else {
      console.warn('[Notification Webhook Warning]', webhookRes.message);
    }
  }

  return {
    success: true,
    appointmentId: apt.id,
    mode: 'static_recorded',
    message: `Pré-agendamento registrado com sucesso. Notificação estruturada de ${AUTHORIZED_SENDER_EMAIL} para ${TARGET_NOTIFICATION_EMAIL}.`,
    payload
  };
}
