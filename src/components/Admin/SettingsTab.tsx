import React, { useState, useEffect } from 'react';
import { STUDIO_ADDRESS } from '../../data/mockData';
import { TimeSlotConfig, DayScheduleConfig, BlacklistEntry, StudioAddressConfig, WhatsAppConfig } from '../../types';
import { checkWhatsAppStatus, testWhatsAppMessage, fetchWhatsAppLogs, WhatsAppStatus } from '../../services/whatsappService';

interface SettingsTabProps {
  timeSlots?: TimeSlotConfig[];
  onUpdateTimeSlots?: (slots: TimeSlotConfig[]) => void;
  daySchedules?: DayScheduleConfig[];
  onUpdateDaySchedules?: (schedules: DayScheduleConfig[]) => void;
  blacklist?: BlacklistEntry[];
  onUpdateBlacklist?: (entries: BlacklistEntry[]) => void;
  studioAddress?: StudioAddressConfig;
  onUpdateStudioAddress?: (addr: StudioAddressConfig) => void;
  whatsappConfig?: WhatsAppConfig;
  onUpdateWhatsappConfig?: (config: WhatsAppConfig) => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  timeSlots: propTimeSlots,
  onUpdateTimeSlots,
  daySchedules: propDaySchedules,
  onUpdateDaySchedules,
  blacklist: propBlacklist,
  onUpdateBlacklist,
  studioAddress: propStudioAddress,
  onUpdateStudioAddress,
  whatsappConfig: propWhatsappConfig,
  onUpdateWhatsappConfig
}) => {
  // Local fallbacks if not wired in App
  const [internalSlots, setInternalSlots] = useState<TimeSlotConfig[]>([
    { id: 'slot-1', time: '09:00', status: 'disponivel', active: true },
    { id: 'slot-2', time: '10:30', status: 'disponivel', active: true },
    { id: 'slot-3', time: '11:30', status: 'disponivel', active: true },
    { id: 'slot-4', time: '13:00', status: 'bloqueado', note: 'Almoço & Descanso', active: true },
    { id: 'slot-5', time: '14:00', status: 'disponivel', active: true },
    { id: 'slot-6', time: '15:30', status: 'disponivel', active: true },
    { id: 'slot-7', time: '16:30', status: 'bloqueado', note: 'Autoclave & Higienização', active: true },
    { id: 'slot-8', time: '18:00', status: 'disponivel', active: true },
    { id: 'slot-9', time: '19:30', status: 'disponivel', active: true }
  ]);

  const [internalDays, setInternalDays] = useState<DayScheduleConfig[]>([
    { dayKey: 'ter', dayLabel: 'Terça-feira', isOpen: true, openTime: '09:00', closeTime: '19:30' },
    { dayKey: 'qua', dayLabel: 'Quarta-feira', isOpen: true, openTime: '09:00', closeTime: '19:30' },
    { dayKey: 'qui', dayLabel: 'Quinta-feira', isOpen: true, openTime: '09:00', closeTime: '19:30' },
    { dayKey: 'sex', dayLabel: 'Sexta-feira', isOpen: true, openTime: '09:00', closeTime: '20:00' },
    { dayKey: 'sab', dayLabel: 'Sábado', isOpen: true, openTime: '08:30', closeTime: '18:00' },
    { dayKey: 'dom', dayLabel: 'Domingo', isOpen: false, openTime: '00:00', closeTime: '00:00' },
    { dayKey: 'seg', dayLabel: 'Segunda-feira', isOpen: false, openTime: '00:00', closeTime: '00:00' }
  ]);

  const [internalBlacklist, setInternalBlacklist] = useState<BlacklistEntry[]>([]);

  const [internalAddress, setInternalAddress] = useState<StudioAddressConfig>(STUDIO_ADDRESS);

  const slots = propTimeSlots || internalSlots;
  const days = propDaySchedules || internalDays;
  const blacklist = propBlacklist || internalBlacklist;
  const address = propStudioAddress || internalAddress;

  const updateSlots = (newSlots: TimeSlotConfig[]) => {
    if (onUpdateTimeSlots) onUpdateTimeSlots(newSlots);
    else setInternalSlots(newSlots);
  };

  const updateDays = (newDays: DayScheduleConfig[]) => {
    if (onUpdateDaySchedules) onUpdateDaySchedules(newDays);
    else setInternalDays(newDays);
  };

  const updateBlacklist = (newBl: BlacklistEntry[]) => {
    if (onUpdateBlacklist) onUpdateBlacklist(newBl);
    else setInternalBlacklist(newBl);
  };

  // State for Pix & Settings
  const [pixKey, setPixKey] = useState('+5512974062241');
  const [pixBeneficiary, setPixBeneficiary] = useState('Angelica do Carmo E. Silva ME');
  const [depositAmount, setDepositAmount] = useState('50');
  const [prepayDiscount, setPrepayDiscount] = useState('5');
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);

  // Time Slot Management UI State
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newSlotNote, setNewSlotNote] = useState('');
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editingSlotTime, setEditingSlotTime] = useState('');
  const [editingSlotNote, setEditingSlotNote] = useState('');

  // Blacklist Management UI State
  const [newBlPhone, setNewBlPhone] = useState('');
  const [newBlName, setNewBlName] = useState('');
  const [newBlReason, setNewBlReason] = useState('Faltou sem avisar (No-show)');
  const [showAddBlModal, setShowAddBlModal] = useState(false);

  // Address edit state
  const [addressText, setAddressText] = useState(address.fullAddress);

  // WhatsApp Business API State
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [waConfig, setWaConfig] = useState<WhatsAppConfig>(() => {
    if (propWhatsappConfig) return propWhatsappConfig;
    try {
      const saved = localStorage.getItem('angelica_whatsapp_config');
      return saved ? JSON.parse(saved) : { autoSendOnConfirm: true };
    } catch {
      return { autoSendOnConfirm: true };
    }
  });
  const [waTemplate, setWaTemplate] = useState<string>(() => {
    return waConfig.customTemplate || `✨ *Confirmação de Agendamento • Espaço Angélica do Carmo* ✨

Olá, *{cliente}*! Seu horário no nosso atelier privativo foi *CONFIRMADO* com sucesso na grade. 💅✨

📋 *Detalhes do seu atendimento:*
• *Procedimento:* {servico}
• *Data:* {data}
• *Horário:* às {horario}
• *Valor:* {valor}
• *Sinal:* {sinal}

📍 *Endereço:* {endereco}

ℹ️ *Orientações importantes:*
• Pedimos a gentileza de chegar com 5 a 10 minutos de antecedência.
• Em caso de necessidade de remarcação, avise com antecedência mínima de 24 horas.

Qualquer dúvida, pode responder a esta mensagem. Mal podemos esperar para cuidar de você! 💕`;
  });
  const [waLogs, setWaLogs] = useState<any[]>([]);
  const [testPhone, setTestPhone] = useState<string>('12999998888');
  const [testClientName, setTestClientName] = useState<string>('Cliente VIP');
  const [isTestingWa, setIsTestingWa] = useState<boolean>(false);
  const [testWaFeedback, setTestWaFeedback] = useState<{ message: string; success: boolean; fallbackUrl?: string } | null>(null);
  const [showWaPreview, setShowWaPreview] = useState<boolean>(false);

  useEffect(() => {
    checkWhatsAppStatus().then(setWaStatus);
    fetchWhatsAppLogs().then(setWaLogs);
  }, []);

  const handleSaveWaConfig = () => {
    const updated: WhatsAppConfig = {
      ...waConfig,
      customTemplate: waTemplate
    };
    setWaConfig(updated);
    if (onUpdateWhatsappConfig) {
      onUpdateWhatsappConfig(updated);
    }
    try {
      localStorage.setItem('angelica_whatsapp_config', JSON.stringify(updated));
    } catch {}
    notify('Parâmetros da API do WhatsApp Business salvos!');
  };

  const handleTestWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) {
      alert('Informe um número de telefone para teste.');
      return;
    }
    setIsTestingWa(true);
    setTestWaFeedback(null);
    try {
      const res = await testWhatsAppMessage(testPhone, testClientName);
      setTestWaFeedback({
        message: res.message || (res.success ? 'Mensagem disparada com sucesso!' : 'Falha no disparo'),
        success: res.success,
        fallbackUrl: res.fallbackUrl
      });
      fetchWhatsAppLogs().then(setWaLogs);
      checkWhatsAppStatus().then(setWaStatus);
    } catch (err: any) {
      setTestWaFeedback({
        message: err.message || 'Erro ao conectar à API.',
        success: false
      });
    } finally {
      setIsTestingWa(false);
    }
  };

  const notify = (msg: string) => {
    setSavedSuccess(msg);
    setTimeout(() => setSavedSuccess(null), 4000);
  };

  // Handle Slot Actions
  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlotTime.trim()) return;

    const newSlot: TimeSlotConfig = {
      id: `slot-${Date.now()}`,
      time: newSlotTime.trim(),
      status: 'disponivel',
      note: newSlotNote.trim() || undefined,
      active: true
    };

    const sorted = [...slots, newSlot].sort((a, b) => a.time.localeCompare(b.time));
    updateSlots(sorted);
    setNewSlotTime('');
    setNewSlotNote('');
    notify(`Novo horário ${newSlot.time} adicionado à grade!`);
  };

  const handleToggleBlockSlot = (slotId: string) => {
    const updated = slots.map(s => {
      if (s.id === slotId) {
        const isCurrentlyBlocked = s.status === 'bloqueado' || s.status === 'autoclave' || s.status === 'almoco';
        return {
          ...s,
          status: isCurrentlyBlocked ? ('disponivel' as const) : ('bloqueado' as const),
          note: isCurrentlyBlocked ? undefined : 'Bloqueado no painel'
        };
      }
      return s;
    });
    updateSlots(updated);
    notify('Status de bloqueio do horário atualizado!');
  };

  const handleDeleteSlot = (slotId: string, time: string) => {
    if (confirm(`Deseja realmente remover o horário das ${time} da grade de atendimento?`)) {
      const updated = slots.filter(s => s.id !== slotId);
      updateSlots(updated);
      notify(`Horário das ${time} excluído.`);
    }
  };

  const handleStartEditSlot = (s: TimeSlotConfig) => {
    setEditingSlotId(s.id);
    setEditingSlotTime(s.time);
    setEditingSlotNote(s.note || '');
  };

  const handleSaveEditSlot = (slotId: string) => {
    const updated = slots.map(s => {
      if (s.id === slotId) {
        return {
          ...s,
          time: editingSlotTime.trim() || s.time,
          note: editingSlotNote.trim() || undefined
        };
      }
      return s;
    }).sort((a, b) => a.time.localeCompare(b.time));
    updateSlots(updated);
    setEditingSlotId(null);
    notify('Horário alterado com sucesso!');
  };

  // Handle Blacklist Actions
  const handleAddBlacklist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlPhone.trim()) return;

    const entry: BlacklistEntry = {
      id: `bl-${Date.now()}`,
      phone: newBlPhone.trim(),
      clientName: newBlName.trim() || 'Cliente Não Identificado',
      reason: newBlReason.trim(),
      addedDate: new Date().toLocaleDateString('pt-BR'),
      active: true,
      requires100Percent: true
    };

    updateBlacklist([entry, ...blacklist]);
    setShowAddBlModal(false);
    setNewBlPhone('');
    setNewBlName('');
    notify(`Número ${entry.phone} cadastrado na lista de pré-pagamento obrigatório!`);
  };

  const handleToggleBlacklist = (id: string) => {
    const updated = blacklist.map(b => b.id === id ? { ...b, active: !b.active } : b);
    updateBlacklist(updated);
    notify('Status de restrição atualizado!');
  };

  const handleDeleteBlacklist = (id: string, name: string) => {
    if (confirm(`Remover restrição de ${name}?`)) {
      updateBlacklist(blacklist.filter(b => b.id !== id));
      notify(`Restrição de ${name} removida.`);
    }
  };

  // Handle Day Schedule Toggle
  const handleToggleDay = (dayKey: string) => {
    const updated = days.map(d => d.dayKey === dayKey ? { ...d, isOpen: !d.isOpen } : d);
    updateDays(updated);
    notify('Dia de expediente atualizado!');
  };
  return (
    <div className="flex flex-col gap-6 max-w-5xl text-[#49382E]">
      <div>
        <div className="flex items-center gap-1.5 text-[#D4AF37] mb-1">
          <span className="material-symbols-outlined text-[18px]">tune</span>
          <span className="font-jakarta text-[11px] uppercase tracking-widest font-bold">
            Diretrizes &amp; Parâmetros Operacionais
          </span>
        </div>
        <h1 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold tracking-tight">
          Configurações do Ateliê &amp; Grade de Atendimento
        </h1>
        <p className="font-jakarta text-xs sm:text-sm text-[#786C63]">
          Gerencie horários de atendimento, bloqueios preventivos de agenda, números com exigência de pré-pagamento via Pix e endereço do estúdio.
        </p>
      </div>

      {savedSuccess && (
        <div className="p-3.5 rounded-xl bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            <span>{savedSuccess}</span>
          </div>
          <button onClick={() => setSavedSuccess(null)} className="cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Box 1: HORÁRIOS DE ATENDIMENTO (Adicionar, Editar, Deletar, Bloquear) */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37]">schedule</span>
            <div>
              <h3 className="font-syne text-lg text-[#49382E] font-bold">
                Grade de Horários de Atendimento
              </h3>
              <span className="font-jakarta text-xs text-[#786C63]">
                Adicione, edite, exclua ou bloqueie horários. As clientes só verão os horários ativos e desbloqueados.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-[#FBF2D5] text-[#3C2F00] font-jakarta text-[11px] font-bold border border-[#E8D9B5]">
              {slots.filter(s => s.status === 'disponivel').length} Disponíveis / {slots.length} Total
            </span>
          </div>
        </div>

        {/* Quick Add Slot Form */}
        <form onSubmit={handleAddSlot} className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full sm:w-36">
            <label className="block text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold mb-1">
              Novo Horário
            </label>
            <input
              type="time"
              required
              value={newSlotTime}
              onChange={e => setNewSlotTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] text-xs font-bold focus:border-[#D4AF37] outline-none"
            />
          </div>

          <div className="flex-1 w-full">
            <label className="block text-[10px] text-[#786C63] uppercase tracking-wider font-bold mb-1">
              Nota / Observação do Horário (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Turno matutino, Vaga extra, etc."
              value={newSlotNote}
              onChange={e => setNewSlotNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] text-xs focus:border-[#D4AF37] outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full sm:w-auto mt-auto px-5 py-2.5 rounded-xl bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>Adicionar Horário</span>
          </button>
        </form>

        {/* Time Slots Grid with Edit, Delete, and Block Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {slots.map(slot => {
            const isBlocked = slot.status === 'bloqueado' || slot.status === 'autoclave' || slot.status === 'almoco';
            const isEditing = editingSlotId === slot.id;

            return (
              <div
                key={slot.id}
                className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-2.5 shadow-xs ${
                  isBlocked
                    ? 'bg-red-50/60 border-red-200'
                    : 'bg-[#FFFFFF] border-[#E8D9B5] hover:border-[#D4AF37]'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={editingSlotTime}
                        onChange={e => setEditingSlotTime(e.target.value)}
                        className="px-2 py-1 rounded bg-[#FFFFFF] text-[#49382E] border border-[#D4AF37] text-xs font-bold"
                      />
                      <input
                        type="text"
                        placeholder="Nota"
                        value={editingSlotNote}
                        onChange={e => setEditingSlotNote(e.target.value)}
                        className="flex-1 px-2 py-1 rounded bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => handleSaveEditSlot(slot.id)}
                        className="px-3 py-1 rounded-full bg-[#D4AF37] text-[#3C2F00] text-xs font-bold cursor-pointer"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSlotId(null)}
                        className="px-2 py-1 text-xs text-[#786C63] cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">
                          schedule
                        </span>
                        <span className="font-syne text-lg font-bold text-[#49382E] tracking-wide">
                          {slot.time}
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-jakarta font-bold uppercase tracking-wider ${
                          isBlocked
                            ? 'bg-red-100 text-red-800 border border-red-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                      >
                        {isBlocked ? 'Bloqueado' : 'Disponível'}
                      </span>
                    </div>

                    {slot.note && (
                      <span className="text-[11px] text-[#786C63] italic">
                        {slot.note}
                      </span>
                    )}

                    <div className="pt-2 border-t border-[#E8D9B5] flex items-center justify-between gap-1">
                      {/* Block/Unblock Button */}
                      <button
                        type="button"
                        onClick={() => handleToggleBlockSlot(slot.id)}
                        className={`px-3 py-1 rounded-full text-[11px] font-jakarta font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          isBlocked
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300'
                            : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-300'
                        }`}
                        title={isBlocked ? 'Desbloquear para agendamento' : 'Bloquear horário'}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {isBlocked ? 'lock_open' : 'lock'}
                        </span>
                        <span>{isBlocked ? 'Desbloquear' : 'Bloquear'}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditSlot(slot)}
                          className="w-7 h-7 rounded-lg bg-[#F7EFEA] text-[#786C63] hover:text-[#D4AF37] flex items-center justify-center cursor-pointer border border-[#E8D9B5]"
                          title="Editar horário"
                        >
                          <span className="material-symbols-outlined text-[15px]">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(slot.id, slot.time)}
                          className="w-7 h-7 rounded-lg bg-[#F7EFEA] text-[#786C63] hover:text-red-600 flex items-center justify-center cursor-pointer border border-[#E8D9B5]"
                          title="Excluir horário"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Days of Week Operating Hours */}
        <div className="pt-4 border-t border-[#E8D9B5]">
          <span className="font-syne text-sm text-[#D4AF37] font-bold block mb-3">
            Dias de Abertura do Atelier:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {days.map(d => (
              <div
                key={d.dayKey}
                onClick={() => handleToggleDay(d.dayKey)}
                className={`p-3 rounded-xl border text-center cursor-pointer transition-all ${
                  d.isOpen
                    ? 'bg-[#FFFFFF] border-[#D4AF37] text-[#49382E] shadow-xs'
                    : 'bg-[#F7EFEA]/50 border-[#E8D9B5] text-[#A39A90]'
                }`}
              >
                <span className="block font-bold text-xs">{d.dayLabel}</span>
                <span className={`text-[10px] uppercase font-bold mt-1 block ${d.isOpen ? 'text-[#D4AF37]' : 'text-[#A39A90]'}`}>
                  {d.isOpen ? `${d.openTime} às ${d.closeTime}` : 'Fechado'}
                </span>
                <span className="text-[9px] text-[#786C63] mt-1 block">Clique p/ alternar</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Box 2: BLOQUEIO DE INADIMPLENTES & EXIGÊNCIA DE PRÉ-PAGAMENTO */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37]">no_accounts</span>
            <div>
              <h3 className="font-syne text-lg text-[#49382E] font-bold">
                Controle de Inadimplência &amp; Trava de Pré-Pagamento
              </h3>
              <span className="font-jakarta text-xs text-[#786C63]">
                Números cadastrados terão a agenda travada, exigindo 100% de Pré-pagamento via Pix para confirmação.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddBlModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-jakarta text-xs font-bold transition-all cursor-pointer self-start sm:self-auto shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">person_add_disabled</span>
            <span>+ Adicionar Inadimplente</span>
          </button>
        </div>

        {/* Warning Banner */}
        <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] flex items-start gap-3 text-xs text-[#786C63]">
          <span className="material-symbols-outlined text-[#D4AF37] text-[20px] shrink-0 mt-0.5">verified_user</span>
          <p>
            <strong>Como funciona:</strong> Ao tentar agendar pelo site com qualquer um dos números abaixo, o sistema detecta a inadimplência e emite um alerta formal. O agendamento só é aceito mediante <strong>Pré-pagamento Integral (100% via Pix)</strong>, protegendo o atelier contra no-shows recorrentes.
          </p>
        </div>

        {/* Blacklist Table */}
        <div className="divide-y divide-[#E8D9B5]">
          {blacklist.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#786C63]">
              <span className="material-symbols-outlined text-[28px] text-[#A39A90] block mb-1">
                verified_user
              </span>
              Nenhum número cadastrado na lista de inadimplência.
              <p className="text-[11px] text-[#786C63] mt-0.5">
                Utilize o botão acima para adicionar contatos caso haja ocorrência de no-show sem aviso.
              </p>
            </div>
          ) : (
            blacklist.map(entry => (
              <div key={entry.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-red-600 text-[18px]">phone_disabled</span>
                    <span className="font-syne text-sm font-bold text-[#49382E]">{entry.clientName}</span>
                    <span className="font-jakarta text-xs text-[#D4AF37] font-semibold">({entry.phone})</span>
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold border border-red-300">
                      100% Pix Obrigatório
                    </span>
                  </div>
                  <p className="font-jakarta text-xs text-[#786C63]">
                    Motivo: {entry.reason} • Cadastrado em {entry.addedDate}
                  </p>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleToggleBlacklist(entry.id)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                      entry.active
                        ? 'bg-red-100 text-red-800 border border-red-300 hover:bg-red-200'
                        : 'bg-[#F7EFEA] text-[#786C63] border border-[#E8D9B5]'
                    }`}
                  >
                    {entry.active ? 'Restrição Ativa' : 'Pausado'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBlacklist(entry.id, entry.clientName)}
                    className="w-7 h-7 rounded-lg bg-[#F7EFEA] text-[#786C63] hover:text-red-600 flex items-center justify-center cursor-pointer border border-[#E8D9B5]"
                    title="Remover da lista"
                  >
                    <span className="material-symbols-outlined text-[15px]">delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Box 3: ENDEREÇO OFICIAL & LOCALIZAÇÃO */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5]">
          <span className="material-symbols-outlined text-[#D4AF37]">pin_drop</span>
          <h3 className="font-syne text-lg text-[#49382E] font-bold">
            Endereço Oficial do Atelier
          </h3>
        </div>

        <div className="space-y-3 font-jakarta text-xs">
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Endereço Completo (exibido na página de agendamento, rodapé e comprovantes)
            </label>
            <input
              type="text"
              value={addressText}
              onChange={e => {
                setAddressText(e.target.value);
                if (onUpdateStudioAddress) {
                  onUpdateStudioAddress({
                    ...address,
                    fullAddress: e.target.value
                  });
                }
              }}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] font-medium outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href={address.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] hover:border-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">map</span>
              <span>Testar Rota Google Maps</span>
            </a>
            <a
              href={address.wazeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] hover:border-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">directions_car</span>
              <span>Testar Rota Waze</span>
            </a>
          </div>
        </div>
      </div>

      {/* Box 4: CHAVE PIX & PARÂMETROS DE PRÉ-PAGAMENTO */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5]">
          <span className="material-symbols-outlined text-[#D4AF37]">payments</span>
          <h3 className="font-syne text-lg text-[#49382E] font-bold">
            Chave Pix Oficial &amp; Regras de Sinal
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-jakarta text-xs">
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Chave Pix Oficial (Telefone ou CNPJ)
            </label>
            <input
              type="text"
              value={pixKey}
              onChange={e => setPixKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Nome do Favorecido / Razão Social
            </label>
            <input
              type="text"
              value={pixBeneficiary}
              onChange={e => setPixBeneficiary(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Valor do Sinal de Reserva Padrão (R$)
            </label>
            <input
              type="number"
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Desconto VIP p/ Pré-pagamento Total 100% (%)
            </label>
            <input
              type="number"
              value={prepayDiscount}
              onChange={e => setPrepayDiscount(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-[#E8D9B5]">
          <button
            type="button"
            onClick={() => notify('Configurações de Pix e parâmetros salvas com sucesso!')}
            className="px-6 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md"
          >
            Salvar Regras de Pix
          </button>
        </div>
      </div>

      {/* Box 6: INTEGRAÇÃO WHATSAPP BUSINESS API (META CLOUD API) */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#25D366] text-[26px]">chat</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-syne text-lg text-[#49382E] font-bold">
                  Integração WhatsApp Business API
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-jakarta font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                  {waStatus?.isConfigured ? 'Meta Cloud API Conectada' : 'Simulação Inteligente Pronta'}
                </span>
              </div>
              <span className="font-jakarta text-xs text-[#786C63]">
                Envio automático de mensagens de confirmação para o WhatsApp cadastrado da cliente no momento da aprovação do agendamento.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                checkWhatsAppStatus().then(setWaStatus);
                fetchWhatsAppLogs().then(setWaLogs);
                notify('Status da API do WhatsApp atualizado!');
              }}
              className="px-3 py-1.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] text-xs font-semibold border border-[#E8D9B5] flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">refresh</span>
              <span>Verificar Conexão</span>
            </button>
          </div>
        </div>

        {/* API Credentials & Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] text-[#786C63] uppercase font-bold tracking-wider block">
              Provedor &amp; Versão
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-syne text-sm text-[#49382E] font-bold">
                Meta Cloud API ({waStatus?.apiVersion || 'v20.0'})
              </span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              API oficial do WhatsApp com envio direto por servidores da Meta Graph.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] text-[#786C63] uppercase font-bold tracking-wider block">
              Identificador (Phone Number ID)
            </span>
            <div className="font-jakarta text-xs font-bold text-[#49382E] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">badge</span>
              <span>{waStatus?.phoneNumberIdConfigured ? 'ID Vinculado no Servidor' : 'Injetável via .env'}</span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              Variável: <code className="text-[#D4AF37] font-mono">WHATSAPP_PHONE_NUMBER_ID</code>
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] text-[#786C63] uppercase font-bold tracking-wider block">
              Token de Acesso Permanente
            </span>
            <div className="font-jakarta text-xs font-bold text-[#49382E] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">key</span>
              <span>{waStatus?.tokenConfigured ? 'Token Meta Autenticado' : 'Injetável via .env'}</span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              Variável: <code className="text-[#D4AF37] font-mono">WHATSAPP_API_TOKEN</code>
            </p>
          </div>
        </div>

        {/* Automation Switch & Options */}
        <div className="p-4 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0 text-[#3C2F00]">
              <span className="material-symbols-outlined text-[20px]">bolt</span>
            </div>
            <div>
              <h4 className="font-syne text-sm font-bold text-[#49382E]">
                Disparo Automático de Confirmação
              </h4>
              <p className="font-jakarta text-xs text-[#786C63]">
                Quando ativado, ao clicar em "Aprovar Sinal" no painel Pix ou criar um agendamento confirmado, o sistema envia a confirmação instantaneamente para o WhatsApp cadastrado da cliente.
              </p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={waConfig.autoSendOnConfirm}
              onChange={e => setWaConfig(prev => ({ ...prev, autoSendOnConfirm: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-[#E8D9B5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#25D366]"></div>
          </label>
        </div>

        {/* Message Template Editor */}
        <div className="space-y-3 font-jakarta text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <label className="block text-[#49382E] font-bold text-sm">
                Texto da Mensagem de Confirmação Automática
              </label>
              <span className="text-[#786C63] text-xs">
                Personalize a mensagem enviada à cliente. Use as variáveis dinâmicas abaixo:
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowWaPreview(!showWaPreview)}
                className="px-3 py-1 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] font-semibold hover:border-[#D4AF37] cursor-pointer transition-colors flex items-center gap-1 shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">
                  {showWaPreview ? 'edit' : 'visibility'}
                </span>
                <span>{showWaPreview ? 'Editar Texto' : 'Ver Prévia Realista'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setWaTemplate(`✨ *Confirmação de Agendamento • Espaço Angélica do Carmo* ✨\n\nOlá, *{cliente}*! Seu horário no nosso atelier privativo foi *CONFIRMADO* com sucesso na grade. 💅✨\n\n📋 *Detalhes do seu atendimento:*\n• *Procedimento:* {servico}\n• *Data:* {data}\n• *Horário:* às {horario}\n• *Valor:* {valor}\n• *Sinal:* {sinal}\n\n📍 *Endereço:* {endereco}\n\nℹ️ *Orientações importantes:*\n• Pedimos a gentileza de chegar com 5 a 10 minutos de antecedência.\n• Em caso de necessidade de remarcação, avise com antecedência mínima de 24 horas.\n\nQualquer dúvida, pode responder a esta mensagem. Mal podemos esperar para cuidar de você! 💕`);
                  notify('Modelo padrão restaurado!');
                }}
                className="px-3 py-1 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#786C63] hover:text-[#49382E] font-semibold cursor-pointer transition-colors"
              >
                Restaurar Padrão
              </button>
            </div>
          </div>

          {/* Tags Chips */}
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5]">
            <span className="text-[10px] text-[#786C63] uppercase font-bold mr-1">Inserir:</span>
            {[
              { tag: '{cliente}', label: 'Nome da Cliente' },
              { tag: '{servico}', label: 'Procedimento' },
              { tag: '{data}', label: 'Data' },
              { tag: '{horario}', label: 'Horário' },
              { tag: '{valor}', label: 'Valor' },
              { tag: '{sinal}', label: 'Sinal Pix' },
              { tag: '{endereco}', label: 'Endereço Atelier' }
            ].map(item => (
              <button
                key={item.tag}
                type="button"
                onClick={() => setWaTemplate(prev => prev + ` ${item.tag} `)}
                className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] hover:bg-[#F7EFEA] text-[#49382E] border border-[#E8D9B5] font-mono text-[11px] font-semibold hover:border-[#D4AF37] cursor-pointer transition-all shadow-xs"
                title={`Inserir ${item.label}`}
              >
                {item.tag}
              </button>
            ))}
          </div>

          {showWaPreview ? (
            /* Realistic WhatsApp Chat Bubble Preview */
            <div className="p-4 rounded-2xl bg-[#EFEAE2] border border-[#E8D9B5] flex justify-center">
              <div className="max-w-md w-full bg-[#FFFFFF] rounded-2xl p-4 shadow-sm relative border-l-4 border-[#25D366]">
                <div className="flex items-center gap-2 mb-2 pb-2 border-gray-100">
                  <div className="w-7 h-7 rounded-full bg-[#25D366] text-white flex items-center justify-center font-bold text-xs">
                    A
                  </div>
                  <div>
                    <span className="font-bold text-xs text-gray-900 block">Espaço Angélica do Carmo</span>
                    <span className="text-[10px] text-gray-500">Conta Comercial Oficial</span>
                  </div>
                </div>
                <div className="whitespace-pre-line text-xs text-gray-800 leading-relaxed font-sans">
                  {waTemplate
                    .replace(/{cliente}/g, 'Fernanda Vasconcelos')
                    .replace(/{servico}/g, 'Alongamento em Fibra Slim')
                    .replace(/{data}/g, 'Quinta, 14 Nov')
                    .replace(/{horario}/g, '14:30')
                    .replace(/{valor}/g, 'R$ 220,00')
                    .replace(/{sinal}/g, 'R$ 50,00 (Liquidado via Pix)')
                    .replace(/{endereco}/g, address.fullAddress)}
                </div>
                <div className="mt-2 text-right flex items-center justify-end gap-1 text-[10px] text-gray-400">
                  <span>14:31</span>
                  <span className="material-symbols-outlined text-[14px] text-[#34B7F1]">done_all</span>
                </div>
              </div>
            </div>
          ) : (
            <textarea
              rows={9}
              value={waTemplate}
              onChange={e => setWaTemplate(e.target.value)}
              className="w-full p-4 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] text-xs font-mono focus:border-[#D4AF37] outline-none leading-relaxed"
            />
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveWaConfig}
              className="px-5 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-xs"
            >
              Salvar Template &amp; Preferências
            </button>
          </div>
        </div>

        {/* Live Test Dispatcher */}
        <div className="p-5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37]">send</span>
            <div>
              <h4 className="font-syne text-sm font-bold text-[#49382E]">
                Testar Envio Automático Imediato
              </h4>
              <p className="font-jakarta text-xs text-[#786C63]">
                Envie uma mensagem de teste em tempo real para qualquer número para verificar a entrega da API.
              </p>
            </div>
          </div>

          <form onSubmit={handleTestWhatsApp} className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#49382E] mb-1">
                Nome para Teste
              </label>
              <input
                type="text"
                value={testClientName}
                onChange={e => setTestClientName(e.target.value)}
                placeholder="Ex: Amanda Silva"
                className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E8D9B5] text-xs text-[#49382E] focus:border-[#D4AF37] outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#49382E] mb-1">
                Telefone com DDD *
              </label>
              <input
                type="tel"
                required
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="Ex: 12974062241"
                className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E8D9B5] text-xs font-bold text-[#49382E] focus:border-[#D4AF37] outline-none"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isTestingWa}
                className="w-full py-2 px-4 rounded-lg bg-[#25D366] hover:bg-[#20BA5A] text-white font-jakarta text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isTestingWa ? 'sync' : 'outgoing_mail'}
                </span>
                <span>{isTestingWa ? 'Disparando...' : 'Enviar Teste Agora'}</span>
              </button>
            </div>
          </form>

          {testWaFeedback && (
            <div
              className={`p-3 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                testWaFeedback.success
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-900 border border-amber-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {testWaFeedback.success ? 'check_circle' : 'info'}
                </span>
                <span>{testWaFeedback.message}</span>
              </div>
              {testWaFeedback.fallbackUrl && (
                <a
                  href={testWaFeedback.fallbackUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 rounded-full bg-white text-[#25D366] font-bold text-[11px] border border-[#25D366] hover:bg-emerald-50 transition-colors inline-flex items-center gap-1 self-start sm:self-auto"
                >
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  <span>Abrir no WhatsApp Web</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Real-time Dispatch Logs Table */}
        <div className="space-y-3 font-jakarta text-xs">
          <div className="flex items-center justify-between pb-1 border-b border-[#E8D9B5]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">history</span>
              <h4 className="font-syne text-sm font-bold text-[#49382E]">
                Histórico Recente de Disparos Automáticos ({waLogs.length})
              </h4>
            </div>
            <button
              type="button"
              onClick={() => fetchWhatsAppLogs().then(setWaLogs)}
              className="text-[11px] text-[#786C63] hover:text-[#D4AF37] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              <span>Atualizar Histórico</span>
            </button>
          </div>

          {waLogs.length === 0 ? (
            <div className="p-6 text-center text-[#786C63] bg-[#FDFBF9] rounded-xl border border-[#E8D9B5]">
              Nenhuma mensagem disparada recentemente. Ao confirmar agendamentos ou testar o envio, o registro aparecerá aqui.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8D9B5]">
              <table className="w-full text-left font-jakarta text-xs">
                <thead className="bg-[#F7EFEA] text-[#786C63] uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-3">Data / Hora</th>
                    <th className="p-3">Destinatário</th>
                    <th className="p-3">WhatsApp</th>
                    <th className="p-3">Procedimento</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8D9B5] bg-[#FFFFFF]">
                  {waLogs.slice(0, 10).map((log: any) => (
                    <tr key={log.id} className="hover:bg-[#FDFBF9] transition-colors">
                      <td className="p-3 text-[#786C63] whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {new Date(log.timestamp).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="p-3 font-bold text-[#49382E] whitespace-nowrap">
                        {log.recipientName}
                      </td>
                      <td className="p-3 font-mono text-[#D4AF37] font-semibold whitespace-nowrap">
                        {log.recipientPhone}
                      </td>
                      <td className="p-3 text-[#786C63]">
                        {log.serviceTitle || 'Confirmação de Horário'}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            log.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : log.status === 'simulated'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-red-100 text-red-800 border border-red-300'
                          }`}
                        >
                          {log.status === 'sent' ? 'Enviado Meta' : log.status === 'simulated' ? 'Simulado (OK)' : 'Falha'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Inadimplente Modal */}
      {showAddBlModal && (
        <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] p-6 rounded-3xl max-w-md w-full border border-[#E8D9B5] shadow-2xl relative">
            <button
              type="button"
              onClick={() => setShowAddBlModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-red-600 text-[24px]">person_add_disabled</span>
              <h3 className="font-syne text-lg text-[#49382E] font-bold">Bloquear Número Inadimplente</h3>
            </div>

            <form onSubmit={handleAddBlacklist} className="space-y-3 font-jakarta text-xs">
              <div>
                <label className="block text-[#49382E] mb-1 font-semibold">Nome da Cliente</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Patrícia G. Mendes"
                  value={newBlName}
                  onChange={e => setNewBlName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-[#49382E] mb-1 font-semibold">Número de WhatsApp / Telefone *</label>
                <input
                  type="tel"
                  required
                  placeholder="Ex: (12) 99111-2233"
                  value={newBlPhone}
                  onChange={e => setNewBlPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] font-bold outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-[#49382E] mb-1 font-semibold">Motivo do Bloqueio</label>
                <select
                  value={newBlReason}
                  onChange={e => setNewBlReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
                >
                  <option value="Faltou sem avisar (No-show com perda de grade)">Faltou sem avisar (No-show com perda de grade)</option>
                  <option value="Cancelamento em cima da hora recorrente">Cancelamento em cima da hora recorrente</option>
                  <option value="Histórico de pendência financeira">Histórico de pendência financeira</option>
                  <option value="Atraso superior a 30 minutos recorrente">Atraso superior a 30 minutos recorrente</option>
                </select>
              </div>

              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-800">
                Ao cadastrar este número, o sistema exigirá <strong>100% de Pré-pagamento via Pix</strong> no ato do agendamento para liberar a vaga.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8D9B5]">
                <button
                  type="button"
                  onClick={() => setShowAddBlModal(false)}
                  className="px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white font-bold transition-all shadow-xs cursor-pointer"
                >
                  Cadastrar Bloqueio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
