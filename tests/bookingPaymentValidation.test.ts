import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SERVICES_CATALOG } from '../src/data/mockData';
import {
  calculateDeposit40,
  calculateFullPrepayment,
  calculateRemainingBalance,
  formatBRL
} from '../src/services/notificationTemplates';
import { buildPreBookingEmailPayload } from '../src/services/emailNotificationService';
import { Appointment, BlacklistEntry } from '../src/types';
import {
  OFFICIAL_SERVICES_BY_ID,
  validateBookingPaymentCoherence
} from '../server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assertCondition(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const EXPECTED_SERVICES = [
  { id: 'alongamento-fibra-slim', title: 'Alongamento em Fibra Slim', price: 220, deposit40: 88, full100: 220, balance40: 132 },
  { id: 'manutencao-fibra-vidro', title: 'Manutenção Fibra de Vidro', price: 140, deposit40: 56, full100: 140, balance40: 84 },
  { id: 'blindagem-diamante', title: 'Blindagem Diamante & Banho Gel', price: 130, deposit40: 52, full100: 130, balance40: 78 },
  { id: 'esmaltacao-gel-premium', title: 'Esmaltação em Gel Premium', price: 95, deposit40: 38, full100: 95, balance40: 57 },
  { id: 'nail-art-encapsulada', title: 'Nail Art Autoral & Encapsulada', price: 50, deposit40: 20, full100: 50, balance40: 30 },
  { id: 'spa-das-maos-ouro', title: 'Spa das Mãos & Esfoliação', price: 85, deposit40: 34, full100: 85, balance40: 51 }
];

let passedTests = 0;

function runTest(name: string, fn: () => void): void {
  fn();
  passedTests += 1;
  console.log(`PASS: ${name}`);
}

// 1. Catálogo oficial: alinhamento entre mockData.ts e server.ts para os 6 serviços
runTest('Catálogo oficial possui exatamente os 6 procedimentos alinhados entre frontend e backend', () => {
  assertCondition(SERVICES_CATALOG.length === 6, `Esperado 6 serviços em SERVICES_CATALOG, encontrado ${SERVICES_CATALOG.length}`);
  assertCondition(
    Object.keys(OFFICIAL_SERVICES_BY_ID).length === 6,
    `Esperado 6 serviços em OFFICIAL_SERVICES_BY_ID, encontrado ${Object.keys(OFFICIAL_SERVICES_BY_ID).length}`
  );

  for (const expected of EXPECTED_SERVICES) {
    const frontendService = SERVICES_CATALOG.find(s => s.id === expected.id);
    assertCondition(Boolean(frontendService), `Serviço ${expected.id} ausente em SERVICES_CATALOG`);
    assertCondition(frontendService!.title === expected.title, `Título divergente em frontend para ${expected.id}`);
    assertCondition(frontendService!.price === expected.price, `Preço divergente em frontend para ${expected.id}`);

    const backendService = OFFICIAL_SERVICES_BY_ID[expected.id];
    assertCondition(Boolean(backendService), `Serviço ${expected.id} ausente em OFFICIAL_SERVICES_BY_ID`);
    assertCondition(backendService.title === expected.title, `Título divergente em backend para ${expected.id}`);
    assertCondition(backendService.price === expected.price, `Preço divergente em backend para ${expected.id}`);
  }
});

// 2. Sinal de 40% e pré-pagamento de 100% para todos os 6 serviços
runTest('Validação de sinal_40 (40%) e pre_pagamento_100 (100% sem desconto) para os 6 serviços', () => {
  for (const expected of EXPECTED_SERVICES) {
    const frontendService = SERVICES_CATALOG.find(s => s.id === expected.id)!;

    const calc40 = calculateDeposit40(frontendService.price);
    const calc100 = calculateFullPrepayment(frontendService.price);
    const balance40 = calculateRemainingBalance(frontendService.price, calc40);
    const balance100 = calculateRemainingBalance(frontendService.price, calc100);

    assertCondition(calc40 === expected.deposit40, `Sinal 40% incorreto para ${expected.id}: ${calc40} !== ${expected.deposit40}`);
    assertCondition(calc100 === expected.full100, `Pagamento 100% incorreto para ${expected.id}: ${calc100} !== ${expected.full100}`);
    assertCondition(balance40 === expected.balance40, `Saldo restante 40% incorreto para ${expected.id}: ${balance40} !== ${expected.balance40}`);
    assertCondition(balance100 === 0, `Saldo restante 100% deve ser 0 para ${expected.id}`);

    // Simula criação do Appointment e payload de notificação para sinal_40
    const apt40: Appointment = {
      id: `apt-40-${expected.id}`,
      clientName: 'Cliente Teste',
      clientPhone: '(12) 99123-4567',
      serviceId: frontendService.id,
      serviceTitle: frontendService.title,
      servicePrice: frontendService.priceFormatted,
      serviceDuration: frontendService.duration,
      date: 'Quinta, 14 Nov',
      time: '11:30',
      status: 'pendente_pix',
      depositAmount: calc40,
      depositStatus: 'pendente',
      paymentMode: 'sinal_40'
    };
    const payload40 = buildPreBookingEmailPayload(apt40);
    assertCondition(payload40.serviceId === expected.id, `serviceId não propagado no payload para ${expected.id}`);

    const res40 = validateBookingPaymentCoherence(payload40);
    assertCondition(res40.valid === true, `Backend rejeitou sinal_40 legítimo para ${expected.id}: ${res40.error}`);
    assertCondition(res40.verifiedServiceId === expected.id, `verifiedServiceId incorreto para ${expected.id}`);
    assertCondition(res40.verifiedDepositAmount === expected.deposit40, `verifiedDepositAmount incorreto para ${expected.id}`);
    assertCondition(res40.verifiedPaymentMode === 'sinal_40', `verifiedPaymentMode incorreto para ${expected.id}`);
    assertCondition(
      res40.verifiedServicePrice === `R$ ${formatBRL(expected.price)}`,
      `verifiedServicePrice incorreto para ${expected.id}: ${res40.verifiedServicePrice}`
    );

    // Simula criação do Appointment e payload de notificação para pre_pagamento_100
    const apt100: Appointment = {
      ...apt40,
      id: `apt-100-${expected.id}`,
      depositAmount: calc100,
      paymentMode: 'pre_pagamento_100'
    };
    const payload100 = buildPreBookingEmailPayload(apt100);
    const res100 = validateBookingPaymentCoherence(payload100);
    assertCondition(res100.valid === true, `Backend rejeitou pre_pagamento_100 legítimo para ${expected.id}: ${res100.error}`);
    assertCondition(res100.verifiedDepositAmount === expected.full100, `verifiedDepositAmount 100% incorreto para ${expected.id}`);
    assertCondition(res100.verifiedPaymentMode === 'pre_pagamento_100', `verifiedPaymentMode 100% incorreto para ${expected.id}`);
  }
});

// 3. Confirmação de que NÃO existe mais desconto de 5% no pré-pagamento integral
runTest('Remoção do desconto de 5%: valores com 5% de desconto são rejeitados no backend e removidos do BookingWizard', () => {
  for (const expected of EXPECTED_SERVICES) {
    const legacyDiscounted95 = Math.round(expected.price * 0.95);
    const resDiscounted = validateBookingPaymentCoherence({
      serviceId: expected.id,
      serviceTitle: expected.title,
      servicePrice: `R$ ${formatBRL(expected.price)}`,
      depositAmount: legacyDiscounted95,
      paymentMode: 'pre_pagamento_100'
    });
    assertCondition(
      resDiscounted.valid === false,
      `Backend deveria rejeitar valor com desconto de 5% (R$ ${legacyDiscounted95}) para ${expected.id}`
    );
  }

  const wizardSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/BookingWizard.tsx'),
    'utf-8'
  );
  assertCondition(!wizardSource.includes('-5% OFF'), 'Selo "-5% OFF" ainda presente em BookingWizard.tsx');
  assertCondition(!wizardSource.includes('prepayDiscountPercent'), 'Variável prepayDiscountPercent ainda presente em BookingWizard.tsx');
  assertCondition(!wizardSource.includes('discountedFullPrice'), 'Variável discountedFullPrice ainda presente em BookingWizard.tsx');
});

// 4. Rejeição de ID desconhecido e proibição de fallback para preço do navegador
runTest('Rejeição de serviceId desconhecido ou serviço fora do catálogo (sem fallback para servicePrice)', () => {
  const unknownIdRes = validateBookingPaymentCoherence({
    serviceId: 'servico-inexistente-hacker',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 220,00',
    depositAmount: 88,
    paymentMode: 'sinal_40'
  });
  assertCondition(unknownIdRes.valid === false, 'Backend aceitou serviceId desconhecido');

  const spoofedCustomServiceRes = validateBookingPaymentCoherence({
    serviceTitle: 'Procedimento Inventado No Navegador',
    servicePrice: 'R$ 10,00',
    depositAmount: 4,
    paymentMode: 'sinal_40'
  });
  assertCondition(
    spoofedCustomServiceRes.valid === false,
    'Backend usou servicePrice enviado pelo navegador como fallback para serviço desconhecido'
  );

  const mismatchedTitleAndIdRes = validateBookingPaymentCoherence({
    serviceId: 'spa-das-maos-ouro',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 85,00',
    depositAmount: 34,
    paymentMode: 'sinal_40'
  });
  assertCondition(
    mismatchedTitleAndIdRes.valid === false,
    'Backend aceitou payload com serviceId e serviceTitle divergentes'
  );
});

// 5. Rejeição de preço adulterado ou valor de pagamento incorreto
runTest('Rejeição de preço adulterado ou valor de sinal/pagamento incorreto', () => {
  // Preço adulterado no navegador (tentando pagar 40% sobre R$ 50 para Alongamento de R$ 220)
  const spoofedPriceRes = validateBookingPaymentCoherence({
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 50,00',
    depositAmount: 20,
    paymentMode: 'sinal_40'
  });
  assertCondition(spoofedPriceRes.valid === false, 'Backend aceitou servicePrice adulterado');

  // Sinal antigo fixo de R$ 50,00 para procedimento cujo 40% não é R$ 50
  const legacy50Res = validateBookingPaymentCoherence({
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 220,00',
    depositAmount: 50,
    paymentMode: 'sinal_40'
  });
  assertCondition(legacy50Res.valid === false, 'Backend aceitou sinal fixo incorreto de R$ 50 para Alongamento (R$ 220)');

  // Modalidade pre_pagamento_100 enviando apenas 40%
  const underpaid100Res = validateBookingPaymentCoherence({
    serviceId: 'blindagem-diamante',
    serviceTitle: 'Blindagem Diamante & Banho Gel',
    servicePrice: 'R$ 130,00',
    depositAmount: 52,
    paymentMode: 'pre_pagamento_100'
  });
  assertCondition(underpaid100Res.valid === false, 'Backend aceitou valor de 40% quando paymentMode era pre_pagamento_100');

  // Modalidade sinal_40 enviando 100%
  const overpaid40Res = validateBookingPaymentCoherence({
    serviceId: 'blindagem-diamante',
    serviceTitle: 'Blindagem Diamante & Banho Gel',
    servicePrice: 'R$ 130,00',
    depositAmount: 130,
    paymentMode: 'sinal_40'
  });
  assertCondition(overpaid40Res.valid === false, 'Backend aceitou valor de 100% quando paymentMode era sinal_40');
});

// 6. Rejeição de modalidade inválida
runTest('Rejeição de modalidades de pagamento inválidas', () => {
  for (const invalidMode of ['sinal_50', 'desconto_5', 'gratis', 'pix_parcial', '']) {
    const res = validateBookingPaymentCoherence({
      serviceId: 'alongamento-fibra-slim',
      serviceTitle: 'Alongamento em Fibra Slim',
      servicePrice: 'R$ 220,00',
      depositAmount: 88,
      paymentMode: invalidMode
    });
    assertCondition(res.valid === false, `Backend aceitou modalidade inválida "${invalidMode}"`);
  }
});

// 7. Fluxos de agendamento manual e clientes com restrição (blacklist)
runTest('Verificação de clientes com restrição (blacklist) e agendamento manual', () => {
  const blacklist: BlacklistEntry[] = [
    {
      id: 'bl-1',
      phone: '(12) 98888-7777',
      clientName: 'Cliente Restrita',
      reason: 'No-show reincidente',
      addedDate: '10/11/2024',
      active: true,
      requires100Percent: true
    }
  ];

  const incomingPhone = '12988887777';
  const matched = blacklist.find(b => {
    if (!b.active) return false;
    const bDigits = b.phone.replace(/\D/g, '');
    return bDigits.length >= 8 && (incomingPhone.includes(bDigits) || bDigits.includes(incomingPhone));
  });
  const isInadimplente = Boolean(matched);
  assertCondition(isInadimplente === true, 'Falha na detecção de cliente na lista de restrição');

  // Mesmo que na UI o estado inicial fosse sinal_40, effectivePaymentMode força pre_pagamento_100 (100% integral)
  const requestedMode: 'sinal_40' | 'pre_pagamento_100' = 'sinal_40';
  const effectivePaymentMode = isInadimplente ? 'pre_pagamento_100' : requestedMode;
  assertCondition(effectivePaymentMode === 'pre_pagamento_100', 'Cliente restrita deve exigir pre_pagamento_100');

  for (const service of SERVICES_CATALOG) {
    const manualOrRestrictedApt: Appointment = {
      id: `apt-restricted-${service.id}`,
      clientName: 'Cliente Restrita',
      clientPhone: '(12) 98888-7777',
      serviceId: service.id,
      serviceTitle: service.title,
      servicePrice: service.priceFormatted,
      serviceDuration: service.duration,
      date: 'Quinta, 14 Nov',
      time: '14:30',
      status: 'pendente_pix',
      depositAmount: calculateFullPrepayment(service.price),
      depositStatus: 'pendente',
      paymentMode: effectivePaymentMode,
      requiresFullPrepayment: isInadimplente,
      isBlacklisted: isInadimplente
    };

    const payload = buildPreBookingEmailPayload(manualOrRestrictedApt);
    const check = validateBookingPaymentCoherence(payload);
    assertCondition(check.valid === true, `Falha ao validar agendamento 100% de cliente restrita para ${service.id}`);
    assertCondition(check.verifiedDepositAmount === service.price, `Valor validado para cliente restrita deve ser 100% (${service.price})`);

    // Garante que enviar flags falsas de elegibilidade pelo navegador não permite desconto em pre_pagamento_100
    const spoofedEligibilityCheck = validateBookingPaymentCoherence({
      ...payload,
      isBlacklisted: false,
      requiresFullPrepayment: false,
      isInadimplente: false,
      depositAmount: Math.round(service.price * 0.95)
    });
    assertCondition(
      spoofedEligibilityCheck.valid === false,
      `Flags de elegibilidade enviadas pelo cliente não podem conceder desconto para ${service.id}`
    );
  }
});

console.log(`\nTodos os ${passedTests} grupos de testes automatizados passaram com sucesso.`);
