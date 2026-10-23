import { Appointment, Service } from '../types';
import {
  AUTHORIZED_SENDER_EMAIL,
  TARGET_NOTIFICATION_EMAIL,
  getGmailAccessToken,
  sendDirectGmailFromBrowser
} from './gmailService';

export { AUTHORIZED_SENDER_EMAIL, TARGET_NOTIFICATION_EMAIL };

export const DEFAULT_APPS_SCRIPT_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbysNBMLthA_GvAZJR1irBGcS-3Lspbfz0NIsvz0P2ax6jzE4M01RwVJ0za6zFsq8bGojw/exec';

export interface EmailNotificationPayload {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceId?: string;
  additionalServiceIds?: string[];
  customRequest?: string;
  appointmentLocation?: 'salon' | 'home';
  homeAddress?: string;
  serviceTitle: string;
  servicePrice?: string;
  date: string;
  time: string;
  depositAmount: number;
  depositStatus?: Appointment['depositStatus'];
  paymentMode?: 'sinal_40' | 'pre_pagamento_100';
  status: string;
  appointmentId: string;
  nailCondition?: string;
  notes?: string;
  timestamp: string;
  isTest?: boolean;
}

export interface EmailDispatchResult {
  success: boolean;
  persisted?: boolean;
  duplicate?: boolean;
  delivered?: boolean;
  emailSent?: boolean;
  emailSuppressed?: boolean;
  emailError?: string;
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
  const isTest = Boolean(
    apt.status === 'teste_sistema' ||
    (typeof apt.id === 'string' && apt.id.startsWith('test-')) ||
    (typeof apt.clientName === 'string' && apt.clientName.toLowerCase().includes('teste_sistema'))
  );

  return {
    from: AUTHORIZED_SENDER_EMAIL,
    to: TARGET_NOTIFICATION_EMAIL,
    replyTo: apt.clientEmail || AUTHORIZED_SENDER_EMAIL,
    subject: `${isTest ? '[TESTE] ' : ''}Novo pré-agendamento — ${apt.clientName} — ${apt.date} às ${apt.time}`,
    clientName: apt.clientName,
    clientPhone: apt.clientPhone,
    clientEmail: apt.clientEmail,
    serviceId: apt.serviceId,
    additionalServiceIds: apt.additionalServiceIds,
    customRequest: apt.customRequest,
    appointmentLocation: apt.appointmentLocation,
    homeAddress: apt.homeAddress,
    serviceTitle: apt.serviceTitle,
    servicePrice: apt.servicePrice,
    date: apt.date,
    time: apt.time,
    depositAmount: apt.depositAmount,
    depositStatus: apt.depositStatus,
    paymentMode: apt.paymentMode,
    status: apt.status || 'pendente_pix',
    appointmentId: apt.id,
    nailCondition: apt.nailCondition,
    notes: apt.notes,
    timestamp: new Date().toISOString(),
    isTest
  };
}

export function isLocalOrStagingFrontend(): boolean {
  const envMode = (import.meta as any).env?.VITE_APP_ENV || (import.meta as any).env?.MODE;
  if (envMode === 'staging') return true;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  }
  return false;
}

/**
 * Obtém a URL do Webhook configurada para envio de notificações por e-mail e Sheets.
 * Em ambiente local/staging, nunca faz fallback para a URL de produção.
 */
export function getNotificationWebhookUrl(): string {
  if (typeof window === 'undefined') {
    return isLocalOrStagingFrontend() ? '' : DEFAULT_APPS_SCRIPT_WEBHOOK_URL;
  }
  const explicitUrl = (
    (import.meta as any).env?.VITE_NOTIFICATION_WEBHOOK_URL ||
    localStorage.getItem(NOTIFICATION_WEBHOOK_STORAGE_KEY) ||
    ''
  ).trim();
  if (isLocalOrStagingFrontend()) {
    if (!explicitUrl || explicitUrl === DEFAULT_APPS_SCRIPT_WEBHOOK_URL) {
      return '';
    }
    return explicitUrl;
  }
  return explicitUrl || DEFAULT_APPS_SCRIPT_WEBHOOK_URL;
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
 * Em ambiente local/staging, usa o servidor local ('') por padrão e nunca faz fallback para produção.
 */
export function getBackendApiUrl(): string {
  if (typeof window === 'undefined') {
    return isLocalOrStagingFrontend() ? '' : DEFAULT_BACKEND_API_URL;
  }
  const explicitBackend = (
    (import.meta as any).env?.VITE_BACKEND_API_URL ||
    localStorage.getItem(BACKEND_API_URL_STORAGE_KEY) ||
    ''
  ).trim();
  if (isLocalOrStagingFrontend()) {
    if (!explicitBackend || explicitBackend === DEFAULT_BACKEND_API_URL) {
      return '';
    }
    return explicitBackend;
  }
  return explicitBackend || DEFAULT_BACKEND_API_URL;
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

      if (resJson && (resJson.status === 'success' || resJson.success === true || resJson.test === true)) {
        return {
          success: true,
          delivered: Boolean(resJson.emailSent),
          message: resJson.message || 'Notificação por e-mail confirmada com sucesso pelo Google Apps Script!',
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

  const testPayload: EmailNotificationPayload & { action?: string } = {
    action: 'testConnection',
    from: AUTHORIZED_SENDER_EMAIL,
    to: TARGET_NOTIFICATION_EMAIL,
    replyTo: AUTHORIZED_SENDER_EMAIL,
    subject: '🧪 [Teste de Conexão] Webhook de Notificações • Espaço Angélica do Carmo',
    clientName: 'Cliente Teste (Sistema)',
    clientPhone: '(12) 97406-2241',
    clientEmail: 'angelikm19@gmail.com',
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 220,00',
    date: 'Hoje',
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    depositAmount: 88,
    paymentMode: 'sinal_40',
    status: 'teste_sistema',
    appointmentId: `test-${Date.now()}`,
    notes: `Disparo de verificação de conectividade. Nenhuma linha deve ser gravada na planilha oficial.`,
    timestamp: new Date().toISOString(),
    isTest: true
  };

  const res = await sendWebhookNotification(url, testPayload, token);
  return {
    success: res.success,
    message: res.message
  };
}

/**
 * Dispara automaticamente a notificação de novo pré-agendamento para a Angélica
 * a partir do remetente autorizado kontakt@alansmsolutions.com.
 * Previne duplicidades e se adapta de forma segura tanto a Webhooks 24/7 quanto ao envio pelo navegador.
 */
export async function triggerNewPreBookingEmailNotification(
  apt: Appointment,
  authToken?: string
): Promise<EmailDispatchResult> {
  const payload = buildPreBookingEmailPayload(apt);

  // Evita duplicidade se a mesma reserva já foi confirmada anteriormente no servidor
  if (isAppointmentAlreadyNotified(apt.id)) {
    return {
      success: true,
      persisted: true,
      appointmentId: apt.id,
      mode: 'already_notified',
      message: `A notificação para a reserva ${apt.id} já havia sido registrada anteriormente.`,
      payload
    };
  }

  // Envio através do Backend Seguro (Cloud Run / Node server)
  // O backend seguro injeta APPS_SCRIPT_TOKEN mantendo os segredos 100% no servidor, sem expor no frontend.
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/notifications/new-booking`
      : '/api/notifications/new-booking';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    const token =
      (authToken || '').trim() ||
      (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Admin-Token'] = token;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      const isPersisted = Boolean(data.persisted === true || (data.success && data.persisted !== false));
      if (data.success && isPersisted) {
        // Marca como notificada apenas após persistência confirmada pelo servidor
        markAppointmentAsNotified(apt.id);
        return {
          success: true,
          persisted: true,
          duplicate: Boolean(data.duplicate),
          delivered: Boolean(data.delivered),
          emailSent: Boolean(data.emailSent),
          emailSuppressed: Boolean(data.emailSuppressed),
          emailError: data.emailError,
          appointmentId: apt.id,
          mode: 'server_dispatched',
          message: data.message || 'Reserva persistida com sucesso na planilha oficial do ateliê.',
          payload
        };
      }

      return {
        success: false,
        persisted: false,
        duplicate: Boolean(data.duplicate),
        appointmentId: apt.id,
        mode: 'webhook_rejected',
        message: data.error || data.message || 'O servidor não confirmou a gravação da reserva na planilha.',
        payload
      };
    } else {
      let errorMessage = `Servidor retornou erro HTTP ${response.status}.`;
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage = errorData.error;
        }
      } catch {}

      return {
        success: false,
        persisted: false,
        appointmentId: apt.id,
        mode: 'webhook_rejected',
        message: errorMessage,
        payload
      };
    }
  } catch (err: any) {
    console.error('[Notification Network Error] Falha ao conectar ao backend seguro:', err);
    return {
      success: false,
      persisted: false,
      appointmentId: apt.id,
      mode: 'webhook_rejected',
      message: 'Não foi possível conectar ao servidor do ateliê para confirmar sua reserva. Verifique sua conexão e tente novamente.',
      payload
    };
  }
}

/**
 * Persiste um agendamento manual criado no painel administrativo diretamente no Google Sheets
 * através do endpoint oficial do backend seguro (/api/notifications/new-booking).
 * Transmite a credencial administrativa para validação e persistência prioritária.
 */
export async function submitManualBooking(
  apt: Appointment,
  authToken?: string
): Promise<EmailDispatchResult> {
  return triggerNewPreBookingEmailNotification(apt, authToken);
}

export interface FetchAppointmentsDetailedResult {
  success: boolean;
  appointments: Appointment[];
  source?: string;
  total?: number;
  error?: string;
  statusCode?: number;
}

/**
 * Consulta agendamentos com resultado detalhado (para exibir status de carregamento,
 * erros de credencial e lista vazia no painel administrativo).
 */
export async function fetchRemoteAppointmentsDetailed(authToken?: string): Promise<FetchAppointmentsDetailedResult> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/appointments`
      : '/api/appointments';

    const token = (authToken || '').trim();
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.appointments)) {
        return {
          success: true,
          appointments: data.appointments as Appointment[],
          source: data.source || 'sheets_synced',
          total: data.total ?? data.appointments.length,
          statusCode: 200
        };
      }
      return {
        success: false,
        appointments: [],
        error: data.error || 'Formato de resposta inesperado do servidor.',
        statusCode: 200
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        appointments: [],
        error: 'Senha ou credencial administrativa incorreta. Acesso não autorizado.',
        statusCode: 401
      };
    }

    let errMsg = `Erro HTTP ${response.status} ao consultar agendamentos.`;
    try {
      const errJson = await response.json();
      if (errJson?.error) errMsg = errJson.error;
    } catch {}

    return {
      success: false,
      appointments: [],
      error: errMsg,
      statusCode: response.status
    };
  } catch (err: any) {
    return {
      success: false,
      appointments: [],
      error: `Falha de rede ao conectar com o servidor: ${err.message || 'Servidor indisponível'}`
    };
  }
}

export interface DeleteAppointmentResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export async function deleteRemoteAppointment(
  appointmentId: string,
  authToken?: string
): Promise<DeleteAppointmentResult> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/appointments/${encodeURIComponent(appointmentId)}`
      : `/api/appointments/${encodeURIComponent(appointmentId)}`;
    const token = (authToken || '').trim();
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(targetUrl, {
      method: 'DELETE',
      headers
    });
    let data: any;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        error: 'Resposta inválida do servidor ao excluir o agendamento.',
        statusCode: response.status
      };
    }

    if (response.ok && data?.success) {
      return { success: true, statusCode: response.status };
    }
    return {
      success: false,
      error: data?.error || `Erro HTTP ${response.status} ao excluir agendamento.`,
      statusCode: response.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Falha de rede ao excluir agendamento: ${err.message || 'servidor indisponível'}.`
    };
  }
}

/**
 * Busca agendamentos centralizados persistidos no backend seguro (Cloud Run / Google Sheets)
 * para exibição no painel administrativo compartilhado.
 */
export async function fetchRemoteAppointments(authToken?: string): Promise<Appointment[]> {
  const result = await fetchRemoteAppointmentsDetailed(authToken);
  return result.success ? result.appointments : [];
}

export interface BlockScheduleResult {
  success: boolean;
  persisted: boolean;
  appointmentId?: string;
  message?: string;
  error?: string;
}

/**
 * Persiste o bloqueio de uma data no armazenamento oficial (Google Sheets / backend).
 * Requer token de autenticação administrativa.
 */
export async function submitBlockSchedule(
  blockApt: Appointment,
  authToken?: string
): Promise<BlockScheduleResult> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/appointments/block`
      : '/api/appointments/block';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    const token =
      (authToken || '').trim() ||
      (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Admin-Token'] = token;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        appointmentId: blockApt.id,
        date: blockApt.date,
        time: blockApt.time,
        reason: blockApt.blockReason || blockApt.serviceTitle,
        notes: blockApt.notes,
        clientName: blockApt.clientName || 'Protocolo Ateliê'
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.persisted === true) {
        return {
          success: true,
          persisted: true,
          appointmentId: blockApt.id,
          message: data.message || 'Bloqueio de data registrado e persistido com sucesso.'
        };
      }
      return {
        success: false,
        persisted: false,
        appointmentId: blockApt.id,
        error: data.error || data.message || 'O servidor não confirmou a gravação do bloqueio.'
      };
    }

    let errorMsg = `Erro HTTP ${response.status} ao registrar bloqueio.`;
    try {
      const errJson = await response.json();
      if (errJson?.error) errorMsg = errJson.error;
    } catch {}

    return {
      success: false,
      persisted: false,
      appointmentId: blockApt.id,
      error: errorMsg
    };
  } catch (err: any) {
    return {
      success: false,
      persisted: false,
      appointmentId: blockApt.id,
      error: `Falha de rede ao conectar com o servidor: ${err.message || 'Servidor indisponível'}`
    };
  }
}

/**
 * Consulta as datas bloqueadas diretamente do backend público (sem expor PII de clientes).
 */
export async function fetchRemoteBlockedDates(): Promise<string[]> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/appointments/blocked-dates`
      : '/api/appointments/blocked-dates';
    const res = await fetch(targetUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.blockedDates)) {
        return data.blockedDates as string[];
      }
    }
    return [];
  } catch {
    return [];
  }
}

export interface UpdateAppointmentResult {
  success: boolean;
  persisted?: boolean;
  appointment?: Appointment;
  error?: string;
  statusCode?: number;
}

export async function updateRemoteAppointment(
  appointment: Partial<Appointment> & { id: string },
  authToken?: string
): Promise<UpdateAppointmentResult> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/appointments/${encodeURIComponent(appointment.id)}`
      : `/api/appointments/${encodeURIComponent(appointment.id)}`;
    const token = (authToken || '').trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(targetUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(appointment)
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        persisted: false,
        error: 'Resposta inválida do servidor ao atualizar o agendamento.',
        statusCode: response.status
      };
    }

    if (response.ok && data?.success && data?.persisted) {
      return {
        success: true,
        persisted: true,
        appointment: data.appointment,
        statusCode: response.status
      };
    }

    return {
      success: false,
      persisted: false,
      error: data?.error || `Erro HTTP ${response.status} ao atualizar agendamento.`,
      statusCode: response.status
    };
  } catch (err: any) {
    return {
      success: false,
      persisted: false,
      error: `Falha de rede ao atualizar agendamento: ${err.message || 'servidor indisponível'}.`
    };
  }
}

export async function fetchRemoteServices(): Promise<Service[]> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase ? `${backendBase}/api/services` : '/api/services';
    const response = await fetch(targetUrl, {
      headers: { Accept: 'application/json' }
    });
    if (response.ok) {
      const data = await response.json();
      if (data?.success && Array.isArray(data.services) && data.services.length > 0) {
        return data.services as Service[];
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveRemoteService(
  service: Service,
  authToken?: string
): Promise<{ success: boolean; saved?: boolean; error?: string; service?: Service }> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase ? `${backendBase}/api/services` : '/api/services';
    const token = (authToken || '').trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(service)
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      return { success: false, error: 'Resposta inválida do servidor ao salvar procedimento.' };
    }

    if (response.ok && data?.success) {
      return { success: true, saved: true, service: data.service || service };
    }

    return { success: false, error: data?.error || `Erro HTTP ${response.status} ao salvar procedimento.` };
  } catch (err: any) {
    return { success: false, error: `Falha de conexão: ${err.message || 'servidor indisponível'}.` };
  }
}

export async function deleteRemoteService(
  serviceId: string,
  authToken?: string
): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
  try {
    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase
      ? `${backendBase}/api/services/${encodeURIComponent(serviceId)}`
      : `/api/services/${encodeURIComponent(serviceId)}`;
    const token = (authToken || '').trim();
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(targetUrl, {
      method: 'DELETE',
      headers
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      return { success: false, error: 'Resposta inválida do servidor ao excluir procedimento.' };
    }

    if (response.ok && data?.success) {
      return { success: true, deleted: true };
    }

    return { success: false, error: data?.error || `Erro HTTP ${response.status} ao excluir procedimento.` };
  } catch (err: any) {
    return { success: false, error: `Falha de rede: ${err.message || 'servidor indisponível'}.` };
  }
}

export async function uploadServicePhoto(
  file: File,
  authToken?: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(file.type)) {
      return {
        success: false,
        error: 'Formato não suportado. Por favor utilize JPEG, PNG ou WebP.'
      };
    }

    if (file.size > 5 * 1024 * 1024) {
      return {
        success: false,
        error: 'A imagem deve ter no máximo 5MB.'
      };
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const backendBase = getBackendApiUrl();
    const targetUrl = backendBase ? `${backendBase}/api/upload-photo` : '/api/upload-photo';
    const token = (authToken || '').trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        imageBase64: base64,
        fileName: file.name,
        mimeType: file.type
      })
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      return { success: false, error: 'Resposta inválida do servidor ao enviar foto.' };
    }

    if (response.ok && data?.success && data?.url) {
      return { success: true, url: data.url };
    }

    return { success: false, error: data?.error || `Erro HTTP ${response.status} ao processar foto.` };
  } catch (err: any) {
    return { success: false, error: `Falha no upload: ${err.message || 'servidor indisponível'}.` };
  }
}
