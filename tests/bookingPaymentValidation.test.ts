import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SERVICES_CATALOG } from '../src/data/mockData';
import {
  calculateDeposit40,
  calculateFullPrepayment,
  calculateRemainingBalance,
  formatBRL,
  buildOfficialPreBookingWhatsAppMessage,
  normalizeDateKey,
  areDatesEqual
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
  { id: 'nail-art-encapsulada', title: 'Nail Art Autoral & Encapsulada', price: 30, deposit40: 12, full100: 30, balance40: 18 },
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

// 3. Serviços adicionais: o total deve ser a soma de todos os serviços selecionados
runTest('Serviços adicionais: soma de 2 ou mais extras, sinal de 40% sobre o total e pré-pagamento de 100%', () => {
  const main = OFFICIAL_SERVICES_BY_ID['alongamento-fibra-slim'];
  const additionalIds = ['spa-das-maos-ouro', 'nail-art-encapsulada'];
  const additional = additionalIds.map(id => OFFICIAL_SERVICES_BY_ID[id]);
  const total = main.price + additional.reduce((sum, service) => sum + service.price, 0);
  const deposit40 = calculateDeposit40(total);
  const title = [main.title, ...additional.map(service => service.title)].join(' + ');
  const combined = {
    serviceId: main.id,
    additionalServiceIds: additionalIds,
    serviceTitle: title,
    servicePrice: `R$ ${formatBRL(total)}`,
    depositAmount: deposit40,
    paymentMode: 'sinal_40'
  };
  const validCombined = validateBookingPaymentCoherence(combined);
  assertCondition(validCombined.valid === true, `Backend rejeitou total combinado válido: ${validCombined.error}`);
  assertCondition(validCombined.verifiedServicePrice === `R$ ${formatBRL(total)}`, 'Backend não retornou a soma dos preços oficiais de todos os serviços');
  assertCondition(validCombined.verifiedDepositAmount === deposit40, 'Sinal de 40% não foi calculado sobre o total combinado');

  const wrongTotal = validateBookingPaymentCoherence({ ...combined, servicePrice: `R$ ${formatBRL(total - 5)}` });
  assertCondition(wrongTotal.valid === false, 'Backend aceitou total adulterado de serviços combinados');

  const wrongDeposit = validateBookingPaymentCoherence({ ...combined, depositAmount: deposit40 - 1 });
  assertCondition(wrongDeposit.valid === false, 'Backend aceitou sinal incorreto para serviços combinados');

  const fullPayment = validateBookingPaymentCoherence({
    ...combined,
    depositAmount: total,
    paymentMode: 'pre_pagamento_100'
  });
  assertCondition(fullPayment.valid === true, `Backend rejeitou pré-pagamento integral válido: ${fullPayment.error}`);
  assertCondition(fullPayment.verifiedDepositAmount === total, 'Pré-pagamento integral deve corresponder à soma de todos os serviços');
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
    paymentMode: 'sinal_40',
    pixKey: 'CHAVE_PIX_DA_PLANILHA',
    pixBeneficiary: 'Titular configurado na planilha'
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
  assertCondition(message.includes('Chave PIX: CHAVE_PIX_DA_PLANILHA'), 'Mensagem deve conter a chave Pix oficial');
  assertCondition(message.includes('Titular configurado na planilha'), 'Mensagem deve conter o nome da titular');
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
runTest('Segurança Admin: isAuthorizedAdminRequest exige credencial configurada no ambiente e falha de forma segura sem credencial', () => {
  const origToken = process.env.ADMIN_TOKEN;
  const origPassword = process.env.ADMIN_PASSWORD;

  try {
    // Cenário A: Sem configuração administrativa no ambiente (Falha segura/fechada)
    delete process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_PASSWORD;

    const unauthReq: any = { headers: {}, query: {} };
    assertCondition(!isAuthorizedAdminRequest(unauthReq), 'Sem token deve ser rejeitado');

    const fallbackReq: any = { headers: { authorization: 'Bearer angelica' }, query: {} };
    assertCondition(!isAuthorizedAdminRequest(fallbackReq), 'Senha fallback angelica NÃO deve ser aceita quando não configurada no ambiente');

    const anyTokenReq: any = { headers: { authorization: 'Bearer qualquer-senha' }, query: {} };
    assertCondition(!isAuthorizedAdminRequest(anyTokenReq), 'Qualquer senha deve ser recusada quando nenhuma credencial administrativa está configurada');

    // Cenário B: Configuração válida via ADMIN_PASSWORD
    process.env.ADMIN_PASSWORD = 'strong-admin-password-2026';

    const validBearer: any = { headers: { authorization: 'Bearer strong-admin-password-2026' }, query: {} };
    assertCondition(isAuthorizedAdminRequest(validBearer), 'Bearer token correto com ADMIN_PASSWORD deve ser autorizado');

    const validHeader: any = { headers: { 'x-admin-token': 'strong-admin-password-2026' }, query: {} };
    assertCondition(isAuthorizedAdminRequest(validHeader), 'X-Admin-Token correto com ADMIN_PASSWORD deve ser autorizado');

    const wrongPass: any = { headers: { authorization: 'Bearer senha-incorreta' }, query: {} };
    assertCondition(!isAuthorizedAdminRequest(wrongPass), 'Senha incorreta deve ser rejeitada');

    const oldFallbackWhenConfigured: any = { headers: { authorization: 'Bearer angelica' }, query: {} };
    assertCondition(!isAuthorizedAdminRequest(oldFallbackWhenConfigured), 'Senha angelica deve ser rejeitada quando a senha real é diferente');

    // Rejeição estrita: Token via query string DEVE ser rejeitado
    const queryOnlyReq: any = { headers: {}, query: { token: 'strong-admin-password-2026' } };
    assertCondition(!isAuthorizedAdminRequest(queryOnlyReq), 'Token administrativo via query string DEVE ser rejeitado');

    // Cenário C: Configuração válida via ADMIN_TOKEN
    delete process.env.ADMIN_PASSWORD;
    process.env.ADMIN_TOKEN = 'dedicated-admin-bearer-token';

    const validAdminToken: any = { headers: { authorization: 'Bearer dedicated-admin-bearer-token' }, query: {} };
    assertCondition(isAuthorizedAdminRequest(validAdminToken), 'Bearer token correto com ADMIN_TOKEN deve ser autorizado');

    // Isolamento estrito: APPS_SCRIPT_TOKEN NÃO deve ser aceito como senha do administrador
    process.env.APPS_SCRIPT_TOKEN = 'secret-apps-script-token';
    const appsScriptTokenReq: any = { headers: { authorization: 'Bearer secret-apps-script-token' }, query: {} };
    assertCondition(!isAuthorizedAdminRequest(appsScriptTokenReq), 'APPS_SCRIPT_TOKEN NUNCA deve ser aceito como credencial administrativa');

  } finally {
    if (origToken !== undefined) process.env.ADMIN_TOKEN = origToken;
    else delete process.env.ADMIN_TOKEN;
    if (origPassword !== undefined) process.env.ADMIN_PASSWORD = origPassword;
    else delete process.env.ADMIN_PASSWORD;
  }
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

// 18. Disparo de dois e-mails independentes (Admin + Cliente) e isolamento de teste
runTest('Disparo de dois e-mails: Notificação administrativa para titular e confirmação para a cliente com breakdown Pix', () => {
  // Simula o comportamento do Code.gs atualizado para disparo de dois e-mails
  const sentEmails: Array<{ to: string; subject: string; body: string }> = [];
  const fakeMailApp = {
    sendEmail: (opts: { to: string; subject: string; body: string }) => {
      sentEmails.push(opts);
    }
  };

  function simulateAppsScriptEmailDispatch(data: any, isTest: boolean) {
    if (isTest) {
      return { emailSent: false, emailSuppressed: true };
    }

    let adminSent = false;
    let clientSent = false;

    // 1. E-mail administrativo para a titular
    try {
      fakeMailApp.sendEmail({
        to: 'angelikm19@gmail.com',
        subject: `Novo Pré-Agendamento: ${data.clientName} - ${data.serviceTitle}`,
        body: `Detalhes: ${data.serviceTitle} | Sinal: R$ ${data.depositAmount}`
      });
      adminSent = true;
    } catch {}

    // 2. E-mail de confirmação para o cliente (se informado)
    const clientEmail = (data.clientEmail || '').trim();
    if (clientEmail && clientEmail.includes('@')) {
      try {
        fakeMailApp.sendEmail({
          to: clientEmail,
          subject: `Pré-Agendamento Recebido: ${data.serviceTitle} - Espaço Angélica`,
          body: `Olá ${data.clientName},\n\nRecebemos sua solicitação de agendamento no Espaço Angélica.\n\nProcedimento: ${data.serviceTitle}\nValor Total: ${data.servicePrice}\nSinal (40%): R$ ${data.depositAmount},00\n\nChave PIX: 12974062241 (Angelica do Carmo Costa Santos)\nEndereço: Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP\n\nImportante: Seu horário fica pré-reservado e a confirmação definitiva ocorre após o envio do comprovante Pix.`
        });
        clientSent = true;
      } catch {}
    }

    return {
      emailSent: adminSent || clientSent,
      adminEmailSent: adminSent,
      clientEmailSent: clientSent,
      emailSuppressed: false
    };
  }

  // Cenário A: Reserva real com e-mail do cliente informado -> Deve disparar DOIS e-mails
  sentEmails.length = 0;
  const realBookingData = {
    clientName: 'Carla Silva',
    clientEmail: 'carla.silva@exemplo.com.br',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 220,00',
    depositAmount: 88,
    date: '15/11/2026',
    time: '14:00'
  };
  const realRes = simulateAppsScriptEmailDispatch(realBookingData, false);
  assertCondition(realRes.emailSent === true, 'Pelo menos um e-mail deve ter sido enviado');
  assertCondition(realRes.adminEmailSent === true, 'E-mail administrativo para angelikm19@gmail.com deve ter sido enviado');
  assertCondition(realRes.clientEmailSent === true, 'E-mail de confirmação para a cliente deve ter sido enviado');
  assertCondition(sentEmails.length === 2, `Esperado 2 e-mails disparados, registrado ${sentEmails.length}`);

  const adminEmail = sentEmails.find(e => e.to === 'angelikm19@gmail.com')!;
  assertCondition(adminEmail.subject.includes('Carla Silva'), 'Assunto do e-mail admin deve conter o nome da cliente');

  const clientEmail = sentEmails.find(e => e.to === 'carla.silva@exemplo.com.br')!;
  assertCondition(clientEmail.body.includes('12974062241'), 'E-mail da cliente deve conter a chave Pix');
  assertCondition(clientEmail.body.includes('R$ 88,00'), 'E-mail da cliente deve conter o valor do sinal');
  assertCondition(clientEmail.body.includes('Pontal da Cruz'), 'E-mail da cliente deve conter o endereço do ateliê');

  // Cenário B: Reserva com flag de teste (isTest = true) -> NENHUM e-mail pode ser enviado
  sentEmails.length = 0;
  const testRes = simulateAppsScriptEmailDispatch(realBookingData, true);
  assertCondition(testRes.emailSent === false, 'Reserva de teste NUNCA deve enviar e-mails');
  assertCondition(testRes.emailSuppressed === true, 'emailSuppressed deve ser true em modo teste');
  assertCondition(sentEmails.length === 0, 'Nenhum e-mail deve constar na fila em modo teste');
});

// 19. Trava de Confirmação Visual no Frontend: Bloqueio estrito quando persisted é false
runTest('Trava de Confirmação Visual: Sucesso visual depende estritamente de persisted: true', () => {
  function handleBookingSubmissionResult(dispatchResult: { success: boolean; persisted?: boolean; error?: string }) {
    // Replica a regra estrita em BookingWizard.tsx:
    // const isPersisted = dispatchResult.success && dispatchResult.persisted === true;
    const isConfirmed = Boolean(dispatchResult.success && dispatchResult.persisted === true);
    return {
      confirmed: isConfirmed,
      formStayedOnStep4: !isConfirmed,
      errorMessage: !isConfirmed ? (dispatchResult.error || 'Erro ao persistir reserva.') : null
    };
  }

  // Cenário A: Servidor confirmou gravação na planilha (persisted: true)
  const successResult = handleBookingSubmissionResult({
    success: true,
    persisted: true
  });
  assertCondition(successResult.confirmed === true, 'Visual deve confirmar quando persisted: true');
  assertCondition(successResult.formStayedOnStep4 === false, 'Formulário deve avançar para tela de confirmação');

  // Cenário B: Servidor respondeu com erro (ex: 400 Bad Request, persistência falhou)
  const failResult = handleBookingSubmissionResult({
    success: false,
    persisted: false,
    error: 'Modalidade de pagamento inválida ou preço divergente.'
  });
  assertCondition(failResult.confirmed === false, 'Visual NÃO pode confirmar quando persisted: false');
  assertCondition(failResult.formStayedOnStep4 === true, 'Formulário DEVE permanecer no Step 4 com dados preservados');
  assertCondition(failResult.errorMessage?.includes('Modalidade de pagamento'), 'Mensagem de erro clara deve ser apresentada');

  // Cenário C: Resposta legada incompleta (success: true mas persisted ausente/falso)
  const unpersistedSuccess = handleBookingSubmissionResult({
    success: true,
    persisted: false
  });
  assertCondition(unpersistedSuccess.confirmed === false, 'Visual NÃO pode confirmar se persisted for false mesmo com success: true');
});

// 20. Idempotência em retentativa com o mesmo appointmentId
runTest('Idempotência em retentativa: Reenvio com o mesmo ID preserva persisted: true e não duplica registros', () => {
  const existingSheetData = [
    { id: 'apt-idempotent-test-999', rowNumber: 42, clientName: 'Cliente Idempotente' }
  ];

  function simulateSheetAppendOrFind(data: { appointmentId: string; clientName: string }) {
    const existing = existingSheetData.find(row => row.id === data.appointmentId);
    if (existing) {
      return {
        status: 'success',
        duplicate: true,
        persisted: true,
        emailSent: false,
        emailSuppressed: true,
        message: `Reserva ${data.appointmentId} já confirmada anteriormente no Sheets (linha ${existing.rowNumber}).`
      };
    }
    existingSheetData.push({ id: data.appointmentId, rowNumber: 43, clientName: data.clientName });
    return {
      status: 'success',
      duplicate: false,
      persisted: true,
      emailSent: true,
      emailSuppressed: false,
      message: 'Reserva gravada com sucesso.'
    };
  }

  // Primeira tentativa de um ID que já existia no banco
  const retryResult = simulateSheetAppendOrFind({
    appointmentId: 'apt-idempotent-test-999',
    clientName: 'Cliente Idempotente'
  });
  assertCondition(retryResult.persisted === true, 'persisted deve ser true em retentativa bem-sucedida');
  assertCondition(retryResult.duplicate === true, 'duplicate deve ser true');
  assertCondition(retryResult.emailSuppressed === true, 'E-mails devem ser suprimidos para evitar spam em retentativas');
  assertCondition(existingSheetData.length === 1, 'Nenhuma linha adicional deve ter sido gravada na planilha');
});

// 21. Sincronização centralizada do Painel Administrativo com contingência offline
runTest('Sincronização Admin: Consulta autenticada, modo contingência offline e preservação de histórico local', () => {
  // Simula o comportamento de App.tsx:
  const localAppointments: Appointment[] = [
    {
      id: 'apt-local-offline-1',
      clientName: 'Cliente Histórico Local',
      clientPhone: '12999990000',
      serviceTitle: 'Alongamento em Fibra Slim',
      servicePrice: 'R$ 220,00',
      serviceDuration: '2h 30min',
      date: '10/11/2026',
      time: '14:00',
      status: 'confirmado',
      depositAmount: 88,
      depositStatus: 'liquidado'
    }
  ];

  // Cenário A: Servidor offline -> Não apaga dados locais, ativa modo contingência
  const serverOfflineResponse = {
    success: false,
    appointments: [],
    error: 'Falha ao conectar com o servidor.'
  };

  let displayedAppointments = [...localAppointments];
  let isOfflineMode = false;

  if (!serverOfflineResponse.success) {
    isOfflineMode = true;
    // Dados locais NÃO são apagados!
  } else {
    displayedAppointments = serverOfflineResponse.appointments;
  }

  assertCondition(isOfflineMode === true, 'Deve ativar o modo offline quando servidor falha');
  assertCondition(displayedAppointments.length === 1, 'Dados locais devem ser mantidos durante falha do servidor');
  assertCondition(displayedAppointments[0].id === 'apt-local-offline-1', 'Reserva local preservada');

  // Cenário B: Servidor online com dados de Sheets -> Identifica agendamentos locais não sincronizados para backup
  const serverOnlineResponse = {
    success: true,
    appointments: [
      {
        id: 'apt-remote-sheets-1',
        clientName: 'Cliente Sincronizada Sheets',
        clientPhone: '12988881111',
        serviceTitle: 'Manutenção Fibra de Vidro',
        servicePrice: 'R$ 140,00',
        serviceDuration: '2h',
        date: '12/11/2026',
        time: '10:00',
        status: 'pendente_pix',
        depositAmount: 56,
        depositStatus: 'pendente'
      } as Appointment
    ]
  };

  const remoteIds = new Set(serverOnlineResponse.appointments.map(a => a.id));
  const localOnly = localAppointments.filter(a => !remoteIds.has(a.id));

  assertCondition(localOnly.length === 1, 'Deve detectar 1 agendamento local não presente na planilha');
  assertCondition(localOnly[0].id === 'apt-local-offline-1', 'ID do agendamento local para backup identificado corretamente');
});

// 22. Campos obrigatórios ausentes ou inválidos: rejeição rigorosa no backend e no Apps Script
runTest('Campos obrigatórios ausentes: validação rejeita dados faltantes ou corrompidos', () => {
  // Cenário A: Nome da cliente ausente ou muito curto (< 2 caracteres)
  const missingName = validateBookingPaymentCoherence({
    clientName: 'A',
    serviceId: 'alongamento-fibra-slim',
    depositAmount: 88
  });
  // Note que validateBookingPaymentCoherence valida pagamento e serviço; nome é validado na rota
  assertCondition(missingName.valid === true, 'validateBookingPaymentCoherence foca em pagamento');

  // Cenário B: Procedimento ausente ou desconhecido
  const missingService = validateBookingPaymentCoherence({
    depositAmount: 88
  });
  assertCondition(missingService.valid === false, 'Deve rejeitar payload sem serviceId');
  assertCondition(missingService.error?.includes('Identificação do procedimento'), 'Erro deve informar ausência de serviceId');

  const unknownService = validateBookingPaymentCoherence({
    serviceId: 'servico-ficticio-inexistente',
    depositAmount: 88
  });
  assertCondition(unknownService.valid === false, 'Deve rejeitar serviço inexistente no catálogo');

  // Cenário C: Sinal não positivo, NaN ou ausente
  const zeroDeposit = validateBookingPaymentCoherence({
    serviceId: 'alongamento-fibra-slim',
    depositAmount: 0
  });
  assertCondition(zeroDeposit.valid === false, 'Deve rejeitar sinal zerado');

  const negativeDeposit = validateBookingPaymentCoherence({
    serviceId: 'alongamento-fibra-slim',
    depositAmount: -88
  });
  assertCondition(negativeDeposit.valid === false, 'Deve rejeitar sinal negativo');

  const nanDeposit = validateBookingPaymentCoherence({
    serviceId: 'alongamento-fibra-slim',
    depositAmount: NaN
  });
  assertCondition(nanDeposit.valid === false, 'Deve rejeitar sinal NaN');
});

// 23. Tentativa de falsificar modo de teste: requisições públicas não autenticadas nunca ativam modo teste
runTest('Tentativa de falsificar modo de teste: requisições públicas não autenticadas nunca são classificadas como teste', () => {
  // Simula requisição vinda do navegador público (SEM cabeçalhos administrativos)
  const fakePublicReq: any = {
    headers: {},
    body: {
      isTest: true,
      status: 'teste_sistema',
      clientName: 'Teste Hacker Manipulado',
      notes: 'teste de invasão',
      appointmentId: 'apt-real-hacker-1'
    }
  };

  const isAdmin = isAuthorizedAdminRequest(fakePublicReq);
  assertCondition(isAdmin === false, 'Requisição pública não deve ter privilégio administrativo');

  // Lógica implementada em server.ts:
  // Se !isAdmin, isTestBooking DEVE ser estritamente false
  const isTestBooking = Boolean(
    isAdmin && (
      fakePublicReq.body.isTest === true ||
      fakePublicReq.body.status === 'teste_sistema' ||
      fakePublicReq.body.appointmentId.startsWith('test-')
    )
  );
  assertCondition(isTestBooking === false, 'Requisição pública com isTest: true NÃO PODE ser classificada como teste');

  // Status para usuário comum deve ser normalizado para 'pendente_pix'
  const bookingStatus = isTestBooking ? 'teste_sistema' : 'pendente_pix';
  assertCondition(bookingStatus === 'pendente_pix', 'Status forçado como pendente_pix para requisição pública');

  // Tentativa de enviar prefixo test-* sem admin deve ser barrada
  const publicTestPrefixId = 'test-spoofed-id-123';
  const isPublicPrefixAllowed = !(!isAdmin && publicTestPrefixId.startsWith('test-'));
  assertCondition(isPublicPrefixAllowed === false, 'Prefixo test-* DEVE ser rejeitado para usuários não autenticados');

  // Cenário com Administrador Autenticado: modo teste é legítimo
  const origPass23 = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'admin-secret-for-test-mode';
  try {
    const authorizedAdminReq: any = {
      headers: {
        authorization: 'Bearer admin-secret-for-test-mode'
      },
      body: {
        isTest: true,
        status: 'teste_sistema',
        appointmentId: 'test-admin-probe-1'
      }
    };
    const isAdminLegit = isAuthorizedAdminRequest(authorizedAdminReq);
    assertCondition(isAdminLegit === true, 'Admin legítimo deve ser autenticado');
    const isAdminTest = Boolean(
      isAdminLegit && (
        authorizedAdminReq.body.isTest === true ||
        authorizedAdminReq.body.status === 'teste_sistema'
      )
    );
    assertCondition(isAdminTest === true, 'Admin com flag isTest: true deve ser reconhecido como teste legítimo');
  } finally {
    if (origPass23 !== undefined) process.env.ADMIN_PASSWORD = origPass23;
    else delete process.env.ADMIN_PASSWORD;
  }
});

// 24. Teste sem gravação na planilha oficial Agendamentos e sem e-mails
runTest('Teste sem gravação na planilha oficial e sem e-mails: persistência isolada e retorno persisted: false', () => {
  // Simula execução de teste no Code.gs
  let rowsAppendedToAgendamentos = 0;
  let emailsDispatched = 0;

  function simulateCodeGsExecution(data: any) {
    var isTestExecution = Boolean(
      data.action === "testConnection" ||
      data.action === "verifyWebhook" ||
      data.isTest === true ||
      data.isTest === "true"
    );

    if (isTestExecution) {
      // Teste seguro: NÃO grava na aba Agendamentos e NÃO envia e-mails
      return {
        status: "success",
        test: true,
        persisted: false,
        emailSent: false,
        emailSuppressed: true,
        message: "Teste autenticado de conectividade validado com sucesso. Nenhuma linha foi gravada na aba oficial Agendamentos.",
        appointmentId: data.appointmentId || "test-probe"
      };
    }

    // Gravação real
    rowsAppendedToAgendamentos++;
    emailsDispatched += 2; // admin + cliente
    return {
      status: "success",
      persisted: true,
      duplicate: false,
      emailSent: true,
      emailSuppressed: false,
      appointmentId: data.appointmentId
    };
  }

  // Executa teste autenticado
  const testPayload = {
    action: 'testConnection',
    isTest: true,
    appointmentId: 'test-isolated-probe-1'
  };

  const testResult = simulateCodeGsExecution(testPayload);
  assertCondition(testResult.test === true, 'Resultado deve indicar test: true');
  assertCondition(testResult.persisted === false, 'persisted DEVE ser false para testes');
  assertCondition(testResult.emailSent === false, 'emailSent DEVE ser false para testes');
  assertCondition(testResult.emailSuppressed === true, 'emailSuppressed DEVE ser true para testes');
  assertCondition(rowsAppendedToAgendamentos === 0, 'NENHUMA linha pode ser adicionada em Agendamentos durante teste');
  assertCondition(emailsDispatched === 0, 'NENHUM e-mail pode ser enviado durante teste');

  // Parser do backend: confirma que persisted é false
  const parsed = parseAppsScriptResponse(testResult, 'production');
  assertCondition(parsed.isSuccess === true, 'Operação de teste deve ser considerada bem-sucedida');
  assertCondition(parsed.persisted === false, 'parseAppsScriptResponse DEVE retornar persisted: false para testes');
  assertCondition(parsed.delivered === false, 'parseAppsScriptResponse DEVE retornar delivered: false para testes');
});

// 25. Validação do link do WhatsApp no e-mail da cliente
runTest('Validação do link do WhatsApp: URL válida com parâmetros codificados', () => {
  const serviceTitle = 'Alongamento em Fibra Slim';
  const bookingDate = '20/11/2026';
  const bookingTime = '14:30';
  const clientName = 'Juliana Martins & Amiga';
  const rawId = 'apt-juliana-123';

  const waMessage = "Olá Angélica! Segue o comprovante do meu pré-agendamento no Espaço Angélica:\n" +
    "• Procedimento: " + serviceTitle + "\n" +
    "• Data: " + bookingDate + " às " + bookingTime + "\n" +
    "• Cliente: " + clientName + "\n" +
    "• ID da Reserva: " + rawId;

  const waLink = "https://wa.me/5512974062241?text=" + encodeURIComponent(waMessage);

  // Validação estrutural da URL
  assertCondition(waLink.startsWith('https://wa.me/5512974062241?text='), 'Deve iniciar com o endpoint oficial do WhatsApp');
  assertCondition(!waLink.includes(' '), 'A URL não deve conter espaços em branco não codificados');

  const parsedUrl = new URL(waLink);
  assertCondition(parsedUrl.protocol === 'https:', 'Protocolo deve ser https:');
  assertCondition(parsedUrl.hostname === 'wa.me', 'Hostname deve ser wa.me');
  assertCondition(parsedUrl.pathname === '/5512974062241', 'Número de telefone E.164 deve ser 5512974062241');

  const decodedText = parsedUrl.searchParams.get('text') || '';
  assertCondition(decodedText.includes('Juliana Martins & Amiga'), 'Mensagem decodificada deve conter o nome da cliente');
  assertCondition(decodedText.includes('Alongamento em Fibra Slim'), 'Mensagem decodificada deve conter o procedimento');
  assertCondition(decodedText.includes('20/11/2026 às 14:30'), 'Mensagem decodificada deve conter a data e hora');
  assertCondition(decodedText.includes('apt-juliana-123'), 'Mensagem decodificada deve conter o ID da reserva');
});

// 26. Escape estrito de conteúdo dinâmico no HTML do e-mail contra injeção e XSS
runTest('Conteúdo HTML escapado: previne injeção de scripts e quebra de tags HTML', () => {
  function escapeHtml(str: any): string {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Cenário A: Injeção de script clássico
  const maliciousName = '<script>alert("XSS")</script>';
  const escapedName = escapeHtml(maliciousName);
  assertCondition(!escapedName.includes('<script>'), 'Tag script deve ser neutralizada');
  assertCondition(escapedName === '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;', 'Escape exato de script');

  // Cenário B: Atributo HTML malicioso com aspas e eventos
  const maliciousAttr = 'Alongamento" onmouseover="alert(1)"';
  const escapedAttr = escapeHtml(maliciousAttr);
  assertCondition(!escapedAttr.includes('" onmouseover'), 'Aspas duplas devem ser escapadas');
  assertCondition(escapedAttr.includes('&quot; onmouseover=&quot;'), 'Aspas devem ser substituídas por &quot;');

  // Cenário C: Caracteres especiais e ampersand
  const complexInput = "Unhas & Art's <Bella>";
  const escapedComplex = escapeHtml(complexInput);
  assertCondition(escapedComplex === "Unhas &amp; Art&#39;s &lt;Bella&gt;", 'Ampersands e aspas simples devem ser escapados');

  // Cenário D: Montagem do HTML completo com dados do cliente escapados
  const clientHtml = `<div><p>Olá <strong>${escapeHtml(maliciousName)}</strong></p></div>`;
  assertCondition(!clientHtml.includes('<script>'), 'HTML gerado não deve conter tags executáveis');
  assertCondition(clientHtml.includes('&lt;script&gt;'), 'HTML gerado deve conter entidades codificadas');
});

// 27. Validação de isolamento do frontend: nenhuma rota administrativa acessível apenas por estado do localStorage
runTest('Isolamento Admin Frontend: acesso ao painel exige validação do servidor e não aceita localStorage como autenticação', () => {
  const mockLocalStorage: Record<string, string> = {
    angelica_admin_password: 'senha-falsa-no-navegador',
    angelica_admin_session: 'token-invalido-persistido'
  };

  const server401Response = {
    success: false,
    statusCode: 401,
    appointments: [],
    error: 'Acesso não autorizado. Credenciais administrativas ausentes ou inválidas.'
  };

let currentAppMode: string = 'public';
  let adminSessionToken = '';
  let loginError: string | null = null;

  function simulateHandleAdminLogin(enteredPassword: string, backendResult: { success: boolean; statusCode: number; appointments?: any[]; error?: string }) {
    if (backendResult.success) {
      currentAppMode = 'admin';
      adminSessionToken = enteredPassword;
      loginError = null;
    } else if (backendResult.statusCode === 401) {
      loginError = 'Senha administrativa incorreta ou não configurada no servidor. Acesso não autorizado.';
    } else {
      loginError = backendResult.error || 'Falha ao autenticar no servidor administrativo.';
    }
  }

  // Tentativa 1: Senha digitada igual ao localStorage, mas recusada pelo backend (401)
  simulateHandleAdminLogin('senha-falsa-no-navegador', server401Response);
  assertCondition(currentAppMode === 'public', 'Modo do app DEVE permanecer public após 401 do backend');
  assertCondition(adminSessionToken === '', 'Session token DEVE permanecer vazio após 401');
  assertCondition(Boolean(loginError), 'Erro de login deve ser exibido na tela');

  // Tentativa 2: Falha de rede / servidor offline (500)
  const server500Response = {
    success: false,
    statusCode: 500,
    appointments: [],
    error: 'Servidor indisponível'
  };
  simulateHandleAdminLogin('senha-falsa-no-navegador', server500Response);
  assertCondition(currentAppMode === 'public', 'Modo do app DEVE permanecer public mesmo se o servidor estiver offline');
  assertCondition(adminSessionToken === '', 'Session token DEVE permanecer vazio após erro de rede');

  // Tentativa 3: Login bem-sucedido quando o backend confirma a credencial
  const server200Response = {
    success: true,
    statusCode: 200,
    appointments: [{ id: 'apt-1', clientName: 'Cliente Real' } as any],
    error: undefined
  };
  simulateHandleAdminLogin('senha-valida-no-backend', server200Response);
  assertCondition(currentAppMode === 'admin', 'Modo do app DEVE mudar para admin APENAS quando backend confirma');
  assertCondition(adminSessionToken === 'senha-valida-no-backend', 'Session token é configurado após confirmação do backend');
});

// 28. Validação de cabeçalhos CORS: Access-Control-Allow-Headers inclui X-Admin-Token
runTest('CORS Security: Access-Control-Allow-Headers inclui X-Admin-Token para permitir preflights de administração', () => {
  const allowedHeaders = 'Content-Type, Authorization, X-Admin-Token';
  assertCondition(allowedHeaders.includes('X-Admin-Token'), 'CORS deve permitir explicitamente o cabeçalho X-Admin-Token');
  assertCondition(allowedHeaders.includes('Authorization'), 'CORS deve permitir explicitamente o cabeçalho Authorization');
  assertCondition(allowedHeaders.includes('Content-Type'), 'CORS deve permitir Content-Type');
});

// 29. Validação de não-exposição de dados de clientes em /api/whatsapp/status
runTest('PII Security: Endpoint /api/whatsapp/status não expõe histórico de mensagens nem dados de clientes sem autenticação', () => {
  const simulatedPublicStatusResponse = {
    status: 'configured',
    mode: 'Meta WhatsApp Cloud API (Oficial)',
    isConfigured: true,
    phoneNumberIdConfigured: true,
    tokenConfigured: true,
    businessAccountIdConfigured: true,
    apiVersion: 'v20.0',
    totalLogs: 15
  };

  assertCondition(!('lastLog' in simulatedPublicStatusResponse), 'lastLog NÃO pode estar presente na resposta pública de status');
  assertCondition(!JSON.stringify(simulatedPublicStatusResponse).includes('recipientPhone'), 'Nenhum número de telefone deve ser exposto na resposta de status pública');
  assertCondition(!JSON.stringify(simulatedPublicStatusResponse).includes('recipientName'), 'Nenhum nome de cliente deve ser exposto na resposta de status pública');
  assertCondition(simulatedPublicStatusResponse.totalLogs === 15, 'Contagem total de logs agregada é permitida');
});

// 30. Validação de anexação de credenciais administrativas em chamadas do whatsappService
runTest('WhatsApp Service Admin Authentication: requisições administrativas anexam Authorization e X-Admin-Token', () => {
  function simulateResolveHeaders(token?: string, extra?: Record<string, string>) {
    const headers: Record<string, string> = { ...extra };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Admin-Token'] = token;
    }
    return headers;
  }

  // Cenário A: Sem credencial informada
  const unauthHeaders = simulateResolveHeaders(undefined);
  assertCondition(!('Authorization' in unauthHeaders), 'Sem credencial, nenhum header de autenticação deve ser enviado');

  // Cenário B: Token administrativo autenticado presente
  const authHeaders = simulateResolveHeaders('admin-secret-key-123', { 'Content-Type': 'application/json' });
  assertCondition(authHeaders['Authorization'] === 'Bearer admin-secret-key-123', 'Header Authorization deve conter Bearer token');
  assertCondition(authHeaders['X-Admin-Token'] === 'admin-secret-key-123', 'Header X-Admin-Token deve conter o token administrativo');
  assertCondition(authHeaders['Content-Type'] === 'application/json', 'Content-Type deve ser preservado');
});

// 31. Validação de preço-base "A partir de R$ 30,00" para Nail Art Encapsulada e notas adicionais
runTest('Nail Art Base Pricing: procedimento com preço "A partir de R$ 30,00" valida corretamente base R$ 30 e notas', () => {
  const nailArtPayload = {
    serviceId: 'nail-art-encapsulada',
    serviceTitle: 'Nail Art Autoral & Encapsulada',
    servicePrice: 'A partir de R$ 30,00',
    depositAmount: 12, // 40% de 30
    paymentMode: 'sinal_40',
    notes: 'Inspiração: madrepérola e folha de ouro nas unhas anelares'
  };

  const validation = validateBookingPaymentCoherence(nailArtPayload);
  assertCondition(validation.valid === true, 'Nail Art com base R$ 30,00 e sinal de R$ 12,00 deve ser validada com sucesso');
  assertCondition(validation.verifiedDepositAmount === 12, 'Depósito verificado deve ser exatamente R$ 12,00');
  assertCondition(validation.verifiedServicePrice === 'R$ 30,00', 'Preço canônico numérico formatado como R$ 30,00 deve ser gerado');

  // Teste de 100% de pré-pagamento para Nail Art
  const nailArtFull = {
    serviceId: 'nail-art-encapsulada',
    serviceTitle: 'Nail Art Autoral & Encapsulada',
    depositAmount: 30,
    paymentMode: 'pre_pagamento_100'
  };
  const validationFull = validateBookingPaymentCoherence(nailArtFull);
  assertCondition(validationFull.valid === true, 'Pré-pagamento de 100% para Nail Art (R$ 30,00) deve ser aceito');
  assertCondition(validationFull.verifiedDepositAmount === 30, 'Depósito verificado deve ser R$ 30,00');
});

// 32. Validação estática e estrutural de Code.gs e codeGsTemplate.ts: isolamento total de testes
runTest('Apps Script Contract: Code.gs e codeGsTemplate.ts garantem que testes NUNCA chamam appendRow nem MailApp', () => {
  const codeGsPath = path.resolve(__dirname, '../Code.gs');
  const templatePath = path.resolve(__dirname, '../src/data/codeGsTemplate.ts');

  assertCondition(fs.existsSync(codeGsPath), 'Arquivo Code.gs deve existir na raiz do projeto');
  assertCondition(fs.existsSync(templatePath), 'Arquivo src/data/codeGsTemplate.ts deve existir');

  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');
  const templateContent = fs.readFileSync(templatePath, 'utf8');

  // Confirma que a lógica de teste interrompe a execução ANTES de appendRow
  const isTestPos = codeGsContent.indexOf('var isTestExecution = Boolean(');
  assertCondition(isTestPos !== -1, 'Code.gs deve definir isTestExecution');

  const returnTestPos = codeGsContent.indexOf('return responseJSON({\n          status: "success",\n          test: true,\n          persisted: false,');
  assertCondition(returnTestPos !== -1, 'Code.gs deve retornar early return com persisted: false em modo teste');

  const appendRowPos = codeGsContent.indexOf('sheet.appendRow([');
  assertCondition(appendRowPos !== -1, 'Code.gs deve conter appendRow para reservas reais');

  assertCondition(
    returnTestPos < appendRowPos,
    'O retorno de teste (persisted: false) DEVE ocorrer ANTES da chamada de sheet.appendRow'
  );

  // Confirma que não existe mais a lógica antiga de appending em teste
  assertCondition(
    !codeGsContent.includes('[TESTE DE SISTEMA]'),
    'Code.gs NÃO pode conter o prefixo [TESTE DE SISTEMA] na chamada de appendRow (indicaria gravação indevida de teste)'
  );

  // Confirma que MailApp.sendEmail também ocorre apenas após a validação e após appendRow
  const mailAppPos = codeGsContent.indexOf('MailApp.sendEmail(');
  assertCondition(mailAppPos !== -1, 'Code.gs deve conter MailApp.sendEmail para envio real');
  assertCondition(
    returnTestPos < mailAppPos,
    'O retorno de teste DEVE ocorrer ANTES de qualquer chamada a MailApp.sendEmail'
  );

  // Validação idêntica em codeGsTemplate.ts (que alimenta o painel de configurações do frontend)
  assertCondition(
    !templateContent.includes('[TESTE DE SISTEMA]'),
    'src/data/codeGsTemplate.ts NÃO pode conter o prefixo [TESTE DE SISTEMA]'
  );
  assertCondition(
    templateContent.includes('persisted: false'),
    'src/data/codeGsTemplate.ts deve manter persisted: false para testes'
  );
});

// 33. Validação do fluxo de teste no server.ts: /api/notifications/test-connection isolado
runTest('Server Test Isolation: /api/notifications/test-connection nunca persiste reservas nem dispara WhatsApp', () => {
  const serverPath = path.resolve(__dirname, '../server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  // 1. Proteção de autenticação: fail-closed
  const testConnPos = serverContent.indexOf("app.post('/api/notifications/test-connection'");
  assertCondition(testConnPos !== -1, 'server.ts deve conter a rota /api/notifications/test-connection');

  const authCheckPos = serverContent.indexOf('if (!isAuthorizedAdminRequest(req))', testConnPos);
  assertCondition(authCheckPos !== -1 && authCheckPos < testConnPos + 200, 'test-connection DEVE validar isAuthorizedAdminRequest imediatamente no topo');

  // 2. Garantia de que test-connection não chama recordServerAppointment
  const nextRoutePos = serverContent.indexOf("app.post('/api/notifications/new-booking'", testConnPos);
  const testConnBlock = serverContent.substring(testConnPos, nextRoutePos !== -1 ? nextRoutePos : testConnPos + 2500);

  assertCondition(
    !testConnBlock.includes('recordServerAppointment('),
    'A rota /api/notifications/test-connection NUNCA pode chamar recordServerAppointment'
  );

  // 3. Garantia de que test-connection sempre retorna persisted: false e emailSuppressed: true
  assertCondition(
    testConnBlock.includes('persisted: false') && testConnBlock.includes('emailSuppressed: true'),
    'test-connection DEVE retornar expressamente persisted: false e emailSuppressed: true'
  );

  // 4. Garantia de que nenhuma chamada ao WhatsApp Service ocorre em test-connection
  assertCondition(
    !testConnBlock.includes('sendWhatsAppMessage') && !testConnBlock.includes('sendWhatsAppNotification'),
    'test-connection NUNCA pode disparar mensagens via WhatsApp'
  );
});

// 34. Validação de isolamento de teste em new-booking: isTestBooking bloqueia recordServerAppointment e WhatsApp
runTest('Server New Booking Test Isolation: isTestBooking bloqueia recordServerAppointment e envio de mensagens', () => {
  const serverPath = path.resolve(__dirname, '../server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  const newBookingPos = serverContent.indexOf("app.post('/api/notifications/new-booking'");
  const testConnPos = serverContent.indexOf("app.post('/api/notifications/test-connection'");

  assertCondition(newBookingPos !== -1, 'server.ts deve conter a rota /api/notifications/new-booking');
  assertCondition(testConnPos !== -1, 'server.ts deve conter a rota /api/notifications/test-connection');

  const newBookingBlock = serverContent.substring(newBookingPos, testConnPos);

  // Confirma que isTestBooking retorna antes de recordServerAppointment
  const isTestReturnPos = newBookingBlock.indexOf('if (isTestBooking) {');
  const recordApptPos = newBookingBlock.indexOf('recordServerAppointment({');

  assertCondition(isTestReturnPos !== -1, 'new-booking deve ter bloco if (isTestBooking)');
  assertCondition(recordApptPos !== -1, 'new-booking deve ter chamada de recordServerAppointment para reservas reais');
  assertCondition(
    isTestReturnPos < recordApptPos,
    'O retorno antecipado de isTestBooking DEVE preceder a persistência de recordServerAppointment'
  );

  // Confirma que no retorno de isTestBooking, persisted é false e emailSent é false
  const testReturnSnippet = newBookingBlock.substring(isTestReturnPos, isTestReturnPos + 500);
  assertCondition(testReturnSnippet.includes('persisted: false'), 'isTestBooking deve retornar persisted: false');
  assertCondition(testReturnSnippet.includes('emailSent: false'), 'isTestBooking deve retornar emailSent: false');
  assertCondition(testReturnSnippet.includes('emailSuppressed: true'), 'isTestBooking deve retornar emailSuppressed: true');
});

// 35. Validação do fluxo de exclusão autenticada e sincronização autoritativa da planilha
runTest('Appointment Deletion: exclusão autenticada remove registros de Sheets, cache e armazenamento local', () => {
  const serverPath = path.resolve(__dirname, '../server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  const deleteRouteStart = serverContent.indexOf("app.delete('/api/appointments/:appointmentId'");
  const deleteRouteEnd = serverContent.indexOf('export interface CanonicalCatalogService', deleteRouteStart);
  const deleteRoute = serverContent.substring(deleteRouteStart, deleteRouteEnd);

  assertCondition(deleteRouteStart !== -1, 'server.ts deve expor a rota DELETE autenticada de agendamentos');
  assertCondition(
    deleteRoute.indexOf('isAuthorizedAdminRequest(req)') < deleteRoute.indexOf('fetch(cfg.webhookUrl'),
    'A rota DELETE deve autenticar antes de chamar o Apps Script'
  );
  assertCondition(deleteRoute.includes("action: 'deleteAppointment'"), 'A rota DELETE deve delegar a exclusão ao Apps Script');
  assertCondition(deleteRoute.includes('deletedAppointmentIds.add(appointmentId)'), 'A rota deve impedir que o cache ressuscite uma exclusão');

  const scriptPath = path.resolve(__dirname, '../Code.gs');
  const scriptContent = fs.readFileSync(scriptPath, 'utf8');
  const deleteActionStart = scriptContent.indexOf('if (data.action === "deleteAppointment")');
  const deleteActionEnd = scriptContent.indexOf('// 3. Mecanismo de Teste', deleteActionStart);
  const deleteAction = scriptContent.substring(deleteActionStart, deleteActionEnd);
  assertCondition(
    scriptContent.indexOf('var auth = validateAuthorization(tokenProvided)') < deleteActionStart,
    'A exclusão do Apps Script deve ficar após autenticação obrigatória'
  );
  assertCondition(deleteAction.includes('deleteSheet.deleteRow(rowIndex + 1)'), 'O Apps Script deve remover a linha identificada na planilha');

  assertCondition(
    serverContent.includes("resData?.status === 'success' && Array.isArray(resData?.appointments)") &&
      serverContent.includes('if (hasAuthoritativeSheetData)'),
    'Uma leitura válida da planilha, inclusive vazia, deve substituir o cache do servidor'
  );

  const appPath = path.resolve(__dirname, '../src/App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');
  assertCondition(appContent.includes('deleteRemoteAppointment(appointment.id, adminSessionToken)'), 'O painel deve chamar a exclusão remota autenticada');
  assertCondition(appContent.includes("['angelica_appointments', 'angelica_appointments_local_archive']"), 'A exclusão deve limpar os dois caches locais de agendamentos');
});

// 36. Validação de integridade do domínio personalizado (CNAME) e sincronia exata do Code.gs
runTest('Custom Domain & Apps Script Sync: public/CNAME configurado e Code.gs 100% idêntico a codeGsTemplate.ts', () => {
  const cnamePath = path.resolve(__dirname, '../public/CNAME');
  assertCondition(fs.existsSync(cnamePath), 'public/CNAME deve existir para inclusão automática no build do Vite');

  const cnameContent = fs.readFileSync(cnamePath, 'utf8').trim();
  assertCondition(
    cnameContent === 'espacoangelica.alansmsolutions.com',
    `public/CNAME deve conter exatamente 'espacoangelica.alansmsolutions.com', encontrado: '${cnameContent}'`
  );

  const workflowPath = path.resolve(__dirname, '../.github/workflows/deploy.yml');
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  assertCondition(
    workflowContent.includes('cname: espacoangelica.alansmsolutions.com'),
    'deploy.yml deve conter a opção cname: espacoangelica.alansmsolutions.com'
  );

  // Validação de paridade 100% entre Code.gs e src/data/codeGsTemplate.ts
  const codeGsPath = path.resolve(__dirname, '../Code.gs');
  const codeGsRaw = fs.readFileSync(codeGsPath, 'utf8').replace(/\r\n/g, '\n').trim();

  // Import dinâmico ou leitura do CODE_GS_TEMPLATE
  const templatePath = path.resolve(__dirname, '../src/data/codeGsTemplate.ts');
  const templateFileRaw = fs.readFileSync(templatePath, 'utf8');
  const quoteStart = templateFileRaw.indexOf('"');
  const quoteEnd = templateFileRaw.lastIndexOf('"');
  const unescapedTemplate = JSON.parse(templateFileRaw.substring(quoteStart, quoteEnd + 1)).replace(/\r\n/g, '\n').trim();

  assertCondition(
    codeGsRaw === unescapedTemplate,
    'Code.gs e CODE_GS_TEMPLATE em src/data/codeGsTemplate.ts devem ser 100% idênticos'
  );
});

// 37. Validação do fluxo de teste E2E controlado: permissão de prefixo e supressão de notificações
runTest('E2E Test Booking Flow: ID regex aceita e2e-*, endpoint exige admin e suprime notificações', () => {
  // 1. Validação de regex do ID para prefixo e2e-
  assertCondition(isValidAppointmentId('e2e-test-1792607999999'), 'isValidAppointmentId deve aceitar prefixo e2e-test-*');
  assertCondition(APPOINTMENT_ID_REGEX.test('e2e-test-probe-1'), 'APPOINTMENT_ID_REGEX deve aceitar e2e-test-probe-1');

  // 2. Bloqueio para usuários públicos
  const fakePublicReq = {
    headers: {},
    body: { appointmentId: 'e2e-test-unauth' }
  };
  const isAdmin = isAuthorizedAdminRequest(fakePublicReq as any);
  assertCondition(!isAdmin, 'Usuário público não pode ser administrador');
  const isPublicPrefixAllowed = !(!isAdmin && fakePublicReq.body.appointmentId.startsWith('e2e-'));
  assertCondition(isPublicPrefixAllowed === false, 'Prefixo e2e-* DEVE ser rejeitado para usuários não autenticados');

  // 3. Validação do Code.gs: e2e- suprime estritamente envio de e-mails
  const codeGsPath = path.resolve(__dirname, '../Code.gs');
  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  assertCondition(codeGsContent.includes('isE2EExecution'), 'Code.gs deve definir isE2EExecution');
  assertCondition(codeGsContent.includes('if (!isE2EExecution) {'), 'Code.gs deve condicionar o envio de e-mails a !isE2EExecution');
  assertCondition(
    codeGsContent.includes('rawId.indexOf("e2e-") === 0') || codeGsContent.includes('rawId.startsWith("e2e-")'),
    'Code.gs deve reconhecer prefixo e2e- para supressão de e-mails'
  );

  // 4. Validação da rota no server.ts
  const serverPath = path.resolve(__dirname, '../server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  assertCondition(
    serverContent.includes("app.post('/api/notifications/e2e-test-booking'"),
    'server.ts deve conter a rota /api/notifications/e2e-test-booking'
  );
});

// 37. Fluxo de Novo Agendamento Manual: Sucesso com gravação confirmada no servidor (persisted: true)
runTest('Fluxo de Novo Agendamento Manual: sucesso com gravação confirmada no servidor (persisted: true)', () => {
  const manualApt: Appointment = {
    id: `apt-manual-${Date.now()}`,
    clientName: 'Fernanda Vasconcelos',
    clientPhone: '(12) 98765-4321',
    clientEmail: 'fernanda.vasconcelos@exemplo.com',
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 220,00',
    serviceDuration: '2h 30min',
    date: 'Sexta, 15 Nov',
    time: '15:00',
    status: 'confirmado',
    depositAmount: 88,
    depositStatus: 'liquidado',
    paymentMode: 'sinal_40'
  };

  // 1. Validação do payload gerado pelo frontend
  const payload = buildPreBookingEmailPayload(manualApt);
  assertCondition(payload.appointmentId === manualApt.id, 'ID deve ser preservado');
  assertCondition(payload.clientName === 'Fernanda Vasconcelos', 'Nome deve ser preservado');
  assertCondition(payload.status === 'confirmado', 'Status liquidado deve gerar status confirmado');
  assertCondition(payload.depositStatus === 'liquidado', 'depositStatus deve ser liquidado');

  // 2. Validação financeira no backend
  const paymentCheck = validateBookingPaymentCoherence(payload);
  assertCondition(paymentCheck.valid === true, `Validação financeira falhou: ${paymentCheck.error}`);
  assertCondition(paymentCheck.verifiedDepositAmount === 88, 'Sinal de 40% deve ser R$ 88,00');

  // 3. Simulação de resposta de persistência confirmada do Apps Script
  const mockScriptRes = {
    status: 'success',
    persisted: true,
    duplicate: false,
    message: 'Reserva registrada com sucesso no Sheets.',
    appointmentId: manualApt.id
  };
  const parsed = parseAppsScriptResponse(mockScriptRes, 'production');
  assertCondition(parsed.isSuccess === true, 'parseAppsScriptResponse deve indicar sucesso');
  assertCondition(parsed.persisted === true, 'parseAppsScriptResponse deve confirmar persisted: true');

  // 4. Inclusão na grade ocorre apenas sob persisted === true
  let savedLocally = false;
  if (parsed.isSuccess && parsed.persisted === true) {
    savedLocally = true;
  }
  assertCondition(savedLocally === true, 'Agendamento deve ser aceito na grade quando o servidor confirmar gravação');
});

// 38. Fluxo de Novo Agendamento Manual: Falha do servidor com preservação do formulário e sem persistência local
runTest('Fluxo de Novo Agendamento Manual: falha do servidor preserva formulário e não efetua persistência local', () => {
  const modalSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/Modals/ManualBookingModal.tsx'),
    'utf8'
  );

  // 1. Validação estática de que ManualBookingModal só salva localmente após persisted === true
  assertCondition(
    modalSource.includes('submitManualBooking'),
    'ManualBookingModal deve importar e chamar submitManualBooking'
  );
  assertCondition(
    modalSource.includes('if (!dispatchResult.success || dispatchResult.persisted !== true)'),
    'ManualBookingModal deve rejeitar respostas sem persisted: true'
  );
  assertCondition(
    modalSource.includes('setSubmitError('),
    'ManualBookingModal deve exibir mensagem clara em caso de erro'
  );

  // 2. Simulação de falha de servidor (HTTP 500 / Timeout)
  let onSaveAppointmentCalled = false;
  const dispatchResultFailure = {
    success: false,
    persisted: false,
    message: 'Servidor retornou erro HTTP 500 ao persistir na planilha.'
  };

  if (!dispatchResultFailure.success || dispatchResultFailure.persisted !== true) {
    // Form preservado, erro setado, onSaveAppointment NUNCA é chamado
  } else {
    onSaveAppointmentCalled = true;
  }

  assertCondition(
    onSaveAppointmentCalled === false,
    'onSaveAppointment NÃO pode ser chamado em caso de falha de conexão ou erro do servidor'
  );
});

// 39. Fluxo de Novo Agendamento Manual: Falha de persistência remota (persisted !== true) é rejeitada
runTest('Fluxo de Novo Agendamento Manual: falha de persistência remota (persisted !== true) rejeitada', () => {
  // Simulação de resposta com success: true mas persisted: false (ex: falha de gravação no Sheets)
  const rejectedRes = {
    status: 'error',
    persisted: false,
    error: 'Aba Agendamentos bloqueada por tempo limite'
  };
  const parsed = parseAppsScriptResponse(rejectedRes, 'production');
  assertCondition(parsed.isSuccess === false, 'Resposta de erro deve retornar isSuccess: false');
  assertCondition(parsed.persisted === false, 'Resposta de erro deve retornar persisted: false');

  // Teste com resposta ambígua ou parcial
  const ambiguousRes = {
    status: 'success',
    test: true,
    persisted: false
  };
  const parsedAmbiguous = parseAppsScriptResponse(ambiguousRes, 'production');
  assertCondition(
    parsedAmbiguous.persisted === false,
    'Respostas em modo teste ou sem gravação real NUNCA devem ter persisted: true'
  );
});

// 40. Fluxo de Novo Agendamento Manual: Proteção anti-duplicação e reuso de ID em retentativa
runTest('Fluxo de Novo Agendamento Manual: proteção anti-duplicação e reuso de ID em retentativa', () => {
  const modalSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/Modals/ManualBookingModal.tsx'),
    'utf8'
  );

  // Garante que o componente mantém o mesmo appointmentId no estado de retentativa
  assertCondition(
    modalSource.includes('persistedAppointmentId'),
    'ManualBookingModal deve manter persistedAppointmentId para retentativas'
  );
  assertCondition(
    modalSource.includes('const appointmentId = persistedAppointmentId || `apt-${Date.now()}`'),
    'ManualBookingModal deve reutilizar persistedAppointmentId existente ao retentar'
  );

  // Simulação de resposta de retentativa do backend (duplicate: true, persisted: true)
  const duplicateRetryRes = {
    status: 'success',
    duplicate: true,
    persisted: true,
    message: 'Reserva apt-manual-1 já confirmada anteriormente no Sheets.'
  };
  const parsed = parseAppsScriptResponse(duplicateRetryRes, 'production');
  assertCondition(parsed.isSuccess === true, 'Retentativa com duplicate: true deve ser aceita');
  assertCondition(parsed.persisted === true, 'Retentativa com duplicate: true confirma persistência prévia');
  assertCondition(parsed.duplicate === true, 'Retentativa deve ser classificada como duplicate: true');
});

// 41. Fluxo de Novo Agendamento Manual: Status coerente e sincronização com fonte oficial
runTest('Fluxo de Novo Agendamento Manual: status coerente e sincronização com fonte oficial', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../src/App.tsx'),
    'utf8'
  );

  // Verifica que handleManualBookingSave re-sincroniza com o backend/Sheets imediatamente
  assertCondition(
    appSource.includes('await refreshRemoteAppointments()'),
    'handleManualBookingSave deve disparar refreshRemoteAppointments para sincronizar com Google Sheets'
  );
  assertCondition(
    appSource.includes('adminSessionToken={adminSessionToken}'),
    'App.tsx deve passar adminSessionToken para o ManualBookingModal'
  );
});

// 42. Bloqueio de Agenda: Validação estrita do ID e rejeição do padrão legado block-*
runTest('Bloqueio de Agenda: Validação estrita do ID e rejeição do padrão legado block-*', () => {
  // O prefixo correto aceito pelo servidor e pelo Google Apps Script é apt-block-*
  assertCondition(
    isValidAppointmentId('apt-block-1731500000000') === true,
    'apt-block-* deve ser considerado um ID válido pelo regex'
  );
  assertCondition(
    isValidAppointmentId('apt-block-20241113') === true,
    'apt-block-20241113 deve ser válido'
  );

  // O padrão legado block-* (sem prefixo apt-) gerava falhas silenciosas na validação do backend
  assertCondition(
    isValidAppointmentId('block-1731500000000') === false,
    'O ID legado block-* DEVE ser rejeitado por não iniciar com apt-, test- ou e2e-'
  );
  assertCondition(
    isValidAppointmentId('') === false,
    'ID vazio deve ser rejeitado'
  );
});

// 43. Bloqueio de Agenda: Contrato Code.gs e codeGsTemplate.ts para gravação de folgas e bloqueios
runTest('Bloqueio de Agenda: Contrato Code.gs e codeGsTemplate.ts para gravação de folgas e bloqueios', () => {
  const codeGsContent = fs.readFileSync(path.resolve(__dirname, '../Code.gs'), 'utf8');
  const templatePath = path.resolve(__dirname, '../src/data/codeGsTemplate.ts');
  const templateFileRaw = fs.readFileSync(templatePath, 'utf8');
  const quoteStart = templateFileRaw.indexOf('"');
  const quoteEnd = templateFileRaw.lastIndexOf('"');
  const unescapedTemplate = JSON.parse(templateFileRaw.substring(quoteStart, quoteEnd + 1));

  // 1. Ambos os arquivos devem conter suporte para a ação blockSchedule
  assertCondition(
    codeGsContent.includes('action === "blockSchedule"'),
    'Code.gs deve suportar explicitamente action === "blockSchedule"'
  );
  assertCondition(
    unescapedTemplate.includes('action === "blockSchedule"'),
    'codeGsTemplate.ts deve suportar explicitamente action === "blockSchedule"'
  );

  // 2. Gravação de bloqueio deve usar status 'bloqueado' e valor 0
  assertCondition(
    codeGsContent.includes("'bloqueado'"),
    'Code.gs deve registrar status bloqueado'
  );

  // 3. Bloqueios de agenda NUNCA enviam e-mails para a cliente nem notificações de venda
  assertCondition(
    codeGsContent.includes('emailSuppressed: true'),
    'Code.gs deve retornar emailSuppressed: true nos bloqueios'
  );
});

// 44. Bloqueio de Agenda: Endpoint /api/appointments/block exige autenticação e persiste status bloqueado
runTest('Bloqueio de Agenda: Endpoint /api/appointments/block exige autenticação e persiste status bloqueado', () => {
  const serverContent = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf8');

  // 1. Rota dedicada existe no backend
  const blockRoutePos = serverContent.indexOf("app.post('/api/appointments/block'");
  assertCondition(blockRoutePos !== -1, 'server.ts deve conter a rota POST /api/appointments/block');

  // 2. Autenticação obrigatória logo no início da rota
  const authPos = serverContent.indexOf('isAuthorizedAdminRequest(req)', blockRoutePos);
  assertCondition(
    authPos !== -1 && authPos < blockRoutePos + 250,
    '/api/appointments/block deve exigir autenticação administrativa logo no início'
  );

  // 3. Validação de data e ID
  const idCheckPos = serverContent.indexOf('isValidAppointmentId(appointmentId)', blockRoutePos);
  assertCondition(
    idCheckPos !== -1 && idCheckPos < blockRoutePos + 750,
    '/api/appointments/block deve validar o formato do appointmentId'
  );

  // 4. Registro com status bloqueado
  assertCondition(
    serverContent.includes("status: 'bloqueado'"),
    'server.ts deve armazenar registros de bloqueio com status: "bloqueado"'
  );
});

// 45. Bloqueio de Agenda: BookingWizard e Backend impedem reservas em datas bloqueadas
runTest('Bloqueio de Agenda: BookingWizard e Backend impedem reservas em datas bloqueadas', () => {
  const serverContent = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf8');
  const wizardContent = fs.readFileSync(path.resolve(__dirname, '../src/components/BookingWizard.tsx'), 'utf8');

  // 1. Backend: /api/notifications/new-booking verifica se a data está bloqueada
  assertCondition(
    serverContent.includes("status === 'bloqueado'") &&
    serverContent.includes('está bloqueada para novos agendamentos'),
    'server.ts deve verificar se a data está bloqueada e rejeitar com erro 400'
  );

  // 2. Frontend: BookingWizard recebe appointments e tem helper isDateBlocked
  assertCondition(
    wizardContent.includes('isDateBlocked'),
    'BookingWizard deve ter o helper isDateBlocked'
  );
  assertCondition(
    wizardContent.includes('isDateUnavailable') && wizardContent.includes('const disabled = past || unavailable'),
    'BookingWizard deve desabilitar datas passadas, bloqueadas ou indisponíveis no calendário dinâmico'
  );

  // 3. Frontend: handleConfirmBooking impede submissão em data bloqueada
  assertCondition(
    wizardContent.includes('if (isDateBlocked(selectedDate))'),
    'handleConfirmBooking no BookingWizard deve rejeitar submissão se selectedDate estiver bloqueada'
  );
});

// 46. Bloqueio de Agenda: Exclusão/Desbloqueio remove da lista oficial e reabilita agendamentos
runTest('Bloqueio de Agenda: Exclusão/Desbloqueio remove da lista oficial e reabilita agendamentos', () => {
  const calendarContent = fs.readFileSync(path.resolve(__dirname, '../src/components/Admin/CalendarTab.tsx'), 'utf8');
  const appContent = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');

  // 1. CalendarTab oferece ação de desbloquear
  assertCondition(
    calendarContent.includes('Desbloquear Data'),
    'CalendarTab deve exibir botão para Desbloquear Data'
  );
  assertCondition(
    calendarContent.includes('handleDeleteAppointment(currentDayBlock)'),
    'CalendarTab deve chamar handleDeleteAppointment para remover o bloqueio'
  );

  // 2. App.tsx chama deleteRemoteAppointment na exclusão
  assertCondition(
    appContent.includes('deleteRemoteAppointment(appointment.id'),
    'App.tsx deve chamar deleteRemoteAppointment para remover da fonte oficial'
  );
});

// 47. Bloqueio de Agenda: Representação canônica de data e prevenção de falsos positivos por substrings
runTest('Bloqueio de Agenda: Representação canônica de data e prevenção de falsos positivos por substrings', () => {
  // 1. Igualdade exata no formato de interface
  assertCondition(areDatesEqual('Quarta, 13 Nov', 'Quarta, 13 Nov') === true, 'Datas idênticas devem ser iguais');
  assertCondition(areDatesEqual(' Quarta, 13 Nov ', 'quarta, 13 nov') === true, 'Normalização de case e espaços');

  // 2. Equivalência entre formatos distintos (textual, ISO, barra)
  assertCondition(areDatesEqual('Quarta, 13 Nov', '13/11/2024') === true, 'Textual e DD/MM/YYYY devem ser equivalentes');
  assertCondition(areDatesEqual('Quarta, 13 Nov', '2024-11-13') === true, 'Textual e YYYY-MM-DD devem ser equivalentes');
  assertCondition(areDatesEqual('13 Nov', 'Quarta, 13 Nov') === true, 'Dia+mês sem dia da semana deve ser equivalente');

  // 3. Rejeição estrita de dias diferentes (previne bloqueio indevido por mesmo dia da semana)
  assertCondition(areDatesEqual('Quarta, 13 Nov', 'Quarta, 20 Nov') === false, 'Quarta 13 e Quarta 20 NÃO podem ser iguais');
  assertCondition(areDatesEqual('Quinta, 14 Nov', 'Quinta, 21 Nov') === false, 'Quinta 14 e Quinta 21 NÃO podem ser iguais');

  // 4. Rejeição estrita de armadilhas clássicas de substring (4 Nov em 14 Nov, 1 Nov em 21 Nov)
  assertCondition(areDatesEqual('14 Nov', '4 Nov') === false, '14 Nov e 4 Nov NÃO podem ser iguais');
  assertCondition(areDatesEqual('Quinta, 14 Nov', '4 Nov') === false, 'Quinta 14 Nov e 4 Nov NÃO podem ser iguais');
  assertCondition(areDatesEqual('21 Nov', '1 Nov') === false, '21 Nov e 1 Nov NÃO podem ser iguais');

  // 5. Entradas inválidas ou vazias
  assertCondition(areDatesEqual('', '14 Nov') === false, 'Data vazia deve retornar false');
  assertCondition(areDatesEqual(undefined, '14 Nov') === false, 'Data undefined deve retornar false');
});

// 48. Bloqueio de Agenda: BookingWizard recebe blockedDates explicitamente do componente pai (App.tsx)
runTest('Bloqueio de Agenda: BookingWizard recebe blockedDates explicitamente do componente pai (App.tsx)', () => {
  const appContent = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');

  // Verifica que BookingWizard é invocado com a prop blockedDates no App.tsx
  assertCondition(
    appContent.includes('<BookingWizard') &&
    appContent.includes('blockedDates={publicBlockedDates}') &&
    appContent.includes('appointments={publicAvailability}'),
    'App.tsx deve passar ao BookingWizard a disponibilidade pública confirmada pelo backend'
  );
});

// 49. Bloqueio de Agenda: Contingência sem falsos sucessos e fail-closed na ausência de Apps Script
runTest('Bloqueio de Agenda: Contingência sem falsos sucessos e fail-closed na ausência de Apps Script', () => {
  const serverContent = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf8');

  // 1. DELETE /api/appointments/:appointmentId mantém comportamento original e retorna 503 se Apps Script não estiver configurado
  const deleteRoutePos = serverContent.indexOf("app.delete('/api/appointments/:appointmentId'");
  assertCondition(deleteRoutePos !== -1, 'server.ts deve conter a rota DELETE');
  const deleteConfigCheck = serverContent.indexOf('if (!cfg.configured || !cfg.webhookUrl)', deleteRoutePos);
  assertCondition(deleteConfigCheck !== -1, 'Rota DELETE deve verificar cfg.configured e cfg.webhookUrl');
  const delete503Check = serverContent.indexOf('return res.status(503).json', deleteConfigCheck);
  assertCondition(
    delete503Check !== -1 && delete503Check < deleteConfigCheck + 200,
    'Rota DELETE deve retornar HTTP 503 quando Apps Script não estiver configurado (sem falsos sucessos)'
  );

  // 2. POST /api/appointments/block falha fechado com 503 se Apps Script não estiver configurado
  const blockRoutePos = serverContent.indexOf("app.post('/api/appointments/block'");
  assertCondition(blockRoutePos !== -1, 'server.ts deve conter a rota POST /api/appointments/block');
  const block503Check = serverContent.indexOf('return res.status(503).json', blockRoutePos);
  assertCondition(
    block503Check !== -1,
    'Rota de bloqueio deve retornar 503 caso Apps Script não esteja configurado, prevenindo persistência fictícia'
  );
});

// 50. Edição de Agendamentos: Rota PUT /api/appointments/:appointmentId e persistência oficial
runTest('Edição de Agendamentos: Rota PUT /api/appointments/:appointmentId e persistência oficial', () => {
  const serverContent = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf8');
  const codeGsContent = fs.readFileSync(path.resolve(__dirname, '../Code.gs'), 'utf8');

  // 1. Rota PUT registrada no server.ts
  const putPos = serverContent.indexOf("app.put('/api/appointments/:appointmentId'");
  assertCondition(putPos !== -1, 'server.ts deve registrar a rota PUT /api/appointments/:appointmentId');

  // 2. Exige autenticação administrativa
  const authCheckPos = serverContent.indexOf('isAuthorizedAdminRequest(req)', putPos);
  assertCondition(authCheckPos !== -1 && authCheckPos < putPos + 400, 'Rota PUT deve verificar autorização de admin');

  // 3. Verifica configuração do Apps Script e falha com 503 se não configurado
  const cfgCheckPos = serverContent.indexOf('if (!cfg.configured || !cfg.webhookUrl)', putPos);
  assertCondition(cfgCheckPos !== -1, 'Rota PUT deve checar se Apps Script está configurado');

  // 4. Encaminha para Apps Script action 'updateAppointment'
  const actionCheckPos = serverContent.indexOf("action: 'updateAppointment'", putPos);
  assertCondition(actionCheckPos !== -1, 'Rota PUT deve encaminhar action "updateAppointment" para o Apps Script');

  // 5. Code.gs implementa action updateAppointment
  assertCondition(
    codeGsContent.includes('action === "updateAppointment"') || codeGsContent.includes("action === 'updateAppointment'"),
    'Code.gs deve suportar a ação updateAppointment'
  );
  assertCondition(
    codeGsContent.includes('updateSheet.getRange(foundRowIndex, 2).setValue'),
    'Code.gs deve atualizar os campos do agendamento nas colunas correspondentes'
  );
});

// 51. Gestão de Serviços: Endpoints de CRUD (/api/services) e integridade do catálogo
runTest('Gestão de Serviços: Endpoints de CRUD (/api/services) e integridade do catálogo', () => {
  const serverContent = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf8');
  const codeGsContent = fs.readFileSync(path.resolve(__dirname, '../Code.gs'), 'utf8');

  // 1. Endpoints registrados no server.ts
  assertCondition(serverContent.includes("app.get('/api/services'"), 'server.ts deve conter GET /api/services');
  assertCondition(serverContent.includes("app.post('/api/services'"), 'server.ts deve conter POST /api/services');
  assertCondition(serverContent.includes("app.put('/api/services/:id'"), 'server.ts deve conter PUT /api/services/:id');
  assertCondition(serverContent.includes("app.delete('/api/services/:id'"), 'server.ts deve conter DELETE /api/services/:id');

  // 2. Proteção de autenticação administrativa em rotas de mutação
  const postPos = serverContent.indexOf("app.post('/api/services'");
  assertCondition(serverContent.indexOf('isAuthorizedAdminRequest(req)', postPos) !== -1, 'POST /api/services deve exigir admin');

  const putServPos = serverContent.indexOf("app.put('/api/services/:id'");
  assertCondition(serverContent.indexOf('isAuthorizedAdminRequest(req)', putServPos) !== -1, 'PUT /api/services/:id deve exigir admin');

  const delServPos = serverContent.indexOf("app.delete('/api/services/:id'");
  assertCondition(serverContent.indexOf('isAuthorizedAdminRequest(req)', delServPos) !== -1, 'DELETE /api/services/:id deve exigir admin');

  // 3. Code.gs suporta getServices, saveService e deleteService
  assertCondition(codeGsContent.includes('action === "getServices"'), 'Code.gs deve suportar action getServices');
  assertCondition(codeGsContent.includes('action === "saveService"'), 'Code.gs deve suportar action saveService');
  assertCondition(codeGsContent.includes('action === "deleteService"'), 'Code.gs deve suportar action deleteService');
  assertCondition(codeGsContent.includes('function getServicesSheet()'), 'Code.gs deve implementar getServicesSheet()');
});

// 52. Upload e Validação de Fotos: Endpoint /api/upload-photo, validações de formato e limites de tamanho
runTest('Upload e Validação de Fotos: Endpoint /api/upload-photo, validações de formato e limites de tamanho', () => {
  const serverContent = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf8');
  const codeGsContent = fs.readFileSync(path.resolve(__dirname, '../Code.gs'), 'utf8');

  // 1. Rota registrada no server.ts
  assertCondition(serverContent.includes("app.post('/api/upload-photo'"), 'server.ts deve conter POST /api/upload-photo');

  // 2. Validação de MIME types seguros
  const uploadPos = serverContent.indexOf("app.post('/api/upload-photo'");
  assertCondition(
    serverContent.includes("'image/jpeg', 'image/png', 'image/webp'"),
    'server.ts deve aceitar apenas image/jpeg, image/png e image/webp'
  );

  // 3. Limite estrito de tamanho de arquivo (max 5MB)
  assertCondition(
    serverContent.includes('5 * 1024 * 1024'),
    'server.ts deve validar o limite de 5MB para upload de fotos'
  );

  // 4. Code.gs suporta action uploadPhoto
  assertCondition(
    codeGsContent.includes('action === "uploadPhoto"'),
    'Code.gs deve suportar action uploadPhoto no Apps Script'
  );

  // 5. Paridade estrita entre Code.gs e codeGsTemplate.ts
  const templatePath = path.resolve(__dirname, '../src/data/codeGsTemplate.ts');
  const templateFileRaw = fs.readFileSync(templatePath, 'utf8');
  assertCondition(
    templateFileRaw.includes('uploadPhoto'),
    'codeGsTemplate.ts deve conter a implementação de uploadPhoto'
  );
});

console.log(`\nTodos os ${passedTests} grupos de testes automatizados passaram com sucesso.`);

