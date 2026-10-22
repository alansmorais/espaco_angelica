/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  SERVICES_CATALOG,
  INITIAL_TODAY_APPOINTMENTS,
  INITIAL_CLIENTS,
  INITIAL_TIME_SLOTS,
  INITIAL_DAY_SCHEDULES,
  INITIAL_BLACKLIST,
  STUDIO_ADDRESS
} from './data/mockData';
import {
  Service,
  Appointment,
  ClientProfile,
  TimeSlotConfig,
  DayScheduleConfig,
  BlacklistEntry,
  StudioAddressConfig,
  WhatsAppConfig
} from './types';
import { sendAppointmentWhatsAppConfirmation } from './services/whatsappService';
import { playDiscreteAdminNotificationSound, registerUserInteraction } from './services/soundNotificationService';
import { calculateDeposit40, formatBRL } from './services/notificationTemplates';
import {
  deleteRemoteAppointment,
  fetchRemoteAppointments,
  fetchRemoteAppointmentsDetailed
} from './services/emailNotificationService';

// Public Components
import { HeaderPublic } from './components/HeaderPublic';
import { HeroSection } from './components/HeroSection';
import { ServiceCatalog } from './components/ServiceCatalog';
import { BookingWizard } from './components/BookingWizard';
import { GallerySection } from './components/GallerySection';
import { LocationSection } from './components/LocationSection';
import { FooterPublic } from './components/FooterPublic';
import { AboutModal } from './components/Modals/AboutModal';
import { FAQModal } from './components/Modals/FAQModal';

// Admin Components
import { AdminSidebar, AdminTab } from './components/Admin/AdminSidebar';
import { AdminHeader } from './components/Admin/AdminHeader';
import { OverviewTab } from './components/Admin/OverviewTab';
import { CalendarTab } from './components/Admin/CalendarTab';
import { PixReconciliationTab } from './components/Admin/PixReconciliationTab';
import { ClientsTab } from './components/Admin/ClientsTab';
import { FinancialTab } from './components/Admin/FinancialTab';
import { SettingsTab } from './components/Admin/SettingsTab';

// Modals
import { ManualBookingModal } from './components/Modals/ManualBookingModal';
import { BlockScheduleModal } from './components/Modals/BlockScheduleModal';
import { ExtraEncaixeModal } from './components/Modals/ExtraEncaixeModal';
import { NewClientModal } from './components/Modals/NewClientModal';

export default function App() {
  // Mode: 'public' (Client) vs 'admin' (Executive Atelier)
  const [appMode, setAppMode] = useState<'public' | 'admin'>('public');

  // Admin Login Modal & Session State (volatile, never stored permanently or in bundle)
  const [adminLoginModalOpen, setAdminLoginModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminLoginError, setAdminLoginError] = useState<string | null>(null);
  const [isVerifyingAdminLogin, setIsVerifyingAdminLogin] = useState(false);
  const [adminSessionToken, setAdminSessionToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('angelica_admin_session') || '';
    } catch {
      return '';
    }
  });

  const [isLoadingRemoteAppointments, setIsLoadingRemoteAppointments] = useState(false);
  const [remoteAppointmentsError, setRemoteAppointmentsError] = useState<string | null>(null);
  const [localOnlyCount, setLocalOnlyCount] = useState<number>(0);

  const calculateLocalOnlyCount = (remoteList: Appointment[]) => {
    try {
      const raw = localStorage.getItem('angelica_appointments_local_archive') || localStorage.getItem('angelica_appointments');
      if (!raw) {
        setLocalOnlyCount(0);
        return;
      }
      const localList: Appointment[] = JSON.parse(raw);
      const remoteIds = new Set(remoteList.map(a => a.id));
      const localOnly = localList.filter(a => !remoteIds.has(a.id));
      setLocalOnlyCount(localOnly.length);
      if (localOnly.length > 0) {
        localStorage.setItem('angelica_appointments_local_archive', JSON.stringify(localOnly));
      } else {
        localStorage.removeItem('angelica_appointments_local_archive');
      }
    } catch {
      setLocalOnlyCount(0);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const entered = adminPasswordInput.trim();
    if (!entered) return;

    setIsVerifyingAdminLogin(true);
    setAdminLoginError(null);

    try {
      const result = await fetchRemoteAppointmentsDetailed(entered);
      if (result.success) {
        setAdminSessionToken(entered);
        try {
          sessionStorage.setItem('angelica_admin_session', entered);
        } catch {}
        setAppointments(result.appointments);
        setRemoteAppointmentsError(null);
        setAdminLoginModalOpen(false);
        setAdminPasswordInput('');
        setAppMode('admin');
        calculateLocalOnlyCount(result.appointments);
      } else if (result.statusCode === 401) {
        setAdminLoginError('Senha administrativa incorreta ou não configurada no servidor. Acesso não autorizado.');
      } else {
        setAdminLoginError(
          result.error || 'Falha de comunicação ao verificar credencial com o servidor administrativo. Acesso negado.'
        );
      }
    } catch (err: any) {
      setAdminLoginError('Erro de conexão ao verificar credencial administrativa.');
    } finally {
      setIsVerifyingAdminLogin(false);
    }
  };

  const refreshRemoteAppointments = async () => {
    const token = adminSessionToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');
    if (!token) return;
    setIsLoadingRemoteAppointments(true);
    setRemoteAppointmentsError(null);
    try {
      const result = await fetchRemoteAppointmentsDetailed(token);
      if (result.success) {
        setAppointments(result.appointments);
        calculateLocalOnlyCount(result.appointments);
      } else {
        setRemoteAppointmentsError(result.error || 'Erro ao sincronizar com o servidor.');
      }
    } catch (err: any) {
      setRemoteAppointmentsError('Falha de rede ao sincronizar com a planilha do Google Sheets.');
    } finally {
      setIsLoadingRemoteAppointments(false);
    }
  };

  const handleAdminLogout = () => {
    try {
      sessionStorage.removeItem('angelica_admin_session');
    } catch {}
    setAdminSessionToken('');
    setAppMode('public');
  };

  const handleExportLocalBackup = () => {
    try {
      const raw = localStorage.getItem('angelica_appointments_local_archive') || localStorage.getItem('angelica_appointments');
      if (!raw) return;
      const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_agendamentos_locais_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao exportar backup local:', err);
    }
  };

  // Admin Active Tab
  const [adminTab, setAdminTab] = useState<AdminTab>('visao-geral');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [adminSearch, setAdminSearch] = useState<string>('');

  // 1 & 2: Services State (Shared between Public Catalog & Admin Price/Photo Manager)
  const [services, setServices] = useState<Service[]>(() => {
    try {
      const saved = localStorage.getItem('angelica_services');
      return saved ? JSON.parse(saved) : SERVICES_CATALOG;
    } catch {
      return SERVICES_CATALOG;
    }
  });

  const activeServices = services.filter(s => s.active !== false);
  const [selectedService, setSelectedService] = useState<Service>(
    activeServices[0] || services[0] || SERVICES_CATALOG[0]
  );

  // 4: Operating Hours & Time Slots State (Add, Edit, Delete, Block)
  const [timeSlots, setTimeSlots] = useState<TimeSlotConfig[]>(() => {
    try {
      const saved = localStorage.getItem('angelica_timeslots');
      return saved ? JSON.parse(saved) : INITIAL_TIME_SLOTS;
    } catch {
      return INITIAL_TIME_SLOTS;
    }
  });
  const [daySchedules, setDaySchedules] = useState<DayScheduleConfig[]>(() => {
    try {
      const saved = localStorage.getItem('angelica_dayschedules');
      return saved ? JSON.parse(saved) : INITIAL_DAY_SCHEDULES;
    } catch {
      return INITIAL_DAY_SCHEDULES;
    }
  });

  // 6: Inadimplentes Blacklist State (Requires 100% Pre-payment via Pix)
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>(() => {
    try {
      const saved = localStorage.getItem('angelica_blacklist');
      return saved ? JSON.parse(saved) : INITIAL_BLACKLIST;
    } catch {
      return INITIAL_BLACKLIST;
    }
  });

  // 3: Studio Address State (Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP)
  const [studioAddress, setStudioAddress] = useState<StudioAddressConfig>(() => {
    try {
      const saved = localStorage.getItem('angelica_address');
      return saved ? JSON.parse(saved) : STUDIO_ADDRESS;
    } catch {
      return STUDIO_ADDRESS;
    }
  });

  // Appointments & Clients State (Real data only, default empty)
  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    try {
      const saved = localStorage.getItem('angelica_appointments');
      return saved ? JSON.parse(saved) : INITIAL_TODAY_APPOINTMENTS;
    } catch {
      return INITIAL_TODAY_APPOINTMENTS;
    }
  });

  const [clients, setClients] = useState<ClientProfile[]>(() => {
    try {
      const saved = localStorage.getItem('angelica_clients');
      return saved ? JSON.parse(saved) : INITIAL_CLIENTS;
    } catch {
      return INITIAL_CLIENTS;
    }
  });

  // Save to localStorage whenever states change
  useEffect(() => {
    try {
      localStorage.setItem('angelica_services', JSON.stringify(services));
    } catch {}
  }, [services]);

  useEffect(() => {
    try {
      localStorage.setItem('angelica_timeslots', JSON.stringify(timeSlots));
    } catch {}
  }, [timeSlots]);

  useEffect(() => {
    try {
      localStorage.setItem('angelica_dayschedules', JSON.stringify(daySchedules));
    } catch {}
  }, [daySchedules]);

  useEffect(() => {
    try {
      localStorage.setItem('angelica_blacklist', JSON.stringify(blacklist));
    } catch {}
  }, [blacklist]);

  useEffect(() => {
    try {
      localStorage.setItem('angelica_address', JSON.stringify(studioAddress));
    } catch {}
  }, [studioAddress]);

  useEffect(() => {
    try {
      localStorage.setItem('angelica_appointments', JSON.stringify(appointments));
    } catch {}
  }, [appointments]);

  useEffect(() => {
    try {
      localStorage.setItem('angelica_clients', JSON.stringify(clients));
    } catch {}
  }, [clients]);

  // Centralized Appointments Synchronization (Cloud Run / Sheets)
  useEffect(() => {
    if (appMode !== 'admin') return;
    let isMounted = true;

    const syncRemote = async () => {
      const token = adminSessionToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');
      if (!token) return;

      try {
        setIsLoadingRemoteAppointments(true);
        const result = await fetchRemoteAppointmentsDetailed(token);
        if (!isMounted) return;

        if (result.success) {
          setRemoteAppointmentsError(null);
          setAppointments(result.appointments);
          calculateLocalOnlyCount(result.appointments);
        } else if (result.statusCode === 401) {
          try {
            sessionStorage.removeItem('angelica_admin_session');
          } catch {}
          setAdminSessionToken('');
          setAppMode('public');
          setAdminLoginError('Sessão administrativa expirada ou não autorizada pelo servidor. Faça login novamente.');
        } else {
          setRemoteAppointmentsError(result.error || 'Falha ao sincronizar com Google Sheets.');
        }
      } catch (err: any) {
        if (isMounted) {
          setRemoteAppointmentsError('Falha ao conectar ao servidor para sincronização.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingRemoteAppointments(false);
        }
      }
    };

    syncRemote();
    const interval = setInterval(syncRemote, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [appMode, adminSessionToken]);

  // WhatsApp Business API Config State
  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppConfig>(() => {
    try {
      const saved = localStorage.getItem('angelica_whatsapp_config');
      return saved ? JSON.parse(saved) : { autoSendOnConfirm: true };
    } catch {
      return { autoSendOnConfirm: true };
    }
  });

  const [waGlobalToast, setWaGlobalToast] = useState<{
    message: string;
    clientName: string;
    clientPhone: string;
    success: boolean;
    fallbackUrl?: string;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('angelica_whatsapp_config', JSON.stringify(whatsappConfig));
    } catch {}
  }, [whatsappConfig]);

  // Admin Real-time Pre-Booking Notification Toast State
  const [adminNewBookingToast, setAdminNewBookingToast] = useState<{
    id: string;
    clientName: string;
    serviceTitle: string;
    date: string;
    time: string;
    depositAmount: number;
  } | null>(null);

  // Set of appointment IDs already notified to avoid repeating alerts
  const seenNotificationIdsRef = React.useRef<Set<string>>(new Set());

  // On mount: mark existing appointments as already seen so we never trigger alerts for historical data
  useEffect(() => {
    appointments.forEach(a => seenNotificationIdsRef.current.add(a.id));
  }, []);

  // Helper to trigger alert when a new pre-booking arrives
  const notifyNewPreBooking = (apt: Appointment) => {
    if (seenNotificationIdsRef.current.has(apt.id)) return;
    seenNotificationIdsRef.current.add(apt.id);

    setAdminNewBookingToast({
      id: apt.id,
      clientName: apt.clientName,
      serviceTitle: apt.serviceTitle,
      date: apt.date,
      time: apt.time,
      depositAmount: apt.depositAmount
    });

    playDiscreteAdminNotificationSound();
  };

  // Real-time synchronization across browser tabs via storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'angelica_appointments' && e.newValue) {
        try {
          const updatedList: Appointment[] = JSON.parse(e.newValue);
          const newPending = updatedList.filter(
            a => a.status === 'pendente_pix' && !seenNotificationIdsRef.current.has(a.id)
          );

          setAppointments(updatedList);

          if (newPending.length > 0) {
            notifyNewPreBooking(newPending[0]);
          }
        } catch {}
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Register user interaction to unlock Web Audio API seamlessly
  useEffect(() => {
    const handleInteraction = () => {
      registerUserInteraction();
    };
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('touchstart', handleInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, []);

  // Modals state
  const [aboutModalOpen, setAboutModalOpen] = useState<boolean>(false);
  const [faqModalOpen, setFaqModalOpen] = useState<boolean>(false);
  const [manualBookingModalOpen, setManualBookingModalOpen] = useState<boolean>(false);
  const [blockModalOpen, setBlockModalOpen] = useState<boolean>(false);
  const [encaixeModalOpen, setEncaixeModalOpen] = useState<boolean>(false);
  const [newClientModalOpen, setNewClientModalOpen] = useState<boolean>(false);

  // Handlers for Services Management
  const handleUpdateService = (updated: Service) => {
    setServices(prev => prev.map(s => (s.id === updated.id ? updated : s)));
    if (selectedService.id === updated.id) {
      setSelectedService(updated);
    }
  };

  const handleAddService = (newService: Service) => {
    setServices(prev => [newService, ...prev]);
  };

  const handleDeleteService = (id: string) => {
    setServices(prev => {
      const remaining = prev.filter(s => s.id !== id);
      if (selectedService.id === id && remaining.length > 0) {
        setSelectedService(remaining[0]);
      }
      return remaining;
    });
  };

  // Handlers for client booking
  const handleSelectService = (service: Service) => {
    setSelectedService(service);
    const el = document.getElementById('wizard-agendamento');
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleBookingConfirmed = (newApt: Appointment) => {
    setAppointments(prev => [newApt, ...prev]);
    notifyNewPreBooking(newApt);

    // Automatically register or update client profile
    setClients(prev => {
      const normalizedPhone = newApt.clientPhone.replace(/\D/g, '');
      const existingIndex = prev.findIndex(c => c.phone.replace(/\D/g, '') === normalizedPhone);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          lastVisit: `${newApt.date} às ${newApt.time}`,
          lastService: newApt.serviceTitle
        };
        return updated;
      }

      const initials = newApt.clientName
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

      const newClientProfile: ClientProfile = {
        id: `client-${Date.now()}`,
        name: newApt.clientName,
        initials,
        phone: newApt.clientPhone,
        tier: '1ª Sessão',
        status: 'nova',
        lastVisit: `${newApt.date} às ${newApt.time}`,
        lastService: newApt.serviceTitle,
        nextMaintenanceDays: 21,
        daysRemainingOrOverdue: '21 dias rest.',
        isOverdue: false,
        ltv: newApt.depositAmount,
        ltvFormatted: `R$ ${formatBRL(newApt.depositAmount)}`,
        laminaType: newApt.nailCondition || 'Natural',
        oiliness: 'Média',
        allergies: 'Nenhuma informada',
        onycholysis: 'Lâmina íntegra',
        preferredShape: 'Almond Clássica',
        preferredColor: 'Tons Nude / Translúcidos',
        products: {
          preparer: 'Desidratador Max + Primer Sem Ácido',
          baseGel: 'Fiber Base Gel Haute Pink',
          tensionPoint: 'Gel Construtor Hard Classic',
          topCoat: 'Diamond Brilho Espelhado'
        },
        privateNotes: newApt.notes || 'Cliente cadastrada via agendamento online.'
      };

      return [newClientProfile, ...prev];
    });
  };

  const handleUpdateAppointment = async (updated: Appointment) => {
    const prevApt = appointments.find(a => a.id === updated.id);
    const isNowConfirmed = updated.status === 'confirmado' && (!prevApt || prevApt.status !== 'confirmado');

    setAppointments(prev => prev.map(a => (a.id === updated.id ? updated : a)));

    // If appointment became confirmed and auto-send is enabled
    if (isNowConfirmed && whatsappConfig.autoSendOnConfirm && updated.whatsappStatus !== 'enviado') {
      try {
        const res = await sendAppointmentWhatsAppConfirmation(
          updated,
          whatsappConfig.customTemplate,
          studioAddress.fullAddress
        );
        const withWa: Appointment = {
          ...updated,
          whatsappStatus: res.success ? 'enviado' : 'falha',
          whatsappSentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          whatsappLastMessage: res.previewText || res.message
        };
        setAppointments(prev => prev.map(a => (a.id === updated.id ? withWa : a)));
        setWaGlobalToast({
          message: res.message,
          clientName: updated.clientName,
          clientPhone: updated.clientPhone,
          success: res.success,
          fallbackUrl: res.fallbackUrl
        });
        setTimeout(() => setWaGlobalToast(null), 6000);
      } catch {}
    }
  };

  const handleDeleteAppointment = async (appointment: Appointment) => {
    const result = await deleteRemoteAppointment(appointment.id, adminSessionToken);
    if (!result.success) {
      throw new Error(result.error || 'Não foi possível excluir o agendamento.');
    }

    setAppointments(prev => prev.filter(a => a.id !== appointment.id));
    let archiveCount: number | null = null;
    for (const storageKey of ['angelica_appointments', 'angelica_appointments_local_archive']) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) continue;

        const storedAppointments: Appointment[] = JSON.parse(raw);
        const remaining = storedAppointments.filter(a => a.id !== appointment.id);
        if (remaining.length > 0) {
          localStorage.setItem(storageKey, JSON.stringify(remaining));
        } else {
          localStorage.removeItem(storageKey);
        }
        if (storageKey === 'angelica_appointments_local_archive') {
          archiveCount = remaining.length;
        }
      } catch (err) {
        console.error(`Não foi possível atualizar ${storageKey} após excluir o agendamento:`, err);
      }
    }
    if (archiveCount !== null) setLocalOnlyCount(archiveCount);
  };

  const handleUpdateClient = (updated: ClientProfile) => {
    setClients(prev => prev.map(c => (c.id === updated.id ? updated : c)));
  };

  const handleManualBookingSave = async (newApt: Appointment) => {
    // 1. Atualiza lista local imediatamente evitando duplicações
    setAppointments(prev => {
      const exists = prev.some(a => a.id === newApt.id);
      return exists ? prev.map(a => (a.id === newApt.id ? newApt : a)) : [newApt, ...prev];
    });

    // 2. Registra ou atualiza perfil da cliente no CRM do ateliê
    setClients(prev => {
      const normalizedPhone = newApt.clientPhone.replace(/\D/g, '');
      const existingIndex = prev.findIndex(c => c.phone.replace(/\D/g, '') === normalizedPhone);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          lastVisit: `${newApt.date} às ${newApt.time}`,
          lastService: newApt.serviceTitle
        };
        return updated;
      }

      const initials = newApt.clientName
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

      const newClientProfile: ClientProfile = {
        id: `client-${Date.now()}`,
        name: newApt.clientName,
        initials,
        phone: newApt.clientPhone,
        tier: '1ª Sessão',
        status: 'nova',
        lastVisit: `${newApt.date} às ${newApt.time}`,
        lastService: newApt.serviceTitle,
        nextMaintenanceDays: 21,
        daysRemainingOrOverdue: '21 dias rest.',
        isOverdue: false,
        ltv: newApt.depositAmount,
        ltvFormatted: `R$ ${formatBRL(newApt.depositAmount)}`,
        laminaType: newApt.nailCondition || 'Natural',
        oiliness: 'Média',
        allergies: 'Nenhuma informada',
        onycholysis: 'Lâmina íntegra',
        preferredShape: 'Almond Clássica',
        preferredColor: 'Tons Nude / Translúcidos',
        products: {
          preparer: 'Desidratador Max + Primer Sem Ácido',
          baseGel: 'Fiber Base Gel Haute Pink',
          tensionPoint: 'Gel Construtor Hard Classic',
          topCoat: 'Diamond Brilho Espelhado'
        },
        privateNotes: newApt.notes || 'Cliente cadastrada via agendamento manual administrativo.'
      };

      return [newClientProfile, ...prev];
    });

    // 3. Re-sincroniza imediatamente com a planilha oficial do Google Sheets (fonte da verdade)
    await refreshRemoteAppointments();

    if (newApt.whatsappStatus === 'enviado' || newApt.whatsappStatus === 'simulado') {
      setWaGlobalToast({
        message: `Confirmação de agendamento disparada via WhatsApp para ${newApt.clientName} (${newApt.clientPhone})!`,
        clientName: newApt.clientName,
        clientPhone: newApt.clientPhone,
        success: true
      });
      setTimeout(() => setWaGlobalToast(null), 6000);
    }
  };

  const handleNewClientSave = (newClient: ClientProfile) => {
    setClients(prev => [newClient, ...prev]);
  };

  const handleBlockConfirm = (reason: string, timeSpan: string) => {
    const blockApt: Appointment = {
      id: `block-${Date.now()}`,
      clientName: 'Protocolo Ateliê',
      clientPhone: '',
      serviceTitle: reason,
      servicePrice: 'R$ 0,00',
      serviceDuration: timeSpan,
      date: 'Quarta, 13 Nov',
      time: timeSpan.split(' ')[0] || '13:30',
      status: 'bloqueado',
      depositAmount: 0,
      depositStatus: 'liquidado',
      isAutoclave: true,
      blockReason: reason
    };
    setAppointments(prev => [...prev, blockApt]);

    // Mark corresponding slot as blocked
    const timeMatch = timeSpan.split(' ')[0];
    if (timeMatch) {
      setTimeSlots(prev =>
        prev.map(s =>
          s.time.startsWith(timeMatch)
            ? { ...s, status: 'bloqueado', note: reason }
            : s
        )
      );
    }
  };

  const handleExtraEncaixeConfirm = (name: string, procedure: string, dateTime: string, feeApplied: boolean) => {
    const encaixePrice = feeApplied ? 265 : 220;
    const encaixeApt: Appointment = {
      id: `encaixe-${Date.now()}`,
      clientName: name,
      clientPhone: '',
      serviceTitle: `${procedure} ${feeApplied ? '(+ Taxa Urgência)' : ''}`,
      servicePrice: feeApplied ? 'R$ 265,00' : 'R$ 220,00',
      serviceDuration: '1h 30min',
      date: dateTime.split('•')[0]?.trim() || 'Qua, 13 Nov',
      time: dateTime.split('•')[1]?.trim() || '20:15',
      status: 'pendente_pix',
      depositAmount: calculateDeposit40(encaixePrice),
      depositStatus: 'pendente',
      paymentMode: 'sinal_40',
      isVip: true,
      clientInitials: name
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    };
    setAppointments(prev => [encaixeApt, ...prev]);
  };

  const pendingPixCount = appointments.filter(
    a => a.status === 'pendente_pix' || a.depositStatus === 'pendente'
  ).length;

  return (
    <div className="min-h-screen bg-[#FBF7F2] text-[#49382E] font-jakarta antialiased selection:bg-[#E8D3C7] selection:text-[#49382E]">
      {/* ========================================================
          PUBLIC CLIENT EXPERIENCE
      ======================================================== */}
      {appMode === 'public' && (
        <div className="w-full min-h-screen bg-[#FBF7F2] flex flex-col pb-20 sm:pb-12">
          {/* Public Header */}
          <HeaderPublic
            onOpenBooking={() => {
              const el = document.getElementById('wizard-agendamento');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            onOpenAdmin={() => setAdminLoginModalOpen(true)}
            onOpenAbout={() => setAboutModalOpen(true)}
            onOpenFAQ={() => setFaqModalOpen(true)}
            onOpenGallery={() => {
              const el = document.getElementById('galeria-nailart');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            onOpenServices={() => {
              const el = document.getElementById('catalogo-vitrine');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
          />

          {/* Main Public Content */}
          <main className="w-full pt-20 flex-1">
            {/* Hero Section with Official Gold Logo and Badges */}
            <HeroSection
              onStartBooking={() => {
                const el = document.getElementById('wizard-agendamento');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              onViewServices={() => {
                const el = document.getElementById('catalogo-vitrine');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
            />

            {/* Vitrine de Procedimentos (Uses Dynamic Services) */}
            <ServiceCatalog
              services={services}
              onSelectService={handleSelectService}
              selectedServiceId={selectedService.id}
            />

            {/* Fluxo de Agendamento Dinâmico (Wizard com Recorrência, Horários e Pré-pagamento Pix) */}
            <BookingWizard
              selectedService={activeServices.find(s => s.id === selectedService?.id) || activeServices[0] || services[0]}
              onBookingConfirmed={handleBookingConfirmed}
              timeSlots={timeSlots}
              blacklist={blacklist}
              studioAddress={studioAddress}
              services={activeServices}
              onSelectService={handleSelectService}
            />

            {/* Galeria de Criações Recentes */}
            <GallerySection />

            {/* Localização Nobre no Pontal da Cruz, São Sebastião SP */}
            <LocationSection />
          </main>

          {/* Public Footer */}
          <FooterPublic
            onOpenAbout={() => setAboutModalOpen(true)}
            onOpenFAQ={() => setFaqModalOpen(true)}
            onOpenAdmin={() => setAdminLoginModalOpen(true)}
          />

          {/* ONLY ONE Floating Action Button on Public Website: Centered "Agendar" */}
          <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('wizard-agendamento');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta font-bold text-xs sm:text-sm shadow-[0_10px_25px_-3px_rgba(212,175,55,0.45),0_4px_12px_rgba(73,56,46,0.15)] border border-[#E8D9B5] transition-all cursor-pointer transform active:scale-95 whitespace-nowrap min-h-[46px]"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
              title="Agendar Horário no Ateliê"
            >
              <span className="material-symbols-outlined text-[19px]">calendar_month</span>
              <span>Agendar</span>
            </button>
          </div>

          {/* Admin Login Modal (Password Protected) */}
          {adminLoginModalOpen && (
            <div className="fixed inset-0 z-50 bg-[#49382E]/60 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-md w-full border border-[#E8D9B5] shadow-2xl relative text-center animate-fadeIn">
                <button
                  type="button"
                  onClick={() => {
                    setAdminLoginModalOpen(false);
                    setAdminPasswordInput('');
                    setAdminLoginError(null);
                  }}
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>

                <div className="w-16 h-16 rounded-2xl bg-[#FBF2D5] text-[#D4AF37] mx-auto flex items-center justify-center mb-4 border border-[#E8D9B5]">
                  <span className="material-symbols-outlined text-[32px]">admin_panel_settings</span>
                </div>

                <h3 className="font-syne text-xl sm:text-2xl text-[#49382E] font-bold">
                  Painel Administrativo
                </h3>
                <p className="font-jakarta text-xs text-[#786C63] mt-1 mb-6">
                  Acesso restrito à profissional responsável. Informe a senha de segurança para continuar.
                </p>

                <form onSubmit={handleAdminLogin} className="space-y-4 text-left font-jakarta text-xs">
                  <div>
                    <label className="block text-[#49382E] font-semibold mb-1">Senha de Acesso</label>
                    <input
                      type="password"
                      required
                      autoFocus
                      disabled={isVerifyingAdminLogin}
                      placeholder="Digite a senha..."
                      value={adminPasswordInput}
                      onChange={e => setAdminPasswordInput(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
                    />
                  </div>

                  {adminLoginError && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-[11px] leading-relaxed">
                      {adminLoginError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isVerifyingAdminLogin}
                    className="w-full py-3.5 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-sm font-bold transition-all shadow-md cursor-pointer active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isVerifyingAdminLogin ? (
                      <>
                        <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                        <span>Verificando credencial...</span>
                      </>
                    ) : (
                      <span>Entrar no Painel do Ateliê</span>
                    )}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          ADMIN MASTER ARTIST EXPERIENCE
      ======================================================== */}
      {appMode === 'admin' && (
        <div className="w-full min-h-screen bg-[#FBF7F2] text-[#49382E] flex">
          {/* Admin Sidebar */}
          <AdminSidebar
            activeTab={adminTab}
            onSelectTab={setAdminTab}
            onSwitchToPublic={handleAdminLogout}
            isOpenMobile={mobileSidebarOpen}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            pendingPixCount={pendingPixCount}
          />

          {/* Admin Main Body Container */}
          <div className="flex-1 xl:pl-72 flex flex-col min-w-0 min-h-screen">
            {/* Admin Header */}
            <AdminHeader
              onOpenManualBooking={() => setManualBookingModalOpen(true)}
              onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
              onSwitchToPublic={handleAdminLogout}
              searchQuery={adminSearch}
              onSearchChange={setAdminSearch}
            />

            {/* Visual Notification Toast for New Pre-Booking */}
            {adminNewBookingToast && (
              <div className="fixed top-20 right-4 sm:right-6 z-50 max-w-md w-full bg-[#FFFFFF] border-2 border-[#D4AF37] shadow-2xl rounded-2xl p-4 flex items-start gap-3.5 animate-fadeIn">
                <div className="w-10 h-10 rounded-full bg-[#FBF2D5] text-[#D4AF37] flex items-center justify-center shrink-0 border border-[#E8D9B5]">
                  <span className="material-symbols-outlined text-[24px]">notifications_active</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-syne text-xs font-bold text-[#3C2F00] uppercase tracking-wider">
                      Novo Pré-Agendamento!
                    </span>
                    <button
                      type="button"
                      onClick={() => setAdminNewBookingToast(null)}
                      className="text-[#786C63] hover:text-[#49382E] text-xs cursor-pointer p-0.5"
                      title="Dispensar aviso"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                  <p className="font-jakarta text-xs text-[#49382E] font-bold">
                    {adminNewBookingToast.clientName}
                  </p>
                  <p className="font-jakarta text-[11px] text-[#786C63] mt-0.5">
                    {adminNewBookingToast.serviceTitle} • <strong>{adminNewBookingToast.date} às {adminNewBookingToast.time}</strong>
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] text-[10px] font-bold text-[#D4AF37]">
                      Sinal Pix: R$ {formatBRL(adminNewBookingToast.depositAmount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAdminTab('confirmacao-sinais-pix');
                        setAdminNewBookingToast(null);
                      }}
                      className="text-[11px] font-bold text-[#D4AF37] hover:underline flex items-center gap-0.5 cursor-pointer ml-auto"
                    >
                      <span>Conferir no Extrato</span>
                      <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Admin Tab View Content */}
            <main className="flex-1 pt-24 px-4 sm:px-6 lg:px-8 pb-16">
              {/* Sync Status Banner */}
              <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-white border border-[#E8D9B5] shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    remoteAppointmentsError
                      ? 'bg-amber-100 text-amber-700 border border-amber-300'
                      : isLoadingRemoteAppointments
                      ? 'bg-[#FBF2D5] text-[#D4AF37] border border-[#E8D9B5]'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    <span className={`material-symbols-outlined text-[20px] ${isLoadingRemoteAppointments ? 'animate-spin' : ''}`}>
                      {remoteAppointmentsError ? 'cloud_off' : isLoadingRemoteAppointments ? 'sync' : 'cloud_done'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-syne text-xs font-bold text-[#49382E]">
                        {remoteAppointmentsError ? 'Modo Offline (Contingência Local)' : 'Sincronizado na Nuvem'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        remoteAppointmentsError
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {appointments.length} {appointments.length === 1 ? 'agendamento' : 'agendamentos'}
                      </span>
                    </div>
                    <p className="font-jakarta text-[11px] text-[#786C63] mt-0.5">
                      {remoteAppointmentsError
                        ? `Aviso: ${remoteAppointmentsError}`
                        : 'Dados carregados da planilha oficial (aba Agendamentos).'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={refreshRemoteAppointments}
                    disabled={isLoadingRemoteAppointments}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F7EFEA] hover:bg-[#E8D9B5] text-[#49382E] font-jakarta text-xs font-semibold border border-[#E8D9B5] transition-all cursor-pointer disabled:opacity-50"
                    title="Atualizar dados do Google Sheets"
                  >
                    <span className={`material-symbols-outlined text-[16px] ${isLoadingRemoteAppointments ? 'animate-spin' : ''}`}>
                      refresh
                    </span>
                    <span>{isLoadingRemoteAppointments ? 'Sincronizando...' : 'Atualizar'}</span>
                  </button>
                </div>
              </div>

              {/* Local-only Unpersisted Appointments Warning Card */}
              {localOnlyCount > 0 && (
                <div className="mb-6 p-4 rounded-2xl bg-amber-50/90 border border-amber-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-amber-600 text-[22px] shrink-0 mt-0.5">
                      history_edu
                    </span>
                    <div>
                      <h4 className="font-syne text-xs font-bold text-amber-900">
                        Histórico Local Detectado ({localOnlyCount} agendamento{localOnlyCount > 1 ? 's' : ''} local{localOnlyCount > 1 ? 'is' : ''})
                      </h4>
                      <p className="font-jakarta text-[11px] text-amber-800 mt-0.5">
                        Existem registros armazenados apenas no navegador deste dispositivo que não constam na planilha do Google Sheets. Para protegê-los contra perda acidental, você pode exportar o arquivo de backup.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportLocalBackup}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-jakarta text-xs font-semibold shadow-sm transition-all cursor-pointer shrink-0"
                    title="Exportar backup dos agendamentos locais em arquivo JSON"
                  >
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    <span>Exportar Backup ({localOnlyCount})</span>
                  </button>
                </div>
              )}

              {adminTab === 'visao-geral' && (
                <OverviewTab
                  onOpenManualBooking={() => setManualBookingModalOpen(true)}
                  onNavigateToTab={setAdminTab}
                  onSelectAppointmentForReview={_name => {
                    setAdminTab('gestao-clientes');
                  }}
                  todayAppointments={appointments}
                />
              )}

              {adminTab === 'agenda-bloqueios' && (
                <CalendarTab
                  onOpenBlockModal={() => setBlockModalOpen(true)}
                  onOpenExtraEncaixeModal={() => setEncaixeModalOpen(true)}
                  onSelectClientForDossier={_name => {
                    setAdminTab('gestao-clientes');
                  }}
                  appointments={appointments}
                  timeSlots={timeSlots}
                  onUpdateAppointment={handleUpdateAppointment}
                  onDeleteAppointment={handleDeleteAppointment}
                />
              )}

              {adminTab === 'confirmacao-sinais-pix' && (
                <PixReconciliationTab
                  appointments={appointments}
                  onUpdateAppointment={handleUpdateAppointment}
                  onDeleteAppointment={handleDeleteAppointment}
                />
              )}

              {adminTab === 'gestao-clientes' && (
                <ClientsTab
                  clients={clients}
                  onOpenNewClientModal={() => setNewClientModalOpen(true)}
                  onBookNextForClient={_client => {
                    setManualBookingModalOpen(true);
                  }}
                  onUpdateClient={handleUpdateClient}
                />
              )}

              {adminTab === 'financeiro-servicos' && (
                <FinancialTab
                  services={services}
                  onUpdateService={handleUpdateService}
                  onAddService={handleAddService}
                  onDeleteService={handleDeleteService}
                  appointments={appointments}
                />
              )}

              {adminTab === 'configuracoes' && (
                <SettingsTab
                  timeSlots={timeSlots}
                  onUpdateTimeSlots={setTimeSlots}
                  daySchedules={daySchedules}
                  onUpdateDaySchedules={setDaySchedules}
                  blacklist={blacklist}
                  onUpdateBlacklist={setBlacklist}
                  studioAddress={studioAddress}
                  onUpdateStudioAddress={setStudioAddress}
                  whatsappConfig={whatsappConfig}
                  onUpdateWhatsappConfig={setWhatsappConfig}
                />
              )}
            </main>
          </div>
        </div>
      )}

      {/* Global Modals */}
      <AboutModal
        isOpen={aboutModalOpen}
        onClose={() => setAboutModalOpen(false)}
        onBookNow={() => {
          const el = document.getElementById('wizard-agendamento');
          el?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      <FAQModal
        isOpen={faqModalOpen}
        onClose={() => setFaqModalOpen(false)}
        onBookNow={() => {
          const el = document.getElementById('wizard-agendamento');
          el?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      <ManualBookingModal
        isOpen={manualBookingModalOpen}
        onClose={() => setManualBookingModalOpen(false)}
        onSaveAppointment={handleManualBookingSave}
        services={services}
        blacklist={blacklist}
        adminSessionToken={adminSessionToken}
      />

      <BlockScheduleModal
        isOpen={blockModalOpen}
        onClose={() => setBlockModalOpen(false)}
        onConfirmBlock={handleBlockConfirm}
      />

      <ExtraEncaixeModal
        isOpen={encaixeModalOpen}
        onClose={() => setEncaixeModalOpen(false)}
        onConfirmEncaixe={handleExtraEncaixeConfirm}
      />

      <NewClientModal
        isOpen={newClientModalOpen}
        onClose={() => setNewClientModalOpen(false)}
        onSaveClient={handleNewClientSave}
      />

      {/* WhatsApp Business Confirmation Notification Toast */}
      {waGlobalToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-[#FFFFFF] border border-[#E8D9B5] shadow-2xl rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-[#25D366]/15 text-[#25D366] flex items-center justify-center shrink-0 border border-[#25D366]/30">
            <span className="material-symbols-outlined text-[20px]">
              {waGlobalToast.success ? 'mark_chat_read' : 'info'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <span className="font-syne text-xs font-bold text-[#49382E]">
                WhatsApp Business API
              </span>
              <button
                type="button"
                onClick={() => setWaGlobalToast(null)}
                className="text-[#786C63] hover:text-[#49382E] text-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            <p className="font-jakarta text-[11px] text-[#786C63] leading-snug">
              {waGlobalToast.message}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[10px] font-bold text-[#D4AF37]">
                {waGlobalToast.clientName} ({waGlobalToast.clientPhone})
              </span>
              {waGlobalToast.fallbackUrl && (
                <a
                  href={waGlobalToast.fallbackUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[#25D366] font-bold hover:underline inline-flex items-center gap-0.5"
                >
                  <span>Abrir conversa</span>
                  <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
