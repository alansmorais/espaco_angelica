import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { formatBRL } from './notificationTemplates';

export const AUTHORIZED_SENDER_EMAIL = 'kontakt@alansmsolutions.com';
export const TARGET_NOTIFICATION_EMAIL = 'angelikm19@gmail.com';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.send');
// Sugere a conta autorizada kontakt@alansmsolutions.com no popup de autenticação
provider.setCustomParameters({
  login_hint: AUTHORIZED_SENDER_EMAIL
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGmailAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = await getGmailAccessToken();
      if (token) {
        if (onAuthSuccess) onAuthSuccess(user, token);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem('angelica_gmail_access_token');
          sessionStorage.removeItem('angelica_gmail_user_email');
        } catch {}
      }
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const signInWithGmail = async (): Promise<{
  user: User;
  accessToken: string;
  isAuthorizedSender: boolean;
  userEmail: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Falha ao obter token de acesso do Google via Firebase Auth');
    }
    cachedAccessToken = credential.accessToken;
    const userEmail = result.user.email || '';
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('angelica_gmail_access_token', cachedAccessToken);
        sessionStorage.setItem('angelica_gmail_user_email', userEmail);
      } catch {}
    }
    const isAuthorizedSender = userEmail.toLowerCase() === AUTHORIZED_SENDER_EMAIL.toLowerCase();
    return {
      user: result.user,
      accessToken: cachedAccessToken,
      isAuthorizedSender,
      userEmail
    };
  } catch (error: any) {
    console.error('Gmail sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getGmailAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('angelica_gmail_access_token');
      if (stored) {
        cachedAccessToken = stored;
        return stored;
      }
    } catch {}
  }
  return null;
};

export const getConnectedSenderEmail = (): string | null => {
  if (typeof window !== 'undefined') {
    try {
      return sessionStorage.getItem('angelica_gmail_user_email') || auth.currentUser?.email || null;
    } catch {}
  }
  return auth.currentUser?.email || null;
};

export const isAuthorizedSenderConnected = (): boolean => {
  const email = getConnectedSenderEmail();
  return Boolean(email && email.toLowerCase() === AUTHORIZED_SENDER_EMAIL.toLowerCase());
};

export const logoutGmail = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem('angelica_gmail_access_token');
      sessionStorage.removeItem('angelica_gmail_user_email');
    } catch {}
  }
};

// Helper to create RFC 5322 email with explicit From, To, Subject and base64url encoding
export function createEmail(
  from: string,
  to: string,
  subject: string,
  message: string,
  replyTo?: string
): string {
  const emailLines = [
    `From: Espaço Angélica do Carmo <${from}>`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : '',
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(message)))
  ].filter(Boolean);

  const email = emailLines.join('\r\n');
  return btoa(email).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Disparo direto via Gmail API usando a sessão ativa no navegador da conta kontakt@alansmsolutions.com.
 * Nota: Requer que o painel esteja aberto com o token OAuth ativo.
 */
export async function sendDirectGmailFromBrowser(payload: {
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceTitle: string;
  servicePrice?: string;
  date: string;
  time: string;
  depositAmount: number;
  paymentMode?: string;
  appointmentId: string;
  notes?: string;
}): Promise<{ success: boolean; message: string }> {
  const token = await getGmailAccessToken();
  if (!token) {
    return {
      success: false,
      message: `Nenhum token ativo no navegador. Conecte a conta ${AUTHORIZED_SENDER_EMAIL} no painel.`
    };
  }

  const paymentLabel =
    payload.paymentMode === 'pre_pagamento_100'
      ? 'Pré-pagamento Pix (100%)'
      : 'Sinal Pix (40%)';

  const subject = `Novo pré-agendamento — ${payload.clientName} — ${payload.date} às ${payload.time}`;
  const body = `✨ Novo pré-agendamento registrado no Espaço Angélica do Carmo ✨\n\n` +
    `👤 Cliente: ${payload.clientName}\n` +
    `📞 Telefone: ${payload.clientPhone}\n` +
    (payload.clientEmail ? `📧 E-mail da Cliente: ${payload.clientEmail}\n` : '') +
    `💅 Procedimento: ${payload.serviceTitle}\n` +
    (payload.servicePrice ? `💳 Valor do Procedimento: ${payload.servicePrice}\n` : '') +
    `🗓️ Data & Horário: ${payload.date} às ${payload.time}\n` +
    `💰 ${paymentLabel}: R$ ${formatBRL(payload.depositAmount)}\n` +
    `🔖 ID da Reserva: ${payload.appointmentId}\n` +
    (payload.notes ? `📝 Observações: ${payload.notes}\n\n` : '\n') +
    `📍 Local: Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP\n\n` +
    `Remetente: ${AUTHORIZED_SENDER_EMAIL}\n` +
    `Destinatário: ${TARGET_NOTIFICATION_EMAIL}\n` +
    `Disparado via Gmail API autenticada como ${AUTHORIZED_SENDER_EMAIL}.`;

  const raw = createEmail(
    AUTHORIZED_SENDER_EMAIL,
    TARGET_NOTIFICATION_EMAIL,
    subject,
    body,
    payload.clientEmail || AUTHORIZED_SENDER_EMAIL
  );

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Falha ao enviar e-mail via API do Gmail');
  }

  return {
    success: true,
    message: `Notificação enviada com sucesso de ${AUTHORIZED_SENDER_EMAIL} para ${TARGET_NOTIFICATION_EMAIL}!`
  };
}

export async function sendGmailConfirmation(
  accessToken: string,
  toEmail: string,
  clientName: string,
  serviceTitle: string,
  date: string,
  time: string,
  servicePrice: string,
  depositAmount: number,
  paymentMode?: string
): Promise<any> {
  const paymentLabel =
    paymentMode === 'pre_pagamento_100'
      ? 'Pré-pagamento Pix (100%)'
      : 'Sinal Pix (40%)';

  const subject = `Novo Agendamento • ${clientName} (${date} às ${time})`;
  const body = `✨ Nova confirmação de agendamento registrada no Espaço Angélica do Carmo ✨\n\n` +
    `👤 Cliente: ${clientName}\n` +
    `💅 Procedimento: ${serviceTitle}\n` +
    `🗓️ Data & Horário: ${date} às ${time}\n` +
    `💳 Valor do Procedimento: ${servicePrice}\n` +
    `💰 ${paymentLabel}: R$ ${formatBRL(depositAmount)}\n\n` +
    `📍 Local: Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP\n\n` +
    `Remetente: ${AUTHORIZED_SENDER_EMAIL}\n` +
    `Destinatário: ${TARGET_NOTIFICATION_EMAIL}\n` +
    `Esta notificação foi enviada via Google Gmail API autorizada.`;

  const raw = createEmail(AUTHORIZED_SENDER_EMAIL, TARGET_NOTIFICATION_EMAIL, subject, body, toEmail);

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Falha ao enviar e-mail via API do Gmail');
  }

  return response.json();
}
