import React, { useState } from 'react';
import { Appointment, TimeSlotConfig } from '../../types';
import { INITIAL_TIME_SLOTS } from '../../data/mockData';
import { sendAppointmentWhatsAppConfirmation } from '../../services/whatsappService';

interface CalendarTabProps {
  onOpenBlockModal: () => void;
  onOpenExtraEncaixeModal: () => void;
  onSelectClientForDossier: (clientName: string) => void;
  appointments?: Appointment[];
  timeSlots?: TimeSlotConfig[];
  onUpdateAppointment?: (apt: Appointment) => void;
}

export const CalendarTab: React.FC<CalendarTabProps> = ({
  onOpenBlockModal,
  onOpenExtraEncaixeModal,
  onSelectClientForDossier,
  appointments = [],
  timeSlots = INITIAL_TIME_SLOTS,
  onUpdateAppointment
}) => {
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'dia' | 'semana' | 'mes'>('semana');
  const [selectedDayLabel, setSelectedDayLabel] = useState<string>('Quinta, 14 Nov');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Find selected appointment if any
  const selectedAppointment = appointments.find(a => a.id === selectedSlotKey) || null;

  // Real counts derived from actual data
  const confirmedCount = appointments.filter(a => a.status === 'confirmado').length;
  const pendingCount = appointments.filter(a => a.status === 'pendente_pix').length;
  const completedCount = appointments.filter(a => a.status === 'concluido').length;

  const handleFinalizeAppointment = (apt: Appointment) => {
    if (onUpdateAppointment) {
      onUpdateAppointment({
        ...apt,
        status: 'concluido',
        depositStatus: 'liquidado'
      });
      showNotice(`Atendimento de ${apt.clientName} finalizado e marcado como concluído.`);
    }
  };

  const [isDispatchingWa, setIsDispatchingWa] = useState(false);

  const handleDispatchConfirmationWhatsApp = async (apt: Appointment) => {
    setIsDispatchingWa(true);
    try {
      const res = await sendAppointmentWhatsAppConfirmation(apt);
      if (onUpdateAppointment) {
        onUpdateAppointment({
          ...apt,
          whatsappStatus: res.success ? 'enviado' : 'falha',
          whatsappSentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          whatsappLastMessage: res.previewText || res.message
        });
      }
      showNotice(res.message || `Confirmação de agendamento disparada via WhatsApp para ${apt.clientName}!`);
    } catch {
      showNotice('Erro ao disparar confirmação via WhatsApp.');
    } finally {
      setIsDispatchingWa(false);
    }
  };

  const handleSendReminderWhatsApp = (apt: Appointment) => {
    const phoneDigits = apt.clientPhone.replace(/\D/g, '');
    if (!phoneDigits) {
      alert('Número de telefone não informado para esta cliente.');
      return;
    }
    const msg = encodeURIComponent(
      `Olá, ${apt.clientName}! Passando para lembrar do seu atendimento no Espaço Angelica do Carmo agendado para ${apt.date} às ${apt.time} (${apt.serviceTitle}). Nos vemos em breve no Pontal da Cruz, São Sebastião!`
    );
    window.open(`https://wa.me/${phoneDigits}?text=${msg}`, '_blank');
  };

  const daysHeader = [
    { label: 'Terça', num: '12', full: 'Terça, 12 Nov' },
    { label: 'Quarta', num: '13', full: 'Quarta, 13 Nov' },
    { label: 'Quinta', num: '14', full: 'Quinta, 14 Nov' },
    { label: 'Sexta', num: '15', full: 'Sexta, 15 Nov' },
    { label: 'Sábado', num: '16', full: 'Sábado, 16 Nov' }
  ];

  return (
    <div className="flex flex-col gap-6 text-[#49382E]">
      {/* Top Action Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-[#FFFFFF] p-4 lg:p-6 rounded-2xl border border-[#E8D9B5] shadow-xs relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 z-10">
          {/* Week Date Navigator */}
          <div className="flex items-center gap-2 bg-[#F7EFEA] px-4 py-1.5 rounded-full border border-[#E8D9B5]">
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">calendar_month</span>
            <span className="font-syne text-sm sm:text-base text-[#49382E] font-bold tracking-tight">
              Grade Semanal de Atendimentos
            </span>
          </div>

          {/* View Segmented Pill */}
          <div className="flex items-center p-1 bg-[#FDFBF9] rounded-full border border-[#E8D9B5]">
            {(['dia', 'semana', 'mes'] as const).map(view => (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={`px-3.5 py-1 rounded-full font-jakarta text-xs font-semibold capitalize transition-colors cursor-pointer ${
                  activeView === view
                    ? 'bg-[#D4AF37] text-[#3C2F00] font-bold shadow-xs'
                    : 'text-[#786C63] hover:text-[#49382E]'
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Atelier Actions */}
        <div className="flex flex-wrap items-center gap-2.5 z-10">
          <button
            type="button"
            onClick={onOpenBlockModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] hover:bg-[#FDFBF9] transition-all font-jakarta text-xs font-semibold border border-[#E8D9B5] shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[17px] text-[#D4AF37]">block</span>
            <span>Bloquear Horário / Folga</span>
          </button>

          <button
            type="button"
            onClick={onOpenExtraEncaixeModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] hover:bg-[#FDFBF9] transition-all font-jakarta text-xs font-semibold border border-[#E8D9B5] shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[17px] text-[#D4AF37]">flash_on</span>
            <span>Encaixe Extraordinário</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold flex items-center justify-between shadow-xs">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)}>
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Real Status Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Confirmados</span>
            <span className="text-xs text-[#49382E] font-bold">{confirmedCount} na grade</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-[#D4AF37]" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Aguardando Pix</span>
            <span className="text-xs text-[#49382E] font-bold">{pendingCount} pendentes</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-[#A39A90]" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Concluídos</span>
            <span className="text-xs text-[#49382E] font-bold">{completedCount} finalizados</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Bloqueios</span>
            <span className="text-xs text-[#49382E] font-bold">
              {timeSlots.filter(s => s.status === 'bloqueado').length} horários
            </span>
          </div>
        </div>
      </div>

      {/* Main Workspace (8 cols grid + 4 cols Dossier) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Calendar Timetable Grid (8 cols) */}
        <div className="xl:col-span-8 flex flex-col bg-[#FFFFFF] rounded-2xl p-4 lg:p-6 border border-[#E8D9B5] shadow-xs overflow-hidden">
          {/* Day Selector Buttons */}
          <div className="grid grid-cols-5 gap-2 pb-4 border-b border-[#E8D9B5] mb-4">
            {daysHeader.map(d => (
              <button
                key={d.full}
                type="button"
                onClick={() => setSelectedDayLabel(d.full)}
                className={`flex flex-col items-center p-2.5 rounded-xl transition-all cursor-pointer border ${
                  selectedDayLabel === d.full
                    ? 'bg-[#FBF2D5] border-[#D4AF37] text-[#3C2F00] shadow-xs'
                    : 'bg-[#FDFBF9] text-[#786C63] border-[#E8D9B5] hover:bg-[#F7EFEA] hover:text-[#49382E]'
                }`}
              >
                <span className="font-jakarta text-[10px] uppercase font-bold">{d.label}</span>
                <span className="font-syne text-base font-bold text-[#49382E]">{d.num}</span>
              </button>
            ))}
          </div>

          <div className="text-xs text-[#786C63] mb-3 font-jakarta flex items-center justify-between">
            <span>Visualizando grade de: <strong className="text-[#49382E]">{selectedDayLabel}</strong></span>
            <span className="text-[#D4AF37] font-semibold">Clique em um agendamento para ver detalhes</span>
          </div>

          {/* Schedule Slots Rows */}
          <div className="space-y-2.5 overflow-y-auto max-h-[650px] pr-1">
            {timeSlots.filter(s => s.active).map(slot => {
              const matchingApt = appointments.find(
                a => a.time === slot.time && (a.date.includes(selectedDayLabel.split(' ')[0]) || a.date === selectedDayLabel)
              );
              const isBlocked = slot.status === 'bloqueado' || slot.status === 'autoclave' || slot.status === 'almoco';
              const isSelected = matchingApt && selectedSlotKey === matchingApt.id;

              return (
                <div
                  key={slot.id}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#FBF2D5] border-[#D4AF37] shadow-xs'
                      : matchingApt
                      ? 'bg-[#FFFFFF] border-[#E8D9B5] hover:border-[#D4AF37] cursor-pointer shadow-xs'
                      : isBlocked
                      ? 'bg-red-50 border-red-200 opacity-80'
                      : 'bg-[#FDFBF9] border-[#E8D9B5]'
                  }`}
                  onClick={() => {
                    if (matchingApt) setSelectedSlotKey(matchingApt.id);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-14 py-1.5 rounded-lg bg-[#F7EFEA] border border-[#E8D9B5] text-center font-syne text-sm font-bold text-[#49382E] shrink-0">
                      {slot.time}
                    </div>

                    <div className="flex flex-col min-w-0">
                      {matchingApt ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-syne text-sm font-bold text-[#49382E] truncate">
                              {matchingApt.clientName}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                matchingApt.status === 'confirmado'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-amber-100 text-amber-800 border border-amber-300'
                              }`}
                            >
                              {matchingApt.status === 'confirmado' ? 'Confirmado' : 'Aguardando Pix'}
                            </span>
                          </div>
                          <span className="font-jakarta text-xs text-[#786C63]">
                            {matchingApt.serviceTitle} • {matchingApt.servicePrice}
                          </span>
                        </>
                      ) : isBlocked ? (
                        <div className="flex items-center gap-1.5 text-xs text-red-700 font-medium">
                          <span className="material-symbols-outlined text-[16px]">block</span>
                          <span>Bloqueado: {slot.note || 'Intervalo / Indisponível'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-[#786C63]">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>Horário Disponível para Atendimento</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {matchingApt && (
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleSendReminderWhatsApp(matchingApt);
                        }}
                        className="px-3 py-1 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] text-xs font-semibold hover:border-[#D4AF37] hover:text-[#D4AF37] transition-colors inline-flex items-center gap-1 shadow-xs cursor-pointer"
                        title="Enviar lembrete pelo WhatsApp"
                      >
                        <span className="material-symbols-outlined text-[14px] text-[#D4AF37]">chat</span>
                        <span>Lembrete</span>
                      </button>

                      {matchingApt.status !== 'concluido' && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            handleFinalizeAppointment(matchingApt);
                          }}
                          className="px-3 py-1 rounded-full bg-[#D4AF37] text-[#3C2F00] text-xs font-bold hover:bg-[#E5C158] transition-colors shadow-xs cursor-pointer"
                        >
                          Concluir
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Dossier Right Panel (4 cols) */}
        <div className="xl:col-span-4 bg-[#FFFFFF] rounded-2xl p-5 border border-[#E8D9B5] shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5] mb-4">
            <span className="material-symbols-outlined text-[#D4AF37]">receipt_long</span>
            <h3 className="font-syne text-base text-[#49382E] font-bold">
              Ficha Técnica do Atendimento
            </h3>
          </div>

          {selectedAppointment ? (
            <div className="space-y-4 font-jakarta text-xs">
              <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
                <span className="text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold">
                  Cliente
                </span>
                <div className="font-syne text-base text-[#49382E] font-bold">
                  {selectedAppointment.clientName}
                </div>
                <div className="text-[#786C63]">
                  WhatsApp: {selectedAppointment.clientPhone}
                </div>
                {selectedAppointment.clientInstagram && (
                  <div className="text-[#D4AF37] font-semibold">
                    Instagram: {selectedAppointment.clientInstagram}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-[#786C63]">
                  <span>Procedimento:</span>
                  <span className="text-[#49382E] font-semibold">{selectedAppointment.serviceTitle}</span>
                </div>
                <div className="flex justify-between text-[#786C63]">
                  <span>Data &amp; Hora:</span>
                  <span className="text-[#49382E] font-semibold">
                    {selectedAppointment.date} às {selectedAppointment.time}
                  </span>
                </div>
                <div className="flex justify-between text-[#786C63]">
                  <span>Valor do Serviço:</span>
                  <span className="text-[#49382E] font-semibold">{selectedAppointment.servicePrice}</span>
                </div>
                <div className="flex justify-between text-[#786C63]">
                  <span>Sinal Pix:</span>
                  <span className="text-[#D4AF37] font-bold">
                    R$ {selectedAppointment.depositAmount},00 ({selectedAppointment.depositStatus})
                  </span>
                </div>
              </div>

              {selectedAppointment.nailCondition && (
                <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#E8D9B5] text-[#786C63]">
                  <strong className="text-[#49382E] block mb-0.5">Condição da Lâmina:</strong>
                  {selectedAppointment.nailCondition}
                </div>
              )}

              {selectedAppointment.notes && (
                <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#E8D9B5] text-[#786C63]">
                  <strong className="text-[#49382E] block mb-0.5">Observações:</strong>
                  {selectedAppointment.notes}
                </div>
              )}

              {/* WhatsApp Business Confirmation Status Badge */}
              <div className="p-3 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="material-symbols-outlined text-[#25D366] text-[18px]">
                    {selectedAppointment.whatsappStatus === 'enviado' ? 'verified' : 'chat'}
                  </span>
                  <div className="truncate">
                    <span className="font-bold text-[#49382E] block text-[11px]">
                      WhatsApp Business API
                    </span>
                    <span className="text-[10px] text-[#786C63]">
                      {selectedAppointment.whatsappStatus === 'enviado'
                        ? `Enviado às ${selectedAppointment.whatsappSentAt || ''}`
                        : selectedAppointment.whatsappStatus === 'simulado'
                        ? 'Simulado com Sucesso'
                        : selectedAppointment.whatsappStatus === 'falha'
                        ? 'Falha no envio anterior'
                        : 'Confirmação pendente'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isDispatchingWa}
                  onClick={() => handleDispatchConfirmationWhatsApp(selectedAppointment)}
                  className="px-2.5 py-1 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] text-[10px] font-bold transition-all shadow-xs shrink-0 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  title="Enviar mensagem oficial de confirmação com data, horário e endereço via WhatsApp"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {isDispatchingWa ? 'sync' : 'send'}
                  </span>
                  <span>{isDispatchingWa ? 'Enviando...' : 'Disparar Confirmação'}</span>
                </button>
              </div>

              <div className="pt-3 border-t border-[#E8D9B5] flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => handleSendReminderWhatsApp(selectedAppointment)}
                  className="w-full py-2.5 rounded-xl bg-[#FFFFFF] hover:bg-[#FDFBF9] text-[#49382E] hover:text-[#D4AF37] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-[#E8D9B5] shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">chat</span>
                  <span>Abrir Conversa Manual (wa.me)</span>
                </button>

                <button
                  type="button"
                  onClick={() => onSelectClientForDossier(selectedAppointment.clientName)}
                  className="w-full py-2.5 rounded-xl bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] transition-all text-center cursor-pointer border border-[#E8D9B5] font-semibold"
                >
                  Ver Perfil Completo na Gestão de Clientes
                </button>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-[#786C63] space-y-2">
              <span className="material-symbols-outlined text-[36px] text-[#A39A90] block">
                touch_app
              </span>
              <p className="font-semibold text-[#49382E]">Nenhum agendamento selecionado.</p>
              <p className="text-[11px] text-[#786C63]">
                Selecione um horário com agendamento na grade ao lado para inspecionar os detalhes do procedimento.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
