import React, { useState } from 'react';
import { SERVICES_CATALOG, INITIAL_BLACKLIST } from '../../data/mockData';
import { Appointment, Service, BlacklistEntry, RecurrenceConfig } from '../../types';
import { sendAppointmentWhatsAppConfirmation } from '../../services/whatsappService';
import { calculateDeposit40, calculateFullPrepayment, formatBRL } from '../../services/notificationTemplates';
import { submitManualBooking } from '../../services/emailNotificationService';

interface ManualBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAppointment: (apt: Appointment) => void;
  services?: Service[];
  blacklist?: BlacklistEntry[];
  adminSessionToken?: string;
}

export const ManualBookingModal: React.FC<ManualBookingModalProps> = ({
  isOpen,
  onClose,
  onSaveAppointment,
  services = SERVICES_CATALOG,
  blacklist = INITIAL_BLACKLIST,
  adminSessionToken
}) => {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id || SERVICES_CATALOG[0].id);
  const [date, setDate] = useState('Quinta, 14 Nov');
  const [time, setTime] = useState('14:30');
  const [paymentMode, setPaymentMode] = useState<'sinal_40' | 'pre_pagamento_100'>('sinal_40');
  const [depositStatus, setDepositStatus] = useState<'liquidado' | 'pendente'>('liquidado');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState(21);
  const [totalSessions, setTotalSessions] = useState(3);
  const [notes, setNotes] = useState('');
  const [sendWhatsAppAuto, setSendWhatsAppAuto] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [persistedAppointmentId, setPersistedAppointmentId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  };

  // Check if client phone is in blacklist
  const normalized = clientPhone.replace(/\D/g, '');
  const matchedBlacklist = blacklist.find(b => {
    if (!b.active) return false;
    const bDigits = b.phone.replace(/\D/g, '');
    return bDigits.length >= 8 && (normalized.includes(bDigits) || bDigits.includes(normalized));
  });

  const isInadimplente = Boolean(matchedBlacklist);
  const effectivePaymentMode = isInadimplente ? 'pre_pagamento_100' : paymentMode;

  const serv = services.find(s => s.id === selectedServiceId) || services[0] || SERVICES_CATALOG[0];
  const standardDeposit = calculateDeposit40(serv.price);
  const fullPrepayment = calculateFullPrepayment(serv.price);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const trimmedName = clientName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setSubmitError('Por favor, informe o nome completo da cliente (mínimo de 2 caracteres).');
      return;
    }

    const trimmedPhone = clientPhone.trim();
    const phoneDigits = trimmedPhone.replace(/\D/g, '');
    if (!trimmedPhone || phoneDigits.length < 8) {
      setSubmitError('Por favor, informe o WhatsApp da cliente com DDD.');
      return;
    }

    if (!date.trim() || !time.trim()) {
      setSubmitError('Por favor, informe a data e o horário do atendimento.');
      return;
    }

    setIsSubmitting(true);

    // Reuse appointmentId across retries to prevent duplicate Google Sheets records
    const appointmentId = persistedAppointmentId || `apt-${Date.now()}`;
    if (!persistedAppointmentId) {
      setPersistedAppointmentId(appointmentId);
    }

    const recurrenceConfig: RecurrenceConfig | undefined = isRecurring
      ? {
          frequencyDays: recurrenceFreq,
          frequencyLabel: `A cada ${recurrenceFreq} dias`,
          totalSessions,
          seriesId: `series-${Date.now()}`,
          currentSession: 1
        }
      : undefined;

    const depositAmount = effectivePaymentMode === 'pre_pagamento_100' ? fullPrepayment : standardDeposit;

    const newApt: Appointment = {
      id: appointmentId,
      clientName: trimmedName,
      clientPhone: trimmedPhone,
      clientEmail: clientEmail.trim() || undefined,
      serviceId: serv.id,
      serviceTitle: serv.title,
      servicePrice: serv.priceFormatted,
      serviceDuration: serv.duration,
      date: date.trim(),
      time: time.trim(),
      status: depositStatus === 'liquidado' ? 'confirmado' : 'pendente_pix',
      depositAmount,
      depositStatus,
      paymentMode: effectivePaymentMode,
      requiresFullPrepayment: isInadimplente,
      isBlacklisted: isInadimplente,
      recurrence: recurrenceConfig,
      notes: notes.trim() || undefined,
      clientInitials: trimmedName
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    };

    try {
      const token =
        (adminSessionToken || '').trim() ||
        (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');

      const dispatchResult = await submitManualBooking(newApt, token);

      if (!dispatchResult.success || dispatchResult.persisted !== true) {
        setIsSubmitting(false);
        setSubmitError(
          dispatchResult.message ||
            'Falha ao persistir agendamento no Google Sheets. O servidor não confirmou a gravação.'
        );
        return;
      }

      // Disparar WhatsApp se habilitado
      if (sendWhatsAppAuto && trimmedPhone) {
        try {
          const waRes = await sendAppointmentWhatsAppConfirmation(newApt);
          newApt.whatsappStatus = waRes.success ? 'enviado' : 'falha';
          newApt.whatsappSentAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          newApt.whatsappLastMessage = waRes.previewText || waRes.message;
        } catch {}
      }

      // Limpar formulário e estado do modal após sucesso
      setClientName('');
      setClientPhone('');
      setClientEmail('');
      setNotes('');
      setPersistedAppointmentId(null);
      setSubmitError(null);
      setIsSubmitting(false);

      // Notificar salvamento confirmado pelo servidor e fechar modal
      onSaveAppointment(newApt);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setSubmitError(
        err?.message ||
          'Falha de comunicação ao conectar ao servidor. Os dados foram mantidos intactos no formulário para nova tentativa.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-[#E8D9B5] shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8D9B5] mb-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">add_circle</span>
            <h3 className="font-syne text-lg sm:text-xl text-[#49382E] font-bold">
              Novo Agendamento Manual
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {submitError && (
          <div className="p-3.5 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2.5 shadow-xs">
            <span className="material-symbols-outlined text-[20px] text-red-600 shrink-0 mt-0.5">error</span>
            <div>
              <strong className="block font-semibold">Falha na Gravação da Reserva</strong>
              <span>{submitError}</span>
            </div>
          </div>
        )}

        {isInadimplente && (
          <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-red-600">warning</span>
            <span>
              <strong>Alerta de Inadimplência:</strong> Número cadastrado na lista de restrição. Exigido 100% de Pré-pagamento via Pix.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 font-jakarta text-xs">
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Nome Completo da Cliente *</label>
            <input
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="Ex: Amanda Rezende"
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">WhatsApp com DDD *</label>
              <input
                type="tel"
                value={clientPhone}
                onChange={e => setClientPhone(e.target.value)}
                placeholder="(12) 98888-7777"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">E-mail da Cliente (Opcional)</label>
              <input
                type="email"
                value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                placeholder="cliente@exemplo.com"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Procedimento</label>
            <select
              value={selectedServiceId}
              onChange={e => setSelectedServiceId(e.target.value)}
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
            >
              {services.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.priceFormatted})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">Data</label>
              <input
                type="text"
                value={date}
                onChange={e => setDate(e.target.value)}
                placeholder="Ex: Quinta, 14 Nov"
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
              />
            </div>
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">Horário</label>
              <input
                type="text"
                value={time}
                onChange={e => setTime(e.target.value)}
                placeholder="Ex: 14:30"
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
              />
            </div>
          </div>

          {/* Agendamento Recorrente */}
          <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#49382E] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#D4AF37] text-[16px]">update</span>
                Agendamento Recorrente
              </span>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="w-4 h-4 rounded text-[#D4AF37] focus:ring-[#D4AF37]"
              />
            </div>
            {isRecurring && (
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div>
                  <label className="text-[#786C63] block mb-0.5 font-medium">Intervalo</label>
                  <select
                    value={recurrenceFreq}
                    onChange={e => setRecurrenceFreq(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5]"
                  >
                    <option value={15}>A cada 15 dias</option>
                    <option value={21}>A cada 21 dias (Recomendado)</option>
                    <option value={30}>A cada 30 dias</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#786C63] block mb-0.5 font-medium">Qtd. Sessões</label>
                  <select
                    value={totalSessions}
                    onChange={e => setTotalSessions(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5]"
                  >
                    <option value={2}>2 sessões</option>
                    <option value={3}>3 sessões</option>
                    <option value={4}>4 sessões</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Forma de Pagamento */}
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Modalidade Pix</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isInadimplente}
                onClick={() => setPaymentMode('sinal_40')}
                className={`py-2 px-2.5 rounded-xl font-bold cursor-pointer transition-all border ${
                  effectivePaymentMode === 'sinal_40'
                    ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37] shadow-xs'
                    : isInadimplente
                    ? 'bg-[#F7EFEA] text-[#A39A90] border-[#E8D9B5] cursor-not-allowed'
                    : 'bg-[#FFFFFF] text-[#49382E] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                Sinal 40% (R$ {formatBRL(standardDeposit)})
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('pre_pagamento_100')}
                className={`py-2 px-2.5 rounded-xl font-bold cursor-pointer transition-all border ${
                  effectivePaymentMode === 'pre_pagamento_100'
                    ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37] shadow-xs'
                    : 'bg-[#FFFFFF] text-[#49382E] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                100% Pré-pago ({serv.priceFormatted})
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Status da Liquidação</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDepositStatus('liquidado')}
                className={`py-2 px-3 rounded-xl font-bold cursor-pointer transition-all border ${
                  depositStatus === 'liquidado'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-[#FFFFFF] text-[#786C63] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                Já Liquidado / Confirmado
              </button>
              <button
                type="button"
                onClick={() => setDepositStatus('pendente')}
                className={`py-2 px-3 rounded-xl font-bold cursor-pointer transition-all border ${
                  depositStatus === 'pendente'
                    ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37] shadow-xs'
                    : 'bg-[#FFFFFF] text-[#786C63] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                Aguardando Comprovante Pix
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Observações / Ficha</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ex: Formato almond, sensibilidade leve"
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          {/* WhatsApp Confirmation Toggle */}
          <div className="p-3.5 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#25D366] text-[20px]">chat</span>
              <div>
                <span className="font-bold text-[#49382E] block text-xs">
                  Disparar Confirmação Automática via WhatsApp
                </span>
                <span className="text-[11px] text-[#786C63]">
                  Envia comprovante, endereço e orientações para {clientPhone.trim() || 'o telefone da cliente'}.
                </span>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={sendWhatsAppAuto}
                onChange={e => setSendWhatsAppAuto(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#E8D9B5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#25D366]"></div>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8D9B5]">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-6 py-2.5 rounded-full font-bold shadow-md transition-all flex items-center gap-2 ${
                isSubmitting
                  ? 'bg-[#E8D9B5] text-[#786C63] cursor-not-allowed'
                  : 'bg-[#D4AF37] text-[#3C2F00] hover:bg-[#E5C158] cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                  <span>Gravando no Google Sheets...</span>
                </>
              ) : (
                <span>Inserir na Grade</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
