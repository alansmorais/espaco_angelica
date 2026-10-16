import { Appointment } from '../types';

export interface SendConfirmationResult {
  success: boolean;
  status: 'sent' | 'simulated' | 'failed';
  message: string;
  normalizedPhone?: string;
  previewText?: string;
  fallbackUrl?: string;
  error?: string;
  log?: any;
}

export interface WhatsAppStatus {
  status: 'configured' | 'sandbox_simulation';
  mode: string;
  isConfigured: boolean;
  phoneNumberIdConfigured: boolean;
  tokenConfigured: boolean;
  businessAccountIdConfigured: boolean;
  apiVersion: string;
  totalLogs: number;
  lastLog?: any;
}

export async function checkWhatsAppStatus(): Promise<WhatsAppStatus> {
  try {
    const res = await fetch('/api/whatsapp/status');
    if (!res.ok) {
      throw new Error(`Status ${res.status}`);
    }
    return await res.json();
  } catch {
    return {
      status: 'sandbox_simulation',
      mode: 'Modo Simulação Inteligente (Pronto para Chaves Meta)',
      isConfigured: false,
      phoneNumberIdConfigured: false,
      tokenConfigured: false,
      businessAccountIdConfigured: false,
      apiVersion: 'v20.0',
      totalLogs: 0
    };
  }
}

export async function fetchWhatsAppLogs(): Promise<any[]> {
  try {
    const res = await fetch('/api/whatsapp/logs');
    if (!res.ok) return [];
    const data = await res.json();
    return data.logs || [];
  } catch {
    return [];
  }
}

export async function sendAppointmentWhatsAppConfirmation(
  apt: Appointment,
  customTemplate?: string,
  studioAddress?: string
): Promise<SendConfirmationResult> {
  try {
    const res = await fetch('/api/whatsapp/send-confirmation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        appointmentId: apt.id,
        clientName: apt.clientName,
        clientPhone: apt.clientPhone,
        serviceTitle: apt.serviceTitle,
        servicePrice: apt.servicePrice,
        date: apt.date,
        time: apt.time,
        studioAddress,
        depositAmount: apt.depositAmount,
        paymentMode: apt.paymentMode,
        depositStatus: apt.depositStatus,
        customTemplate
      })
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    return {
      success: false,
      status: 'failed',
      message: 'Não foi possível conectar ao serviço de envio de WhatsApp.',
      error: err.message
    };
  }
}

export async function testWhatsAppMessage(
  testPhone: string,
  testName: string = 'Cliente Teste'
): Promise<SendConfirmationResult> {
  try {
    const res = await fetch('/api/whatsapp/send-confirmation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientName: testName,
        clientPhone: testPhone,
        serviceTitle: 'Alongamento em Fibra Slim',
        servicePrice: 'R$ 220,00',
        date: 'Quinta, 14 Nov',
        time: '14:30',
        depositAmount: 50,
        depositStatus: 'liquidado'
      })
    });

    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      status: 'failed',
      message: 'Erro ao enviar mensagem de teste.',
      error: err.message
    };
  }
}
