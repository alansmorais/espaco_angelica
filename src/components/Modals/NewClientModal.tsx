import React, { useState } from 'react';
import { ClientProfile } from '../../types';

interface NewClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveClient: (client: ClientProfile) => void;
}

export const NewClientModal: React.FC<NewClientModalProps> = ({
  isOpen,
  onClose,
  onSaveClient
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tier, setTier] = useState<'VIP Club' | 'Frequente' | 'Atrasada' | '1ª Sessão'>('1ª Sessão');
  const [preferredShape, setPreferredShape] = useState('Almond Clássica');
  const [laminaType, setLaminaType] = useState('Normal / Saudável');
  const [oiliness, setOiliness] = useState('Média');
  const [allergies, setAllergies] = useState('Nenhuma');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const initials = name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const newClient: ClientProfile = {
      id: `client-${Date.now()}`,
      name: name.trim(),
      initials,
      phone: phone || '+55 (31) 99999-0000',
      tier,
      status: 'nova',
      lastVisit: 'Hoje (Cadastro Inicial)',
      lastService: 'Primeira Sessão • Anamnese',
      nextMaintenanceDays: 25,
      daysRemainingOrOverdue: 'Em dia (25 dias rest.)',
      isOverdue: false,
      ltv: 220,
      ltvFormatted: 'R$ 220',
      laminaType,
      oiliness,
      allergies,
      onycholysis: 'Lâmina íntegra',
      preferredShape,
      preferredColor: 'Tons Nude / Translúcidos',
      products: {
        preparer: 'Desidratador Max + Primer Sem Ácido Cuccio',
        baseGel: 'Fiber Base Gel Haute Pink Vòlia',
        tensionPoint: 'Gel Construtor Hard Classic',
        topCoat: 'Diamond Brilho Espelhado Ultra Selante'
      },
      privateNotes: notes || 'Cliente cadastrada via painel do atelier.',
      photos: {
        before: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCx_rEi_UhKA9-_uSnYwn0DfAJJQGz1LAw9T0NiTwid1EcmTr8f-tq6mW-a_GjskCwZ4-n_GQbcC4HPGiyaWJO2olSrLrGpmWrdFzTAHOAm8dm9zA_4fjkJC1FqiMZ9y84aisY_vGPkECzbRweafqz8uMA5owDJOv8abwHPQZChg8naDuEjAZ4JjNIhgvlyePEbCEvg40zfxerSf8ZR8_lp3aU7ijrhhj0aJkCCATCqyTKQ5RkOTBJlmQ',
        after: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB9fu0-mSu5SLLQ4IXmP9Bdj_OUpz9cYqHfb8-5FH66xGvUmGD3G1dGHcD4tEDEu5J9TBdV24sQo_dyO0Cwfxy7BxncI52OB9yMOX16yeLXNQJSwNpymDarzg2OWTDcrqY1pDYlAUSGtdJWx8NscnxW4ntg24wFotJLcABhZjHnYZmhexTS44aYMxoCScYcZGgHzjRqIEbLpGkgbK7rf_6mDlWhV6kZkL8gm9_dw2oZZLbfdbM9Dh_SHQ'
      }
    };

    onSaveClient(newClient);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-[#E8D9B5] shadow-2xl relative flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">person_add</span>
            <h3 className="font-syne text-lg text-[#49382E] font-bold">Cadastrar Nova Cliente &amp; Anamnese</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-jakarta text-xs">
          <div>
            <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Nome Completo *</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Priscila Guimarães"
              className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">WhatsApp</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(12) 98765-4321"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Perfil / Categoria</label>
              <select
                value={tier}
                onChange={e => setTier(e.target.value as any)}
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              >
                <option value="1ª Sessão">1ª Sessão</option>
                <option value="Frequente">Frequente</option>
                <option value="VIP Club">VIP Club</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Formato Preferido</label>
              <input
                type="text"
                value={preferredShape}
                onChange={e => setPreferredShape(e.target.value)}
                placeholder="Ex: Almond Fina"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Tipo de Lâmina</label>
              <input
                type="text"
                value={laminaType}
                onChange={e => setLaminaType(e.target.value)}
                placeholder="Ex: Levemente côncava / frágil"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Oleosidade Cutânea</label>
              <select
                value={oiliness}
                onChange={e => setOiliness(e.target.value)}
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              >
                <option value="Baixa">Baixa</option>
                <option value="Média">Média</option>
                <option value="Alta (Requer Primer Ácido)">Alta (Requer Primer Ácido)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Alergias Relatadas</label>
              <input
                type="text"
                value={allergies}
                onChange={e => setAllergies(e.target.value)}
                placeholder="Ex: Nenhuma alergia relatada"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Observações Técnicas Privadas</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Sensibilidade a calor de cabine LED, preferências de acabamento..."
              className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2 rounded-xl border border-[#E8D9B5] outline-none resize-none focus:border-[#D4AF37]"
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
              className="px-5 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-bold hover:bg-[#E5C158] shadow-md cursor-pointer transition-all"
            >
              Salvar Ficha Técnica
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
