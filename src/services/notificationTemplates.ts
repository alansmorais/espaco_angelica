/**
 * Template oficial aprovado para mensagens de pré-agendamento do Espaço Angelica do Carmo.
 * Preserva integralmente a política de agendamento (sinal de 40% e aviso mínimo de 24h).
 */

export const DEPOSIT_RATE = 0.4;

export function calculateDeposit40(servicePrice: number): number {
  return Math.round(servicePrice * DEPOSIT_RATE * 100) / 100;
}

export function calculateFullPrepayment(servicePrice: number): number {
  return Math.round(servicePrice * 100) / 100;
}

export function calculateRemainingBalance(servicePrice: number, depositAmount: number): number {
  return Math.max(0, Math.round((servicePrice - depositAmount) * 100) / 100);
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export interface PreBookingTemplateData {
  clientName: string;
  serviceTitle: string;
  servicePrice?: string;
  date: string;
  time: string;
  depositAmount: number;
  remainingBalance?: number;
  paymentMode?: 'sinal_40' | 'sinal_50' | 'pre_pagamento_100';
}

/**
 * Constrói a mensagem oficial aprovada pela Angélica com os dados reais da reserva.
 */
export function buildOfficialPreBookingWhatsAppMessage(data: PreBookingTemplateData): string {
  const signalValue = `R$ ${formatBRL(data.depositAmount)}`;
  const totalLine = data.servicePrice ? `\nTotal do procedimento: ${data.servicePrice}` : '';
  const balanceLine =
    data.remainingBalance !== undefined
      ? `\nSaldo restante a pagar no atendimento: R$ ${formatBRL(data.remainingBalance)}`
      : '';
  const paymentPrompt =
    data.paymentMode === 'pre_pagamento_100'
      ? `Para confirmar, faça o PIX do pré-pagamento integral (100%) de ${signalValue}:`
      : `Para confirmar, faça o PIX do sinal (40%) de ${signalValue}:`;

  return `Olá, ${data.clientName}! Recebemos o seu pré-agendamento na Angelica do Carmo Unhas.
Serviço: ${data.serviceTitle}${totalLine}
Data: ${data.date}
Horário: ${data.time}

${paymentPrompt}${balanceLine}
Chave PIX: 12974062241
Titular: Angelica do Carmo Costa Santos

Depois é só enviar o comprovante por aqui. Assim que conferirmos o pagamento, enviamos a confirmação do seu agendamento. 💛

🤎 POLÍTICA DE AGENDAMENTO
- Para confirmar o horário, é necessário pagar um sinal de 40% do valor do procedimento.
- O sinal garante a vaga e é descontado do valor total no dia do atendimento.
- Em caso de desistência ou não comparecimento, o sinal não é reembolsado, pois cobre o bloqueio da vaga e os preparativos.
- Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago.
Agradeço a compreensão e o carinho de sempre! 🤎✨`;
}

/**
 * Retorna o link oficial do WhatsApp da Angélica com a mensagem pré-preenchida.
 */
export function buildOfficialWhatsAppUrl(data: PreBookingTemplateData, phone: string = '5512974062241'): string {
  const cleanPhone = phone.replace(/\D/g, '');
  const message = buildOfficialPreBookingWhatsAppMessage(data);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
