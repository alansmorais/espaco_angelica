/**
 * Template oficial aprovado para mensagens de pré-agendamento do Espaço Angelica do Carmo.
 * Preserva integralmente o texto, emojis, política de cancelamento e regras de sinal.
 */

export interface PreBookingTemplateData {
  clientName: string;
  serviceTitle: string;
  date: string;
  time: string;
  depositAmount: number;
}

/**
 * Constrói a mensagem oficial aprovada pela Angélica com os dados reais da reserva.
 */
export function buildOfficialPreBookingWhatsAppMessage(data: PreBookingTemplateData): string {
  const signalValue = `R$ ${data.depositAmount},00`;

  return `Olá, ${data.clientName}! Recebemos o seu pré-agendamento na Angelica do Carmo Unhas.
Serviço: ${data.serviceTitle}
Data: ${data.date}
Horário: ${data.time}

Para confirmar, faça o PIX do sinal de ${signalValue}:
Chave PIX: 12974062241
Titular: Angelica do Carmo Costa Santos

Depois é só enviar o comprovante por aqui. Assim que conferirmos o pagamento, enviamos a confirmação do seu agendamento. 💛

🤎 POLÍTICA DE AGENDAMENTO
O horário é reservado exclusivamente para você mediante o pagamento do sinal, que é descontado do valor do atendimento no dia.
Caso precise cancelar ou remarcar, pedimos que avise com pelo menos 12 horas de antecedência. Assim, o sinal poderá ser utilizado no novo agendamento.
Em casos de cancelamento com menos de 12 horas de antecedência ou não comparecimento, o sinal não será devolvido nem transferido, pois o horário reservado dificilmente poderá ser preenchido. Essa regra não se aplica em casos de força maior.
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
