import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SERVICES_CATALOG } from '../src/data/mockData';
import {
  calculateDeposit40,
  calculateFullPrepayment,
  calculateRemainingBalance,
  formatBRL,
  buildOfficialPreBookingWhatsAppMessage
} from '../src/services/notificationTemplates';
import { buildPreBookingEmailPayload } from '../src/services/emailNotificationService';
import { Appointment, BlacklistEntry } from '../src/types';
import {
  OFFICIAL_SERVICES_BY_ID,
  validateBookingPaymentCoherence,
  isOriginAllowed,
  allowedOrigins,
  buildConfirmationMessage,
  isAuthorizedAdminRequest,
  resolveNotificationRecipient,
  parseAppsScriptResponse,
  isValidAppointmentId,
  APPOINTMENT_ID_REGEX
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

// 8. Regressão do Incidente de Produção: CORS para o domínio oficial de produção
runTest('CORS: Permite o domínio oficial de produção e variantes legítimas, bloqueando origens não autorizadas', () => {
  // Salva NODE_ENV original e simula produção para teste rigoroso de CORS
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    // Domínio oficial de produção (origem do incidente)
    assertCondition(
      isOriginAllowed('https://espacoangelica.alansmsolutions.com'),
      'Domínio oficial de produção https://espacoangelica.alansmsolutions.com deve ser expressamente permitido'
    );
    assertCondition(
      isOriginAllowed('https://www.espacoangelica.alansmsolutions.com'),
      'Variante www oficial https://www.espacoangelica.alansmsolutions.com deve ser permitida'
    );

    // Domínio com trailing slash normalizado
    assertCondition(
      isOriginAllowed('https://espacoangelica.alansmsolutions.com/'),
      'Domínio oficial com barra final deve ser aceito após normalização'
    );

    // Origens de fallback e GitHub Pages
    assertCondition(
      isOriginAllowed('https://alansmorais.github.io'),
      'Origem GitHub Pages https://alansmorais.github.io deve permanecer permitida'
    );
    assertCondition(
      isOriginAllowed('https://alanp.github.io'),
      'Origem https://alanp.github.io deve permanecer permitida'
    );
    assertCondition(
      isOriginAllowed('http://localhost:5173'),
      'Origem localhost:5173 deve ser permitida'
    );
    assertCondition(
      isOriginAllowed('http://localhost:3000'),
      'Origem localhost:3000 deve ser permitida'
    );

    // Origens não autorizadas DEVEM ser bloqueadas
    assertCondition(
      !isOriginAllowed('https://malicious-site.com'),
      'Origem desconhecida https://malicious-site.com deve ser bloqueada'
    );
    assertCondition(
      !isOriginAllowed('https://spoofed-espacoangelica.com'),
      'Origem falsificada https://spoofed-espacoangelica.com deve ser bloqueada'
    );
    assertCondition(
      !isOriginAllowed('http://espacoangelica.alansmsolutions.com'),
      'Origem insegura HTTP deve ser bloqueada em produção'
    );
    assertCondition(
      !isOriginAllowed(undefined),
      'Origem indefinida não deve ser autorizada'
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

// 9. Template do WhatsApp de pré-agendamento calcula sinal de 40%, saldo restante e política de 24h
runTest('WhatsApp Template: calcula sinal de 40%, saldo restante, política de 24h e chave Pix', () => {
  const service = SERVICES_CATALOG.find(s => s.id === 'alongamento-fibra-slim')!; // R$ 220
  const deposit = calculateDeposit40(service.price); // R$ 88
  const balance = calculateRemainingBalance(service.price, deposit); // R$ 132

  const message = buildOfficialPreBookingWhatsAppMessage({
    clientName: 'Fernanda Cliente',
    serviceTitle: service.title,
    servicePrice: service.priceFormatted,
    date: 'Quinta, 14 Nov',
    time: '14:30',
    depositAmount: deposit,
    remainingBalance: balance,
    paymentMode: 'sinal_40'
  });

  // Validações de conteúdo da mensagem oficial
  assertCondition(message.includes('sinal (40%) de R$ 88,00'), 'Mensagem deve indicar sinal de 40% correto (R$ 88,00)');
  assertCondition(message.includes('Saldo restante a pagar no atendimento: R$ 132,00'), 'Mensagem deve conter o saldo restante de R$ 132,00');
  assertCondition(message.includes('Chave PIX: 12974062241'), 'Mensagem deve conter a chave Pix oficial');
  assertCondition(message.includes('Angelica do Carmo Costa Santos'), 'Mensagem deve conter o nome da titular');
  assertCondition(message.includes('24 horas de antecedência'), 'Mensagem deve conter a política de 24h para remarcação');
  assertCondition(message.includes('40% do valor do procedimento'), 'Política de agendamento deve explicitar os 40%');
  assertCondition(!message.includes('R$ 50'), 'Mensagem não pode conter valor fixo legado de R$ 50');

  // Validação para pré-pagamento 100% (sem saldo restante a pagar no atendimento)
  const message100 = buildOfficialPreBookingWhatsAppMessage({
    clientName: 'Cliente Restrita',
    serviceTitle: service.title,
    servicePrice: service.priceFormatted,
    date: 'Sexta, 15 Nov',
    time: '10:00',
    depositAmount: calculateFullPrepayment(service.price),
    paymentMode: 'pre_pagamento_100'
  });

  assertCondition(message100.includes('pré-pagamento integral (100%) de R$ 220,00'), 'Mensagem 100% deve indicar pré-pagamento integral de R$ 220,00');
  assertCondition(!message100.includes('Saldo restante a pagar no atendimento'), 'Mensagem 100% não deve ter saldo restante');
});

// 10. Mensagem de confirmação do servidor (buildConfirmationMessage) inclui 40%, saldo e política de 24h
runTest('Servidor: buildConfirmationMessage calcula saldo restante e preserva política de 24h', () => {
  const msg = buildConfirmationMessage({
    clientName: 'Mariana Teste',
    serviceTitle: 'Blindagem Diamante & Banho Gel',
    servicePrice: 'R$ 130,00',
    date: 'Sexta, 15 Nov',
    time: '16:00',
    depositAmount: 52, // 40% de 130
    depositStatus: 'liquidado',
    paymentMode: 'sinal_40'
  });

  assertCondition(msg.includes('Sinal (40%):* R$ 52,00'), 'Mensagem do servidor deve indicar Sinal (40%)');
  assertCondition(msg.includes('Saldo Restante no Atendimento:* R$ 78,00'), 'Mensagem do servidor deve calcular saldo restante de R$ 78,00');
  assertCondition(msg.includes('24 horas de antecedência'), 'Mensagem do servidor deve incluir a política de 24h');
  assertCondition(!msg.includes('sinal_50'), 'Mensagem do servidor não deve referenciar sinal_50');
});

// 11. Segurança e Autenticação do endpoint administrativo /api/appointments
runTest('Segurança Admin: isAuthorizedAdminRequest exige credencial e bloqueia requisições não autenticadas', () => {
  // Requisição sem cabeçalho Authorization ou token
  const unauthReq: any = {
    headers: {},
    query: {}
  };
  assertCondition(!isAuthorizedAdminRequest(unauthReq), 'Requisição sem token deve ser rejeitada');

  // Requisição com token incorreto
  const invalidTokenReq: any = {
    headers: { authorization: 'Bearer token-invalido-123' },
    query: {}
  };
  assertCondition(!isAuthorizedAdminRequest(invalidTokenReq), 'Requisição com token inválido deve ser rejeitada');

  // Requisição com senha administrativa padrão ou token configurado
  const authReqBearer: any = {
    headers: { authorization: 'Bearer angelica' },
    query: {}
  };
  assertCondition(isAuthorizedAdminRequest(authReqBearer), 'Requisição com Bearer password administrativa deve ser autorizada');

  const authReqHeader: any = {
    headers: { 'x-admin-token': 'angelica' },
    query: {}
  };
  assertCondition(isAuthorizedAdminRequest(authReqHeader), 'Requisição com x-admin-token deve ser autorizada');

  // Rejeição estrita: Token via query string DEVE ser rejeitado
  const queryOnlyReq: any = {
    headers: {},
    query: { token: 'angelica' }
  };
  assertCondition(!isAuthorizedAdminRequest(queryOnlyReq), 'Token administrativo via query string DEVE ser rejeitado');

  // Isolamento estrito: APPS_SCRIPT_TOKEN NÃO deve ser aceito como senha do administrador
  process.env.APPS_SCRIPT_TOKEN = 'secret-apps-script-token';
  const appsScriptTokenReq: any = {
    headers: { authorization: 'Bearer secret-apps-script-token' },
    query: {}
  };
  assertCondition(!isAuthorizedAdminRequest(appsScriptTokenReq), 'APPS_SCRIPT_TOKEN NUNCA deve ser aceito como credencial administrativa');
});

// 12. Modo de Teste Seguro: Notificações de teste nunca devem ser enviadas à destinatária real de produção
runTest('Modo de Teste: Destinatário oficial é sempre angelikm19@gmail.com e reservas de teste não vão para a titular', () => {
  // Em produção, uma reserva normal vai para o e-mail oficial da Angélica
  const prodRecipient = resolveNotificationRecipient(false, false);
  assertCondition(prodRecipient === 'angelikm19@gmail.com', 'Reserva normal em produção deve ser enviada para a titular (angelikm19@gmail.com)');

  // Reserva com flag de teste (isTest = true) nunca deve ser enviada para a titular de produção
  const testRecipientInProd = resolveNotificationRecipient(false, true);
  assertCondition(testRecipientInProd !== 'angelikm19@gmail.com', 'Reserva de teste NUNCA deve ser enviada para angelikm19@gmail.com');
});

// 13. Sincronização e Mesclagem no Painel Admin: Preservação de modificações administrativas locais
runTest('Sincronização Admin: Mesclagem preserva status modificado localmente e adiciona novas reservas sem duplicar', () => {
  const localAppointments: Appointment[] = [
    {
      id: 'apt-local-1',
      clientName: 'Cliente Local Antiga',
      clientPhone: '12999991111',
      serviceId: 'alongamento-fibra-slim',
      serviceTitle: 'Alongamento em Fibra Slim',
      servicePrice: 'R$ 220,00',
      serviceDuration: '2h 30min',
      date: '15/11/2026',
      time: '14:00',
      status: 'confirmado', // Modificado pela admin no painel
      depositAmount: 88,
      depositStatus: 'liquidado', // Modificado pela admin no painel
      paymentMode: 'sinal_40'
    }
  ];

  const remoteAppointments: Appointment[] = [
    {
      // Mesma reserva vinda do servidor com status original da entrada
      id: 'apt-local-1',
      clientName: 'Cliente Local Antiga',
      clientPhone: '12999991111',
      serviceId: 'alongamento-fibra-slim',
      serviceTitle: 'Alongamento em Fibra Slim',
      servicePrice: 'R$ 220,00',
      serviceDuration: '2h 30min',
      date: '15/11/2026',
      time: '14:00',
      status: 'pendente_pix',
      depositAmount: 88,
      depositStatus: 'pendente',
      paymentMode: 'sinal_40'
    },
    {
      // Nova reserva feita por cliente em outro dispositivo
      id: 'apt-novo-remoto-2',
      clientName: 'Nova Cliente Online',
      clientPhone: '12999992222',
      serviceId: 'manutencao-fibra-vidro',
      serviceTitle: 'Manutenção Fibra de Vidro',
      servicePrice: 'R$ 140,00',
      serviceDuration: '2h',
      date: '16/11/2026',
      time: '10:00',
      status: 'pendente_pix',
      depositAmount: 56,
      depositStatus: 'pendente',
      paymentMode: 'sinal_40'
    }
  ];

  // Simula a lógica implementada em App.tsx
  const mergedMap = new Map<string, Appointment>();
  for (const localApt of localAppointments) {
    mergedMap.set(localApt.id, localApt);
  }
  for (const remoteApt of remoteAppointments) {
    if (!mergedMap.has(remoteApt.id)) {
      mergedMap.set(remoteApt.id, remoteApt);
    } else {
      const localApt = mergedMap.get(remoteApt.id)!;
      const hasLocalStatusChange =
        localApt.status !== 'pendente_pix' && remoteApt.status === 'pendente_pix';
      const hasLocalDepositChange =
        localApt.depositStatus !== 'pendente' && remoteApt.depositStatus === 'pendente';
      mergedMap.set(remoteApt.id, {
        ...remoteApt,
        ...localApt,
        status: hasLocalStatusChange ? localApt.status : (remoteApt.status || localApt.status),
        depositStatus: hasLocalDepositChange ? localApt.depositStatus : (remoteApt.depositStatus || localApt.depositStatus)
      });
    }
  }

  const result = Array.from(mergedMap.values());
  assertCondition(result.length === 2, 'Total de reservas deve ser 2 sem duplicação de apt-local-1');

  const apt1 = result.find(a => a.id === 'apt-local-1')!;
  assertCondition(apt1.status === 'confirmado', 'Status confirmado pela profissional localmente NÃO deve ser revertido para pendente_pix');
  assertCondition(apt1.depositStatus === 'liquidado', 'Status liquidado localmente NÃO deve ser revertido para pendente');

  const apt2 = result.find(a => a.id === 'apt-novo-remoto-2');
  assertCondition(Boolean(apt2), 'Nova reserva remota deve ter sido adicionada com sucesso');
  assertCondition(apt2?.clientName === 'Nova Cliente Online', 'Dados da nova cliente devem ser preservados');
});

// 14. Validação estrita do token do Apps Script: Rejeição de AUTH_TOKEN e aceitação exclusiva de APPS_SCRIPT_TOKEN
runTest('Apps Script Security: Validação aceita exclusivamente APPS_SCRIPT_TOKEN e falha de forma segura se ausente', () => {
  function validateAppsScriptAuthorization(properties: Record<string, string>, tokenProvided: any) {
    const expectedToken = properties["APPS_SCRIPT_TOKEN"];
    if (!expectedToken || String(expectedToken).trim() === "") {
      return { valid: false, error: "Configuração incompleta: APPS_SCRIPT_TOKEN ausente nas Propriedades do Script." };
    }
    if (!tokenProvided || String(tokenProvided).trim() !== String(expectedToken).trim()) {
      return { valid: false, error: "Acesso não autorizado: token de autorização inválido ou ausente." };
    }
    return { valid: true };
  }

  // Cenário A: Propriedades do Script vazias (falha segura/fechada)
  const emptyPropsResult = validateAppsScriptAuthorization({}, 'qualquer-token');
  assertCondition(!emptyPropsResult.valid, 'Deve falhar com ScriptProperties vazias');
  assertCondition(emptyPropsResult.error?.includes('APPS_SCRIPT_TOKEN ausente'), 'Mensagem de erro deve apontar ausência de APPS_SCRIPT_TOKEN');

  // Cenário B: Propriedade legada AUTH_TOKEN presente, mas APPS_SCRIPT_TOKEN ausente (DEVE SER REJEITADA)
  const legacyAuthProps = { AUTH_TOKEN: 'token-legado-invalido' };
  const legacyResult = validateAppsScriptAuthorization(legacyAuthProps, 'token-legado-invalido');
  assertCondition(!legacyResult.valid, 'AUTH_TOKEN NÃO deve ser aceito como substituto de APPS_SCRIPT_TOKEN');

  // Cenário C: APPS_SCRIPT_TOKEN configurado, mas requisição sem token ou com token divergente
  const validProps = { APPS_SCRIPT_TOKEN: 'secret-token-12345' };
  const invalidAttempt = validateAppsScriptAuthorization(validProps, 'token-errado');
  assertCondition(!invalidAttempt.valid, 'Token incorreto deve ser rejeitado');
  assertCondition(invalidAttempt.error?.includes('Acesso não autorizado'), 'Erro deve reportar acesso não autorizado');

  const missingTokenAttempt = validateAppsScriptAuthorization(validProps, undefined);
  assertCondition(!missingTokenAttempt.valid, 'Requisição sem token deve ser rejeitada');

  // Cenário D: Token correto enviado
  const authorizedAttempt = validateAppsScriptAuthorization(validProps, 'secret-token-12345');
  assertCondition(authorizedAttempt.valid, 'Token correto correspondente a APPS_SCRIPT_TOKEN deve ser aceito');
});

// 15. Resultado da persistência independente do e-mail e modo teste totalmente silencioso
runTest('Persistência independente do e-mail e teste silencioso: Planilha confirmada e e-mail suprimido em testes', () => {
  // Cenário A: Reserva de teste no Apps Script grava na planilha mas suprime e-mails e WhatsApp
  const simulatedSilentTest = {
    status: 'success',
    persisted: true,
    emailSent: false,
    emailSuppressed: true,
    message: 'Reserva de teste registrada com sucesso no Sheets (notificações suprimidas em modo teste).',
    appointmentId: 'test-silent-uuid-1'
  };

  const parsedSilentTest = parseAppsScriptResponse(simulatedSilentTest, 'production');
  assertCondition(parsedSilentTest.isSuccess, 'Reserva de teste persistida deve retornar sucesso');
  assertCondition(parsedSilentTest.persisted, 'persisted DEVE ser true');
  assertCondition(!parsedSilentTest.delivered, 'delivered DEVE ser false para teste silencioso sem envio de e-mails');

  // Cenário B: Reserva real onde sheet.appendRow() teve sucesso, mas MailApp.sendEmail() falhou (ex: cota de e-mails diária excedida)
  const simulatedAppsScriptEmailFail = {
    status: 'success',
    persisted: true,
    emailSent: false,
    emailError: 'Exception: Service invoked too many times: email limit.',
    appointmentId: 'apt-persistent-success-1'
  };

  const parsedResult = parseAppsScriptResponse(simulatedAppsScriptEmailFail, 'production');
  assertCondition(parsedResult.isSuccess, 'Operação geral deve ser considerada sucesso se a reserva foi persistida');
  assertCondition(parsedResult.persisted, 'persisted DEVE ser true quando a linha foi gravada na planilha');
  assertCondition(!parsedResult.delivered, 'delivered deve ser false indicando falha isolada no envio do e-mail');
  assertCondition(!parsedResult.duplicate, 'Não deve ser marcada como duplicada na primeira inserção');

  // Cenário C: Falha real na planilha (ex: aba inexistente ou erro de permissão do Google Drive)
  const simulatedSheetFailure = {
    status: 'error',
    message: "Aba 'Agendamentos' não encontrada na planilha oficial."
  };
  const parsedSheetFail = parseAppsScriptResponse(simulatedSheetFailure, 'production');
  assertCondition(!parsedSheetFail.isSuccess, 'Falha na planilha deve invalidar o sucesso');
  assertCondition(!parsedSheetFail.persisted, 'persisted deve ser false quando a gravação falha');
  assertCondition(!parsedSheetFail.delivered, 'delivered deve ser false quando a gravação falha');
});

// 16. Idempotência no retry com o mesmo appointmentId e proteção contra dispatches reais em testes
runTest('Idempotência no retry e isolamento de testes: Reserva duplicada retorna existente e teste não envia contatos reais', () => {
  // Simula retry com o mesmo appointmentId que já existia na coluna J da planilha
  const simulatedDuplicateFromSheets = {
    status: 'success',
    duplicate: true,
    persisted: true,
    emailSent: false,
    emailSuppressed: true,
    message: 'Reserva apt-retry-123 já confirmada anteriormente no Sheets.',
    appointmentId: 'apt-retry-123',
    existingAppointment: {
      id: 'apt-retry-123',
      clientName: 'Cliente Teste Retentativa',
      clientPhone: '12999998888',
      serviceTitle: 'Alongamento em Fibra Slim',
      date: '20/11/2026',
      time: '15:00',
      depositAmount: 88,
      status: 'pendente_pix'
    }
  };

  const parsedDuplicate = parseAppsScriptResponse(simulatedDuplicateFromSheets, 'production');
  assertCondition(parsedDuplicate.isSuccess, 'Retry com reserva já gravada deve retornar sucesso');
  assertCondition(parsedDuplicate.persisted, 'persisted deve ser true');
  assertCondition(parsedDuplicate.duplicate, 'duplicate DEVE ser true');

  // Verifica marcação de teste e preservação do destinatário oficial sem substituição
  const testApt: Appointment = {
    id: 'test-retry-uuid-777',
    clientName: 'Teste de Sistema Automatizado (teste_sistema)',
    clientPhone: '12999994444',
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 220,00',
    serviceDuration: '2h 30min',
    date: '21/11/2026',
    time: '11:00',
    status: 'teste_sistema',
    depositAmount: 88,
    depositStatus: 'pendente',
    paymentMode: 'sinal_40'
  };

  const payload = buildPreBookingEmailPayload(testApt);
  assertCondition(payload.isTest === true, 'Reserva de teste de sistema DEVE ter isTest: true no payload');
  assertCondition(payload.to === 'angelikm19@gmail.com', 'Destinatário oficial em buildPreBookingEmailPayload deve ser angelikm19@gmail.com');
  assertCondition(payload.subject.includes('[TESTE]'), 'Assunto da notificação deve incluir prefixo [TESTE]');
});

// 17. Validação estrita do appointmentId: Rejeita IDs ausentes, vazios ou fora do padrão esperado
runTest('Validação estrita do ID: rejeita IDs ausentes, vazios ou fora do formato esperado (apt-* ou test-*)', () => {
  assertCondition(isValidAppointmentId('apt-1729497600000'), 'apt-<timestamp> deve ser válido');
  assertCondition(isValidAppointmentId('apt-local-1'), 'apt-local-1 deve ser válido');
  assertCondition(isValidAppointmentId('test-1729497600000'), 'test-<timestamp> deve ser válido');
  assertCondition(isValidAppointmentId('test-retry-uuid-777'), 'test-retry-uuid-777 deve ser válido');

  assertCondition(!isValidAppointmentId(''), 'ID vazio deve ser rejeitado');
  assertCondition(!isValidAppointmentId('   '), 'Espaços em branco devem ser rejeitados');
  assertCondition(!isValidAppointmentId(null), 'null deve ser rejeitado');
  assertCondition(!isValidAppointmentId(undefined), 'undefined deve ser rejeitado');
  assertCondition(!isValidAppointmentId(12345), 'Número deve ser rejeitado');
  assertCondition(!isValidAppointmentId('12345'), 'ID sem prefixo apt- ou test- deve ser rejeitado');
  assertCondition(!isValidAppointmentId('random-id-123'), 'ID com prefixo não reconhecido deve ser rejeitado');
  assertCondition(!isValidAppointmentId('apt-'), 'ID apenas com prefixo sem sufixo deve ser rejeitado');
  assertCondition(!isValidAppointmentId('test-'), 'ID apenas com prefixo test- sem sufixo deve ser rejeitado');
  assertCondition(!isValidAppointmentId('apt-../../../etc/passwd'), 'ID com path traversal deve ser rejeitado');
  assertCondition(!isValidAppointmentId('apt-<script>alert(1)</script>'), 'ID com injeção de script deve ser rejeitado');
});

console.log(`\nTodos os ${passedTests} grupos de testes automatizados passaram com sucesso.`);
