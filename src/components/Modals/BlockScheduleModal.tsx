import React, { useState } from 'react';

interface BlockScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmBlock: (reason: string, timeSpan: string) => void;
}

export const BlockScheduleModal: React.FC<BlockScheduleModalProps> = ({
  isOpen,
  onClose,
  onConfirmBlock
}) => {
  const [reason, setReason] = useState('Esterilização Autoclave');
  const [startTime, setStartTime] = useState('13:30');
  const [endTime, setEndTime] = useState('14:30');
  const [notes, setNotes] = useState('Higienização terminal dos instrumentais cirúrgicos');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirmBlock(reason, `${startTime} às ${endTime}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-[#E8D9B5] shadow-2xl relative flex flex-col gap-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">block</span>
            <h3 className="font-syne text-lg text-[#49382E] font-bold">Bloquear Grade ou Horário</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <p className="font-jakarta text-xs text-[#786C63]">
          Bloqueios impedem novas reservas na área pública de agendamento online e marcam seu calendário visualmente.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-jakarta text-xs">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase text-[#786C63] font-bold">Motivo do Bloqueio</label>
            <div className="grid grid-cols-3 gap-2">
              {['Esterilização Autoclave', 'Almoço Privativo', 'Folga / Descanso'].map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setReason(opt)}
                  className={`py-2 px-2.5 rounded-xl font-bold text-[11px] transition-all cursor-pointer text-center border ${
                    reason === opt
                      ? 'bg-[#FBF2D5] text-[#3C2F00] border-[#D4AF37]'
                      : 'bg-[#FDFBF9] text-[#786C63] border-[#E8D9B5] hover:bg-[#F7EFEA]'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Data</label>
              <input
                type="text"
                defaultValue="Quarta, 13 Nov"
                className="bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Horário</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-1/2 bg-[#FDFBF9] text-[#49382E] px-2 py-2.5 rounded-xl text-center border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
                />
                <span className="text-[#786C63]">às</span>
                <input
                  type="text"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-1/2 bg-[#FDFBF9] text-[#49382E] px-2 py-2.5 rounded-xl text-center border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-[#786C63] font-bold">Observações Internas</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E8D9B5]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-bold hover:bg-[#E5C158] shadow-md cursor-pointer transition-all"
            >
              Confirmar Bloqueio
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
