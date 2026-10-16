import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.send');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGmailAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const signInWithGmail = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get Gmail access token from Firebase Auth');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Gmail sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getGmailAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutGmail = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// Helper to create RFC 5322 email and encode in base64url
function createEmail(to: string, subject: string, message: string) {
  const emailLines = [
    `To: ${to}`,
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(message)))
  ];
  const email = emailLines.join('\r\n');
  return btoa(email).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendGmailConfirmation(
  accessToken: string,
  toEmail: string,
  clientName: string,
  serviceTitle: string,
  date: string,
  time: string,
  servicePrice: string,
  depositAmount: number
): Promise<any> {
  const targetEmail = 'angelikm19@gmail.com';
  const subject = `Novo Agendamento • ${clientName} (${date} às ${time})`;
  const body = `✨ Nova confirmação de agendamento registrada no Espaço Angélica do Carmo ✨\n\n` +
    `👤 Cliente: ${clientName}\n` +
    `💅 Procedimento: ${serviceTitle}\n` +
    `🗓️ Data & Horário: ${date} às ${time}\n` +
    `💳 Valor do Procedimento: ${servicePrice}\n` +
    `💰 Sinal Pix: R$ ${depositAmount},00\n\n` +
    `📍 Local: Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP\n\n` +
    `Esta notificação foi enviada automaticamente para angelikm19@gmail.com via Google Gmail API.`;

  const raw = createEmail(targetEmail, subject, body);

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
