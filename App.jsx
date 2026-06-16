import { useState, useEffect, useRef } from "react";
// -- STORAGE , localStorage (persists across reloads) -------------------------
var STORAGE_PREFIX = "bdrhelper_";
function storageGet(key) {
  return new Promise(function(resolve) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + key);
      resolve(raw ? JSON.parse(raw) : null);
    } catch(e) { resolve(null); }
  });
}
function storageSet(key, val) {
  return new Promise(function(resolve) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
      resolve(true);
    } catch(e) { resolve(false); }
  });
}
function storageList(prefix) {
  return new Promise(function(resolve) {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX + prefix)) {
          keys.push(k.slice(STORAGE_PREFIX.length));
        }
      }
      resolve(keys);
    } catch(e) { resolve([]); }
  });
}
function storageDel(key) {
  return new Promise(function(resolve) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
      resolve(true);
    } catch(e) { resolve(false); }
  });
}
// -- USAGE / PLANS MODULE -----------------------------------------------------
// IMPORTANTE: Este modulo concentra TODO o controle de uso/plano.
// Hoje persiste em localStorage (Fase 1 - validacao). Na Fase 2, substituir o
// corpo destas funcoes por chamadas a uma serverless (/api/usage) que le/grava
// no Supabase, mantendo as MESMAS assinaturas. O resto do app nao muda.
var PLANS = {
  "starter":      { id:"starter",      label:"Starter",      limit:30,  color:"#0ea5e9" },
  "professional": { id:"professional", label:"Professional", limit:100, color:"#4361EE" },
  "free":         { id:"free",         label:"Trial",        limit:5,   color:"#64748b" },
};
var USAGE_KEY = "usage_state";

// Retorna o id do proximo plano acima (ou null se ja for o topo)
function nextPlanId(planId) {
  if (planId === "free") return "starter";
  if (planId === "starter") return "professional";
  return null;
}
function nextPlanMsg(planId) {
  var np = nextPlanId(planId);
  if (!np) return "Você já está no plano mais alto. Aguarde a renovação no próximo mês.";
  return "Migre para o plano " + PLANS[np].label + " e mapeie até " + PLANS[np].limit + " contas por mês.";
}

function currentPeriod() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
}

// Retorna {plan, period, used, limit, remaining}
function getUsage() {
  return new Promise(function(resolve) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + USAGE_KEY);
      var st = raw ? JSON.parse(raw) : null;
      var period = currentPeriod();
      if (!st || st.period !== period) {
        // novo mes -> zera o contador, mantem o plano
        st = { plan: (st && st.plan) || "free", period: period, used: 0 };
        localStorage.setItem(STORAGE_PREFIX + USAGE_KEY, JSON.stringify(st));
      }
      var plan = PLANS[st.plan] || PLANS.free;
      resolve({ plan: plan.id, planLabel: plan.label, planColor: plan.color, period: st.period, used: st.used, limit: plan.limit, remaining: Math.max(0, plan.limit - st.used) });
    } catch(e) {
      resolve({ plan:"free", planLabel:"Trial", planColor:"#64748b", period:currentPeriod(), used:0, limit:5, remaining:5 });
    }
  });
}

// Incrementa 1 mapeamento. Retorna {ok, usage} ou {ok:false, reason}
function consumeMapping() {
  return new Promise(function(resolve) {
    getUsage().then(function(u) {
      if (u.remaining <= 0) { resolve({ ok:false, reason:"limit", usage:u }); return; }
      try {
        var raw = localStorage.getItem(STORAGE_PREFIX + USAGE_KEY);
        var st = raw ? JSON.parse(raw) : { plan:"free", period:currentPeriod(), used:0 };
        st.used = (st.used||0) + 1;
        localStorage.setItem(STORAGE_PREFIX + USAGE_KEY, JSON.stringify(st));
        getUsage().then(function(u2){ resolve({ ok:true, usage:u2 }); });
      } catch(e) { resolve({ ok:false, reason:"error", usage:u }); }
    });
  });
}

function setPlan(planId, resetUsage) {
  return new Promise(function(resolve) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + USAGE_KEY);
      var st = raw ? JSON.parse(raw) : { period:currentPeriod(), used:0 };
      st.plan = planId;
      if (!st.period) st.period = currentPeriod();
      if (st.used == null) st.used = 0;
      // Ao contratar/migrar de plano, a cota e renovada (zera o contador).
      if (resetUsage) st.used = 0;
      localStorage.setItem(STORAGE_PREFIX + USAGE_KEY, JSON.stringify(st));
      resolve(true);
    } catch(e) { resolve(false); }
  });
}

// -- CSV PARSER ---------------------------------------------------------------
// Espera colunas: nome/empresa, site/website/url, linkedin (opcional).
// Tolerante a maiusculas, acentos e ordem das colunas.
function parseCSV(text) {
  var lines = text.split(/\r\n|\n|\r/).filter(function(l){ return l.trim().length; });
  if (!lines.length) return { rows: [], error: "Arquivo vazio." };

  function splitLine(line) {
    var out = []; var cur = ""; var inQ = false;
    for (var i=0;i<line.length;i++) {
      var ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if ((ch === "," || ch === ";") && !inQ) { out.push(cur); cur=""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(function(s){ return s.trim(); });
  }

  function norm(s){ return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim(); }

  var header = splitLine(lines[0]).map(norm);
  var idxNome = header.findIndex(function(h){ return h==="nome"||h==="empresa"||h==="company"||h==="name"||h==="conta"||h==="account"; });
  var idxSite = header.findIndex(function(h){ return h==="site"||h==="website"||h==="url"||h==="dominio"||h==="domain"||h==="web"; });
  var idxLink = header.findIndex(function(h){ return h.indexOf("linkedin")>=0||h==="li"; });

  var hasHeader = idxNome >= 0;
  var start = hasHeader ? 1 : 0;
  if (!hasHeader) { idxNome = 0; idxSite = 1; idxLink = 2; }

  var rows = [];
  for (var r=start; r<lines.length; r++) {
    var cols = splitLine(lines[r]);
    var nome = (cols[idxNome]||"").trim();
    if (!nome) continue;
    rows.push({
      nome: nome,
      site: (idxSite>=0 ? (cols[idxSite]||"") : "").trim(),
      linkedin: (idxLink>=0 ? (cols[idxLink]||"") : "").trim(),
    });
  }
  if (!rows.length) return { rows: [], error: "Nenhuma linha valida encontrada. Verifique se ha uma coluna de nome/empresa." };
  return { rows: rows, error: null };
}

// -- CONSTANTS ----------------------------------------------------------------
var STATUS_CONFIG = {
  "prospecting": { label:"Em prospecção", color:"#64748b", bg:"#f8fafc", border:"#e2e8f0" },
  "contacted":   { label:"Contatado",     color:"#0369a1", bg:"#eff6ff", border:"#bfdbfe" },
  "meeting":     { label:"Reunião",       color:"#7c3aed", bg:"#f5f3ff", border:"#ddd6fe" },
  "won":         { label:"Convertido",    color:"#2d3a8c", bg:"#f0f3ff", border:"#c7d0fa" },
  "lost":        { label:"Perdido",       color:"#991b1b", bg:"#fff1f2", border:"#fecdd3" },
};
var STATUS_ORDER = ["prospecting","contacted","meeting","won","lost"];
var FIT_CONFIG = {
  "ALTO":  { bg:"#e8ecfd", border:"#4361EE", text:"#2d3a8c" },
  "MEDIO": { bg:"#fef3c7", border:"#f59e0b", text:"#92400e" },
  "BAIXO": { bg:"#fee2e2", border:"#ef4444", text:"#991b1b" },
};
var TIER_COLOR = { "Tier 1":"#2d3a8c", "Tier 2":"#92400e", "Tier 3":"#475569" };
// Sequence touch types
var TOUCH_TYPES = {
  email:    { label:"E-mail",       icon:"E", color:"#0ea5e9", bg:"#eff6ff" },
  linkedin: { label:"InMail",       icon:"in", color:"#0a66c2", bg:"#eff6ff" },
  whatsapp: { label:"WhatsApp",     icon:"W", color:"#16a34a", bg:"#f0f3ff" },
  call:     { label:"Cold Call",    icon:"C", color:"#92400e", bg:"#fffbeb" },
  follow:   { label:"Follow-up",    icon:"F", color:"#7c3aed", bg:"#f5f3ff" },
  breakup:  { label:"Breakup",      icon:"B", color:"#64748b", bg:"#f8fafc" },
};
var STAKEHOLDER_PROFILES = [
  { id:"headcx", label:"Head de CX / Diretor de Atendimento", angle:"CSAT, SLA e escala do time",    pain:"volume crescendo mais rapido que headcount, CSAT caindo" },
  { id:"ceo",    label:"CEO / Diretor Geral",                  angle:"retencao e crescimento",        pain:"churn por atendimento ruim travando expansao da base" },
  { id:"ops",    label:"VP / Diretor de Operacoes",            angle:"custo por ticket e eficiencia", pain:"budget de CX estourado sem visibilidade de ROI" },
  { id:"cs",     label:"Head de Customer Success",             angle:"health score e retencao",       pain:"sem visibilidade de clientes em risco antes de churnarem" },
  { id:"ti",     label:"Gerente de TI / CTO",                  angle:"integracao e migracao",         pain:"sistema atual sem API robusta, customizacoes caras" },
  { id:"cfo",    label:"CFO / Diretor Financeiro",             angle:"ROI e reducao de custo",        pain:"custo por ticket alto sem benchmark claro do mercado" },
];
var SEQUENCE_TEMPLATES = {
  headcx: [
    { day:1,  type:"linkedin", subject:"Atendimento omnichannel na {empresa}", body:"Ola, tudo bem?\n\nVi que {empresa} atua em {setor} e tem uma operacao de atendimento ativo.\n\nComo Head de CX, imagino que voce equilibra diariamente a pressao por SLA com a necessidade de escalar o time sem explodir o custo.\n\nEmpresas similares no {setor} conseguiram aumentar CSAT em 25% e reduzir 40% do custo por ticket ao unificar todos os canais na Zendesk Suite com IA nativa.\n\nFaz sentido um papo de 20 minutos para eu entender como esta o processo de atendimento de voces hoje?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:3,  type:"email",    subject:"[{empresa}] Quanto custa um ticket sem resposta?", body:"Ola,\n\nUma pergunta direta: qual o impacto no churn quando um cliente fica mais de 24h sem resposta na {empresa}?\n\nNa media do setor de {setor}, cada 1% de queda no CSAT representa aumento de 2 a 3% no churn. Com a Zendesk Suite, empresas similares:\n\n, Reduziram TMA em 35% com macros e IA de sugestao de resposta\n, Aumentaram first contact resolution de 52% para 78%\n, Deflexionaram 28% dos tickets via self-service inteligente\n\nConsigo te mostrar em 20 minutos com dados do seu setor.\n\nTem disponibilidade essa semana?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:6,  type:"call",     subject:"Cold call , Head de CX {empresa}", body:"Bom dia [Nome], aqui e o BDR da Zendesk. Tenho 30 segundos?\n\n[PAUSA]\n\nPerfeito. Ligo porque {empresa} tem o perfil exato onde a Zendesk gera mais impacto em {setor}: time de atendimento ativo com pressao crescente de CSAT e custo.\n\nEmpresas similares aumentaram CSAT em 25% e reduziram 40% do custo por ticket nos primeiros 90 dias. Faz sentido eu te mostrar como funcionou? Quando voce tem 20 minutos?" },
    { day:10, type:"email",    subject:"[{empresa}] Case: CSAT de 68% para 89% em 90 dias", body:"Ola,\n\nRecentemente ajudamos uma empresa de {setor} com perfil muito similar ao da {empresa} a:\n\n, Unificar e-mail, chat, WhatsApp e voz em uma unica plataforma em 30 dias\n, Aumentar CSAT de 68% para 89% nos primeiros 90 dias\n, Reduzir TMA em 35% com macros inteligentes e IA de sugestao\n, Deflexionar 28% dos tickets via self-service , sem agente\n\nO time de CX nao parou as operacoes , a implementacao foi conduzida pelo nosso CS.\n\nFaz sentido eu te contar como funcionou? 20 minutos essa semana.\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:15, type:"linkedin", subject:"Atualizacao rapida , {empresa}", body:"Ola,\n\nMandei um email sobre atendimento omnichannel na {empresa}, mas imagino que a caixa esta cheia.\n\nUma pergunta direta: voces tem visibilidade em tempo real do CSAT e SLA em todos os canais hoje?\n\nSe nao, vale muito uma conversa , posso mostrar um benchmark do {setor} que costuma mudar a perspectiva.\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:21, type:"breakup",  subject:"Ultima mensagem , {empresa}", body:"Ola,\n\nVou respeitar o seu tempo , essa e minha ultima mensagem sobre o tema.\n\nSe CX e self-service nao sao prioridade agora na {empresa}, faz todo sentido. Mas se em algum momento a conversa sobre CSAT, custo por ticket ou escala do time de atendimento ganhar urgencia, pode me chamar.\n\nGuardo a {empresa} no radar.\n\nAbraço,\nBDR/SDR | Zendesk" },
  ],
  ceo: [
    { day:1,  type:"linkedin", subject:"Retencao de clientes na {empresa}", body:"Ola, tudo bem?\n\nVi que {empresa} esta crescendo em {setor} , parabens pelo trabalho.\n\nUma realidade comum em empresas que crescem rapido: a base de clientes cresce mais rapido que a capacidade de atendimento, e o CSAT começa a cair , gerando churn justamente quando mais precisam reter.\n\nEmpresas similares no {setor} resolveram esse problema com Zendesk Suite: escalaram o atendimento com IA e self-service sem aumentar headcount.\n\nVale um papo de 15 minutos?" },
    { day:3,  type:"email",    subject:"[{empresa}] Atendimento como vantagem competitiva", body:"Ola,\n\nPara uma empresa de {setor} em crescimento como a {empresa}, atendimento ao cliente pode ser o maior diferencial competitivo , ou o maior risco de churn.\n\nO que empresas líderes do setor estao fazendo:\n, Self-service com IA que resolve 30% dos tickets sem agente\n, Omnichannel unificado: o cliente nao precisa repetir o problema\n, CSAT em tempo real para antecipar clientes em risco de churn\n\nConsigo te mostrar em 20 minutos como isso se aplicaria a {empresa}.\n\nTem disponibilidade?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:7,  type:"whatsapp", subject:"WhatsApp , CEO {empresa}", body:"Oi [Nome], BDR da Zendesk. Direto ao ponto: empresa de {setor} com perfil similar ao da {empresa} reduziu churn em 15% ao melhorar CSAT com nossa plataforma. Vale 15 minutos para eu mostrar como?" },
    { day:12, type:"email",    subject:"[{empresa}] O custo do atendimento ruim", body:"Ola,\n\nUm numero que costuma surpreender CEOs de empresas de {setor}: adquirir um novo cliente custa de 5 a 7x mais do que reter um cliente existente.\n\nE o principal motivo de churn evitavel? Atendimento lento ou fragmentado.\n\nCom a Zendesk Suite, a {empresa} poderia:\n, Responder mais rapido com IA e automacao\n, Dar ao cliente a opcao de resolver sozinho (self-service)\n, Ter visibilidade em tempo real do CSAT e NPS\n\nVale 20 minutos para ver o potencial?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:17, type:"call",     subject:"Cold call , CEO {empresa}", body:"Bom dia [Nome], BDR da Zendesk. Vou ser rapido.\n\nLigo porque {empresa} esta crescendo em {setor} e esse e exatamente o momento em que CX pode ser vantagem competitiva ou gargalo de crescimento.\n\nUma pergunta: qual o CSAT atual de voces e qual o impacto no churn quando um cliente nao e bem atendido?" },
    { day:22, type:"breakup",  subject:"Encerrando contato , {empresa}", body:"Ola,\n\nEncerro o contato por aqui. Se em algum momento o tema de CX, retencao de clientes ou escala do atendimento ganhar urgencia na {empresa}, pode me chamar.\n\nAbraço e sucesso!\nBDR/SDR | Zendesk" },
  ],
  ops: [
    { day:1,  type:"email",    subject:"[{empresa}] Custo por ticket no {setor}", body:"Ola,\n\nUma pergunta direta para um Diretor de Operacoes: qual o custo por ticket do time de atendimento da {empresa} hoje?\n\nNa media do setor de {setor}, o custo por ticket varia de R$15 a R$45. Com deflexao via self-service e IA da Zendesk, empresas similares reduziram esse custo em 40% em 90 dias.\n\nConsigo te mostrar o calculo aplicado ao perfil da {empresa} em 20 minutos.\n\nTem disponibilidade?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:4,  type:"linkedin", subject:"Eficiencia operacional no atendimento , {empresa}", body:"Ola,\n\nComo Diretor de Operacoes, imagino que voce olha constantemente para a relacao entre headcount do time de CX e volume de tickets.\n\nO desafio mais comum em {setor}: o volume cresce 20% ao ano mas o budget nao acompanha , e a saida e ou contratar mais agentes ou encontrar eficiencia com tecnologia.\n\nA Zendesk Suite resolve isso com automacao, IA e self-service. Vale um papo?" },
    { day:8,  type:"call",     subject:"Cold call , Ops {empresa}", body:"Bom dia [Nome], BDR da Zendesk. Tenho 30 segundos?\n\n[PAUSA]\n\nPerfeito. Ligo porque {empresa} apareceu no nosso radar em {setor}. Uma pergunta objetiva: qual o custo mensal do time de atendimento de voces , e voces tem visibilidade do custo por ticket hoje?\n\n[ouvir]\n\nEntendi. E quando o volume de tickets sobe, o que acontece com o SLA e com o headcount?" },
    { day:13, type:"email",    subject:"[{empresa}] ROI de CX: calculo rapido", body:"Ola,\n\nUm calculo que costuma mudar a perspectiva de Diretores de Operacoes:\n\nSe {empresa} tem 50 agentes com custo medio de R$4.000/mes = R$200k/mes\nDeflexionando 30% dos tickets com self-service = 15 agentes equivalentes economizados\nImpacto potencial: R$60k/mes = R$720k/ano\n\nIsso sem contar a melhora de CSAT e reducao de churn.\n\nConsigo te montar um business case especifico para {empresa} em 20 minutos de conversa.\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:19, type:"follow",   subject:"[{empresa}] Ultima tentativa , pilot gratuito", body:"Ola,\n\nUltima mensagem , prometo.\n\nEm vez de mais uma conversa, proponho algo diferente: um pilot de 30 dias da Zendesk Suite com dados reais da {empresa}. Sem compromisso.\n\nVoces veem o resultado na pratica , reducao de TMA, deflexao de tickets, CSAT em tempo real. Se nao fizer sentido, sem custo e sem pressao.\n\nVale arriscar 30 dias?" },
    { day:25, type:"breakup",  subject:"Encerrando , {empresa}", body:"Ola,\n\nNao quero continuar incomodando. Encerro o contato por aqui.\n\nSe em algum momento a conversa sobre custo de atendimento ou eficiencia operacional de CX ganhar espaco, pode me chamar.\n\nAbraço,\nBDR/SDR | Zendesk" },
  ],
  cs: [
    { day:1,  type:"linkedin", subject:"Customer Success e retencao na {empresa}", body:"Ola,\n\nVi que {empresa} esta investindo em Customer Success em {setor} , otima estrategia.\n\nUma pergunta: voces conseguem identificar proativamente quais clientes estao em risco de churn antes de eles cancelarem?\n\nCom a Zendesk Suite, equipes de CS de empresas similares passaram a cruzar dados de CSAT, historico de tickets e engajamento para gerar health score automatico , e reduziram churn evitavel em 20%.\n\nVale um papo?" },
    { day:4,  type:"email",    subject:"[{empresa}] Self-service reduz churn , dados do {setor}", body:"Ola,\n\nUm insight relevante para quem cuida de Customer Success em {setor}:\n\nClientes que resolvem problemas via self-service tem taxa de churn 30% menor do que clientes que precisam abrir ticket para resolver o mesmo problema.\n\nMotivo: self-service gera sensacao de autonomia e competencia. Ticket aberto gera sensacao de dependencia e frustracao.\n\nA {empresa} tem um Help Center estruturado hoje? Se nao, consigo mostrar como montar um em 30 dias com a base de conhecimento da Zendesk.\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:9,  type:"whatsapp", subject:"WhatsApp , CS {empresa}", body:"Oi [Nome], BDR da Zendesk. {empresa} tem algum processo de health score para identificar clientes em risco antes de churnar? Tenho um case relevante do {setor}. Posso te mandar?" },
    { day:15, type:"email",    subject:"[{empresa}] Integracao Zendesk + CRM de CS", body:"Ola,\n\nUm dos maiores problemas de times de CS em {setor}: os dados de atendimento ficam no helpdesk e os dados de conta ficam no CRM , e os dois nao conversam.\n\nA Zendesk Suite integra nativamente com Salesforce, HubSpot e principais CRMs, trazendo historico completo de tickets para dentro do contexto de conta.\n\nIsso significa que o CSM ve, em tempo real, se o cliente abriu ticket critico, qual foi a resolucao e como o CSAT esta evoluindo.\n\nVale 20 minutos para ver isso na pratica?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:20, type:"follow",   subject:"[{empresa}] Uma ultima pergunta", body:"Ola,\n\nAntes de encerrar o contato: a {empresa} tem alguma meta de reducao de churn ou aumento de NPS para os proximos 6 meses?\n\nSe sim, vale muito uma conversa agora , antes da pressao chegar.\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:26, type:"breakup",  subject:"Encerrando , {empresa}", body:"Ola,\n\nEncerro o contato por aqui. Se o tema de retencao, health score ou integracao de CX com CS ganhar relevancia, pode me chamar.\n\nAbraço,\nBDR/SDR | Zendesk" },
  ],
  ti: [
    { day:1,  type:"email",    subject:"[{empresa}] API e integracao Zendesk no {setor}", body:"Ola,\n\nChego ate voce porque {empresa} provavelmente tem um ecossistema de sistemas , ERP, CRM, e-commerce , que precisam conversar com a plataforma de atendimento.\n\nA Zendesk Suite tem API REST completa, marketplace com mais de 1.500 integracoes nativas e webhooks flexiveis. Empresas de {setor} integraram com SAP, TOTVS, Salesforce e plataformas de e-commerce em media em 4 semanas.\n\nPosso te mostrar como funciona a arquitetura de integracao?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:4,  type:"linkedin", subject:"Migracao de helpdesk , {empresa}", body:"Ola,\n\nVi que {empresa} usa [ferramenta atual] para atendimento. Uma pergunta tecnica: qual a maior dor de integracao que voces enfrentam hoje com o sistema atual?\n\nPergunto porque a migracao para Zendesk e conduzida pelo nosso time de CS com script de migracao de dados , historico de tickets, base de conhecimento e configuracoes.\n\nMuitas empresas de {setor} reduziram o trabalho de TI na migracao em mais de 60%. Vale um papo tecnico?" },
    { day:9,  type:"call",     subject:"Cold call , TI {empresa}", body:"Bom dia [Nome], BDR da Zendesk. Tenho 30 segundos?\n\n[PAUSA]\n\nLigo porque {empresa} pode estar avaliando ou ja usar uma ferramenta de atendimento que exige muito trabalho de TI para manter. Uma pergunta: quanto tempo por mes o time de TI de voces gasta mantendo customizacoes e integracoes do sistema de atendimento atual?" },
    { day:14, type:"email",    subject:"[{empresa}] SLA de implementacao Zendesk", body:"Ola,\n\nPara quem cuida de TI, o maior medo de trocar de plataforma e o tempo e risco de implementacao.\n\nO que o nosso time de CS garante na implementacao da Zendesk Suite:\n, Go-live em 30 dias para Mid Market\n, Migracao de dados com script automatizado\n, Integracoes com ERP e CRM em 4 semanas em media\n, Treinamento do time de atendimento incluido\n, Suporte dedicado nos primeiros 90 dias\n\nVale 20 minutos para ver o plano de implementacao para {empresa}?\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:20, type:"breakup",  subject:"Encerrando , {empresa}", body:"Ola,\n\nEncerro o contato por aqui. Se o tema de migracao de plataforma de atendimento ou integracao com sistemas internos ganhar prioridade, pode me chamar.\n\nAbraço,\nBDR/SDR | Zendesk" },
  ],
  cfo: [
    { day:1,  type:"email",    subject:"[{empresa}] ROI de CX , calcular antes de decidir", body:"Ola,\n\nUma pergunta direta para um CFO de empresa de {setor}: qual e o custo mensal do time de atendimento da {empresa}, incluindo salarios, ferramentas e overhead?\n\nNa media do mercado Mid Market brasileiro, esse custo varia de R$150k a R$600k/mes dependendo do tamanho do time.\n\nCom deflexao via self-service e IA da Zendesk, empresas similares reduziram esse custo em 30 a 40% em 6 meses. O payback costuma ser em menos de 4 meses.\n\nConsigo te mostrar o business case especifico para {empresa} em 20 minutos.\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:5,  type:"linkedin", subject:"Custo de atendimento vs retencao , {empresa}", body:"Ola,\n\nTrabalho com CFOs de empresas de {setor} em um item que normalmente nao esta no radar do budget de tecnologia: a plataforma de atendimento ao cliente.\n\nO argumento que tem funcionado: o custo de perder 1% da base de clientes por atendimento ruim e muito maior do que o investimento em CX estruturado. Com a Zendesk, o payback e em menos de 4 meses.\n\nVale 20 minutos para te mostrar o business case?" },
    { day:10, type:"email",    subject:"[{empresa}] Business case: CX como centro de lucro", body:"Ola,\n\nUm numero que costuma mudar a perspectiva de CFOs em {setor}:\n\nCusto de adquirir um novo cliente: 5 a 7x maior do que reter um existente\nImpacto de 1% de reducao no churn: R$X de ARR preservado (depende da base)\nDeflexao de 30% dos tickets: reducao de 10 a 15 agentes equivalentes\n\nIsso significa que investir em CX nao e custo , e reducao de custo de aquisicao e aumento de LTV.\n\nPosso montar o business case especifico para {empresa} em 20 minutos de conversa.\n\nAbraço,\nBDR/SDR | Zendesk" },
    { day:16, type:"call",     subject:"Cold call , CFO {empresa}", body:"Bom dia [Nome], BDR da Zendesk. Tenho 30 segundos?\n\nLigo porque tenho um business case especifico para CFOs de empresas de {setor} , sobre reducao de custo operacional de atendimento e ROI de CX.\n\nO numero que costuma surpreender: deflexionar 30% dos tickets com self-service representa economia de 10 a 15 agentes equivalentes. Faz sentido eu te mostrar o calculo aplicado a {empresa}?" },
    { day:22, type:"breakup",  subject:"Encerrando , {empresa}", body:"Ola,\n\nUltima mensagem. Entendo que o timing pode nao ser o ideal.\n\nSe o tema de custo operacional de atendimento ou ROI de CX ganhar relevancia na agenda da {empresa}, pode me chamar.\n\nAbraço,\nBDR/SDR | Zendesk" },
  ],
};
function safeArr(v) { return Array.isArray(v) ? v : []; }
function fmtDate(ts) {
  if (!ts) return "";
  var d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day:"2-digit", month:"short", year:"2-digit" });
}
function applyVars(text, acc) {
  return text
    .replace(/\{empresa\}/g, acc.nome || "a empresa")
    .replace(/\{setor\}/g, (acc.data && acc.data.empresa && acc.data.empresa.setor) || acc.setor || "tecnologia");
}
// -- MINI GAUGE ----------------------------------------------------------------
function MiniGauge(props) {
  var fc = FIT_CONFIG[props.score] || FIT_CONFIG.ALTO;
  var pct = props.score === "ALTO" ? 88 : props.score === "MEDIO" ? 55 : 22;
  var r = 18; var circ = Math.PI * r;
  return (
    <svg width="50" height="30" viewBox="0 0 50 30">
      <path d={"M " + (25-r) + " 26 A " + r + " " + r + " 0 0 1 " + (25+r) + " 26"} fill="none" stroke="#f1f5f9" strokeWidth="5" strokeLinecap="round"/>
      <path d={"M " + (25-r) + " 26 A " + r + " " + r + " 0 0 1 " + (25+r) + " 26"} fill="none" stroke={fc.border} strokeWidth="5" strokeLinecap="round" strokeDasharray={circ + " " + circ} strokeDashoffset={circ * (1 - pct/100)}/>
    </svg>
  );
}
// -- COPY BUTTON ---------------------------------------------------------------
function CopyBtn(props) {
  var _st_done = useState(false); var done = _st_done[0]; var setDone = _st_done[1];
  function handle() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(props.text).then(function() { setDone(true); setTimeout(function(){setDone(false);}, 2000); });
    }
  }
  return (
    <button onClick={handle} style={{display:"flex",alignItems:"center",gap:4,background:done?"#e8ecfd":"#f8fafc",border:"1px solid "+(done?"#86efac":"#e2e8f0"),borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:10,fontWeight:600,color:done?"#2d3a8c":"#64748b",transition:"all .2s",whiteSpace:"nowrap",fontFamily:"inherit",flexShrink:0}}>
      {done ? "Copiado!" : "Copiar"}
    </button>
  );
}
// -- SEQUENCE VIEW -------------------------------------------------------------
function SequenceView(props) {
  var accounts = props.accounts;
  var _st_selAcc = useState(null); var selAcc = _st_selAcc[0]; var setSelAcc = _st_selAcc[1];
  var _st_selProfile = useState(null); var selProfile = _st_selProfile[0]; var setSelProfile = _st_selProfile[1];
  var _st_customProfile = useState(null); var customProfile = _st_customProfile[0]; var setCustomProfile = _st_customProfile[1];
  var _st_customLabel = useState(""); var customLabel = _st_customLabel[0]; var setCustomLabel = _st_customLabel[1];
  var _st_customAngle = useState(""); var customAngle = _st_customAngle[0]; var setCustomAngle = _st_customAngle[1];
  var _st_generated = useState(null); var generated = _st_generated[0]; var setGenerated = _st_generated[1];
  var _st_saved = useState([]); var saved = _st_saved[0]; var setSaved = _st_saved[1];
  var _st_view = useState("builder"); var view = _st_view[0]; var setView = _st_view[1];
  var _st_openSeq = useState(null); var openSeq = _st_openSeq[0]; var setOpenSeq = _st_openSeq[1];
  var _st_genLoading = useState(false); var genLoading = _st_genLoading[0]; var setGenLoading = _st_genLoading[1];

  useEffect(function() {
    storageList("seq:").then(function(keys) {
      if (!keys.length) return;
      Promise.all(keys.map(storageGet)).then(function(items) {
        setSaved(items.filter(Boolean).sort(function(a,b){return (b.createdAt||0)-(a.createdAt||0);}));
      });
    });
  }, []);

  function buildOneTouchVariant(touch, profile, acc) {
    var cargo = profile.label || "Decisor";
    var angulo = profile.angle || "impacto no negocio";
    var nome = acc.nome || "a empresa";
    var setor = (acc.data && acc.data.empresa && acc.data.empresa.setor) || acc.setor || "tecnologia";
    var pain = profile.pain || "dores do negocio";

    var variants = {
      email: [
        {subject:"["+nome+"] Uma pergunta direta para o "+cargo, body:"Ola,\n\nUma pergunta que raramente fazem para um "+cargo+":\n\nQuanto custa para "+nome+" cada cliente que vai embora sem conseguir atendimento?\n\nPergunto porque empresas de "+setor+" com perfil similar reduziram esse custo em 40% nos primeiros 90 dias com Zendesk.\n\nSe voce gerencia "+angulo+", vale 20 minutos para ver os numeros?\n\nAbraco,\nBDR/SDR | Zendesk"},
        {subject:"["+nome+"] O que "+cargo+" mais reclama sobre CX", body:"Ola,\n\nEm conversas com "+cargo+"s de "+setor+", o que mais ouço e:\n\n\"Meu time apaga incendio o dia todo mas nao tem visibilidade do que realmente importa.\"\n\nIsso ressoa com voce na "+nome+"?\n\nSe sim, tenho 3 formas que empresas similares resolveram isso. Vale 15 minutos?\n\nAbraco,\nBDR/SDR | Zendesk"},
        {subject:"["+nome+"] Benchmark de CX para "+cargo+"s de "+setor, body:"Ola,\n\nMontei um benchmark especifico para "+cargo+"s de "+setor+" com o perfil da "+nome+":\n\nMedia de CSAT do setor: 72%\nMediana de custo por ticket: R$ 28\nDeflexao via self-service: 18%\n\nCom Zendesk Suite, a media dessas empresas foi para CSAT 87%, R$17 por ticket e 31% de deflexao.\n\nQuer ver como "+nome+" se compara? 20 minutos.\n\nAbraco,\nBDR/SDR | Zendesk"},
      ],
      linkedin: [
        {subject:"Uma pergunta sobre "+angulo+" na "+nome, body:"Ola,\n\nVi que voce cuida de "+angulo+" na "+nome+".\n\nQuando o volume de tickets sobe 30% em um mes, o que acontece com a sua operacao?\n\nPergunto porque a resposta me diz muito sobre o momento ideal para a Zendesk entrar em cena.\n\nAbraco,\nBDR/SDR | Zendesk"},
        {subject:nome+" + Zendesk , pergunta rapida", body:"Ola!\n\nUm insight sobre "+setor+": empresas que perdem CSAT nao percebem ate o churn aparecer no relatorio trimestral.\n\nVoce tem visibilidade disso em tempo real hoje na "+nome+"?\n\nAbraco,\nBDR/SDR | Zendesk"},
        {subject:"Vi algo sobre a "+nome+" que vale compartilhar", body:"Ola,\n\nPesquisando empresas de "+setor+" vi a "+nome+" crescendo , parabens.\n\nEmpresa que cresce rapido tem um momento critico onde o atendimento ou vira vantagem competitiva ou vira gargalo.\n\nJa vi dos dois lados. Vale 15 minutos?\n\nAbraco,\nBDR/SDR | Zendesk"},
      ],
      call: [
        {subject:"Script Cold Call "+cargo+" "+nome, body:"Bom dia [Nome], BDR da Zendesk. 30 segundos?\n\n[PAUSA] Otimo.\n\nLigo porque "+nome+" apareceu no nosso radar e imagino que como "+cargo+" voce lida com "+pain+" no dia a dia.\n\nUma pergunta: quando um cliente manda mensagem pelo WhatsApp e depois liga, seu time consegue ver o historico completo ou precisa pedir para ele repetir tudo?\n\n[ouvir]\n\nE exatamente esse problema que resolvemos. Vale 20 minutos essa semana?"},
        {subject:"Script Cold Call 2 "+cargo+" "+nome, body:"[Nome], bom dia! BDR Zendesk. Rapido.\n\nTrabalhamos com "+cargo+"s de "+setor+" que tem uma dor especifica: o time cresce mas o CSAT nao melhora.\n\nIsso acontece na "+nome+"?\n\n[ouvir]\n\nPerfeito. Tenho um case de empresa identica que reverteu isso em 90 dias. Vale 20 minutos?"},
      ],
      whatsapp: [
        {subject:"WhatsApp "+cargo+" "+nome, body:"Oi [Nome], BDR da Zendesk. Voce cuida de "+angulo+" na "+nome+"? Tenho um dado de "+setor+" que acho que vai te surpreender. Posso mandar?"},
        {subject:"WhatsApp 2 "+cargo+" "+nome, body:"Oi [Nome]! Vi que "+nome+" esta crescendo em "+setor+" , parabens. Empresas nessa fase tem um timing critico com CX. Posso te contar em 2 minutos?"},
      ],
      breakup: [
        {subject:"Encerrando , "+nome, body:"Ola,\n\nNao quero continuar incomodando.\n\nSe em algum momento "+angulo+" virar prioridade na "+nome+" , e normalmente e depois que o CSAT cai , pode me chamar.\n\nGuardo a "+nome+" no radar.\n\nAbraco,\nBDR/SDR | Zendesk"},
      ],
    };

    var pool = variants[touch.type] || variants.email;
    var variant = pool[Math.floor(Math.random() * pool.length)];
    return Object.assign({}, touch, {
      subject: applyVars(variant.subject, acc),
      body: applyVars(variant.body, acc)
    });
  }

  function regenerateTouch(idx) {
    if (!generated || !selProfile) return;
    var p = selProfile.id === "custom" ? selProfile : (STAKEHOLDER_PROFILES.find(function(x){return x.id===selProfile.id;}) || STAKEHOLDER_PROFILES[0]);
    var touch = generated.touches[idx];
    var setor = (selAcc.data && selAcc.data.empresa && selAcc.data.empresa.setor) || selAcc.setor || "tecnologia";
    function localFB() {
      var newTouch = buildOneTouchVariant(touch, p, selAcc);
      var nt = generated.touches.map(function(t,i){return i===idx?newTouch:t;});
      setGenerated(Object.assign({},generated,{touches:nt}));
    }
    fetch("/api/gemini",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      empresa:selAcc.nome, setor:setor, cargo:p.label, angulo:p.angle, pain:p.pain, touches:[{day:touch.day,type:touch.type}]
    })})
      .then(function(r){return r.json();})
      .then(function(data){
        if (data && data.touches && data.touches.length) {
          var t0 = data.touches[0];
          var newTouch = Object.assign({}, touch, {subject:t0.subject||touch.subject, body:t0.body||touch.body});
          var nt = generated.touches.map(function(t,i){return i===idx?newTouch:t;});
          setGenerated(Object.assign({},generated,{touches:nt}));
        } else { localFB(); }
      })
      .catch(localFB);
  }

    function buildCustomTemplate(profile, acc) {
    var nome = acc.nome || "a empresa";
    var setor = (acc.data && acc.data.empresa && acc.data.empresa.setor) || acc.setor || "tecnologia";
    var cargo = profile.label || "Decisor";
    var angulo = profile.angle || "impacto no negocio";
    var pain = profile.pain || "dores do cargo";
    var days = [1,3,6,10,15,21];
    var types = ["linkedin","email","call","email","whatsapp","breakup"];
    return days.map(function(day,i){
      var touch = {day:day, type:types[i], subject:"", body:""};
      return buildOneTouchVariant(touch, profile, acc);
    });
  }

  function generate() {
    if (!selAcc || !selProfile || genLoading) return;
    var p = selProfile.id === "custom" ? selProfile : (STAKEHOLDER_PROFILES.find(function(x){return x.id===selProfile.id;}) || STAKEHOLDER_PROFILES[0]);
    var setor = (selAcc.data && selAcc.data.empresa && selAcc.data.empresa.setor) || selAcc.setor || "tecnologia";
    var cadencia = [
      {day:1,type:"linkedin"},{day:3,type:"email"},{day:6,type:"call"},
      {day:10,type:"email"},{day:15,type:"whatsapp"},{day:21,type:"breakup"}
    ];

    function localFallback() {
      var template = (p.id === "custom") ? buildCustomTemplate(p, selAcc) : (SEQUENCE_TEMPLATES[p.id] || SEQUENCE_TEMPLATES.headcx);
      var touches = template.map(function(t) {
        return Object.assign({}, t, {body:applyVars(t.body, selAcc), subject:applyVars(t.subject||"", selAcc)});
      });
      setGenerated({account:selAcc, profile:p, touches:touches, createdAt:Date.now()});
    }

    setGenLoading(true);
    fetch("/api/gemini",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      empresa:selAcc.nome, setor:setor, cargo:p.label, angulo:p.angle, pain:p.pain, touches:cadencia
    })})
      .then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
      .then(function(res){
        var data = res.data;
        if (data && data.touches && data.touches.length) {
          var norm = data.touches.map(function(t){ return {day:(t&&t.day)||1, type:(t&&t.type)||"email", subject:String((t&&t.subject)||""), body:String((t&&t.body!=null)?t.body:"")}; });
          setGenerated({account:selAcc, profile:p, touches:norm, createdAt:Date.now(), engine:"ai"});
          props.showToast("Sequencia gerada com IA (Gemini).", "#10b981");
        } else {
          var reason = (data && (data.error || data.message)) || ("HTTP " + res.status);
          props.showToast("IA indisponivel, usando templates. Motivo: " + reason, "#f59e0b");
          localFallback();
        }
      })
      .catch(function(err){ props.showToast("Falha de rede ao chamar IA, usando templates.", "#f59e0b"); localFallback(); })
      .finally(function(){ setGenLoading(false); });
  }

  function saveSeq() {
    if (!generated) return;
    var id = "seq:" + Date.now();
    var seq = Object.assign({}, generated, {id:id});
    storageSet(id, seq).then(function() {
      setSaved(function(prev){return [seq].concat(prev);});
      props.showToast("Sequencia salva!");
    });
  }

  if (view === "library") {
    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div style={{fontSize:22,fontWeight:800,color:"#0f172a"}}>{"Sequencias Salvas"}</div>
          <button onClick={function(){setView("builder");}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"9px 18px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Nova Sequencia"}</button>
        </div>
        {saved.length === 0 ? (
          <div style={{textAlign:"center",padding:"48px 0",background:"#f8fafc",borderRadius:16,border:"1.5px dashed #e2e8f0"}}>
            <div style={{fontSize:32,marginBottom:10}}>{"📬"}</div>
            <div style={{fontSize:14,fontWeight:700,color:"#334155"}}>Nenhuma sequencia salva</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:4}}>Gere uma sequencia e clique em Salvar</div>
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
            {saved.map(function(seq) {
              var fc = FIT_CONFIG[(seq.account&&seq.account.fit)||"ALTO"]||FIT_CONFIG.ALTO;
              return (
                <div key={seq.id} style={{background:"#fff",border:"1.5px solid #e8edf4",borderRadius:16,padding:"18px 20px",cursor:"pointer",transition:"all .2s"}} onClick={function(){setOpenSeq(seq);}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:2}}>{seq.account&&seq.account.nome}</div>
                      <div style={{fontSize:11,color:"#6b7280"}}>{seq.profile&&seq.profile.label}</div>
                    </div>
                    <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:7,padding:"2px 9px",fontSize:9,fontWeight:700}}>{"FIT "+(seq.account&&seq.account.fit)}</span>
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
                    {safeArr(seq.touches).map(function(t,i) {
                      var tc = TOUCH_TYPES[t.type]||TOUCH_TYPES.email;
                      return <span key={i} style={{background:tc.bg,color:tc.color,borderRadius:5,padding:"2px 7px",fontSize:9,fontWeight:700}}>{"D"+t.day+" "+tc.label}</span>;
                    })}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={function(e){e.stopPropagation();setOpenSeq(seq);}} style={{flex:1,background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:8,padding:"7px 0",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Abrir</button>
                    <button onClick={function(e){e.stopPropagation();storageDel(seq.id).then(function(){setSaved(function(prev){return prev.filter(function(s){return s.id!==seq.id;});});props.showToast("Removida.","#ef4444");});}} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:8,padding:"7px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>x</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {openSeq && <SequenceModal seq={openSeq} onClose={function(){setOpenSeq(null);}}/>}
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:3}}>{"Gerador de Sequências"}</div>
          <div style={{fontSize:13,color:"#64748b"}}>Selecione a conta e o perfil para gerar uma cadência de 6 toques.</div>
        </div>
        <button onClick={function(){setView("library");}} style={{background:"#f8fafc",color:"#475569",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 18px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Biblioteca ("+saved.length+")"}</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:24}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>{"1. Selecione a conta"}</div>
          {accounts.length === 0 ? (
            <div style={{background:"#f8fafc",border:"1.5px dashed #e2e8f0",borderRadius:12,padding:"20px",textAlign:"center"}}>
              <div style={{fontSize:12,color:"#6b7280"}}>Nenhuma conta mapeada. Va para Busca.</div>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:300,overflowY:"auto"}}>
              {accounts.map(function(acc) {
                var fc = FIT_CONFIG[acc.fit]||FIT_CONFIG.ALTO;
                var active = selAcc && selAcc.id===acc.id;
                return (
                  <div key={acc.id} onClick={function(){setSelAcc(acc);setGenerated(null);}} style={{background:active?"#f0f3ff":"#fff",border:"1.5px solid "+(active?"#4361EE":"#e8edf4"),borderRadius:10,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12.5,fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.nome}</div>
                      <div style={{fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.setor}</div>
                    </div>
                    <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:5,padding:"2px 7px",fontSize:8,fontWeight:700,flexShrink:0}}>{"FIT "+acc.fit}</span>
                    {active && <div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE",flexShrink:0}}/>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>{"2. Escolha o stakeholder"}</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {STAKEHOLDER_PROFILES.map(function(p) {
              var active = selProfile && selProfile.id===p.id;
              return (
                <div key={p.id} onClick={function(){setCustomProfile(null);setSelProfile(p);setGenerated(null);}} style={{background:active?"#f0f3ff":"#fff",border:"1.5px solid "+(active?"#4361EE":"#e8edf4"),borderRadius:10,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#0f172a"}}>{p.label}</div>
                    <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{"Angulo: "+p.angle}</div>
                  </div>
                  {active && <div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE",flexShrink:0}}/>}
                </div>
              );
            })}
            <div style={{border:"1.5px dashed "+(customProfile?"#4361EE":"#e2e8f0"),borderRadius:10,padding:"10px 14px",background:customProfile?"#f0f3ff":"#fafafa"}}>
              <div style={{fontSize:10,fontWeight:600,color:"#64748b",marginBottom:7}}>{"+ Cargo personalizado"}</div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                <input value={customLabel} onChange={function(e){setCustomLabel(e.target.value);}} placeholder="Ex: Head de DevOps..." style={{flex:1,minWidth:110,background:"#fff",border:"1px solid #e2e8f0",borderRadius:7,padding:"6px 10px",fontSize:11,fontFamily:"inherit",outline:"none"}}/>
                <input value={customAngle} onChange={function(e){setCustomAngle(e.target.value);}} placeholder="Angulo de abordagem..." style={{flex:1,minWidth:110,background:"#fff",border:"1px solid #e2e8f0",borderRadius:7,padding:"6px 10px",fontSize:11,fontFamily:"inherit",outline:"none"}}/>
                <button onClick={function(){if(!customLabel.trim())return;var cp={id:"custom",label:customLabel.trim(),angle:customAngle.trim()||"abordagem customizada",pain:"dores especificas do cargo"};setCustomProfile(cp);setSelProfile(cp);setGenerated(null);}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:7,padding:"6px 12px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Usar cargo</button>
              </div>
              {customProfile && <div style={{marginTop:6,fontSize:10,color:"#3451d1",fontWeight:600}}>{"v Usando: "+customProfile.label}</div>}
            </div>
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:24}}>
        <button onClick={generate} disabled={!selAcc||!selProfile||genLoading} style={{flex:1,background:(!selAcc||!selProfile||genLoading)?"#e2e8f0":"linear-gradient(135deg,#4361EE,#3451d1)",color:(!selAcc||!selProfile||genLoading)?"#94a3b8":"#fff",border:"none",borderRadius:12,padding:"14px 0",fontSize:14,fontWeight:700,cursor:(!selAcc||!selProfile||genLoading)?"not-allowed":"pointer",fontFamily:"inherit",transition:"all .2s"}}>{genLoading?"Gerando com IA...":"Gerar Sequencia de 6 Toques"}</button>
        {generated && <button onClick={saveSeq} style={{background:"#fff",color:"#3451d1",border:"1.5px solid #10b981",borderRadius:12,padding:"14px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Salvar</button>}
      </div>
      {generated && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
            {generated.engine==="ai" ? (
              <span style={{fontSize:10,fontWeight:700,color:"#fff",background:"linear-gradient(135deg,#10b981,#059669)",borderRadius:7,padding:"4px 10px",display:"flex",alignItems:"center",gap:5}}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21l2.3-7.4-6-4.6h7.6z"/></svg>
                {"Gerado por IA (Gemini)"}
              </span>
            ) : (
              <span style={{fontSize:10,fontWeight:700,color:"#92400e",background:"#fef3c7",border:"1px solid #fde68a",borderRadius:7,padding:"4px 10px"}}>{"Template local (IA indisponivel)"}</span>
            )}
          </div>
          {safeArr(generated.touches).map(function(touch,i) {
            var tc = TOUCH_TYPES[touch.type]||TOUCH_TYPES.email;
            return (
              <div key={i} style={{background:"#fff",border:"1.5px solid #e8edf4",borderRadius:14,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",background:tc.bg,borderBottom:"1px solid #f1f5f9"}}>
                  <div style={{width:28,height:28,borderRadius:8,background:tc.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:tc.color,flexShrink:0}}>{tc.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#0f172a"}}>{tc.label+" , Dia "+touch.day}</div>
                    {touch.subject && <div style={{fontSize:10,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{"Assunto: "+touch.subject}</div>}
                  </div>
                  <button onClick={function(){regenerateTouch(i);}} title="Gerar nova versao" style={{background:"none",border:"1px solid #e2e8f0",borderRadius:7,padding:"4px 8px",cursor:"pointer",color:"#94a3b8",display:"flex",alignItems:"center",gap:4,fontSize:10,fontFamily:"inherit",transition:"all .2s"}}
                    onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.color="#4361EE";}}
                    onMouseLeave={function(e){e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#94a3b8";}}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    Recarregar
                  </button>
                  <CopyBtn text={(touch.subject?"Assunto: "+touch.subject+"\n\n":"")+touch.body}/>
                </div>
                <div style={{padding:"14px 16px",fontSize:12.5,color:"#1e293b",whiteSpace:"pre-wrap",lineHeight:1.85,borderLeft:"3px solid "+tc.color}}>{touch.body}</div>
              </div>
            );
          })}
        </div>
      )}
      {openSeq && <SequenceModal seq={openSeq} onClose={function(){setOpenSeq(null);}}/>}
    </div>
  );
}

// -- SEQUENCE MODAL ------------------------------------------------------------
function SequenceModal(props) {
  var seq = props.seq;
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(15,23,42,.75)",zIndex:9999,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"12px 10px",overflowY:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch"}} onClick={function(e){if(e.target===e.currentTarget)props.onClose();}}>
      <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:660,boxShadow:"0 24px 80px rgba(15,23,42,.3)",marginBottom:16,flexShrink:0}} onClick={function(e){e.stopPropagation();}}>
        <div style={{padding:"14px 14px",borderBottom:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:15,fontWeight:800,color:"#0f172a",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{seq.account && seq.account.nome}</div>
            <div style={{fontSize:11,color:"#6b7280"}}>{seq.profile && seq.profile.label + ", " + fmtDate(seq.createdAt)}</div>
          </div>
          <button onClick={props.onClose} style={{background:"#f1f5f9",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",color:"#64748b",fontSize:15,lineHeight:1,fontFamily:"inherit",flexShrink:0}}>{"x"}</button>
        </div>
        <div style={{padding:"12px 10px",display:"flex",flexDirection:"column",gap:10}}>
          {safeArr(seq.touches).map(function(touch, idx) {
            var tc = TOUCH_TYPES[touch.type] || TOUCH_TYPES.email;
            return (
              <div key={idx} style={{border:"1.5px solid #e8edf4",borderRadius:12,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 10px",background:"#fafafa",borderBottom:"1px solid #f1f5f9",flexWrap:"wrap"}}>
                  <span style={{fontSize:10,fontWeight:700,color:tc.color,flexShrink:0}}>{tc.label}</span>
                  <span style={{background:tc.bg,color:tc.color,borderRadius:20,padding:"1px 7px",fontSize:9,fontWeight:700,flexShrink:0}}>{"Dia " + touch.day}</span>
                  <div style={{flex:1,minWidth:40,fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{touch.subject}</div>
                  <CopyBtn text={(touch.type==="email"||touch.type==="linkedin"?"Assunto: "+touch.subject+"\n\n":"")+touch.body}/>
                </div>
                <div style={{padding:"10px",fontSize:12,color:"#1e293b",whiteSpace:"pre-wrap",lineHeight:1.75,wordBreak:"break-word",overflowWrap:"break-word"}}>{touch.body}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// -- ACCOUNT CARD --------------------------------------------------------------
function AccountCard(props) {
  var acc = props.acc;
  var fc = FIT_CONFIG[acc.fit] || FIT_CONFIG.ALTO;
  var sc = STATUS_CONFIG[acc.status] || STATUS_CONFIG.prospecting;
  var _st_menuOpen = useState(false); var menuOpen = _st_menuOpen[0]; var setMenuOpen = _st_menuOpen[1];
  function handleStatus(s) { props.onStatusChange(acc.id, s); setMenuOpen(false); }

  // ── Estado NAO MAPEADO ──────────────────────────────────────────────────
  if (!acc.mapped) {
    var isMapping = props.mapping;
    return (
      <div style={{background:"rgba(255,255,255,.95)",border:"1.5px solid "+(props.selected?"#4361EE":"rgba(228,235,244,.8)"),borderRadius:20,padding:"20px 22px",position:"relative",boxShadow:props.selected?"0 4px 16px rgba(67,97,238,.12)":"0 2px 12px rgba(15,23,42,.06)",transition:"all .25s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:10}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10,flex:1,minWidth:0}}>
            <input type="checkbox" checked={!!props.selected} onChange={function(){props.onToggleSelect(acc.id);}} disabled={isMapping} style={{marginTop:2,width:16,height:16,accentColor:"#4361EE",cursor:"pointer",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.nome}</div>
              <div style={{fontSize:11,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.site || "Importada da lista"}</div>
            </div>
          </div>
          <span style={{fontSize:8,fontWeight:700,color:"#92400e",background:"#fef3c7",border:"1px solid #fde68a",borderRadius:6,padding:"3px 8px",flexShrink:0,textTransform:"uppercase",letterSpacing:.5}}>{"Não mapeada"}</span>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button onClick={function(e){e.stopPropagation();if(!isMapping)props.onMap(acc);}} disabled={isMapping} style={{flex:1,background:isMapping?"#f1f5f9":"linear-gradient(135deg,#4361EE,#3451d1)",color:isMapping?"#94a3b8":"#fff",border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:isMapping?"default":"pointer",fontFamily:"inherit",boxShadow:isMapping?"none":"0 4px 12px rgba(67,97,238,.25)"}}>
            {isMapping ? "Mapeando..." : "Mapear conta"}
          </button>
          <button onClick={function(e){e.stopPropagation();props.onDelete(acc.id);}} disabled={isMapping} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:10,padding:"9px 11px",fontSize:11,cursor:isMapping?"default":"pointer",fontFamily:"inherit"}}>x</button>
        </div>
      </div>
    );
  }

  // ── Estado MAPEADO (card completo original) ─────────────────────────────
  return (
    <div style={{background:"rgba(255,255,255,.95)",border:"1.5px solid rgba(228,235,244,.8)",borderRadius:20,padding:"20px 22px",transition:"all .25s cubic-bezier(.22,1,.36,1)",position:"relative",boxShadow:"0 2px 12px rgba(15,23,42,.06)"}} onMouseEnter={function(e){e.currentTarget.style.transform="translateY(-5px)";e.currentTarget.style.boxShadow="0 16px 48px rgba(15,23,42,.14)";e.currentTarget.style.borderColor="rgba(67,97,238,.3)";}} onMouseLeave={function(e){e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 12px rgba(15,23,42,.06)";e.currentTarget.style.borderColor="rgba(228,235,244,.8)";}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.nome}</div>
          <div style={{fontSize:11,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.setor}</div>
        </div>
        <MiniGauge score={acc.fit}/>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:8,padding:"3px 10px",fontSize:9,fontWeight:700}}>{"FIT "+acc.fit}</span>
        <span style={{background:"#f8fafc",border:"1px solid "+(TIER_COLOR[acc.tier]||"#e2e8f0"),color:TIER_COLOR[acc.tier]||"#94a3b8",borderRadius:8,padding:"3px 10px",fontSize:9,fontWeight:700}}>{acc.tier}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{position:"relative"}}>
          <button onClick={function(e){e.stopPropagation();setMenuOpen(!menuOpen);}} style={{display:"flex",alignItems:"center",gap:6,background:sc.bg,border:"1px solid "+sc.border,color:sc.color,borderRadius:8,padding:"5px 10px",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {sc.label}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {menuOpen && (
            <div onClick={function(e){e.stopPropagation();}} style={{position:"absolute",bottom:"calc(100% + 6px)",left:0,background:"#fff",border:"1.5px solid #e8edf4",borderRadius:12,boxShadow:"0 8px 32px rgba(15,23,42,.12)",zIndex:50,minWidth:160,overflow:"hidden"}}>
              {STATUS_ORDER.map(function(s) {
                var sc2 = STATUS_CONFIG[s];
                return (
                  <div key={s} onClick={function(){handleStatus(s);}} style={{padding:"9px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,fontSize:11,fontWeight:600,color:sc2.color,background:acc.status===s?sc2.bg:"#fff"}} onMouseEnter={function(e){if(acc.status!==s)e.currentTarget.style.background="#f8fafc";}} onMouseLeave={function(e){if(acc.status!==s)e.currentTarget.style.background="#fff";}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:sc2.color}}/>
                    {sc2.label}
                    {acc.status===s && <svg style={{marginLeft:"auto"}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:10,color:"#6b7280"}}>{fmtDate(acc.savedAt)}</span>
          <button onClick={function(e){e.stopPropagation();props.onOpen(acc);}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:8,padding:"5px 10px",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Ver</button>
          <button onClick={function(e){e.stopPropagation();props.onDelete(acc.id);}} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:8,padding:"5px 8px",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>x</button>
        </div>
      </div>
    </div>
  );
}
// -- PIPELINE VIEW -------------------------------------------------------------
function PipelineView(props) {
  var _st_overCol = useState(null); var overCol = _st_overCol[0]; var setOverCol = _st_overCol[1];
  var _st_dragId = useState(null); var dragId = _st_dragId[0]; var setDragId = _st_dragId[1];
  var _st_dragAcc = useState(null); var dragAcc = _st_dragAcc[0]; var setDragAcc = _st_dragAcc[1];
  var _st_ghostPos = useState({x:0, y:0}); var ghostPos = _st_ghostPos[0]; var setGhostPos = _st_ghostPos[1];
  var _st_ghostW = useState(160); var ghostW = _st_ghostW[0]; var setGhostW = _st_ghostW[1];
  var dragFrom = useRef(null);
  var colRefs = useRef({});
  function getColAtPoint(x, y) {
    var found = null;
    Object.keys(colRefs.current).forEach(function(col) {
      var el = colRefs.current[col];
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found = col;
    });
    return found;
  }
  var grabOffset = useRef({x:80, y:30});
  function startMouseDrag(e, acc, fromCol) {
    e.preventDefault();
    var rect = e.currentTarget.getBoundingClientRect();
    grabOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setGhostW(rect.width);
    dragFrom.current = fromCol;
    setDragId(acc.id);
    setDragAcc(acc);
    setGhostPos({x:e.clientX-grabOffset.current.x, y:e.clientY-grabOffset.current.y});
    setOverCol(fromCol);
    function onMove(ev) {
      setGhostPos({x:ev.clientX-grabOffset.current.x, y:ev.clientY-grabOffset.current.y});
      var col = getColAtPoint(ev.clientX, ev.clientY);
      if (col) setOverCol(col);
    }
    function onUp(ev) {
      var col = getColAtPoint(ev.clientX, ev.clientY);
      if (col && col !== dragFrom.current) props.onStatusChange(acc.id, col);
      dragFrom.current = null;
      setDragId(null);
      setDragAcc(null);
      setOverCol(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function startTouchDrag(e, acc, fromCol) {
    var t0 = e.touches[0];
    var rect = e.currentTarget.getBoundingClientRect();
    grabOffset.current = { x: t0.clientX - rect.left, y: t0.clientY - rect.top };
    setGhostW(rect.width);
    dragFrom.current = fromCol;
    setDragId(acc.id);
    setDragAcc(acc);
    setGhostPos({x:t0.clientX-grabOffset.current.x, y:t0.clientY-grabOffset.current.y});
    setOverCol(fromCol);
    function onTouchMove(ev) {
      ev.preventDefault();
      var t = ev.touches[0];
      if (!t) return;
      setGhostPos({x:t.clientX-grabOffset.current.x, y:t.clientY-grabOffset.current.y});
      var col = getColAtPoint(t.clientX, t.clientY);
      if (col) setOverCol(col);
    }
    function onEnd(ev) {
      var t = ev.changedTouches[0];
      if (t) {
        var col = getColAtPoint(t.clientX, t.clientY);
        if (col && col !== dragFrom.current) props.onStatusChange(acc.id, col);
      }
      dragFrom.current = null;
      setDragId(null);
      setDragAcc(null);
      setOverCol(null);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onEnd);
    }
    document.addEventListener("touchmove", onTouchMove, {passive:false});
    document.addEventListener("touchend", onEnd, {once:true});
  }
  var ghostFc = dragAcc ? (FIT_CONFIG[dragAcc.fit]||FIT_CONFIG.ALTO) : null;
  return (
    <div style={{position:"relative"}}>
      <div className="fluxo de atendimento-scroll" style={{overflowX:"auto",paddingBottom:16,userSelect:"none"}}>
        <div style={{display:"flex",gap:14,minWidth:900}}>
          {STATUS_ORDER.map(function(col) {
            var sc = STATUS_CONFIG[col];
            var cards = props.accounts.filter(function(a){return a.status===col;});
            var isOver = overCol===col && dragFrom.current!==null && dragFrom.current!==col;
            return (
              <div key={col} ref={function(el){colRefs.current[col]=el;}} style={{flex:1,minWidth:155,background:isOver?"rgba(67,97,238,.06)":"#f8fafc",borderRadius:16,padding:14,border:"1.5px solid "+(isOver?"#4361EE":"#e8edf4"),transition:"border-color .15s,background .15s",boxShadow:isOver?"0 0 0 3px rgba(67,97,238,.15)":"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:sc.color}}/>
                  <div style={{fontSize:9,fontWeight:700,color:sc.color,textTransform:"uppercase",letterSpacing:.8}}>{sc.label}</div>
                  <div style={{marginLeft:"auto",fontSize:10,fontWeight:700,color:"#6b7280",background:"#e2e8f0",borderRadius:20,padding:"1px 7px"}}>{cards.length}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8,minHeight:60}}>
                  {cards.map(function(acc) {
                    var fc = FIT_CONFIG[acc.fit]||FIT_CONFIG.ALTO;
                    var isDragging = dragId===acc.id;
                    return (
                      <div key={acc.id} onMouseDown={function(e){startMouseDrag(e,acc,col);}} onTouchStart={function(e){startTouchDrag(e,acc,col);}} style={{background:"#fff",border:"1px solid "+(isDragging?"#4361EE":"#edf0f7"),borderRadius:14,padding:"12px 14px",cursor:isDragging?"grabbing":"grab",touchAction:"none",opacity:isDragging?0.25:1,transition:"opacity .1s",position:"relative"}}>
                        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:3}}>
                          <div style={{fontSize:12,fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{acc.nome}</div>
                          <div style={{fontSize:11,color:"#cbd5e1",marginLeft:6,flexShrink:0,letterSpacing:2}}>{"..."}</div>
                        </div>
                        <div style={{fontSize:10,color:"#6b7280",marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.setor}</div>
                        <div style={{display:"flex",gap:5}}>
                          <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:6,padding:"2px 7px",fontSize:8,fontWeight:700}}>{"FIT "+acc.fit}</span>
                          <span style={{fontSize:8,color:TIER_COLOR[acc.tier]||"#94a3b8",fontWeight:700}}>{acc.tier}</span>
                        </div>
                      </div>
                    );
                  })}
                  {cards.length===0&&(
                    <div style={{textAlign:"center",padding:"28px 8px",color:isOver?"#3451d1":"#cbd5e1",fontSize:11,border:"2px dashed "+(isOver?"#4361EE":"#e8edf4"),borderRadius:10,transition:"all .15s",fontWeight:isOver?600:400}}>
                      {isOver?"Soltar aqui":"Vazio"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {dragId&&(
          <div style={{marginTop:10,textAlign:"center",fontSize:11,color:"#6b7280"}}>
            {"Solte sobre a coluna de destino"}
          </div>
        )}
      </div>
      {dragId && dragAcc && (
        <div style={{position:"fixed",left:ghostPos.x,top:ghostPos.y,width:ghostW,zIndex:9999,pointerEvents:"none",transform:"rotate(2deg)",boxShadow:"0 20px 60px rgba(15,23,42,.2),0 4px 16px rgba(67,97,238,.2)",borderRadius:14}}>
          <div style={{background:"#fff",border:"1.5px solid #10b981",borderRadius:14,padding:"12px 14px"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:3}}>{dragAcc.nome}</div>
            <div style={{fontSize:10,color:"#6b7280",marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{dragAcc.setor}</div>
            {ghostFc&&(
              <span style={{background:ghostFc.bg,border:"1px solid "+ghostFc.border,color:ghostFc.text,borderRadius:6,padding:"2px 7px",fontSize:8,fontWeight:700}}>{"FIT "+dragAcc.fit}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
// -- ACCOUNT MODAL -------------------------------------------------------------
function AttachmentAnalysis(props) {
  var acc = props.acc;
  var _st_analysis = useState(null); var analysis = _st_analysis[0]; var setAnalysis = _st_analysis[1];
  var _st_loading = useState(false); var loading = _st_loading[0]; var setLoading = _st_loading[1];

  useEffect(function() {
    if (!acc.attachData || analysis) return;
    setLoading(true);
    fetch("/api/analyze", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ attachData:acc.attachData, attachFileName:acc.attachFileName||"", company:acc.nome||"" })
    })
    .then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
    .then(function(res){
      var d = res.data;
      if (d && (d.resumo || (d.insights&&d.insights.length))) {
        setAnalysis({resumo:d.resumo||"", insights:d.insights||[], oportunidades:d.oportunidades||[], alertas:d.alertas||[]});
      } else {
        var reason = (d && d.error) || ("HTTP " + res.status);
        setAnalysis({resumo:"Erro ao analisar o documento: " + reason, insights:[], oportunidades:[], alertas:[]});
      }
      setLoading(false);
    })
    .catch(function(err){ setLoading(false); setAnalysis({resumo:"Erro de rede ao analisar o documento.",insights:[],oportunidades:[],alertas:[]}); });
  }, [acc.attachData]);

  if (!acc.attachData) return null;
  if (loading) return (
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"32px 0",justifyContent:"center"}}>
      <div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE",animation:"pulse 1s infinite"}}/>
      <span style={{color:"#6b7280",fontSize:13}}>{"Analisando documento com IA..."}</span>
    </div>
  );
  if (!analysis) return null;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#f0f3ff",borderRadius:10,border:"1px solid #c7d0fa"}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4361EE" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        <span style={{fontSize:11,color:"#4361EE",fontWeight:600}}>{acc.attachFileName||"Documento anexado"}</span>
      </div>
      <div style={{background:"#f8fafc",borderRadius:14,padding:"16px 18px",border:"1px solid #e8edf4"}}>
        <div style={{fontSize:9,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Resumo Executivo</div>
        <div style={{fontSize:13,color:"#334155",lineHeight:1.7}}>{analysis.resumo}</div>
      </div>
      {analysis.insights&&analysis.insights.length>0&&(
        <div>
          <div style={{fontSize:9,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Insights para Prospecção</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {analysis.insights.map(function(ins,i){return (
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",background:"#fff",border:"1px solid #e8edf4",borderRadius:10,padding:"10px 14px"}}>
                <div style={{width:20,height:20,borderRadius:6,background:"linear-gradient(135deg,#4361EE,#3451d1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:9,fontWeight:700,color:"#fff"}}>{i+1}</span>
                </div>
                <span style={{fontSize:12,color:"#334155",lineHeight:1.6}}>{ins}</span>
              </div>
            );})}
          </div>
        </div>
      )}
      {analysis.oportunidades&&analysis.oportunidades.length>0&&(
        <div>
          <div style={{fontSize:9,fontWeight:700,color:"#059669",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Oportunidades Comerciais</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {analysis.oportunidades.map(function(op,i){return (
              <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"8px 12px",background:"#f0fdf4",borderRadius:8,border:"1px solid #bbf7d0"}}>
                <span style={{color:"#059669",fontWeight:700,flexShrink:0}}>{"+"}</span>
                <span style={{fontSize:12,color:"#065f46",lineHeight:1.6}}>{op}</span>
              </div>
            );})}
          </div>
        </div>
      )}
      {analysis.alertas&&analysis.alertas.length>0&&(
        <div>
          <div style={{fontSize:9,fontWeight:700,color:"#92400e",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Alertas e Riscos</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {analysis.alertas.map(function(al,i){return (
              <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"8px 12px",background:"#fffbeb",borderRadius:8,border:"1px solid #fde68a"}}>
                <span style={{color:"#92400e",fontWeight:700,flexShrink:0}}>{"!"}</span>
                <span style={{fontSize:12,color:"#92400e",lineHeight:1.6}}>{al}</span>
              </div>
            );})}
          </div>
        </div>
      )}
    </div>
  );
}

function exportAccountPDF(acc, d) {
  function safe(path) {
    try { var parts=path.split("."); var cur=d||{}; for(var i=0;i<parts.length;i++){cur=cur[parts[i]];if(cur==null)return null;} return cur; } catch(e){return null;}
  }
  function safeA(path) { var v=safe(path); return Array.isArray(v)?v:[]; }
  var nome = acc.nome || "";
  var setor = acc.setor || "";
  var fit = (d&&d.fit&&d.fit.score) || acc.fit || "";
  var tier = acc.tier || "";
  var resumo = safe("empresa.resumo") || "";
  var dores = safeA("dores.principais");
  var triggers = safeA("triggers");
  var stakeholders = safeA("stakeholders");
  var spin = safeA("estrategia.perguntas_spin");
  var objecoes = safeA("estrategia.objecoes");
  var ae = safeA("proximos_passos.ae");
  var bdr = safeA("proximos_passos.bdr");
  var prazo = safe("proximos_passos.prazo") || "";
  var emails = safeA("estrategia.emails");
  var html = "<html><head><title>Account Map - "+nome+"</title><style>";
  html += "body{font-family:Verdana,sans-serif;padding:32px;color:#0f172a;font-size:12px;line-height:1.7;max-width:800px;margin:0 auto}";
  html += "h1{font-size:20px;color:#0f172a;margin-bottom:4px}";
  html += "h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#4361EE;margin:24px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}";
  html += ".meta{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}";
  html += ".badge{padding:3px 10px;border-radius:6px;font-size:9px;font-weight:700}";
  html += ".fit-alto{background:#dcfce7;color:#065f46}.fit-medio{background:#fef3c7;color:#92400e}.fit-baixo{background:#fee2e2;color:#991b1b}";
  html += ".tier{background:#f8fafc;border:1px solid #e2e8f0;color:#475569}";
  html += "ul{list-style:none;padding:0;margin:0}";
  html += "li{padding:4px 0 4px 14px;position:relative;border-bottom:1px solid #f8fafc}";
  html += "li:before{content:'-';position:absolute;left:0;color:#4361EE;font-weight:700}";
  html += ".msg{background:#f8fafc;border-left:3px solid #10b981;padding:12px 16px;white-space:pre-wrap;margin:6px 0;font-size:11px;line-height:1.8}";
  html += ".sk{background:#f8fafc;border-radius:8px;padding:10px 14px;margin-bottom:8px}";
  html += ".footer{margin-top:32px;border-top:1px solid #e2e8f0;padding-top:12px;font-size:10px;color:#94a3b8}";
  html += "@media print{body{padding:16px}h2{break-inside:avoid}}";
  html += "</style></head><body>";
  html += "<h1>"+nome+"</h1>";
  html += "<div class='meta'><span class='badge fit-"+fit.toLowerCase()+"'>FIT "+fit+"</span><span class='badge tier'>"+tier+"</span><span class='badge tier'>"+setor+"</span></div>";
  if (resumo) { html += "<h2>Resumo</h2><p>"+resumo+"</p>"; }
  if (dores.length) { html += "<h2>Dores Mapeadas</h2><ul>"+dores.map(function(d2){return "<li>"+d2+"</li>";}).join("")+"</ul>"; }
  if (triggers.length) { html += "<h2>Gatilhos Comerciais</h2><ul>"+triggers.map(function(t){return "<li>"+t+"</li>";}).join("")+"</ul>"; }
  if (stakeholders.length) {
    html += "<h2>Stakeholders</h2>";
    stakeholders.forEach(function(s) {
      html += "<div class='sk'><strong>"+s.cargo+"</strong> <span style='color:#94a3b8;font-size:10px'>("+s.prioridade+")</span><br/><span style='font-size:11px;color:#64748b'>"+s.angulo+"</span>";
      if (s.email) html += "<br/><a href='mailto:"+s.email+"' style='color:#0ea5e9;font-size:10px'>"+s.email+"</a>";
      if (s.linkedin) html += " <a href='"+s.linkedin+"' style='color:#0a66c2;font-size:10px'>LinkedIn</a>";
      html += "</div>";
    });
  }
  var realContacts = (acc.enriched && Array.isArray(acc.enriched.contacts)) ? acc.enriched.contacts.filter(function(c){return c.nome||c.name;}) : [];
  if (realContacts.length) {
    html += "<h2>Contatos Reais Encontrados</h2>";
    realContacts.forEach(function(c) {
      var cnome = c.nome || c.name || "";
      var ccargo = c.cargo || c.title || "";
      html += "<div class='sk'><strong>"+cnome+"</strong>";
      if (ccargo) html += " <span style='color:#64748b;font-size:11px'>, "+ccargo+"</span>";
      if (c.cidade || c.pais) html += "<br/><span style='font-size:10px;color:#94a3b8'>"+[c.cidade,c.pais].filter(Boolean).join(", ")+"</span>";
      if (c.email) html += "<br/><a href='mailto:"+c.email+"' style='color:#0ea5e9;font-size:10px'>"+c.email+"</a>";
      if (c.linkedin) html += " <a href='"+c.linkedin+"' style='color:#0a66c2;font-size:10px'>LinkedIn</a>";
      html += "</div>";
    });
  }
  if (spin.length) { html += "<h2>Perguntas SPIN</h2><ul>"+spin.map(function(q){return "<li>"+q+"</li>";}).join("")+"</ul>"; }
  if (objecoes.length) {
    html += "<h2>Objecoes e Respostas</h2>";
    objecoes.forEach(function(o) {
      html += "<div class='sk'><strong style='color:#92400e'>\""+o.objecao+"\"</strong><br/><span style='font-size:11px'>-> "+o.resposta+"</span></div>";
    });
  }
  if (ae.length || bdr.length) {
    html += "<h2>Plano de Acao</h2><div style='display:flex;gap:20px'>";
    if (ae.length) { html += "<div style='flex:1'><strong style='font-size:10px;color:#4361EE'>AE</strong><ul style='margin-top:6px'>"+ae.map(function(a){return "<li>"+a+"</li>";}).join("")+"</ul></div>"; }
    if (bdr.length) { html += "<div style='flex:1'><strong style='font-size:10px;color:#f59e0b'>BDR</strong><ul style='margin-top:6px'>"+bdr.map(function(a){return "<li>"+a+"</li>";}).join("")+"</ul></div>"; }
    html += "</div>";
    if (prazo) html += "<p style='margin-top:12px;font-size:11px'><strong>Prazo:</strong> "+prazo+"</p>";
  }
  html += "<div class='footer'>Account Mapper Mais Pipe Beta - Zendesk Suite CX - "+new Date().toLocaleDateString("pt-BR")+"</div>";
  html += "</body></html>";
  var w = window.open("","_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(function(){w.print();}, 500);
}
function AccountModal(props) {
  var acc = props.acc;
  var d = acc.data || {};
  var fit = (d.fit && d.fit.score) || acc.fit;
  var fc = FIT_CONFIG[fit] || FIT_CONFIG.ALTO;
  var sc = STATUS_CONFIG[acc.status] || STATUS_CONFIG.prospecting;
  var _st_activeTab = useState("overview"); var activeTab = _st_activeTab[0]; var setActiveTab = _st_activeTab[1];
  var _st_enrichedContacts = useState([]); var enrichedContacts = _st_enrichedContacts[0]; var setEnrichedContacts = _st_enrichedContacts[1];
  var _st_enrichedSources = useState([]); var enrichedSources = _st_enrichedSources[0]; var setEnrichedSources = _st_enrichedSources[1];
  // Load enriched stakeholder data from localStorage on open
  useEffect(function() {
    storageGet(acc.id).then(function(stored) {
      if (stored && stored.enriched && stored.enriched.contacts) {
        setEnrichedContacts(stored.enriched.contacts);
        setEnrichedSources(stored.enriched.sources || []);
      }
    });
    // Also try to load from acc.enriched directly if already merged
    if (acc.enriched && acc.enriched.contacts) {
      setEnrichedContacts(acc.enriched.contacts);
      setEnrichedSources(acc.enriched.sources || []);
    }
  }, [acc.id]);
  function sd(path) {
    try { var parts=path.split("."); var cur=d; for(var i=0;i<parts.length;i++){cur=cur[parts[i]];if(cur==null)return null;} return cur; } catch(e){return null;}
  }
  // Merge enriched contacts into stakeholder profiles for display
  function getEnrichedStakeholder(cargo) {
    if (!enrichedContacts.length) return null;
    var cargoLow = cargo.toLowerCase();
    var keywords = cargoLow.split(/[\s\/,]+/).filter(function(w){ return w.length > 3; });
    for (var i = 0; i < enrichedContacts.length; i++) {
      var c = enrichedContacts[i];
      var cLow = (c.cargo || "").toLowerCase();
      if (keywords.some(function(w){ return cLow.includes(w); })) return c;
    }
    return null;
  }
  var tabs=[{id:"overview",label:"Visão Geral"},{id:"stakeholders",label:"Stakeholders"},{id:"spin",label:"SPIN & Objeções"},{id:"plan",label:"Plano de Ação"}].concat(acc.attachData?[{id:"attachment",label:"Conteúdo Anexado"}]:[]);
  var empresa=sd("empresa")||{};
  var stakeholders=safeArr(sd("stakeholders"));
  var dores=safeArr(sd("dores.principais"));
  var exposicao=safeArr(sd("dores.exposicao_regulatoria"));
  var sinais=safeArr(sd("dores.sinais_ativos"));
  var triggers=safeArr(sd("triggers"));
  var noticias=safeArr(sd("noticias"));
  var spin=safeArr(sd("estrategia.perguntas_spin"));
  var objecoes=safeArr(sd("estrategia.objecoes"));
  var ae=safeArr(sd("proximos_passos.ae"));
  var bdr=safeArr(sd("proximos_passos.bdr"));
  var prazo=sd("proximos_passos.prazo")||"";
  var useCases=safeArr(sd("fit.use_cases"));
  var solucoes=safeArr(sd("fit.solucoes_zendesk"));
  var fitJust=sd("fit.justificativa")||"";
  var concorrentes=safeArr(sd("mercado.competidores_provedor"));
  var CHANNELS=[{key:"emails",label:"E-mail",color:"#0ea5e9",bg:"rgba(14,165,233,.08)",isObj:true},{key:"inmails",label:"InMail",color:"#0a66c2",bg:"rgba(10,102,194,.08)",isObj:true},{key:"whatsapps",label:"WhatsApp",color:"#16a34a",bg:"rgba(22,163,74,.08)",isObj:false},{key:"cold_calls",label:"Cold Call",color:"#92400e",bg:"#fef3c7",isObj:false}];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.75)",zIndex:200,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"20px 16px",overflowY:"auto",backdropFilter:"blur(10px)"}}>
      <div className="modal-box" style={{background:"rgba(255,255,255,.99)",borderRadius:24,width:"100%",maxWidth:820,boxShadow:"0 32px 100px rgba(15,23,42,.3)"}}>
        <div style={{padding:"22px 28px 0",borderBottom:"1px solid #f1f5f9"}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,marginBottom:16}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                <div style={{fontSize:21,fontWeight:800,color:"#0f172a",lineHeight:1.2}}>{acc.nome}</div>
                {acc.liveMode&&<span style={{background:"#e8ecfd",border:"1px solid #86efac",color:"#2d3a8c",borderRadius:6,padding:"2px 8px",fontSize:8,fontWeight:700}}>LIVE</span>}
              </div>
              <div style={{fontSize:12,color:"#6b7280",marginBottom:10}}>{acc.setor}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:8,padding:"4px 12px",fontSize:9,fontWeight:700}}>{"FIT "+fit}</span>
                <span style={{background:"#f8fafc",border:"1px solid "+(TIER_COLOR[acc.tier]||"#e2e8f0"),color:TIER_COLOR[acc.tier]||"#94a3b8",borderRadius:8,padding:"4px 12px",fontSize:9,fontWeight:700}}>{acc.tier}</span>
                <span style={{background:sc.bg,border:"1px solid "+sc.border,color:sc.color,borderRadius:8,padding:"4px 12px",fontSize:9,fontWeight:700}}>{sc.label}</span>
                <span style={{background:"#f8fafc",color:"#6b7280",borderRadius:8,padding:"4px 12px",fontSize:9}}>{"Salvo "+fmtDate(acc.savedAt)}</span>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0,alignItems:"flex-end"}}>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",maxWidth:200}}>
                {STATUS_ORDER.map(function(s){var sc2=STATUS_CONFIG[s];return <button key={s} onClick={function(){props.onStatusChange(acc.id,s);}} style={{background:acc.status===s?sc2.bg:"#f8fafc",border:"1px solid "+(acc.status===s?sc2.border:"#e2e8f0"),color:acc.status===s?sc2.color:"#6b7280",borderRadius:6,padding:"3px 8px",fontSize:9,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>{sc2.label}</button>;})}
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={function(){exportAccountPDF(acc,d);}} style={{display:"flex",alignItems:"center",gap:6,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"7px 14px",cursor:"pointer",color:"#0369a1",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  {"PDF"}
                </button>
                <button onClick={props.onClose} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"7px 14px",cursor:"pointer",color:"#64748b",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>{"Fechar"}</button>
              </div>
            </div>
          </div>
          <div className="modal-tabs" style={{display:"flex",gap:0,overflowX:"auto"}}>
            {tabs.map(function(tab){var active=activeTab===tab.id;return <button key={tab.id} onClick={function(){setActiveTab(tab.id);}} style={{padding:"10px 16px",border:"none",borderBottom:"2.5px solid "+(active?"#4361EE":"transparent"),background:"transparent",color:active?"#3451d1":"#94a3b8",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:active?700:500,transition:"all .15s",whiteSpace:"nowrap"}}>{tab.label}</button>;})}
          </div>
        </div>
        <div style={{padding:"22px 28px",maxHeight:"60vh",overflowY:"auto"}}>
          {activeTab==="overview"&&(
            <div>
              {empresa.resumo&&<Sec title={empresa.resumoAI?"Resumo da Empresa · IA":"Resumo da Empresa"}><p style={{fontSize:13,lineHeight:1.8,color:"#334155",margin:"0 0 14px"}}>{empresa.resumo}</p><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>{[["Setor",empresa.setor],["Porte",empresa.tamanho],["Faturamento",empresa.faturamento],["Clientes",empresa.clientes],["Estágio",empresa.estagio],["Bolsa",empresa.bolsa]].filter(function(x){return x[1];}).map(function(item){return <div key={item[0]} style={{background:"#e8ecfd",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 12px"}}><div style={{fontSize:8,color:"#2d3a8c",textTransform:"uppercase",letterSpacing:1,fontWeight:700,marginBottom:3}}>{item[0]}</div><div style={{fontSize:12,color:"#0f172a",fontWeight:600}}>{item[1]}</div></div>;})}</div></Sec>}
              {fitJust&&<Sec title="Fit Zendesk"><p style={{fontSize:13,lineHeight:1.7,color:"#334155",marginBottom:10}}>{fitJust}</p>{solucoes.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6}}>{solucoes.map(function(s,i){return <span key={i} style={{background:"rgba(67,97,238,.08)",border:"1px solid rgba(67,97,238,.25)",color:"#3451d1",borderRadius:8,padding:"3px 10px",fontSize:10,fontWeight:600}}>{s}</span>;})}</div>}</Sec>}
              {useCases.length>0&&<Sec title="Use Cases Prioritários">{useCases.map(function(u,i){return <R key={i} icon=">" color="#4361EE">{u}</R>;})}</Sec>}
              {dores.length>0&&<Sec title="Possiveis dores para mapear">{dores.map(function(d2,i){return <R key={i} icon="!" color="#ef4444">{d2}</R>;})} {exposicao.length>0&&<div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:6}}>{exposicao.map(function(r,i){return <span key={i} style={{background:"#fef3c7",border:"1px solid #f59e0b",color:"#92400e",borderRadius:8,padding:"3px 10px",fontSize:10,fontWeight:600}}>{r}</span>;})}</div>}</Sec>}
              {triggers.length>0&&<Sec title="Gatilhos Comerciais">{triggers.map(function(t,i){return <R key={i} icon="T" color="#7c3aed">{t}</R>;})}</Sec>}
              {sinais.length>0&&<Sec title="Sinais de Intenção"><div style={{background:"#0c2340",borderRadius:12,padding:"12px 16px"}}>{sinais.map(function(s,i){return <div key={i} style={{fontSize:11.5,color:"#7dd3fc",lineHeight:1.6,display:"flex",gap:8,marginBottom:5}}><span style={{color:"#38bdf8",flexShrink:0}}>o</span>{s}</div>;})}</div></Sec>}
              {concorrentes.length>0&&<Sec title="Concorrentes Prováveis"><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{concorrentes.map(function(cc,i){return <span key={i} style={{background:"#fef3c7",border:"1px solid #f59e0b",color:"#92400e",borderRadius:8,padding:"3px 10px",fontSize:10,fontWeight:600}}>{cc}</span>;})}</div></Sec>}
              {noticias.length>0&&<Sec title="Notícias e Contexto">{noticias.map(function(n,i){return <div key={i} style={{background:"#f8fafc",border:"1px solid #e8edf4",borderRadius:12,padding:"12px 14px",marginBottom:8}}>{n.url?<a href={n.url} target="_blank" rel="noopener noreferrer" style={{fontSize:12.5,fontWeight:700,color:"#0ea5e9",textDecoration:"none",display:"block",marginBottom:3}}>{n.titulo}</a>:<div style={{fontSize:12.5,fontWeight:700,color:"#0f172a",marginBottom:3}}>{n.titulo}</div>}<div style={{fontSize:11.5,color:"#64748b",lineHeight:1.6,marginBottom:3}}>{n.resumo}</div><div style={{fontSize:10,color:"#3451d1",fontWeight:600}}>{"-> "+n.relevancia}</div></div>;})}</Sec>}
            </div>
          )}
          {activeTab==="stakeholders"&&(
            <div>
              {enrichedContacts.length>0&&(
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:1.5,color:"#3451d1",textTransform:"uppercase",marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE",boxShadow:"0 0 8px rgba(16,185,129,.5)"}}/>
                    {"Contatos Reais Encontrados , "+enrichedContacts.length+" perfil"+(enrichedContacts.length>1?"s":"")}
                    {enrichedSources.map(function(s,i){return <span key={i} style={{background:"rgba(67,97,238,.08)",border:"1px solid rgba(67,97,238,.2)",color:"#3451d1",borderRadius:6,padding:"2px 8px",fontSize:8,fontWeight:600}}>{s}</span>;})}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10,marginBottom:16}}>
                    {enrichedContacts.map(function(contact,i){
                      return (
                        <div key={i} style={{background:"linear-gradient(145deg,#f0fdf4,#fff)",border:"1.5px solid rgba(67,97,238,.25)",borderRadius:14,padding:"14px 16px"}}>
                          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:1}}>{contact.nome||contact.name||""}</div>
                          {(contact.cargo||contact.title)&&<div style={{fontSize:10,color:"#3451d1",marginBottom:6,fontWeight:600}}>{contact.cargo||contact.title}</div>}
                          <div style={{display:"flex",flexDirection:"column",gap:5}}>
                            {contact.email&&(
                              <a href={"mailto:"+contact.email} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#0ea5e9",textDecoration:"none",background:"rgba(14,165,233,.06)",borderRadius:6,padding:"4px 8px"}}>
                                <span>{"@"}</span>
                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{contact.email}</span>
                                {contact.email_confidence>0&&<span style={{fontSize:8,color:"#6b7280",marginLeft:"auto",flexShrink:0}}>{contact.email_confidence+"%"}</span>}
                              </a>
                            )}
                            {contact.linkedin&&(
                              <a href={contact.linkedin.startsWith("http")?contact.linkedin:"https://www.linkedin.com/in/"+contact.linkedin} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#0a66c2",textDecoration:"none",background:"rgba(10,102,194,.06)",borderRadius:6,padding:"4px 8px",fontWeight:600}}>
                                <span>in</span><span>Ver perfil LinkedIn</span>
                              </a>
                            )}
                            {contact.phone&&<span style={{fontSize:10,color:"#64748b",padding:"2px 0"}}>{contact.phone}</span>}
                            <span style={{fontSize:8,color:"#6b7280",fontStyle:"italic"}}>{contact.source}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <Sec title="Mapeamento Estratégico de Cargos">
              <div className="modal-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {stakeholders.map(function(s,i){
                  var pc=s.prioridade==="PRIMARIO"?"#2d3a8c":s.prioridade==="SECUNDARIO"?"#92400e":"#475569";
                  var uc=s.urgencia==="Alta"?"#991b1b":s.urgencia==="Media"||s.urgencia==="Média"?"#92400e":"#64748b";
                  var match=getEnrichedStakeholder(s.cargo);
                  return (
                    <div key={i} style={{background:match?"linear-gradient(145deg,#f0fdf4,#fff)":"#f8fafc",border:"1.5px solid "+(match?"rgba(67,97,238,.3)":"#e8edf4"),borderRadius:14,padding:"14px 16px",transition:"all .2s"}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.boxShadow="0 4px 16px rgba(67,97,238,.1)";}} onMouseLeave={function(e){e.currentTarget.style.borderColor=match?"rgba(67,97,238,.3)":"#e8edf4";e.currentTarget.style.boxShadow="";}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                        <div style={{fontSize:12.5,fontWeight:700,color:"#0f172a",lineHeight:1.3,flex:1}}>{s.cargo}</div>
                        <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end",marginLeft:8,flexShrink:0}}>
                          <span style={{background:pc+"20",border:"1px solid "+pc,color:pc,borderRadius:6,padding:"2px 7px",fontSize:8,fontWeight:700,whiteSpace:"nowrap"}}>{s.prioridade}</span>
                          <span style={{fontSize:8,color:uc,fontWeight:600}}>{"Urgência: "+s.urgencia}</span>
                        </div>
                      </div>
                      {match&&(
                        <div style={{background:"rgba(67,97,238,.08)",border:"1px solid rgba(67,97,238,.2)",borderRadius:8,padding:"6px 10px",marginBottom:8}}>
                          <div style={{fontSize:11,fontWeight:700,color:"#3451d1",marginBottom:3}}>{"✓ Match: "+match.nome}</div>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {match.email&&<a href={"mailto:"+match.email} style={{fontSize:10,color:"#0ea5e9",textDecoration:"none"}}>{match.email}</a>}
                            {match.linkedin&&<a href={match.linkedin.startsWith("http")?match.linkedin:"https://www.linkedin.com/in/"+match.linkedin} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:"#0a66c2",textDecoration:"none",fontWeight:600}}>Ver LinkedIn -></a>}
                          </div>
                        </div>
                      )}
                      <div style={{fontSize:11,color:"#64748b",lineHeight:1.6}}>{s.angulo}</div>
                    </div>
                  );
                })}
              </div>
              </Sec>
            </div>
          )}
          {activeTab==="spin"&&(
            <div>
              <Sec title="Perguntas SPIN">
                {spin.map(function(q,i){
                  var tipo=q.startsWith("SITUAÇÃO")||q.startsWith("SITUAÇÃO")?"S":q.startsWith("PROBLEMA")?"P":q.startsWith("IMPLICAÇÃO")||q.startsWith("IMPLICAÇÃO")?"I":"N";
                  var tc=tipo==="S"?"#0ea5e9":tipo==="P"?"#92400e":tipo==="I"?"#991b1b":"#2d3a8c";
                  var clean=q.indexOf(": ")>-1?q.slice(q.indexOf(": ")+2):q;
                  return (
                    <div key={i} style={{display:"flex",gap:10,padding:"10px 0",borderBottom:"1px solid #f1f5f9",alignItems:"flex-start"}}>
                      <span style={{background:tc+"20",border:"1px solid "+tc+"50",color:tc,borderRadius:6,padding:"2px 8px",fontSize:9,fontWeight:800,flexShrink:0,marginTop:1}}>{tipo}</span>
                      <span style={{fontSize:12.5,color:"#334155",lineHeight:1.6,flex:1}}>{clean}</span>
                      <CopyBtn text={clean}/>
                    </div>
                  );
                })}
              </Sec>
              {objecoes.length>0&&(
                <Sec title="Objeções e Respostas">
                  {objecoes.map(function(o,i){
                    return (
                      <div key={i} style={{background:"#f8fafc",border:"1.5px solid #e8edf4",borderRadius:14,padding:"14px 16px",marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8}}>
                          <div style={{fontSize:12,fontWeight:700,color:"#92400e",lineHeight:1.4,flex:1}}>{'"'+o.objecao+'"'}</div>
                          <CopyBtn text={'"'+o.objecao+'"\n-> '+o.resposta}/>
                        </div>
                        <div style={{fontSize:12,color:"#334155",lineHeight:1.65}}>{"-> "+o.resposta}</div>
                      </div>
                    );
                  })}
                </Sec>
              )}
            </div>
          )}
          {activeTab==="attachment"&&(
            <AttachmentAnalysis acc={acc}/>
          )}
          {activeTab==="plan"&&(
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:18}}>
                <Sec title="AE , Ações Imediatas">
                  {ae.map(function(a,i){return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"8px 0",borderBottom:"1px solid #f1f5f9",gap:8}}><div style={{display:"flex",gap:8,flex:1}}><span style={{color:"#4361EE",flexShrink:0,fontWeight:700}}>{">"}</span><span style={{fontSize:12,color:"#334155",lineHeight:1.5}}>{a}</span></div><CopyBtn text={a}/></div>;})}
                </Sec>
                <Sec title="BDR , Ações de Suporte">
                  {bdr.map(function(a,i){return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"8px 0",borderBottom:"1px solid #f1f5f9",gap:8}}><div style={{display:"flex",gap:8,flex:1}}><span style={{color:"#f59e0b",flexShrink:0,fontWeight:700}}>{">"}</span><span style={{fontSize:12,color:"#334155",lineHeight:1.5}}>{a}</span></div><CopyBtn text={a}/></div>;})}
                </Sec>
              </div>
              {prazo&&<div style={{background:"rgba(67,97,238,.06)",border:"1px solid rgba(67,97,238,.2)",borderRadius:14,padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}><div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#4361EE,#3451d1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg></div><div><div style={{fontSize:9,color:"#3451d1",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:2}}>Prazo</div><div style={{fontSize:13,color:"#0f172a",fontWeight:600}}>{prazo}</div></div></div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function CollapsibleChannels(props) {
  var sd = props.sd; var CHANNELS = props.CHANNELS;
  var _st_open = useState({"emails":true,"inmails":false,"whatsapps":false,"cold_calls":false}); var open = _st_open[0]; var setOpen = _st_open[1];
  function toggle(key) { setOpen(function(prev){var n=Object.assign({},prev);n[key]=!n[key];return n;}); }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {CHANNELS.map(function(cfg){
        var items=safeArr(sd("estrategia."+cfg.key));
        if(!items.length)return null;
        var isOpen=open[cfg.key];
        return (
          <div key={cfg.key} style={{border:"1.5px solid #e8edf4",borderRadius:16,overflow:"hidden",transition:"all .25s"}}>
            <div onClick={function(){toggle(cfg.key);}} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 18px",background:isOpen?cfg.bg:"#fafafa",cursor:"pointer",userSelect:"none",transition:"background .2s"}}>
              <div style={{width:32,height:32,borderRadius:9,background:cfg.bg,border:"1.5px solid "+cfg.color+"40",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:11,fontWeight:800,color:cfg.color}}>{cfg.label.slice(0,2)}</span>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{cfg.label}</div>
                <div style={{fontSize:10,color:"#6b7280"}}>{items.length+" template"+(items.length>1?"s":"")}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform .25s cubic-bezier(.22,1,.36,1)",transform:isOpen?"rotate(180deg)":"rotate(0deg)"}}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
            {isOpen&&(
              <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:12,borderTop:"1px solid #f1f5f9"}}>
                {items.map(function(item,i){
                  var text=cfg.isObj?item.corpo:item;
                  var ck=cfg.key+"-"+i;
                  return (
                    <div key={i} style={{border:"1px solid #e8edf4",borderRadius:12,overflow:"hidden"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 14px",background:cfg.bg}}>
                        <span style={{fontSize:10,fontWeight:700,color:cfg.color}}>{"Template "+(i+1)}</span>
                        {cfg.isObj&&item.assunto&&<span style={{fontSize:11,color:"#64748b",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{", "+item.assunto}</span>}
                        <CopyBtn text={(cfg.isObj&&item.assunto?"Assunto: "+item.assunto+"\n\n":"")+text}/>
                      </div>
                      <div style={{padding:"14px 16px",fontSize:12.5,color:"#1e293b",whiteSpace:"pre-wrap",lineHeight:1.85,borderLeft:"3px solid "+cfg.color}}>{text}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function downloadSeqPDF(seq) {
  var TOUCH_LABELS = {email:"E-mail",linkedin:"InMail",whatsapp:"WhatsApp",call:"Cold Call",follow:"Follow-up",breakup:"Breakup"};
  var html = "<html><head><title>"+((seq.account&&seq.account.nome)||"Sequencia")+"</title><style>body{font-family:Verdana,sans-serif;padding:32px;color:#0f172a;font-size:12px;line-height:1.7}h1{font-size:16px;color:#059669}h2{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#4361EE;margin:20px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}.msg{background:#f8fafc;border-left:4px solid #10b981;padding:12px 16px;white-space:pre-wrap;margin:6px 0;font-size:11px;line-height:1.8}.day{display:inline-block;background:#dcfce7;color:#065f46;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;margin-bottom:6px}.footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:10px;font-size:10px;color:#94a3b8}</style></head><body>";
  html += "<h1>Sequencia: "+((seq.account&&seq.account.nome)||"")+((seq.profile&&seq.profile.label)?" , "+seq.profile.label:"")+"</h1>";
  html += "<p style='color:#64748b;font-size:11px'>Gerado em "+fmtDate(seq.createdAt)+" - Mais Pipe Beta</p>";
  (seq.touches||[]).forEach(function(t,i) {
    html += "<h2>"+(TOUCH_LABELS[t.type]||t.type)+" , Dia "+t.day+"</h2>";
    if (t.subject) html += "<div class='day'>Assunto: "+t.subject+"</div>";
    html += "<div class='msg'>"+t.body+"</div>";
  });
  html += "<div class='footer'>Mais Pipe Beta , Zendesk , BDR/SDR Zendesk</div></body></html>";
  var w = window.open("","_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(function(){w.print();}, 400);
}
function BibliotecaView(props) {
  var _st_seqs = useState([]); var seqs = _st_seqs[0]; var setSeqs = _st_seqs[1];
  var _st_loading = useState(true); var loading = _st_loading[0]; var setLoading = _st_loading[1];
  var _st_viewMode = useState("cards"); var viewMode = _st_viewMode[0]; var setViewMode = _st_viewMode[1];
  var _st_sortOrder = useState("date"); var sortOrder = _st_sortOrder[0]; var setSortOrder = _st_sortOrder[1];
  useEffect(function() {
    storageList("seq:").then(function(keys) {
      if (!keys.length) { setLoading(false); props.onCountChange(0); return; }
      Promise.all(keys.map(storageGet)).then(function(items) {
        var valid = items.filter(Boolean); setSeqs(valid);
        setLoading(false); props.onCountChange(valid.length);
      });
    }).catch(function(){setLoading(false);});
  }, []);
  function deleteSeq(id) {
    if (!window.confirm("Remover esta sequencia?")) return;
    storageDel(id).then(function() {
      setSeqs(function(prev){var n=prev.filter(function(s){return s.id!==id;});props.onCountChange(n.length);return n;});
      props.showToast("Sequencia removida.","#ef4444");
    });
  }
  if (loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"64px 0",gap:10}}><div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE"}}/><span style={{color:"#6b7280",fontSize:13}}>Carregando...</span></div>;
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:"-0.6px"}}>Biblioteca</div>
          <div style={{fontSize:13,color:"#64748b"}}>{seqs.length+" sequência"+(seqs.length!==1?"s":"")+" salva"+(seqs.length!==1?"s":"")}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={sortOrder} onChange={function(e){setSortOrder(e.target.value);}} style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#475569",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
            <option value="date">Mais recente</option>
            <option value="az">A -> Z</option>
            <option value="za">Z -> A</option>
          </select>
          <div style={{display:"flex",background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,overflow:"hidden"}}>
            <button onClick={function(){setViewMode("cards");}} title="Cards" style={{padding:"8px 12px",border:"none",background:viewMode==="cards"?"linear-gradient(135deg,#4361EE,#3451d1)":"transparent",color:viewMode==="cards"?"#fff":"#94a3b8",cursor:"pointer",lineHeight:1}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </button>
            <button onClick={function(){setViewMode("list");}} title="Lista" style={{padding:"8px 12px",border:"none",background:viewMode==="list"?"linear-gradient(135deg,#4361EE,#3451d1)":"transparent",color:viewMode==="list"?"#fff":"#94a3b8",cursor:"pointer",lineHeight:1}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
      {seqs.length===0 ? (
        <div style={{textAlign:"center",padding:"64px 0",background:"#f8fafc",borderRadius:20,border:"1.5px dashed #e2e8f0"}}>
          <div style={{fontSize:36,marginBottom:12}}>{"📚"}</div>
          <div style={{fontSize:15,fontWeight:700,color:"#334155",marginBottom:6}}>{"Nenhuma sequência salva ainda"}</div>
          <div style={{fontSize:12,color:"#6b7280",lineHeight:1.6}}>{"Vá para Sequências, gere uma cadência e clique em Salvar na Biblioteca."}</div>
        </div>
      ) : (
        viewMode==="cards" ? (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
          {seqs.slice().sort(function(a,b){
            if(sortOrder==="az") return ((a.account&&a.account.nome)||"").localeCompare((b.account&&b.account.nome)||"","pt");
            if(sortOrder==="za") return ((b.account&&b.account.nome)||"").localeCompare((a.account&&a.account.nome)||"","pt");
            return (b.createdAt||0)-(a.createdAt||0);
          }).map(function(seq){
            var fc = FIT_CONFIG[(seq.account&&seq.account.fit)||"ALTO"]||FIT_CONFIG.ALTO;
            var TOUCH_TYPES_LOCAL = {email:{label:"E-mail",color:"#0ea5e9",bg:"rgba(14,165,233,.08)"},linkedin:{label:"InMail",color:"#0a66c2",bg:"rgba(10,102,194,.08)"},whatsapp:{label:"WhatsApp",color:"#16a34a",bg:"rgba(22,163,74,.08)"},call:{label:"Cold Call",color:"#92400e",bg:"#fef3c7"},follow:{label:"Follow-up",color:"#7c3aed",bg:"#f5f3ff"},breakup:{label:"Breakup",color:"#64748b",bg:"#f8fafc"}};
            return (
              <div key={seq.id} style={{background:"#fff",border:"1.5px solid #e8edf4",borderRadius:20,padding:"20px 22px",boxShadow:"0 2px 12px rgba(15,23,42,.06)",transition:"all .25s"}} onMouseEnter={function(e){e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 40px rgba(15,23,42,.12)";e.currentTarget.style.borderColor="#d1dae8";}} onMouseLeave={function(e){e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 12px rgba(15,23,42,.06)";e.currentTarget.style.borderColor="#e8edf4";}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{seq.account&&seq.account.nome}</div>
                    <div style={{fontSize:11,color:"#6b7280",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{seq.profile&&seq.profile.label}</div>
                    <div style={{fontSize:10,color:"#cbd5e1"}}>{fmtDate(seq.createdAt)}</div>
                  </div>
                  <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:8,padding:"3px 10px",fontSize:9,fontWeight:700,flexShrink:0,marginLeft:8}}>{"FIT "+(seq.account&&seq.account.fit)}</span>
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
                  {safeArr(seq.touches).map(function(t,i){
                    var tc=TOUCH_TYPES_LOCAL[t.type]||TOUCH_TYPES_LOCAL.email;
                    return <span key={i} style={{background:tc.bg,color:tc.color,borderRadius:6,padding:"2px 8px",fontSize:9,fontWeight:700}}>{"D"+t.day+" "+tc.label}</span>;
                  })}
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={function(){props.onOpenSeq(seq);}} style={{flex:1,background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"8px 0",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Abrir</button>
                  <button onClick={function(){downloadSeqPDF(seq);}} title="Baixar PDF" style={{background:"#eff6ff",border:"1px solid #bfdbfe",color:"#0369a1",borderRadius:10,padding:"8px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>PDF</button>
                  <button onClick={function(){deleteSeq(seq.id);}} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:10,padding:"8px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>x</button>
                </div>
              </div>
            );
          })}
        </div>
        ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {seqs.slice().sort(function(a,b){
            if(sortOrder==="az") return ((a.account&&a.account.nome)||"").localeCompare((b.account&&b.account.nome)||"","pt");
            if(sortOrder==="za") return ((b.account&&b.account.nome)||"").localeCompare((a.account&&a.account.nome)||"","pt");
            return (b.createdAt||0)-(a.createdAt||0);
          }).map(function(seq){
            var fc=FIT_CONFIG[(seq.account&&seq.account.fit)||"ALTO"]||FIT_CONFIG.ALTO;
            return (
              <div key={seq.id} style={{background:"#fff",border:"1px solid #e8edf4",borderRadius:14,padding:"12px 18px",display:"flex",alignItems:"center",gap:14,transition:"all .2s"}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.boxShadow="0 2px 12px rgba(67,97,238,.08)";}} onMouseLeave={function(e){e.currentTarget.style.borderColor="#e8edf4";e.currentTarget.style.boxShadow="";}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13.5,fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{seq.account&&seq.account.nome}</div>
                  <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{seq.profile&&seq.profile.label}</div>
                </div>
                <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:7,padding:"2px 8px",fontSize:9,fontWeight:700,flexShrink:0}}>{"FIT "+(seq.account&&seq.account.fit)}</span>
                <span style={{fontSize:10,color:"#6b7280",flexShrink:0}}>{fmtDate(seq.createdAt)}</span>
                <button onClick={function(){props.onOpenSeq(seq);}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Abrir</button>
                <button onClick={function(){downloadSeqPDF(seq);}} style={{background:"#eff6ff",border:"1px solid #bfdbfe",color:"#0369a1",borderRadius:8,padding:"5px 10px",fontSize:10,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>PDF</button>
                <button onClick={function(){deleteSeq(seq.id);}} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:8,padding:"5px 8px",fontSize:10,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>x</button>
              </div>
            );
          })}
        </div>
        )
      )}
    </div>
  );
}
function Sec(props) {
  return (
    <div style={{marginBottom:22}}>
      <div style={{fontSize:9,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#4361EE",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
        <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
        {props.title}
      </div>
      {props.children}
    </div>
  );
}
function R(props) {
  return <div style={{display:"flex",gap:8,padding:"7px 0",borderBottom:"1px solid #f1f5f9",fontSize:12.5,color:"#334155",lineHeight:1.55}}><span style={{color:props.color,flexShrink:0,fontWeight:700}}>{props.icon}</span>{props.children}</div>;
}
// -- SEARCH VIEW ---------------------------------------------------------------
function LoadingStatus() {
  var steps = [
    {text:"Consultando fontes públicas com IA...", icon:"🔍"},
    {text:"Mapeando stakeholders e estrutura da empresa...", icon:"🧭"},
    {text:"Gerando fit score e dores de CX...", icon:"⚡"},
    {text:"Criando mensagens personalizadas por canal...", icon:"✉"},
    {text:"Montando plano de prospecção...", icon:"🎯"},
  ];
  var _st_step = useState(0); var step = _st_step[0]; var setStep = _st_step[1];
  useEffect(function() {
    var t = setInterval(function() {
      setStep(function(s) { return (s+1) % steps.length; });
    }, 1800);
    return function() { clearInterval(t); };
  }, []);
  return (
    <div style={{marginTop:16,background:"linear-gradient(135deg,rgba(67,97,238,.06),rgba(14,165,233,.04))",border:"1.5px solid rgba(67,97,238,.2)",borderRadius:16,padding:"16px 20px"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE",boxShadow:"0 0 0 3px rgba(67,97,238,.2)",animation:"pulse 1s ease-in-out infinite",flexShrink:0}}/>
        <span style={{fontSize:13,color:"#3451d1",fontWeight:700}}>Mais Pipe com IA</span>
        <span style={{fontSize:10,color:"#6b7280",marginLeft:"auto"}}>{"análise em tempo real"}</span>
      </div>
      <div style={{fontSize:13,color:"#334155",lineHeight:1.6,display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:16}}>{steps[step].icon}</span>
        <span style={{transition:"opacity .3s"}}>{steps[step].text}</span>
      </div>
      <div style={{marginTop:12,height:3,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",background:"linear-gradient(90deg,#10b981,#0ea5e9)",borderRadius:3,animation:"shimmer 1.5s ease-in-out infinite",backgroundSize:"200% 100%"}}/>
      </div>
    </div>
  );
}


// -- CONTACTS VIEW -------------------------------------------------------------
function ContactsView(props) {
  var _st_contacts = useState([]); var contacts = _st_contacts[0]; var setContacts = _st_contacts[1];
  var _st_loading = useState(true); var loadingC = _st_loading[0]; var setLoadingC = _st_loading[1];
  var _st_csort = useState("az"); var csort = _st_csort[0]; var setCsort = _st_csort[1];
  var _st_search = useState(""); var search = _st_search[0]; var setSearch = _st_search[1];
  var _st_enriching = useState({}); var enriching = _st_enriching[0]; var setEnriching = _st_enriching[1];
  var _st_toast = useState(null); var toastC = _st_toast[0]; var setToastC = _st_toast[1];
  var _st_expanded = useState({}); var expandedGroups = _st_expanded[0]; var setExpandedGroups = _st_expanded[1];
  var _st_addModal = useState(false); var addModal = _st_addModal[0]; var setAddModal = _st_addModal[1];
  var _st_newNome = useState(""); var newNome = _st_newNome[0]; var setNewNome = _st_newNome[1];
  var _st_newCargo = useState(""); var newCargo = _st_newCargo[0]; var setNewCargo = _st_newCargo[1];
  var _st_newEmpresa = useState(""); var newEmpresa = _st_newEmpresa[0]; var setNewEmpresa = _st_newEmpresa[1];
  var _st_newEmail = useState(""); var newEmail = _st_newEmail[0]; var setNewEmail = _st_newEmail[1];
  var _st_newLinkedin = useState(""); var newLinkedin = _st_newLinkedin[0]; var setNewLinkedin = _st_newLinkedin[1];
  var _st_newDomain = useState(""); var newDomain = _st_newDomain[0]; var setNewDomain = _st_newDomain[1];
  var _st_saving = useState(false); var saving = _st_saving[0]; var setSaving = _st_saving[1];

  function toggleGroup(empresa) {
    setExpandedGroups(function(prev) { var n=Object.assign({},prev); n[empresa]=!prev[empresa]; return n; });
  }

  function addContactManual() {
    if (!newNome && !newCargo) return;
    setSaving(true);
    var cid = "contact:" + Date.now() + "-" + Math.random().toString(36).slice(2,7);
    var c = { id:cid, nome:newNome||(newCargo||""), cargo:newCargo||"", empresa:newEmpresa||"", email:newEmail||"", emailValidated:false, linkedin:newLinkedin||"", domain:newDomain||"", savedAt:Date.now() };
    storageSet(cid, c).then(function() {
      setContacts(function(prev){ return [c].concat(prev); });
      setAddModal(false);
      setNewNome(""); setNewCargo(""); setNewEmpresa(""); setNewEmail(""); setNewLinkedin(""); setNewDomain("");
      showToastC("Contato adicionado!", "#10b981");
    }).finally(function(){ setSaving(false); });
  }

  useEffect(function() {
    storageList("contact:").then(function(keys) {
      if (!keys.length) { setLoadingC(false); return; }
      Promise.all(keys.map(storageGet)).then(function(items) {
        setContacts(items.filter(Boolean));
        setLoadingC(false);
      });
    }).catch(function(){ setLoadingC(false); });
  }, []);

  function showToastC(msg, color) {
    setToastC({msg:msg,color:color||"#3451d1"});
    setTimeout(function(){ setToastC(null); }, 3000);
  }

  function deleteContact(id) {
    if (!window.confirm("Remover este contato?")) return;
    storageDel(id).then(function() {
      setContacts(function(prev){ return prev.filter(function(c){ return c.id !== id; }); });
      showToastC("Contato removido.", "#ef4444");
    });
  }

  function enrichEmail(contact) {
    setEnriching(function(e){ var n=Object.assign({},e); n[contact.id]=true; return n; });
    fetch("/api/hunter", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({first_name:(contact.nome||"").split(" ")[0], last_name:(contact.nome||"").split(" ").slice(1).join(" "), organization_name:contact.empresa, domain:contact.domain||""})
    }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); }).then(function(res) {
      var data = res.data || {};
      if (data.error) { showToastC(data.error, "#f59e0b"); return; }
      var email = (data.person && data.person.email) || "";
      if (!email) { showToastC(data.message || ("Nenhum e-mail encontrado para este contato (HTTP " + res.status + ")."), "#f59e0b"); }
      else {
        var conf = (data.person && data.person.email_confidence) || 0;
        var updated = Object.assign({}, contact, {email:email, emailValidated:true, emailConfidence:conf, domain:(data.person&&data.person.domain)||contact.domain||""});
        storageSet(contact.id, updated).then(function() {
          setContacts(function(prev){ return prev.map(function(c){ return c.id===contact.id ? updated : c; }); });
          showToastC("E-mail encontrado (" + conf + "% confianca): " + email, "#10b981");
        });
      }
    }).catch(function() {
      showToastC("Erro ao consultar Hunter. Verifique a chave HUNTER_API_KEY no servidor.", "#ef4444");
    }).finally(function() {
      setEnriching(function(e){ var n=Object.assign({},e); delete n[contact.id]; return n; });
    });
  }

  var filtered = contacts.filter(function(c) {
    if (!search) return true;
    var q = search.toLowerCase();
    return (c.nome||"").toLowerCase().includes(q) || (c.empresa||"").toLowerCase().includes(q) || (c.cargo||"").toLowerCase().includes(q);
  });

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:"-0.6px"}}>{"Contatos"}</div>
          <div style={{fontSize:13,color:"#64748b"}}>{contacts.length + " contato" + (contacts.length!==1?"s":"") + " mapeado" + (contacts.length!==1?"s":"")}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder={"Buscar..."} style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 14px",fontSize:13,color:"#0f172a",fontFamily:"inherit",outline:"none",minWidth:160,flex:1}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
          <select value={csort} onChange={function(e){setCsort(e.target.value);}} style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 12px",fontSize:12,color:"#475569",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
            <option value="az">A - Z</option>
            <option value="za">Z - A</option>
          </select>
          <button onClick={function(){setAddModal(true);}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"9px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 4px 12px rgba(67,97,238,.25)"}}>{"+ Novo"}</button>
        </div>
      </div>
      {addModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}} onClick={function(e){if(e.target===e.currentTarget)setAddModal(false);}}>
          <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:440,padding:"24px",boxShadow:"0 24px 80px rgba(15,23,42,.25)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{fontSize:16,fontWeight:800,color:"#0f172a",marginBottom:16}}>{"Adicionar Contato"}</div>
            {[
              {label:"Nome completo", val:newNome, set:setNewNome, ph:"Ex: Ana Lima"},
              {label:"Cargo", val:newCargo, set:setNewCargo, ph:"Ex: VP de Operacoes"},
              {label:"Empresa", val:newEmpresa, set:setNewEmpresa, ph:"Ex: Nubank"},
              {label:"Dominio (melhora busca de e-mail)", val:newDomain, set:setNewDomain, ph:"Ex: nubank.com.br"},
              {label:"E-mail", val:newEmail, set:setNewEmail, ph:"Ex: ana@nubank.com"},
              {label:"LinkedIn URL", val:newLinkedin, set:setNewLinkedin, ph:"Ex: linkedin.com/in/analima"},
            ].map(function(f) {
              return (
                <div key={f.label} style={{marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>{f.label}</div>
                  <input value={f.val} onChange={function(e){f.set(e.target.value);}} placeholder={f.ph} style={{width:"100%",boxSizing:"border-box",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 12px",fontSize:13,color:"#0f172a",fontFamily:"inherit",outline:"none"}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
                </div>
              );
            })}
            <div style={{display:"flex",gap:8,marginTop:16}}>
              <button onClick={function(){setAddModal(false);}} style={{flex:1,background:"#f8fafc",border:"1px solid #e2e8f0",color:"#64748b",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Cancelar"}</button>
              <button onClick={addContactManual} disabled={saving||(!newNome&&!newCargo)} style={{flex:2,background:(saving||(!newNome&&!newCargo))?"#e2e8f0":"linear-gradient(135deg,#4361EE,#3451d1)",color:(saving||(!newNome&&!newCargo))?"#94a3b8":"#fff",border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:(saving||(!newNome&&!newCargo))?"default":"pointer",fontFamily:"inherit"}}>
                {saving ? "Salvando..." : "Salvar contato"}
              </button>
            </div>
          </div>
        </div>
      )}
      {loadingC ? (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"64px 0",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE"}}/>
          <span style={{color:"#6b7280",fontSize:13}}>{"Carregando..."}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{textAlign:"center",padding:"64px 0",background:"#f8fafc",borderRadius:20,border:"1.5px dashed #e2e8f0"}}>
          <div style={{fontSize:36,marginBottom:12}}>{"👥"}</div>
          <div style={{fontSize:15,fontWeight:700,color:"#334155",marginBottom:6}}>{search ? "Nenhum contato encontrado" : "Nenhum contato ainda"}</div>
          <div style={{fontSize:12,color:"#6b7280",lineHeight:1.6}}>{search ? "Tente outro termo de busca." : "Os contatos sao criados automaticamente ao fazer uma pesquisa com IA que retorne stakeholders."}</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:20}}>
          {(function(){
            var grouped = {};
            filtered.forEach(function(c){
              var key = c.empresa || "Sem empresa";
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(c);
            });
            return Object.keys(grouped).sort(function(a,b){ return csort==="za" ? b.localeCompare(a) : a.localeCompare(b); }).map(function(empresa) {
              var group = grouped[empresa].slice().sort(function(a,b){ var an=(a.nome||"").toLowerCase(), bn=(b.nome||"").toLowerCase(); return csort==="za" ? bn.localeCompare(an) : an.localeCompare(bn); });
              return (
                <div key={empresa}>
                  <div onClick={function(){toggleGroup(empresa);}} style={{display:"flex",alignItems:"center",gap:8,marginBottom:expandedGroups[empresa]?10:0,padding:"10px 14px",background:"linear-gradient(135deg,rgba(67,97,238,.07),rgba(14,165,233,.04))",border:"1px solid rgba(67,97,238,.14)",borderRadius:expandedGroups[empresa]?"12px 12px 0 0":12,cursor:"pointer",userSelect:"none",transition:"all .2s"}} onMouseEnter={function(e){e.currentTarget.style.background="linear-gradient(135deg,rgba(67,97,238,.12),rgba(14,165,233,.07))";}} onMouseLeave={function(e){e.currentTarget.style.background="linear-gradient(135deg,rgba(67,97,238,.07),rgba(14,165,233,.04))";}}>
                    <span style={{fontSize:14}}>{"🏢"}</span>
                    <span style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{empresa}</span>
                    <span style={{fontSize:10,color:"#6b7280",marginLeft:"auto",marginRight:6}}>{group.length + " contato" + (group.length!==1?"s":"")}</span>
                    <span style={{fontSize:10,color:"#4361EE",fontWeight:700,transition:"transform .2s",display:"inline-block",transform:expandedGroups[empresa]?"rotate(0deg)":"rotate(-90deg)"}}>{"▼"}</span>
                  </div>
                  {expandedGroups[empresa] && <div style={{display:"flex",flexDirection:"column",gap:8,paddingLeft:8,paddingBottom:4,border:"1px solid rgba(67,97,238,.14)",borderTop:"none",borderRadius:"0 0 12px 12px",background:"#fafbff",padding:"10px 8px 10px 12px"}}>
                    {group.map(function(c) {
                      return (
                        <div key={c.id} style={{background:"#fff",border:"1.5px solid #e8edf4",borderRadius:14,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10,transition:"all .2s"}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.boxShadow="0 2px 12px rgba(67,97,238,.08)";}} onMouseLeave={function(e){e.currentTarget.style.borderColor="#e8edf4";e.currentTarget.style.boxShadow="";}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#4361EE,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              <span style={{fontSize:13,color:"#fff",fontWeight:700}}>{(c.nome||c.cargo||"?")[0].toUpperCase()}</span>
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.nome||c.cargo}</div>
                              {c.nome && c.cargo && c.nome!==c.cargo && <div style={{fontSize:11,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.cargo}</div>}
                            </div>
                            <div style={{display:"flex",gap:6,flexShrink:0}}>
                              {c.linkedin && (
                                <a href={c.linkedin} target="_blank" rel="noreferrer" style={{background:"#eff6ff",border:"1px solid #bfdbfe",color:"#0a66c2",borderRadius:8,padding:"5px 8px",fontSize:10,fontWeight:600,textDecoration:"none",display:"flex",alignItems:"center"}}>{"in"}</a>
                              )}
                              <button onClick={function(){deleteContact(c.id);}} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:8,padding:"5px 8px",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>{"x"}</button>
                            </div>
                          </div>
                          <div style={{width:"100%"}}>
                            {c.email ? (
                              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",background:"#f8fafc",borderRadius:8,padding:"6px 10px"}}>
                                <span style={{fontSize:11,color:c.emailValidated?"#10b981":"#64748b",fontWeight:c.emailValidated?700:400,wordBreak:"break-all",flex:1}}>{c.email}</span>
                                {c.emailValidated && <span style={{fontSize:9,fontWeight:700,color:"#10b981",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"1px 6px",flexShrink:0}}>{c.emailConfidence?c.emailConfidence+"%":"OK"}</span>}
                              </div>
                            ) : (
                              <button onClick={function(){enrichEmail(c);}} disabled={enriching[c.id]} style={{width:"100%",background:enriching[c.id]?"#f1f5f9":"linear-gradient(135deg,#4361EE,#3451d1)",color:enriching[c.id]?"#94a3b8":"#fff",border:"none",borderRadius:8,padding:"8px 12px",fontSize:11,fontWeight:600,cursor:enriching[c.id]?"default":"pointer",fontFamily:"inherit",boxSizing:"border-box"}}>
                                {enriching[c.id] ? "Buscando..." : "Buscar e-mail"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>}
                </div>
              );
            });
          })()}
        </div>
      )}
      {toastC && (
        <div style={{position:"fixed",bottom:28,right:28,background:toastC.color,color:"#fff",borderRadius:14,padding:"14px 22px",fontSize:13,fontWeight:600,boxShadow:"0 12px 40px rgba(15,23,42,.2)",zIndex:400,maxWidth:340}}>
          {toastC.msg}
        </div>
      )}
    </div>
  );
}


// -- INTEGRATIONS VIEW ---------------------------------------------------------
function IntegrationsView() {
  var INTEGRATIONS = [
    {id:"salesforce", name:"Salesforce", logo:"☁️", desc:"Sincronize contas, contatos e oportunidades com o Salesforce CRM.", color:"#00A1E0", connected:false},
    {id:"hubspot",    name:"HubSpot",    logo:"🟠", desc:"Exporte leads e sequencias diretamente para o HubSpot CRM.",      color:"#FF7A59", connected:false},
    {id:"pipedrive",  name:"Pipedrive",  logo:"🎯", desc:"Crie deals automaticamente no Pipedrive ao salvar uma conta.",    color:"#272D35", connected:false},
  ];
  var _st_states = useState(function(){
    var saved = {};
    try { var r = localStorage.getItem("bdrhelper_integrations"); if(r) saved = JSON.parse(r); } catch(e){}
    return saved;
  }); var intStates = _st_states[0]; var setIntStates = _st_states[1];
  var _st_modal = useState(null); var modalInt = _st_modal[0]; var setModalInt = _st_modal[1];
  var _st_apiKey = useState(""); var apiKey = _st_apiKey[0]; var setApiKey = _st_apiKey[1];
  var _st_customModal = useState(false); var customModal = _st_customModal[0]; var setCustomModal = _st_customModal[1];
  var _st_customName = useState(""); var customName = _st_customName[0]; var setCustomName = _st_customName[1];
  var _st_customKey = useState(""); var customKey = _st_customKey[0]; var setCustomKey = _st_customKey[1];
  var _st_customURL = useState(""); var customURL = _st_customURL[0]; var setCustomURL = _st_customURL[1];
  var _st_customs = useState(function(){
    try { var r = localStorage.getItem("bdrhelper_custom_integrations"); if(r) return JSON.parse(r); } catch(e){} return [];
  }); var customs = _st_customs[0]; var setCustoms = _st_customs[1];

  function saveIntState(id, data) {
    var next = Object.assign({}, intStates);
    next[id] = data;
    setIntStates(next);
    try { localStorage.setItem("bdrhelper_integrations", JSON.stringify(next)); } catch(e){}
  }

  function connect(intId) {
    saveIntState(intId, {connected:true, apiKey:apiKey, connectedAt:Date.now()});
    setModalInt(null);
    setApiKey("");
  }

  function disconnect(intId) {
    if (!window.confirm("Desconectar esta integracao?")) return;
    saveIntState(intId, {connected:false});
  }

  function addCustom() {
    if (!customName) return;
    var c = {id:"custom_"+Date.now(), name:customName, apiKey:customKey, webhookURL:customURL, connectedAt:Date.now()};
    var next = customs.concat([c]);
    setCustoms(next);
    try { localStorage.setItem("bdrhelper_custom_integrations", JSON.stringify(next)); } catch(e){}
    setCustomModal(false); setCustomName(""); setCustomKey(""); setCustomURL("");
  }

  function removeCustom(id) {
    if (!window.confirm("Remover esta integracao?")) return;
    var next = customs.filter(function(c){ return c.id !== id; });
    setCustoms(next);
    try { localStorage.setItem("bdrhelper_custom_integrations", JSON.stringify(next)); } catch(e){}
  }

  return (
    <div>
      <div style={{marginBottom:28}}>
        <div style={{fontSize:28,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:"-0.6px"}}>{"Integrações"}</div>
        <div style={{fontSize:13,color:"#64748b"}}>{"Conecte o + Pipe ao seu CRM e ferramentas de vendas."}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16,marginBottom:32}}>
        {INTEGRATIONS.map(function(int) {
          var st = intStates[int.id] || {};
          var isConn = st.connected;
          return (
            <div key={int.id} style={{background:"#fff",border:"1.5px solid "+(isConn?"#bbf7d0":"#e8edf4"),borderRadius:20,padding:"24px",boxShadow:"0 2px 12px rgba(15,23,42,.06)",transition:"all .25s"}} onMouseEnter={function(e){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 32px rgba(15,23,42,.10)";}} onMouseLeave={function(e){e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 12px rgba(15,23,42,.06)";}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                <div style={{width:44,height:44,borderRadius:12,background:int.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{int.logo}</div>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"#0f172a"}}>{int.name}</div>
                  {isConn && <div style={{fontSize:9,fontWeight:700,color:"#10b981",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"1px 7px",display:"inline-block",marginTop:2}}>{"CONECTADO"}</div>}
                </div>
              </div>
              <div style={{fontSize:12,color:"#64748b",lineHeight:1.6,marginBottom:16}}>{int.desc}</div>
              {isConn ? (
                <div style={{display:"flex",gap:8}}>
                  <div style={{flex:1,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"8px 12px",fontSize:11,color:"#10b981",fontWeight:600}}>{"Ativo"}</div>
                  <button onClick={function(){disconnect(int.id);}} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:10,padding:"8px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{"Desconectar"}</button>
                </div>
              ) : (
                <button onClick={function(){setModalInt(int);setApiKey("");}} style={{width:"100%",background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(67,97,238,.25)"}}>{"Conectar"}</button>
              )}
            </div>
          );
        })}
        {customs.map(function(c) {
          return (
            <div key={c.id} style={{background:"#fff",border:"1.5px solid #bbf7d0",borderRadius:20,padding:"24px",boxShadow:"0 2px 12px rgba(15,23,42,.06)"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                <div style={{width:44,height:44,borderRadius:12,background:"#f8fafc",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{"🔌"}</div>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"#0f172a"}}>{c.name}</div>
                  <div style={{fontSize:9,fontWeight:700,color:"#10b981",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"1px 7px",display:"inline-block",marginTop:2}}>{"CUSTOMIZADO"}</div>
                </div>
              </div>
              <div style={{fontSize:11,color:"#64748b",marginBottom:14,wordBreak:"break-all"}}>{c.webhookURL || "Webhook configurado"}</div>
              <button onClick={function(){removeCustom(c.id);}} style={{width:"100%",background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:10,padding:"8px 0",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{"Remover"}</button>
            </div>
          );
        })}
        <button onClick={function(){setCustomModal(true);}} style={{background:"#f8fafc",border:"2px dashed #e2e8f0",borderRadius:20,padding:"24px",cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,transition:"all .2s",minHeight:180}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.background="#eff6ff";}} onMouseLeave={function(e){e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.background="#f8fafc";}}>
          <span style={{fontSize:32}}>{"+"}</span>
          <span style={{fontSize:13,fontWeight:600,color:"#64748b"}}>{"Adicionar integracao"}</span>
          <span style={{fontSize:11,color:"#94a3b8"}}>{"Via webhook ou API key"}</span>
        </button>
      </div>
      {modalInt && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div style={{background:"#fff",borderRadius:24,width:"100%",maxWidth:460,padding:"28px",boxShadow:"0 32px 100px rgba(15,23,42,.28)"}}>
            <div style={{fontSize:18,fontWeight:800,color:"#0f172a",marginBottom:4}}>{modalInt.logo + " Conectar " + modalInt.name}</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:20}}>{"Insira sua API Key do " + modalInt.name + " para ativar a integracao."}</div>
            <input value={apiKey} onChange={function(e){setApiKey(e.target.value);}} placeholder={"API Key do " + modalInt.name} style={{width:"100%",boxSizing:"border-box",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#0f172a",fontFamily:"inherit",outline:"none",marginBottom:16}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setModalInt(null);setApiKey("");}} style={{flex:1,background:"#f8fafc",border:"1px solid #e2e8f0",color:"#64748b",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Cancelar"}</button>
              <button onClick={function(){connect(modalInt.id);}} disabled={!apiKey} style={{flex:2,background:apiKey?"linear-gradient(135deg,#4361EE,#3451d1)":"#e2e8f0",color:apiKey?"#fff":"#94a3b8",border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:apiKey?"pointer":"default",fontFamily:"inherit"}}>{"Conectar " + modalInt.name}</button>
            </div>
          </div>
        </div>
      )}
      {customModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div style={{background:"#fff",borderRadius:24,width:"100%",maxWidth:460,padding:"28px",boxShadow:"0 32px 100px rgba(15,23,42,.28)"}}>
            <div style={{fontSize:18,fontWeight:800,color:"#0f172a",marginBottom:16}}>{"Adicionar integracao personalizada"}</div>
            <input value={customName} onChange={function(e){setCustomName(e.target.value);}} placeholder={"Nome da ferramenta (ex: RD Station)"} style={{width:"100%",boxSizing:"border-box",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#0f172a",fontFamily:"inherit",outline:"none",marginBottom:10}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
            <input value={customURL} onChange={function(e){setCustomURL(e.target.value);}} placeholder={"Webhook URL (opcional)"} style={{width:"100%",boxSizing:"border-box",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#0f172a",fontFamily:"inherit",outline:"none",marginBottom:10}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
            <input value={customKey} onChange={function(e){setCustomKey(e.target.value);}} placeholder={"API Key (opcional)"} style={{width:"100%",boxSizing:"border-box",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#0f172a",fontFamily:"inherit",outline:"none",marginBottom:16}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setCustomModal(false);}} style={{flex:1,background:"#f8fafc",border:"1px solid #e2e8f0",color:"#64748b",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Cancelar"}</button>
              <button onClick={addCustom} disabled={!customName} style={{flex:2,background:customName?"linear-gradient(135deg,#4361EE,#3451d1)":"#e2e8f0",color:customName?"#fff":"#94a3b8",border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:customName?"pointer":"default",fontFamily:"inherit"}}>{"Adicionar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HomeView(props) {
  var accounts = props.accounts || [];
  var onNav = props.onNav;
  var _st_hidden = useState({}); var hidden = _st_hidden[0]; var setHidden = _st_hidden[1];

  function toggleCard(id) {
    setHidden(function(h){ var n=Object.assign({},h); n[id]=!n[id]; return n; });
  }

  var byStatus = {};
  STATUS_ORDER.forEach(function(s){ byStatus[s]=accounts.filter(function(a){return a.status===s;}).length; });
  var total = accounts.length;
  var converted = byStatus.won||0;
  var taxa = total>0?Math.round(converted/total*100):0;

  var CARDS = [
    {id:"busca",    label:"Busca com IA",       emoji:"🔍", nav:"search",
     desc:"Analise qualquer empresa Mid Market e gere account mapping completo com fit, dores, stakeholders e mensagens personalizadas.",
     stat:total+" conta"+(total!==1?"s":"")+" mapeada"+(total!==1?"s":""), statColor:"#4361EE"},
    {id:"contas",   label:"Contas",              emoji:"📁", nav:"accounts",
     desc:"Todas as empresas mapeadas organizadas por fit, tier e estagio. Visualize em cards ou lista com filtros avancados.",
     stat:total+" no total", statColor:"#0369a1"},
    {id:"seqs",     label:"Sequencias",          emoji:"📬", nav:"sequences",
     desc:"Gere cadencias de 6 toques personalizadas por stakeholder com e-mail, InMail, WhatsApp e cold call.",
     stat:"6 perfis de stakeholder", statColor:"#7c3aed"},
    {id:"biblio",   label:"Biblioteca",          emoji:"📚", nav:"biblioteca",
     desc:"Todas as sequencias salvas organizadas. Exporte qualquer cadencia em PDF com um clique.",
     stat:"Sequencias salvas", statColor:"#059669"},
    {id:"pipe",     label:"Pipeline Kanban",     emoji:"📊", nav:"pipeline",
     desc:"Visualize todas as contas por estagio da prospeccao. Arraste os cards entre colunas para atualizar o status.",
     stat:converted+" convertida"+(converted!==1?"s":""), statColor:"#065f46"},
    {id:"relat",    label:"Relatorios",          emoji:"📈", nav:"relatorios",
     desc:"Dashboard com funil de conversao, distribuicao por fit e tier, graficos donut e semicirculo e export em PDF.",
     stat:taxa+"% taxa de conversao", statColor:"#92400e"},
  ];

  var visible = CARDS.filter(function(c2){ return !hidden[c2.id]; });
  var now = new Date();
  var hr = now.getHours();
  var greet = hr<12?"Bom dia":hr<18?"Boa tarde":"Boa noite";

  return (
    <div>
      <div style={{position:"relative",borderRadius:28,overflow:"hidden",marginBottom:28,background:"linear-gradient(135deg,#0A0A0F 0%,#171430 45%,#1e1b4b 100%)",padding:"40px 40px 36px"}}>
        <div style={{position:"absolute",top:-80,right:-60,width:320,height:320,borderRadius:"50%",background:"radial-gradient(circle,rgba(67,97,238,.35),transparent 70%)",filter:"blur(20px)"}}/>
        <div style={{position:"absolute",bottom:-100,left:-40,width:280,height:280,borderRadius:"50%",background:"radial-gradient(circle,rgba(124,58,167,.25),transparent 70%)",filter:"blur(20px)"}}/>
        <div style={{position:"relative",zIndex:2}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18}}>
            <span style={{fontSize:10,fontWeight:700,color:"#a5b4fc",background:"rgba(99,102,241,.15)",border:"1px solid rgba(129,140,248,.3)",borderRadius:20,padding:"4px 12px",letterSpacing:.5}}>{"BETA"}</span>
            <span style={{fontSize:12,color:"#94a3b8"}}>{greet + ", vamos gerar pipeline"}</span>
          </div>
          <div style={{fontSize:38,fontWeight:900,letterSpacing:"-1.2px",lineHeight:1.05,color:"#fff",marginBottom:10}}>
            <span style={{color:"#818cf8"}}>{"+"}</span>{"pipe"}
            <span style={{display:"block",fontSize:18,fontWeight:600,color:"#cbd5e1",letterSpacing:"-.3px",marginTop:6}}>{"Account mapping com IA para times de vendas"}</span>
          </div>
          <div style={{fontSize:13.5,color:"#94a3b8",maxWidth:520,lineHeight:1.7,marginBottom:26}}>{"Pesquise qualquer empresa, gere inteligencia de conta completa e cadencias de prospeccao em segundos. Chegue preparado, feche mais rapido."}</div>
          <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
            {[
              {label:"Contas mapeadas", value:total, accent:"#818cf8"},
              {label:"Convertidas", value:converted, accent:"#34d399"},
              {label:"Taxa de conversao", value:taxa+"%", accent:"#c084fc"},
            ].map(function(m){return (
              <div key={m.label} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:16,padding:"16px 22px",minWidth:128}}>
                <div style={{fontSize:30,fontWeight:800,color:m.accent,lineHeight:1,letterSpacing:"-.5px"}}>{m.value}</div>
                <div style={{fontSize:10.5,color:"#94a3b8",fontWeight:500,marginTop:6,whiteSpace:"nowrap"}}>{m.label}</div>
              </div>
            );})}
            <button onClick={function(){onNav("search");}} style={{marginLeft:"auto",alignSelf:"center",background:"linear-gradient(135deg,#4361EE,#6366f1)",color:"#fff",border:"none",borderRadius:14,padding:"14px 26px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 8px 28px rgba(67,97,238,.45)",display:"flex",alignItems:"center",gap:8,whiteSpace:"nowrap"}} onMouseEnter={function(e){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 12px 36px rgba(67,97,238,.55)";}} onMouseLeave={function(e){e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 8px 28px rgba(67,97,238,.45)";}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
              {"Nova busca"}
            </button>
          </div>
        </div>
      </div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{"Acesso rapido"}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {CARDS.map(function(c2){
            var isHidden = hidden[c2.id];
            return (
              <button key={c2.id} onClick={function(){toggleCard(c2.id);}} style={{background:isHidden?"#f8fafc":"#f0f3ff",border:"1px solid "+(isHidden?"#e2e8f0":"#c7d0fa"),color:isHidden?"#94a3b8":"#4361EE",borderRadius:8,padding:"4px 10px",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all .2s",opacity:isHidden?.5:1}}>
                {c2.emoji+" "+c2.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:18}}>
        {visible.map(function(card){
          return (
            <div key={card.id} onClick={function(){onNav(card.nav);}} style={{background:"#fff",border:"1px solid #e8edf4",borderRadius:20,padding:"24px",cursor:"pointer",transition:"all .25s cubic-bezier(.22,1,.36,1)",position:"relative",overflow:"hidden",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}
              onMouseEnter={function(e){e.currentTarget.style.borderColor="#c7d0fa";e.currentTarget.style.transform="translateY(-4px)";e.currentTarget.style.boxShadow="0 16px 48px rgba(67,97,238,.14)";}}
              onMouseLeave={function(e){e.currentTarget.style.borderColor="#e8edf4";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 1px 3px rgba(15,23,42,.04)";}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16}}>
                <div style={{width:48,height:48,borderRadius:14,background:"linear-gradient(135deg,#4361EE,#6366f1)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 6px 16px rgba(67,97,238,.28)",flexShrink:0}}>
                  <span style={{fontSize:22}}>{card.emoji}</span>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
              </div>
              <div style={{fontSize:16,fontWeight:800,color:"#0f172a",marginBottom:8,letterSpacing:"-.3px"}}>{card.label}</div>
              <div style={{fontSize:12.5,color:"#64748b",lineHeight:1.65,marginBottom:16,minHeight:48}}>{card.desc}</div>
              <div style={{display:"flex",alignItems:"center",gap:7,paddingTop:14,borderTop:"1px solid #f1f5f9"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:card.statColor,flexShrink:0}}/>
                <span style={{fontSize:11,color:card.statColor,fontWeight:600}}>{card.stat}</span>
              </div>
            </div>
          );
        })}
      </div>

      {total === 0 && (
        <div style={{marginTop:28,background:"linear-gradient(135deg,#f0f3ff,#fff)",border:"1.5px solid #c7d0fa",borderRadius:20,padding:"32px",textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>{"🚀"}</div>
          <div style={{fontSize:18,fontWeight:700,color:"#0f172a",marginBottom:8}}>{"Bem-vindo ao +pipe Beta"}</div>
          <div style={{fontSize:13,color:"#64748b",marginBottom:20,lineHeight:1.7,maxWidth:400,margin:"0 auto 20px"}}>{"Comece mapeando sua primeira conta. Digite o nome de uma empresa na Busca e deixe a IA gerar o account mapping completo."}</div>
          <button onClick={function(){onNav("search");}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:12,padding:"12px 28px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(67,97,238,.35)"}}>
            {"Mapear primeira conta"}
          </button>
        </div>
      )}
    </div>
  );
}

// -- SHARED MAPPING HELPERS (module scope so App + SearchView can both use) ---
function isUrl(v) { return /^https?:\/\//i.test(v) || /^www\./.test(v); }
function extractDomain(val) {
  if (!isUrl(val)) return "";
  try {
    var url = val.startsWith("http") ? val : "https://" + val;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch(e) { return ""; }
}
function buildData(company, searchResults) {
  var lower = company.toLowerCase();
  var tavilyAnswers = [];
  if (Array.isArray(searchResults)) {
    searchResults.forEach(function(block) {
      if (block.answer && block.answer.trim().length > 20) tavilyAnswers.push(block.answer.trim());
    });
  }
  var allText = tavilyAnswers.join(" ");
  function extractVal(pats) {
    for (var pi=0;pi<pats.length;pi++) { var m=allText.match(pats[pi]); if(m) return m[0]; }
    return "";
  }
  var faturamento = extractVal([/R$[\s]*[\d,\.]+[\s]*(bilh[oo]es?|milh[oo]es?)/i]);
  var funcionarios = extractVal([/[\d\.]+[\s]*mil[\s]*funcion[aa]rios?/i, /[\d\.]+([\s])*(funcion[aa]rios?|colaboradores?)/i]);
  var clientes = extractVal([/[\d,\.]+[\s]*(milh[oo]es?|mil)[\s]*(de[\s]*)?(clientes?|usuarios?)/i]);
  var isEcomm   = /magalu|americanas|shopee|mercado livre|amazon|via varejo|renner|centauro|dafiti/.test(lower);
  var isFintech = /nubank|c6|inter|stone|pagseguro|pagbank|picpay|cielo|btg|xp|itau|bradesco|banco/.test(lower);
  var isSaaS    = /totvs|linx|vtex|rdstation|senior|sankhya|contaazul|omie|piperun|agendor/.test(lower);
  var isHealth  = /hapvida|amil|unimed|dasa|fleury|einstein|afya|hospital|clinica/.test(lower);
  var isTelecom = /\bvivo\b|claro|\btim\b|algar|embratel/.test(lower);
  var setor = isEcomm?"E-commerce / Varejo Digital":isFintech?"Fintech / Servicos Financeiros":isSaaS?"Software / SaaS B2B":isHealth?"Saude / Healthtech":isTelecom?"Telecomunicacoes":"Tecnologia / Mid Market";
  var tier  = (isEcomm||isFintech||isSaaS||isTelecom) ? "Tier 1" : "Tier 2";
  function buildResumo() {
    if (!tavilyAnswers.length) return company+" e uma empresa de "+setor+" com operacao ativa no Brasil.";
    // Filter to best PT-BR content
    var ptAnswers = tavilyAnswers.filter(function(a) {
      return a.length > 80 && /\b(empresa|brasil|compan|serv|produt|clientes|mercado|tecnolog|atend|fundad|operas|setor)\b/i.test(a);
    });
    var best = (ptAnswers.length ? ptAnswers : tavilyAnswers).slice(0,3);
    // Deduplicate: remove sentences that appear in multiple answers
    var sentences = [];
    best.forEach(function(a) {
      a.replace(/([^.!?]+[.!?]+)/g, function(s) {
        var clean = s.trim();
        if (clean.length < 30) return;
        var isDup = sentences.some(function(existing) {
          return existing.toLowerCase().slice(0,40) === clean.toLowerCase().slice(0,40);
        });
        if (!isDup) sentences.push(clean);
      });
    });
    var text = sentences.slice(0,5).join(" ").trim();
    if (!text) text = best[0].slice(0,500);
    // Remove any raw URLs, brackets, asterisks
    text = text.replace(/https?:\/\/\S+/g,"").replace(/\[.*?\]/g,"").replace(/\*+/g,"").replace(/\s+/g," ").trim();
    return text.slice(0,600) || company+" e uma empresa de "+setor+" no Brasil.";
  }
  var resumo = buildResumo();
  var allSources = [];
  if (Array.isArray(searchResults)) {
    searchResults.forEach(function(b) { (b.sources||[]).forEach(function(s){allSources.push(s);}); });
  }
  // Build noticias — sources have {title, url, content} from search API
  var noticiasSources = allSources
    .filter(function(s){ return s.url && (s.title||s.titulo); })
    .filter(function(s){ return !/linkedin\.com|facebook\.com|instagram\.com|twitter\.com/.test(s.url||""); })
    .slice(0,5)
    .map(function(s){
      var title = s.title || s.titulo || "";
      var snippet = (s.content || s.resumo || "").replace(/https?:\/\/\S+/g,"").replace(/\s+/g," ").trim().slice(0,180);
      return {titulo:title, resumo:snippet, url:s.url, relevancia:"Fonte de contexto"};
    });
  var noticias = noticiasSources.length ? noticiasSources : [{titulo:"Buscar noticias recentes de "+company, resumo:"Clique para pesquisar noticias sobre a empresa.", url:"https://google.com/search?q="+encodeURIComponent(company)+" atendimento CX 2024", relevancia:"Pesquisa sugerida"}];
  return {
    empresa:{nome:company,setor:setor,resumo:resumo,rawContext:allText.slice(0,4000),tamanho:funcionarios||(tier==="Tier 1"?"500-1000 funcionarios":"200-500 funcionarios"),faturamento:faturamento||"Nao disponivel",clientes:clientes||""},
    fit:{score:"ALTO",justificativa:company+" atua em "+setor+", vertical de alto potencial para Zendesk Suite. Times de atendimento Mid Market com pressao de CSAT e custo por ticket sao nosso ICP principal.",solucoes_zendesk:["Zendesk Support (ticketing omnichannel)","Zendesk Messaging (chat e WhatsApp)","Help Center com IA generativa","Zendesk Explore (analytics e CSAT)","Workforce Management","QA e automacao de qualidade","Zendesk Sell (CRM de vendas)"]},
    mercado:{competidores_provedor:["Freshdesk","Salesforce Service Cloud","HubSpot Service Hub","ServiceNow CSM","Intercom","LivePerson","TOTVS CRM","sistema interno legado"],concorrentes_mercado:[]},
    dores:{principais:["Atendimento fragmentado , cliente repete o problema em cada canal","SLA estourado por falta de automacao e triagem inteligente","CSAT baixo gerando churn evitavel","Self-service inexistente ou desatualizado","Analytics limitado , sem visibilidade de CSAT por canal e agente","Custo por ticket alto , headcount crescendo mais rapido que o volume","Time de CX sem ferramentas de QA , qualidade inconsistente"]},
    triggers:["Crescimento acelerado do time de atendimento (vagas abertas de agente/CX)","Alto volume de reclamacoes no Reclame Aqui ou redes sociais","Abertura ou expansao de canal digital (WhatsApp, chat, e-commerce)","Contratacao recente de Head de CX, VP de Ops ou Diretor de Atendimento","Insatisfacao com Freshdesk ou sistema legado","Lancamento de novo produto , aumento de demanda de suporte"],
    stakeholders:[
      {cargo:"Head de CX / Diretor de Atendimento",angulo:"Decisor principal. Sente pressao de CSAT, SLA e custo. Quer escalar sem contratar mais agentes.",prioridade:"PRIMARIO",urgencia:"Alta",email:"",linkedin:"",phone:""},
      {cargo:"CEO / Diretor Geral",angulo:"Decisor economico. Ve CX como alavanca de retencao. Quer ROI claro e reducao de churn.",prioridade:"PRIMARIO",urgencia:"Alta",email:"",linkedin:"",phone:""},
      {cargo:"VP / Diretor de Operacoes",angulo:"Co-decisor. Olha custo por ticket e eficiencia. Quer reducao de custo e SLA previsivel.",prioridade:"PRIMARIO",urgencia:"Media"},
      {cargo:"Head de Customer Success",angulo:"Aliado. Quer integracao com CRM e visibilidade de clientes em risco de churn.",prioridade:"SECUNDARIO",urgencia:"Media"},
      {cargo:"Gerente de TI / CTO",angulo:"Avalia viabilidade tecnica. Precisa de API robusta e suporte no processo de migracao.",prioridade:"SECUNDARIO",urgencia:"Media"},
      {cargo:"CFO / Diretor Financeiro",angulo:"Aprova budget. Quer ROI mensuravel e comparativo de custo por ticket antes x depois.",prioridade:"TERCIARIO",urgencia:"Baixa"}
    ],
    noticias: noticias,
    estrategia:{
      tier:tier,
      emails:[
        {assunto:company+" + Zendesk , atendimento que escala",corpo:"Ola,\n\nChego ate voce porque "+company+" tem o perfil exato onde a Zendesk gera mais impacto em "+setor+". Empresas similares reduziram TMA em 35% e deflexionaram 28% dos tickets via self-service.\n\nTem disponibilidade para 20 minutos?\n\nAbraco,\nBDR/SDR | Zendesk"},
        {assunto:company+": quanto custa um ticket sem resposta?",corpo:"Ola,\n\nCada 1% de queda no CSAT representa 2 a 3% de aumento no churn. Com Zendesk Suite, empresas de "+setor+" reduziram TMA em 35% e deflexionaram 28% dos tickets via self-service.\n\nPosso te mostrar em 20 minutos.\n\nAbraco,\nBDR/SDR | Zendesk"},
        {assunto:"Case: CSAT 68% para 89% em 90 dias , "+setor,corpo:"Ola,\n\nAjudamos recentemente uma empresa de "+setor+" a unificar todos os canais em 30 dias, aumentar CSAT de 68% para 89% e reduzir TMA em 35%.\n\nFaz sentido eu te contar como? 20 minutos essa semana.\n\nAbraco,\nBDR/SDR | Zendesk"}
      ],
      inmails:[
        {assunto:company+" + Zendesk , vale 20 minutos?",corpo:"Ola!\n\nEmpresas de "+setor+" com o perfil da "+company+" aumentaram CSAT em 25% e reduziram 40% do custo por ticket com Zendesk Suite. Vale um papo?\n\nAbraco,\nBDR/SDR | Zendesk"},
        {assunto:"Pergunta sobre atendimento na "+company,corpo:"Voces tem visibilidade em tempo real do CSAT e SLA em todos os canais hoje? Se nao, tenho um benchmark do "+setor+" relevante.\n\nAbraco,\nBDR/SDR | Zendesk"},
        {assunto:company+" esta crescendo , parabens!",corpo:"Vi o crescimento da "+company+" em "+setor+". Esse e o momento em que CX pode ser vantagem ou gargalo. Vale 15 minutos?\n\nAbraco,\nBDR/SDR | Zendesk"}
      ],
      whatsapps:[
        "Oi [Nome], BDR da Zendesk. Vi que "+company+" tem operacao de atendimento em "+setor+". Empresas similares aumentaram CSAT em 25% e reduziram 40% do custo por ticket. Vale 15 minutos?",
        "Oi [Nome]! BDR da Zendesk. Empresa de "+setor+" com perfil da "+company+" aumentou CSAT de 68% para 89% em 90 dias. Tenho um case. Posso te mandar?",
        "Oi [Nome], BDR da Zendesk. Voce cuida de CX na "+company+"? Tenho algo sobre CSAT e custo por ticket. 15 minutos essa semana?"
      ],
      cold_calls:[
        "Bom dia [Nome], BDR da Zendesk. Tenho 30 segundos? [PAUSA] Ligo porque "+company+" tem o perfil exato onde geramos impacto em "+setor+". Empresas similares reduziram 40% do custo e aumentaram CSAT em 25% em 90 dias. Quando voce tem 20 minutos?",
        "[Nome], bom dia! BDR da Zendesk. Pergunta direta: qual o CSAT atual de voces e o que acontece com o SLA quando o volume de tickets sobe?",
        "Oi [Nome], BDR da Zendesk. Empresa de "+setor+" com perfil da "+company+" aumentou CSAT em 25 pontos em 90 dias. Vale 2 minutos agora?"
      ],
      perguntas_spin:[
        "SITUACAO: Como esta o time de atendimento da "+company+" , quantos agentes, quais canais?",
        "SITUACAO: Qual a ferramenta de helpdesk que voces usam e ha quanto tempo?",
        "SITUACAO: Voces visualizam CSAT, SLA e volume em tempo real em todos os canais?",
        "SITUACAO: Existe self-service ou base de conhecimento para os clientes?",
        "PROBLEMA: Com que frequencia o SLA e estourado e qual o impacto no CSAT?",
        "PROBLEMA: Quando o volume cresce, contratam mais agentes ou o SLA piora?",
        "PROBLEMA: Os clientes precisam repetir o problema quando mudam de canal?",
        "PROBLEMA: O time de TI gasta tempo mantendo customizacoes na ferramenta atual?",
        "IMPLICACAO: Qual o impacto no churn quando um cliente fica insatisfeito?",
        "IMPLICACAO: Se o CSAT continuar caindo, qual o impacto na renovacao e expansao?",
        "IMPLICACAO: Qual o custo mensal do time e voces tem visibilidade do custo por ticket?",
        "NECESSIDADE: Se deflexionassem 30% dos tickets com IA, o que isso liberaria?",
        "NECESSIDADE: O que precisaria para CX subir de prioridade na "+company+"?",
        "NECESSIDADE: Se eu mostrasse como aumentar CSAT em 25 pontos em 90 dias, valeria 20 minutos?"
      ],
      objecoes:[
        {objecao:"Ja usamos Freshdesk e estamos satisfeitos",resposta:"A diferenca na pratica e na IA nativa, omnichannel real e analytics profundo com Explore. Vale ver lado a lado?"},
        {objecao:"Nao temos budget para isso agora",resposta:"Posso mostrar o ROI baseado no custo por ticket atual? Clientes de "+setor+" costumam pagar a plataforma com a economia em 4 a 6 meses."},
        {objecao:"Nossa TI nao tem capacidade",resposta:"Nosso CS conduz toda a implementacao. Empresas de "+setor+" ficaram no ar em media em 4 semanas sem demandar TI interna."},
        {objecao:"Nao e prioridade agora",resposta:"Quando CX ganha prioridade , e antes ou depois de uma queda de CSAT que impacta churn?"},
        {objecao:"Ja usamos Salesforce Service Cloud",resposta:"O Salesforce e poderoso. Zendesk e mais rapida para implementar, mais intuitiva para o agente e mais barata para escalar."},
        {objecao:"Precisamos envolver mais areas",resposta:"Posso te ajudar a preparar o business case com ROI e casos do "+setor+" para facilitar a conversa interna."},
        {objecao:"Ja tentamos uma ferramenta e o time nao adotou",resposta:"Problema de UX da ferramenta. Zendesk tem NPS de 86 entre agentes. Posso mostrar a interface em 10 minutos?"},
        {objecao:"Preferimos desenvolver internamente",resposta:"Manter helpdesk interno custa em media 3x mais que a Zendesk em 2 anos. Posso mostrar o calculo?"}
      ]
    },
    proximos_passos:{
      ae:["Mapear organograma no LinkedIn , foco em Head de CX, CEO e VP de Ops da "+company,"Pesquisar vagas de agente CX e Analista de Atendimento , sinal de crescimento","Verificar "+company+" no Reclame Aqui , alto volume de reclamacoes e oportunidade","Buscar noticias de crescimento ou lancamento de produto da "+company,"Preparar business case com ROI da Zendesk Suite para "+setor,"InMail ao Head de CX ou CEO com contexto do "+setor],
      bdr:["Cold call focado em Head de CX e CEO","WhatsApp com Loom referenciando Reclame Aqui ou crescimento recente","Sequencia de 3 emails: Custo de Ticket, Case CSAT, FUP Final","Monitorar LinkedIn , posts sobre CX, vagas abertas, mudanca de lideranca","Eventos: Conarec, ExpoRelations, NRF Brasil, summit de CX"],
      prazo:"Primeira abordagem em ate 48 horas , prioridade Tier 1 se ha sinal de crescimento ou reclamacoes publicas."
    }
  };
}

function SearchView(props) {
  var _st_inputVal = useState(""); var inputVal = _st_inputVal[0]; var setInputVal = _st_inputVal[1];
  var _st_loading = useState(false); var loading = _st_loading[0]; var setLoading = _st_loading[1];
  var _st_done = useState(null); var done = _st_done[0]; var setDone = _st_done[1];
  var _st_searchError = useState(""); var searchError = _st_searchError[0]; var setSearchError = _st_searchError[1];
  var _st_duplicate = useState(null); var duplicate = _st_duplicate[0]; var setDuplicate = _st_duplicate[1];
  var _st_attachment = useState(null); var attachment = _st_attachment[0]; var setAttachment = _st_attachment[1];
  var _st_attachName = useState(""); var attachName = _st_attachName[0]; var setAttachName = _st_attachName[1];
  var _st_csvPreview = useState(null); var csvPreview = _st_csvPreview[0]; var setCsvPreview = _st_csvPreview[1];
  var _st_planMenu = useState(false); var planMenu = _st_planMenu[0]; var setPlanMenu = _st_planMenu[1];
  var _st_csvInfo = useState(false); var csvInfo = _st_csvInfo[0]; var setCsvInfo = _st_csvInfo[1];
  var csvRef = useRef(null);
  var usage = props.usage;
  function onCsvPick(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){ setCsvPreview(parseCSV(String(ev.target.result||""))); };
    reader.readAsText(file);
    e.target.value = "";
  }
  function confirmImport() {
    if (csvPreview && csvPreview.rows && csvPreview.rows.length && props.onImport) props.onImport(csvPreview.rows);
    setCsvPreview(null);
  }
  // Reescreve o resumo da conta com IA (especialista em outbound), depois atualiza no storage
  function enhanceResumo(nome) {
    storageList("acc:").then(function(keys){
      keys.forEach(function(k){
        storageGet(k).then(function(stored){
          if(!stored || stored.nome.toLowerCase()!==nome.toLowerCase()) return;
          var emp = (stored.data && stored.data.empresa) || {};
          var raw = emp.rawContext || emp.resumo || "";
          fetch("/api/gemini",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
            mode:"resumo", empresa:nome, setor:emp.setor||stored.setor||"tecnologia", rawContext:raw
          })})
            .then(function(r){return r.json();})
            .then(function(d){
              if(!d || !d.resumo) return;
              storageGet(k).then(function(cur){
                if(!cur) return;
                var updated = Object.assign({},cur,{
                  data:Object.assign({},cur.data,{empresa:Object.assign({},(cur.data&&cur.data.empresa)||{},{resumo:d.resumo,resumoAI:true})})
                });
                storageSet(k, updated);
                if(props.onUpdateAccount) props.onUpdateAccount(updated);
              });
            })
            .catch(function(){});
        });
      });
    });
  }

  function doEnrich(nome, domain) {
    enhanceResumo(nome);
    fetch("/api/stakeholders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company:nome,domain:domain})})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(stakhData){
        if(!stakhData||!stakhData.contacts||!stakhData.contacts.length) return;
        // Save real contacts (those with an actual name) into Contatos, avoiding duplicates
        storageList("contact:").then(function(ckeys){
          Promise.all(ckeys.map(storageGet)).then(function(existing){
            var existingSet = {};
            existing.filter(Boolean).forEach(function(ec){
              existingSet[((ec.nome||"")+"|"+(ec.empresa||"")).toLowerCase()] = true;
            });
            stakhData.contacts.forEach(function(s){
              var nomeReal = s.nome || s.name || "";
              if(!nomeReal) return;
              var dedupKey = (nomeReal+"|"+nome).toLowerCase();
              if(existingSet[dedupKey]) return;
              existingSet[dedupKey] = true;
              var cid = "contact:" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
              var contact = { id:cid, nome:nomeReal, cargo:s.cargo||s.title||"", empresa:nome, email:s.email||"", emailValidated:!!s.email, linkedin:s.linkedin||"", savedAt:Date.now() };
              storageSet(cid, contact);
            });
          });
        });
        storageList("acc:").then(function(keys){
          keys.forEach(function(k){
            storageGet(k).then(function(stored){
              if(!stored||stored.nome.toLowerCase()!==nome.toLowerCase()) return;
              var merged = mergeStakeholders((stored.data&&stored.data.stakeholders)||[], stakhData.contacts);
              var updated = Object.assign({},stored,{
                data:Object.assign({},stored.data,{stakeholders:merged}),
                enriched:{contacts:stakhData.contacts,sources:stakhData.sources||[]}
              });
              storageSet(k, updated);
              if(props.onUpdateAccount) props.onUpdateAccount(updated);
            });
          });
        });
      }).catch(function(){});
  }
  function handleSearch() {
    if (!inputVal.trim() || loading) return;
    var nome = inputVal.trim();
    var domain = extractDomain(nome);
    var nomeLower = nome.toLowerCase().trim();
    if (props.accounts) {
      var dup = props.accounts.find(function(a){ return a.nome && a.nome.toLowerCase().trim() === nomeLower; });
      if (dup) { setDuplicate(dup); setInputVal(""); return; }
    }
    // Consome 1 credito ANTES de mapear. Se estourou o limite, bloqueia.
    if (props.onRequestCredit) {
      props.onRequestCredit().then(function(ok){
        if (!ok) return; // limite atingido -> toast ja exibido pelo App
        runSearch(nome, domain);
      });
    } else {
      runSearch(nome, domain);
    }
  }
  function runSearch(nome, domain) {
    setLoading(true); setDone(null); setSearchError("");
    fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company:nome,context:""})})
      .then(function(r){if(!r.ok)return r.json().then(function(j){throw new Error(j.error||"HTTP "+r.status);}); return r.json();})
      .then(function(resp){
        var data = buildData(nome, resp.results);
        props.onSave(nome, data, true, attachment, attachName);
        setAttachment(null); setAttachName("");
        doEnrich(nome, domain);
        setLoading(false); setDone(nome); setInputVal("");
      })
      .catch(function(){
        var data = buildData(nome, null);
        props.onSave(nome, data, false, attachment, attachName);
        setAttachment(null); setAttachName("");
        doEnrich(nome, domain);
        setLoading(false); setDone(nome); setInputVal("");
        setSearchError("Busca online indisponivel. Account mapping gerado com base de conhecimento.");
      });
  }
  return (
    <div>
      <div style={{marginBottom:32}}>
        <div style={{fontSize:26,fontWeight:800,color:"#0f172a",marginBottom:6,letterSpacing:"-0.5px"}}>
          {"Account "}<span style={{color:"#4361EE"}}>{"Mapping"}</span>
        </div>
        <div style={{fontSize:13,color:"#64748b",marginBottom:20,lineHeight:1.7}}>{"Digite o nome da empresa para gerar o mapeamento de CX completo. O resultado é salvo automaticamente em Contas."}</div>

        {usage && (
          <div style={{background:"#fff",border:"1.5px solid "+(usage.remaining<=0?"#fecdd3":"#e8edf4"),borderRadius:16,padding:"16px 18px",marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{position:"relative"}}>
                  <button onClick={function(){setPlanMenu(!planMenu);}} title="Trocar plano (demo)" style={{display:"flex",alignItems:"center",gap:5,fontSize:9,fontWeight:700,color:"#fff",background:usage.planColor,border:"none",borderRadius:6,padding:"4px 9px",textTransform:"uppercase",letterSpacing:.5,cursor:"pointer",fontFamily:"inherit"}}>
                    {usage.planLabel}
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  {planMenu && (
                    <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,background:"#fff",border:"1.5px solid #e8edf4",borderRadius:12,boxShadow:"0 8px 32px rgba(15,23,42,.12)",zIndex:60,minWidth:200,overflow:"hidden"}}>
                      <div style={{padding:"8px 12px",fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1px solid #f1f5f9"}}>{"Plano (demo)"}</div>
                      {["free","starter","professional"].map(function(pid) {
                        var p = PLANS[pid]; var isCurrent = usage.plan===pid;
                        return (
                          <div key={pid} onClick={function(){ if(props.onChangePlan)props.onChangePlan(pid); setPlanMenu(false); }} style={{padding:"10px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:isCurrent?"#f0f3ff":"#fff"}} onMouseEnter={function(e){if(!isCurrent)e.currentTarget.style.background="#f8fafc";}} onMouseLeave={function(e){if(!isCurrent)e.currentTarget.style.background="#fff";}}>
                            <span style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                            <span style={{fontSize:12,fontWeight:700,color:"#0f172a",flex:1}}>{p.label}</span>
                            <span style={{fontSize:10,color:"#64748b"}}>{p.limit + "/mês"}</span>
                            {isCurrent && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4361EE" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{"Mapeamentos: " + usage.used + " / " + usage.limit}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:usage.remaining<=3?"#ef4444":"#64748b",fontWeight:usage.remaining<=3?700:500}}>{usage.remaining + " restante" + (usage.remaining!==1?"s":"") + " este mês"}</span>
                <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={onCsvPick} style={{display:"none"}}/>
                <button onClick={function(){csvRef.current&&csvRef.current.click();}} style={{background:"#fff",border:"1.5px solid #4361EE",color:"#4361EE",borderRadius:9,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {"Importar CSV"}
                </button>
                <div style={{position:"relative",display:"flex"}}>
                  <button onClick={function(){setCsvInfo(!csvInfo);}} onMouseEnter={function(){setCsvInfo(true);}} onMouseLeave={function(){setCsvInfo(false);}} title="Modelo do CSV" style={{background:"#f8fafc",border:"1.5px solid #e2e8f0",color:"#64748b",borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,padding:0}}>{"i"}</button>
                  {csvInfo && (
                    <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"#0f172a",color:"#fff",borderRadius:12,padding:"14px 16px",width:260,zIndex:70,boxShadow:"0 12px 40px rgba(15,23,42,.3)",fontSize:11,lineHeight:1.6}} onMouseEnter={function(){setCsvInfo(true);}} onMouseLeave={function(){setCsvInfo(false);}}>
                      <div style={{fontWeight:700,marginBottom:8,fontSize:12}}>{"Modelo do arquivo CSV"}</div>
                      <div style={{color:"#cbd5e1",marginBottom:10}}>{"Use as colunas abaixo (nome é obrigatório, as demais opcionais):"}</div>
                      <div style={{background:"rgba(255,255,255,.08)",borderRadius:8,padding:"10px 12px",fontFamily:"monospace",fontSize:10.5,color:"#e2e8f0",overflowX:"auto",whiteSpace:"nowrap"}}>
                        <div style={{fontWeight:700,color:"#7dd3fc"}}>{"nome,site,linkedin"}</div>
                        <div>{"Nubank,nubank.com.br,linkedin.com/company/nubank"}</div>
                        <div>{"Stone,stone.com.br,"}</div>
                        <div>{"TOTVS,totvs.com,"}</div>
                      </div>
                      <div style={{color:"#94a3b8",marginTop:10,fontSize:10}}>{"Aceita separador vírgula ou ponto-e-vírgula. A ordem das colunas não importa."}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div style={{height:8,background:"#f1f5f9",borderRadius:8,overflow:"hidden"}}>
              <div style={{height:"100%",width:Math.min(100,Math.round((usage.used/usage.limit)*100))+"%",background:usage.remaining<=3?"linear-gradient(90deg,#ef4444,#f59e0b)":"linear-gradient(90deg,"+usage.planColor+",#3451d1)",borderRadius:8,transition:"width .4s"}}/>
            </div>
            {usage.remaining<=0 && (
              <div style={{marginTop:14,background:"linear-gradient(135deg,#fff7ed,#fef2f2)",border:"1.5px solid #fed7aa",borderRadius:12,padding:"14px 16px"}}>
                <div style={{fontSize:13,fontWeight:800,color:"#9a3412",marginBottom:4}}>{"Limite do plano " + usage.planLabel + " atingido"}</div>
                <div style={{fontSize:12,color:"#7c2d12",lineHeight:1.6,marginBottom:12}}>{"Você usou os " + usage.limit + " mapeamentos deste mês. " + (nextPlanMsg(usage.plan))}</div>
                {nextPlanId(usage.plan) && (
                  <button onClick={function(){ if(props.onChangePlan)props.onChangePlan(nextPlanId(usage.plan)); }} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"10px 18px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(67,97,238,.3)"}}>
                    {"Migrar para " + PLANS[nextPlanId(usage.plan)].label + " (" + PLANS[nextPlanId(usage.plan)].limit + "/mês)"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {csvPreview && (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",overflowY:"auto"}} onClick={function(e){if(e.target===e.currentTarget)setCsvPreview(null);}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:520,padding:"24px",boxShadow:"0 24px 80px rgba(15,23,42,.25)",maxHeight:"85vh",display:"flex",flexDirection:"column"}} onClick={function(e){e.stopPropagation();}}>
              <div style={{fontSize:17,fontWeight:800,color:"#0f172a",marginBottom:6}}>{"Importar contas"}</div>
              {csvPreview.error ? (
                <div style={{fontSize:13,color:"#ef4444",background:"#fff1f2",border:"1px solid #fecdd3",borderRadius:10,padding:"12px 14px",marginTop:8}}>{csvPreview.error}</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",minHeight:0}}>
                  <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>{csvPreview.rows.length + " conta" + (csvPreview.rows.length!==1?"s":"") + " encontrada" + (csvPreview.rows.length!==1?"s":"") + ". Serao importadas para Contas como nao mapeadas (sem consumir creditos)."}</div>
                  <div style={{overflowY:"auto",border:"1px solid #f1f5f9",borderRadius:10,marginBottom:16}}>
                    {csvPreview.rows.slice(0,50).map(function(r,i){
                      return (
                        <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:i<csvPreview.rows.length-1?"1px solid #f8fafc":"none"}}>
                          <span style={{fontSize:12,fontWeight:600,color:"#0f172a",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.nome}</span>
                          {r.site && <span style={{fontSize:10,color:"#94a3b8",flexShrink:0}}>{r.site}</span>}
                        </div>
                      );
                    })}
                    {csvPreview.rows.length>50 && <div style={{padding:"8px 12px",fontSize:11,color:"#94a3b8"}}>{"+ " + (csvPreview.rows.length-50) + " outras..."}</div>}
                  </div>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <button onClick={function(){setCsvPreview(null);}} style={{flex:1,background:"#f8fafc",border:"1px solid #e2e8f0",color:"#64748b",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Cancelar"}</button>
                {!csvPreview.error && <button onClick={confirmImport} style={{flex:2,background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{"Importar " + csvPreview.rows.length + " conta" + (csvPreview.rows.length!==1?"s":"")}</button>}
              </div>
            </div>
          </div>
        )}
        <div style={{display:"flex",gap:10}}>
          <input value={inputVal} onChange={function(e){setInputVal(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")handleSearch();}} placeholder="Ex: Nubank, TOTVS, Stone..." style={{flex:1,background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:"14px 18px",fontSize:13.5,color:"#0f172a",fontFamily:"inherit",outline:"none",boxShadow:"0 1px 3px rgba(15,23,42,.06)",transition:"border-color .2s"}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
          <button onClick={handleSearch} disabled={loading||!inputVal.trim()} style={{background:loading||!inputVal.trim()?"#e2e8f0":"linear-gradient(135deg,#4361EE,#3451d1)",color:loading||!inputVal.trim()?"#94a3b8":"#fff",border:"none",borderRadius:12,padding:"14px 28px",fontSize:13,fontWeight:600,cursor:loading||!inputVal.trim()?"not-allowed":"pointer",fontFamily:"inherit",boxShadow:loading||!inputVal.trim()?"none":"0 4px 14px rgba(67,97,238,.35)",transition:"all .2s",whiteSpace:"nowrap"}}>
            {loading?"Buscando na internet...":"Analisar"}
          </button>
        </div>

        <div style={{marginTop:12,background:"#f8fafc",border:"1.5px dashed #e2e8f0",borderRadius:12,padding:"13px 16px",cursor:"pointer",transition:"all .2s"}}
          onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.background="#f0f3ff";}}
          onMouseLeave={function(e){e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.background="#f8fafc";}}
          onClick={function(){document.getElementById("mpipe-attach").click();}}>
          <input id="mpipe-attach" type="file" accept=".pdf,.xlsx,.xls,.docx,.doc,.txt" style={{display:"none"}} onChange={function(e){
            var file=e.target.files&&e.target.files[0];
            if(!file)return;
            setAttachName(file.name);
            var reader=new FileReader();
            reader.onload=function(ev){setAttachment(ev.target.result);};
            reader.readAsDataURL(file);
          }}/>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:32,height:32,borderRadius:8,background:attachment?"rgba(67,97,238,.12)":"#fff",border:"1px solid "+(attachment?"#4361EE":"#e2e8f0"),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={attachment?"#4361EE":"#94a3b8"} strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:attachment?"#4361EE":"#475569",marginBottom:2}}>{attachment?"Arquivo anexado":"Deseja enriquecer a sua pesquisa?"}</div>
              <div style={{fontSize:11,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{attachment?attachName:"Anexe aqui o RI da empresa, relatorios, etc (pdf, xlsx, docx)"}</div>
            </div>
            {attachment&&(
              <button onClick={function(e){e.stopPropagation();setAttachment(null);setAttachName("");}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:6,color:"#94a3b8",cursor:"pointer",fontSize:11,padding:"3px 8px",fontFamily:"inherit",flexShrink:0}}>{"Remover"}</button>
            )}
          </div>
        </div>
        {searchError && (
          <div style={{marginTop:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:"12px 16px",fontSize:12,color:"#92400e"}}>{searchError}</div>
        )}
        {duplicate && (
          <div style={{marginTop:14,background:"#fff7ed",border:"1.5px solid #fb923c",borderRadius:14,padding:"14px 18px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#9a3412",marginBottom:3}}>{"Conta já mapeada: "+duplicate.nome}</div>
                <div style={{fontSize:11,color:"#c2410c"}}>{duplicate.setor + " , " + (STATUS_CONFIG[duplicate.status]&&STATUS_CONFIG[duplicate.status].label)}</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={function(){props.onOpenAccount(duplicate);}} style={{background:"#ea580c",color:"#fff",border:"none",borderRadius:10,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  {"Ver mapeamento"}
                </button>
                <button onClick={function(){setDuplicate(null);}} style={{background:"none",border:"1px solid #fb923c",color:"#ea580c",borderRadius:10,padding:"8px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>x</button>
              </div>
            </div>
          </div>
        )}
        {done && (
          <div style={{marginTop:14,display:"flex",alignItems:"center",gap:10,background:"#f0f3ff",border:"1px solid #86efac",borderRadius:12,padding:"12px 16px",fontSize:13,color:"#2d3a8c",fontWeight:600}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {done + " mapeado e salvo em Contas!"}
          </div>
        )}
      </div>
      <div style={{background:"linear-gradient(160deg,#f0fdf8 0%,#fff 60%)",border:"1px solid rgba(67,97,238,.2)",borderRadius:20,padding:"20px 24px",marginBottom:24,position:"relative",overflow:"hidden"}}>
        <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Como funciona o + Pipe</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:14}}>
          {[
            {n:"1",title:"Busca",desc:"Analise qualquer empresa Mid Market e gere o account mapping completo com fit de CX, dores, stakeholders e mensagens."},
            {n:"2",title:"Contas",desc:"Todas as empresas ficam salvas com status de prospecção, organizadas por fit, tier e estágio."},
            {n:"3",title:"Sequências",desc:"Gere cadências de 6 toques personalizadas por stakeholder com scripts prontos para copiar e usar."},
            {n:"4",title:"Pipeline",desc:"Kanban visual para acompanhar cada conta do mapeamento até a conversão."},
          ].map(function(item) {
            return (
              <div key={item.n}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{width:24,height:24,borderRadius:7,background:"rgba(67,97,238,.1)",border:"1px solid rgba(67,97,238,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#3451d1",flexShrink:0}}>{item.n}</div>
                  <div style={{fontSize:12.5,fontWeight:700,color:"#0f172a"}}>{item.title}</div>
                </div>
                <div style={{fontSize:11,color:"#64748b",lineHeight:1.55}}>{item.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// -- ACCOUNTS VIEW -------------------------------------------------------------
function AccountsView(props) {
  var accounts = props.accounts;
  var usage = props.usage;
  var _st_filter = useState({fit:"",tier:"",status:""}); var filter = _st_filter[0]; var setFilter = _st_filter[1];
  var _st_search = useState(""); var search = _st_search[0]; var setSearch = _st_search[1];
  var _st_viewMode = useState("cards"); var viewMode = _st_viewMode[0]; var setViewMode = _st_viewMode[1];
  var _st_sortOrder = useState("date"); var sortOrder = _st_sortOrder[0]; var setSortOrder = _st_sortOrder[1];
  var _st_csvPreview = useState(null); var csvPreview = _st_csvPreview[0]; var setCsvPreview = _st_csvPreview[1];
  var _st_selected = useState({}); var selected = _st_selected[0]; var setSelected = _st_selected[1];
  var _st_planMenu = useState(false); var planMenu = _st_planMenu[0]; var setPlanMenu = _st_planMenu[1];
  var fileRef = useRef(null);

  function onCsvPick(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var parsed = parseCSV(String(ev.target.result||""));
      setCsvPreview(parsed);
    };
    reader.readAsText(file);
    e.target.value = "";
  }
  function confirmImport() {
    if (csvPreview && csvPreview.rows && csvPreview.rows.length && props.onImport) {
      props.onImport(csvPreview.rows);
    }
    setCsvPreview(null);
  }
  function toggleSelect(id) {
    setSelected(function(prev){ var n=Object.assign({},prev); if(n[id]) delete n[id]; else n[id]=true; return n; });
  }
  function mapSelected() {
    var ids = Object.keys(selected);
    var toMap = accounts.filter(function(a){ return ids.indexOf(a.id)>=0 && !a.mapped; });
    if (!toMap.length) return;
    // Sequential mapping to respect the usage limit one-by-one
    (function next(i){
      if (i>=toMap.length) { setSelected({}); return; }
      props.onMap(toMap[i]).then(function(ok){
        if (!ok) { setSelected({}); return; } // limite atingido, para
        next(i+1);
      });
    })(0);
  }
  var selectedCount = Object.keys(selected).length;
  var filtered = accounts.filter(function(a) {
    if (filter.fit && a.fit !== filter.fit) return false;
    if (filter.tier && a.tier !== filter.tier) return false;
    if (filter.status && a.status !== filter.status) return false;
    if (search && !a.nome.toLowerCase().includes(search.toLowerCase()) && !a.setor.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).slice().sort(function(a,b) {
    if (sortOrder === "az") return a.nome.localeCompare(b.nome, "pt");
    if (sortOrder === "za") return b.nome.localeCompare(a.nome, "pt");
    return (b.savedAt||0) - (a.savedAt||0);
  });
  var statCounts = {};
  STATUS_ORDER.forEach(function(s) { statCounts[s] = accounts.filter(function(a){return a.status===s;}).length; });
  function clearFilters() { setFilter({fit:"",tier:"",status:""}); setSearch(""); }
  function toggleStatus(s) { setFilter(function(f){return Object.assign({},f,{status:f.status===s?"":s});}); }
  function changeFit(v) { setFilter(function(f){return Object.assign({},f,{fit:v});}); }
  function changeTier(v) { setFilter(function(f){return Object.assign({},f,{tier:v});}); }
  var hasFilter = filter.fit || filter.tier || filter.status || search;
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:"-0.6px"}}>Contas</div>
          <div style={{fontSize:13,color:"#64748b"}}>{accounts.length + " conta" + (accounts.length!==1?"s":"") + " na lista"}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sortOrder} onChange={function(e){setSortOrder(e.target.value);}} style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#475569",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
            <option value="date">Mais recente</option>
            <option value="az">A - Z</option>
            <option value="za">Z - A</option>
          </select>
          <div style={{display:"flex",background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,overflow:"hidden"}}>
            <button onClick={function(){setViewMode("cards");}} title="Cards" style={{padding:"8px 12px",border:"none",background:viewMode==="cards"?"linear-gradient(135deg,#4361EE,#3451d1)":"transparent",color:viewMode==="cards"?"#fff":"#94a3b8",cursor:"pointer",lineHeight:1,fontFamily:"inherit"}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </button>
            <button onClick={function(){setViewMode("list");}} title="Lista" style={{padding:"8px 12px",border:"none",background:viewMode==="list"?"linear-gradient(135deg,#4361EE,#3451d1)":"transparent",color:viewMode==="list"?"#fff":"#94a3b8",cursor:"pointer",lineHeight:1,fontFamily:"inherit"}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      {usage && (
        <div style={{background:"#fff",border:"1.5px solid #e8edf4",borderRadius:16,padding:"14px 18px",marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:700,color:"#fff",background:usage.planColor,borderRadius:6,padding:"3px 8px",textTransform:"uppercase",letterSpacing:.5}}>{usage.planLabel}</span>
              <span style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{"Mapeamentos: " + usage.used + " / " + usage.limit}</span>
            </div>
            <span style={{fontSize:11,color:usage.remaining<=3?"#ef4444":"#64748b",fontWeight:usage.remaining<=3?700:500}}>{usage.remaining + " restante" + (usage.remaining!==1?"s":"") + " este mês"}</span>
          </div>
          <div style={{height:8,background:"#f1f5f9",borderRadius:8,overflow:"hidden"}}>
            <div style={{height:"100%",width:Math.min(100,Math.round((usage.used/usage.limit)*100))+"%",background:usage.remaining<=3?"linear-gradient(90deg,#ef4444,#f59e0b)":"linear-gradient(90deg,"+usage.planColor+",#3451d1)",borderRadius:8,transition:"width .4s"}}/>
          </div>
        </div>
      )}
      {selectedCount>0 && (
        <div style={{background:"linear-gradient(135deg,rgba(67,97,238,.08),rgba(14,165,233,.05))",border:"1.5px solid rgba(67,97,238,.2)",borderRadius:14,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <span style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{selectedCount + " selecionada" + (selectedCount!==1?"s":"")}</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={function(){setSelected({});}} style={{background:"#fff",border:"1px solid #e2e8f0",color:"#64748b",borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Limpar"}</button>
            <button onClick={mapSelected} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 12px rgba(67,97,238,.25)"}}>{"Mapear selecionadas"}</button>
          </div>
        </div>
      )}
      {csvPreview && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",overflowY:"auto"}} onClick={function(e){if(e.target===e.currentTarget)setCsvPreview(null);}}>
          <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:520,padding:"24px",boxShadow:"0 24px 80px rgba(15,23,42,.25)",maxHeight:"85vh",display:"flex",flexDirection:"column"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{fontSize:17,fontWeight:800,color:"#0f172a",marginBottom:6}}>{"Importar contas"}</div>
            {csvPreview.error ? (
              <div style={{fontSize:13,color:"#ef4444",background:"#fff1f2",border:"1px solid #fecdd3",borderRadius:10,padding:"12px 14px",marginTop:8}}>{csvPreview.error}</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",minHeight:0}}>
                <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>{csvPreview.rows.length + " conta" + (csvPreview.rows.length!==1?"s":"") + " encontrada" + (csvPreview.rows.length!==1?"s":"") + ". Serao importadas como nao mapeadas (sem consumir creditos)."}</div>
                <div style={{overflowY:"auto",border:"1px solid #f1f5f9",borderRadius:10,marginBottom:16}}>
                  {csvPreview.rows.slice(0,50).map(function(r,i){
                    return (
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:i<csvPreview.rows.length-1?"1px solid #f8fafc":"none"}}>
                        <span style={{fontSize:12,fontWeight:600,color:"#0f172a",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.nome}</span>
                        {r.site && <span style={{fontSize:10,color:"#94a3b8",flexShrink:0}}>{r.site}</span>}
                      </div>
                    );
                  })}
                  {csvPreview.rows.length>50 && <div style={{padding:"8px 12px",fontSize:11,color:"#94a3b8"}}>{"+ " + (csvPreview.rows.length-50) + " outras..."}</div>}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setCsvPreview(null);}} style={{flex:1,background:"#f8fafc",border:"1px solid #e2e8f0",color:"#64748b",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Cancelar"}</button>
              {!csvPreview.error && <button onClick={confirmImport} style={{flex:2,background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{"Importar " + csvPreview.rows.length + " conta" + (csvPreview.rows.length!==1?"s":"")}</button>}
            </div>
          </div>
        </div>
      )}
      <div className="status-chips" style={{display:"flex",gap:10,marginBottom:24,overflowX:"auto",paddingBottom:4}}>
        {STATUS_ORDER.map(function(s) {
          var sc = STATUS_CONFIG[s];
          var cnt = statCounts[s];
          var isActive = filter.status === s;
          return (
            <div key={s} onClick={function(){toggleStatus(s);}} style={{flexShrink:0,background:isActive?sc.bg:"#fff",border:"1.5px solid "+(isActive?sc.border:"#e8edf4"),borderRadius:14,padding:"12px 16px",cursor:"pointer",transition:"all .2s",textAlign:"center",minWidth:100}}>
              <div style={{fontSize:20,fontWeight:800,color:isActive?sc.color:"#64748b"}}>{cnt}</div>
              <div style={{fontSize:9,fontWeight:600,color:isActive?sc.color:"#6b7280",textTransform:"uppercase",letterSpacing:.8,marginTop:2}}>{sc.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="Buscar por nome ou setor..." style={{flex:1,minWidth:200,background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 14px",fontSize:13,color:"#0f172a",fontFamily:"inherit",outline:"none",transition:"border-color .2s"}} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
        <select value={filter.fit} onChange={function(e){changeFit(e.target.value);}} style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 14px",fontSize:12,color:filter.fit?"#0f172a":"#94a3b8",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
          <option value="">Fit</option>
          <option value="ALTO">Fit Alto</option>
          <option value="MEDIO">Fit Medio</option>
          <option value="BAIXO">Fit Baixo</option>
        </select>
        <select value={filter.tier} onChange={function(e){changeTier(e.target.value);}} style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 14px",fontSize:12,color:filter.tier?"#0f172a":"#94a3b8",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
          <option value="">Tier</option>
          <option value="Tier 1">Tier 1</option>
          <option value="Tier 2">Tier 2</option>
          <option value="Tier 3">Tier 3</option>
        </select>
        {hasFilter && (
          <button onClick={clearFilters} style={{background:"#fee2e2",border:"1px solid #fecdd3",color:"#991b1b",borderRadius:10,padding:"9px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {"Limpar"}
          </button>
        )}
      </div>
      {filtered.length===0 ? (
        <div style={{textAlign:"center",padding:"64px 0",background:"#f8fafc",borderRadius:20,border:"1.5px dashed #e2e8f0"}}>
          <div style={{fontSize:36,marginBottom:12}}>{"🔍"}</div>
          <div style={{fontSize:15,fontWeight:700,color:"#334155",marginBottom:6}}>{accounts.length===0?"Nenhuma conta ainda":"Nenhuma conta com esses filtros"}</div>
          <div style={{fontSize:12,color:"#6b7280"}}>{accounts.length===0?"Importe uma lista CSV ou va para Busca para analisar empresas":"Tente limpar os filtros"}</div>
        </div>
      ) : viewMode==="cards" ? (
        <div className="card-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
          {filtered.map(function(acc) {
            return <AccountCard key={acc.id} acc={acc} onOpen={props.onOpen} onStatusChange={props.onStatusChange} onDelete={props.onDelete} onMap={props.onMap} mapping={props.mappingId===acc.id} selected={!!selected[acc.id]} onToggleSelect={toggleSelect}/>;
          })}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtered.map(function(acc) {
            var fc = FIT_CONFIG[acc.fit]||FIT_CONFIG.ALTO;
            var sc = STATUS_CONFIG[acc.status]||STATUS_CONFIG.prospecting;
            if (!acc.mapped) {
              var isMapping = props.mappingId===acc.id;
              return (
                <div key={acc.id} style={{background:"#fff",border:"1px solid "+(selected[acc.id]?"#4361EE":"#e8edf4"),borderRadius:14,padding:"12px 18px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <input type="checkbox" checked={!!selected[acc.id]} onChange={function(){toggleSelect(acc.id);}} disabled={isMapping} style={{width:16,height:16,accentColor:"#4361EE",cursor:"pointer",flexShrink:0}}/>
                  <div style={{flex:1,minWidth:120}}>
                    <div style={{fontSize:13.5,fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.nome}</div>
                    <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{acc.site||"Importada da lista"}</div>
                  </div>
                  <span style={{fontSize:8,fontWeight:700,color:"#92400e",background:"#fef3c7",border:"1px solid #fde68a",borderRadius:6,padding:"3px 8px",flexShrink:0,textTransform:"uppercase",letterSpacing:.5}}>{"Não mapeada"}</span>
                  <button onClick={function(){if(!isMapping)props.onMap(acc);}} disabled={isMapping} style={{background:isMapping?"#f1f5f9":"linear-gradient(135deg,#4361EE,#3451d1)",color:isMapping?"#94a3b8":"#fff",border:"none",borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,cursor:isMapping?"default":"pointer",fontFamily:"inherit",flexShrink:0}}>{isMapping?"Mapeando...":"Mapear"}</button>
                  <button onClick={function(){props.onDelete(acc.id);}} disabled={isMapping} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:8,padding:"6px 9px",fontSize:10,cursor:isMapping?"default":"pointer",fontFamily:"inherit",flexShrink:0}}>x</button>
                </div>
              );
            }
            return (
              <div key={acc.id} style={{background:"#fff",border:"1px solid #e8edf4",borderRadius:14,padding:"12px 18px",display:"flex",alignItems:"center",gap:14,transition:"all .2s"}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.boxShadow="0 2px 12px rgba(67,97,238,.08)";}} onMouseLeave={function(e){e.currentTarget.style.borderColor="#e8edf4";e.currentTarget.style.boxShadow="";}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13.5,fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acc.nome}</div>
                  <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{acc.setor}</div>
                </div>
                <span style={{background:fc.bg,border:"1px solid "+fc.border,color:fc.text,borderRadius:7,padding:"3px 9px",fontSize:9,fontWeight:700,flexShrink:0}}>{"FIT "+acc.fit}</span>
                <span style={{background:"#f8fafc",border:"1px solid "+(TIER_COLOR[acc.tier]||"#e2e8f0"),color:TIER_COLOR[acc.tier]||"#94a3b8",borderRadius:7,padding:"3px 9px",fontSize:9,fontWeight:700,flexShrink:0}}>{acc.tier}</span>
                <span style={{background:sc.bg,border:"1px solid "+sc.border,color:sc.color,borderRadius:7,padding:"3px 9px",fontSize:9,fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>{sc.label}</span>
                <span style={{fontSize:10,color:"#6b7280",flexShrink:0}}>{fmtDate(acc.savedAt)}</span>
                <button onClick={function(){props.onOpen(acc);}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Ver</button>
                <button onClick={function(){props.onDelete(acc.id);}} style={{background:"none",border:"1px solid #fee2e2",color:"#ef4444",borderRadius:8,padding:"5px 8px",fontSize:10,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>x</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// -- INSIGHTS VIEW -------------------------------------------------------------
// Merge API-enriched contacts into stakeholder profiles
function mergeStakeholders(stakeholders, contacts) {
  var kwmap = {
    "Head de CX":["head of cx","head cx","customer experience","atendimento","customer service","support manager","director of cx","vp cx"],
    "CEO":["ceo","chief executive","diretor geral","founder","president","presidente"],
    "VP Operacoes":["vp operacoes","director of operations","head of operations","chief operating","coo"],
    "Customer Success":["customer success","head of cs","cs manager","csm","vp customer success"],
    "TI/CTO":["cto","chief technology","vp engineering","head of engineering","gerente de ti","it manager"],
    "CFO":["cfo","chief financial","diretor financeiro","vp finance"],
  };
  return stakeholders.map(function(s) {
    if (s.linkedin || s.email) return s;
    var cargo = (s.cargo||"").toLowerCase();
    var matched = null;
    Object.keys(kwmap).forEach(function(k) {
      if (matched) return;
      kwmap[k].forEach(function(kw) {
        if (!matched) contacts.forEach(function(c) {
          if (!matched && c.cargo && c.cargo.toLowerCase().includes(kw)) matched = c;
        });
      });
    });
    if (!matched) contacts.forEach(function(c) {
      if (matched) return;
      var ct=(c.cargo||"").toLowerCase();
      if (cargo.split(" ").some(function(w){return w.length>3&&ct.includes(w);})) matched=c;
    });
    if (matched) return Object.assign({},s,{nome:matched.nome||s.nome||"",email:matched.email||s.email||"",linkedin:matched.linkedin||s.linkedin||"",phone:matched.phone||s.phone||"",source:matched.source||""});
    return s;
  });
}
function SemiCircleChart(props) {
  var convSteps = props.convSteps||[];
  var colors=["#0f172a","#0369a1","#7c3aed","#2d3a8c","#991b1b"];
  var radii=[90,76,62,48,34];
  var steps=convSteps.slice(0,5);
  var pathData=steps.map(function(step,i){
    var pct=step.pct/100;
    var r=radii[i];
    if(pct<=0) return null;
    var startA=Math.PI; var endA=Math.PI+(Math.PI*pct);
    var x1=100+r*Math.cos(startA); var y1=100+r*Math.sin(startA);
    var x2=100+r*Math.cos(endA);   var y2=100+r*Math.sin(endA);
    var large=pct>0.5?1:0;
    return {d:"M "+x1+" "+y1+" A "+r+" "+r+" 0 "+large+" 1 "+x2+" "+y2,color:colors[i],key:i};
  }).filter(Boolean);
  return (
    <svg width="200" height="110" viewBox="0 0 200 110">
      {pathData.map(function(p){return <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth="10" strokeLinecap="round" opacity="0.85"/>;})}
      <text x="100" y="98" textAnchor="middle" fontSize="11" fill="#94a3b8">0%</text>
      <text x="10" y="105" textAnchor="middle" fontSize="11" fill="#94a3b8">Map.</text>
      <text x="190" y="105" textAnchor="middle" fontSize="11" fill="#2d3a8c">Conv.</text>
    </svg>
  );
}
function exportRelatoriosPDF(accounts, filters) {
  var filtered = accounts.filter(function(a) {
    if (filters.fit && a.fit !== filters.fit) return false;
    if (filters.tier && a.tier !== filters.tier) return false;
    if (filters.nome && !a.nome.toLowerCase().includes(filters.nome.toLowerCase())) return false;
    if (filters.from) { var d = new Date(filters.from); if (new Date(a.savedAt) < d) return false; }
    if (filters.to)   { var d2 = new Date(filters.to); d2.setHours(23,59,59); if (new Date(a.savedAt) > d2) return false; }
    return true;
  });
  var byStatus = {};
  STATUS_ORDER.forEach(function(s){byStatus[s]=filtered.filter(function(a){return a.status===s;}).length;});
  var html = "<html><head><title>Relatórios Mais Pipe</title><style>body{font-family:Verdana,sans-serif;padding:32px;color:#0f172a;font-size:12px}h1{color:#059669;font-size:18px}h2{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#4361EE;margin:20px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#f8fafc;padding:8px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.8px}td{padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:11px}.fit-alto{color:#065f46;background:#dcfce7;padding:2px 7px;border-radius:5px;font-size:9px;font-weight:700}.fit-medio{color:#92400e;background:#fef3c7;padding:2px 7px;border-radius:5px;font-size:9px;font-weight:700}.fit-baixo{color:#991b1b;background:#fee2e2;padding:2px 7px;border-radius:5px;font-size:9px;font-weight:700}.footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:10px;font-size:10px;color:#94a3b8}</style></head><body>";
  html += "<h1>Relatório de Prospecção , Mais Pipe Beta</h1>";
  html += "<p style='color:#64748b;font-size:11px'>Gerado em "+new Date().toLocaleDateString("pt-BR")+" - "+filtered.length+" contas</p>";
  html += "<h2>Funil de Status</h2><table><tr>";
  STATUS_ORDER.forEach(function(s){html+="<th>"+STATUS_CONFIG[s].label+"</th>";});
  html+="</tr><tr>";
  STATUS_ORDER.forEach(function(s){html+="<td><strong>"+byStatus[s]+"</strong></td>";});
  html+="</tr></table>";
  html += "<h2>Lista de Contas ("+filtered.length+")</h2><table><tr><th>Empresa</th><th>Setor</th><th>Fit</th><th>Tier</th><th>Status</th><th>Salvo em</th></tr>";
  filtered.forEach(function(a) {
    var fitClass = a.fit==="ALTO"?"fit-alto":a.fit==="MEDIO"?"fit-medio":"fit-baixo";
    html += "<tr><td><strong>"+a.nome+"</strong></td><td>"+a.setor+"</td><td><span class='"+fitClass+"'>"+a.fit+"</span></td><td>"+a.tier+"</td><td>"+(STATUS_CONFIG[a.status]&&STATUS_CONFIG[a.status].label||a.status)+"</td><td>"+fmtDate(a.savedAt)+"</td></tr>";
  });
  html += "</table><div class='footer'>Mais Pipe Beta , Zendesk , BDR/SDR Zendesk</div></body></html>";
  var w = window.open("","_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(function(){w.print();}, 400);
}
function InsightsView(props) {
  var accounts = props.accounts;
  var total = accounts.length;
  var _st_pdfFilters = useState({fit:"",tier:"",nome:"",from:"",to:""}); var pdfFilters = _st_pdfFilters[0]; var setPdfFilters = _st_pdfFilters[1];
  // -- SVG Donut chart helper
  function buildDonutPaths(segments, cx, cy, r, innerR) {
    var total2=segments.reduce(function(s,seg){return s+(seg.value||0);},0)||1;
    var startAngle=-Math.PI/2;
    var result=[];
    for(var i=0;i<segments.length;i++){
      var seg=segments[i];
      var angle=(seg.value/total2)*Math.PI*2;
      var endAngle=startAngle+angle;
      var x1=cx+r*Math.cos(startAngle); var y1=cy+r*Math.sin(startAngle);
      var x2=cx+r*Math.cos(endAngle);   var y2=cy+r*Math.sin(endAngle);
      var ix1=cx+innerR*Math.cos(endAngle); var iy1=cy+innerR*Math.sin(endAngle);
      var ix2=cx+innerR*Math.cos(startAngle); var iy2=cy+innerR*Math.sin(startAngle);
      var large=angle>Math.PI?1:0;
      if(seg.value>0) result.push({d:"M "+x1+" "+y1+" A "+r+" "+r+" 0 "+large+" 1 "+x2+" "+y2+" L "+ix1+" "+iy1+" A "+innerR+" "+innerR+" 0 "+large+" 0 "+ix2+" "+iy2+" Z",fill:seg.color,key:i});
      startAngle=endAngle;
    }
    return result;
  }
  function DonutChart(dprops) {
    var segments=dprops.segments; var size=dprops.size||120; var hole=dprops.hole||0.62;
    var cx=size/2; var cy=size/2; var r=size/2-8; var innerR=r*hole;
    var pathData=buildDonutPaths(segments,cx,cy,r,innerR);
    return (
      <svg width={size} height={size} viewBox={"0 0 "+size+" "+size}>
        {pathData.map(function(p){return <path key={p.key} d={p.d} fill={p.fill} opacity="0.9"/>;})}
        {dprops.centerLabel&&<text x={cx} y={cy-5} textAnchor="middle" fontSize="18" fontWeight="800" fill="#0f172a">{dprops.centerLabel}</text>}
        {dprops.centerSub&&<text x={cx} y={cy+14} textAnchor="middle" fontSize="10" fill="#94a3b8">{dprops.centerSub}</text>}
      </svg>
    );
  }
  // -- Funnel by status
  var funnel = STATUS_ORDER.map(function(s) {
    return { status:s, label:STATUS_CONFIG[s].label, count:accounts.filter(function(a){return a.status===s;}).length, color:STATUS_CONFIG[s].color, bg:STATUS_CONFIG[s].bg, border:STATUS_CONFIG[s].border };
  });
  var maxFunnel = Math.max.apply(null, funnel.map(function(f){return f.count;})) || 1;
  // -- By fit score
  var byFit = ["ALTO","MEDIO","BAIXO"].map(function(f) {
    var cnt = accounts.filter(function(a){return a.fit===f;}).length;
    return { fit:f, count:cnt, pct:total?Math.round(cnt/total*100):0, color:FIT_CONFIG[f].text, bg:FIT_CONFIG[f].bg, border:FIT_CONFIG[f].border };
  });
  // -- By tier
  var byTier = ["Tier 1","Tier 2","Tier 3"].map(function(t) {
    var cnt = accounts.filter(function(a){return a.tier===t;}).length;
    return { tier:t, count:cnt, pct:total?Math.round(cnt/total*100):0, color:TIER_COLOR[t]||"#94a3b8" };
  });
  // -- By setor (top 6)
  var setorMap = {};
  accounts.forEach(function(a) {
    var s = (a.setor||"Outros").split("/")[0].trim();
    setorMap[s] = (setorMap[s]||0) + 1;
  });
  var bySetor = Object.keys(setorMap).map(function(s){return {setor:s,count:setorMap[s]};})
    .sort(function(a,b){return b.count-a.count;}).slice(0,6);
  var maxSetor = (bySetor[0]&&bySetor[0].count)||1;
  // -- Velocity: accounts saved by week (last 8 weeks)
  var now = Date.now();
  var weeks = [];
  for (var w = 7; w >= 0; w--) {
    var wStart = now - (w+1)*7*24*60*60*1000;
    var wEnd   = now - w*7*24*60*60*1000;
    var label  = w===0?"Esta semana":"Sem -"+(w);
    var cnt    = accounts.filter(function(a){return a.savedAt>=wStart && a.savedAt<wEnd;}).length;
    weeks.push({label:label, count:cnt});
  }
  var maxWeek = Math.max.apply(null, weeks.map(function(w){return w.count;})) || 1;
  // -- Conversion rates
  var contacted  = accounts.filter(function(a){return ["contacted","meeting","proposal","won"].indexOf(a.status)>-1;}).length;
  var meeting    = accounts.filter(function(a){return ["meeting","proposal","won"].indexOf(a.status)>-1;}).length;
  var proposal   = accounts.filter(function(a){return ["proposal","won"].indexOf(a.status)>-1;}).length;
  var won        = accounts.filter(function(a){return a.status==="won";}).length;
  var convSteps = [
    {label:"Mapeado",   count:total,     pct:100},
    {label:"Contatado", count:contacted, pct:total?Math.round(contacted/total*100):0},
    {label:"Reunião",   count:meeting,   pct:total?Math.round(meeting/total*100):0},
    {label:"Proposta",  count:proposal,  pct:total?Math.round(proposal/total*100):0},
    {label:"Ganho",     count:won,       pct:total?Math.round(won/total*100):0},
  ];
  // -- KPI cards
  var kpis = [
    {label:"Total Mapeado",    value:total,     sub:"empresas",          color:"#0f172a", icon:"T"},
    {label:"Fit Alto",         value:byFit[0]&&byFit[0].count||0, sub:"prospects prime",  color:"#2d3a8c", icon:"A"},
    {label:"Em Andamento",     value:contacted, sub:"contatados ou mais", color:"#7c3aed", icon:"C"},
    {label:"Taxa de Ganho",    value:(total?Math.round(won/total*100):0)+"%", sub:"dos mapeados",color:"#3451d1", icon:"G"},
  ];
  if (total === 0) {
    return (
      <div>
        <div style={{fontSize:28,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:"-0.6px"}}>{"Relatórios"}</div>
        <div style={{fontSize:13,color:"#64748b",marginBottom:32}}>{"Dashboard de performance da sua prospecção."}</div>
        <div style={{textAlign:"center",padding:"64px 0",background:"#f8fafc",borderRadius:20,border:"1.5px dashed #e2e8f0"}}>
          <div style={{fontSize:36,marginBottom:12}}>{"📊"}</div>
          <div style={{fontSize:15,fontWeight:700,color:"#334155",marginBottom:6}}>Nenhum dado ainda</div>
          <div style={{fontSize:12,color:"#6b7280"}}>Mapeie sua primeira empresa em Busca para comecar a ver insights.</div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:28,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:"-0.6px"}}>{"Relatórios"}</div>
          <div style={{fontSize:13,color:"#64748b"}}>{"Performance da sua prospecção baseada nas contas mapeadas."}</div>
        </div>
        <button onClick={function(){exportRelatoriosPDF(accounts,pdfFilters);}} style={{display:"flex",alignItems:"center",gap:7,background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:"10px 18px",fontSize:12,fontWeight:600,color:"#475569",cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#4361EE";e.currentTarget.style.color="#3451d1";}} onMouseLeave={function(e){e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#475569";}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          {"Exportar PDF"}
        </button>
      </div>
      <div style={{background:"#fff",border:"1.5px solid #e8edf4",borderRadius:16,padding:"16px 20px",marginBottom:24,display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:10,fontWeight:700,color:"#6b7280",letterSpacing:1,textTransform:"uppercase"}}>Filtros PDF:</span>
        <select value={pdfFilters.fit} onChange={function(e){setPdfFilters(function(f){return Object.assign({},f,{fit:e.target.value});});}} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",fontSize:11,color:"#475569",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
          <option value="">Todos os fits</option>
          <option value="ALTO">Fit Alto</option>
          <option value="MEDIO">{"Fit Médio"}</option>
          <option value="BAIXO">Fit Baixo</option>
        </select>
        <select value={pdfFilters.tier} onChange={function(e){setPdfFilters(function(f){return Object.assign({},f,{tier:e.target.value});});}} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",fontSize:11,color:"#475569",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
          <option value="">Todos os tiers</option>
          <option value="Tier 1">Tier 1</option>
          <option value="Tier 2">Tier 2</option>
          <option value="Tier 3">Tier 3</option>
        </select>
        <input value={pdfFilters.nome} onChange={function(e){setPdfFilters(function(f){return Object.assign({},f,{nome:e.target.value});});}} placeholder="Filtrar por nome..." style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",fontSize:11,color:"#0f172a",fontFamily:"inherit",outline:"none",minWidth:130}}/>
        <input type="date" value={pdfFilters.from} onChange={function(e){setPdfFilters(function(f){return Object.assign({},f,{from:e.target.value});});}} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",fontSize:11,color:"#0f172a",fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:10,color:"#6b7280"}}>{"até"}</span>
        <input type="date" value={pdfFilters.to} onChange={function(e){setPdfFilters(function(f){return Object.assign({},f,{to:e.target.value});});}} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",fontSize:11,color:"#0f172a",fontFamily:"inherit",outline:"none"}}/>
      </div>
      <div className="kpi-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14,marginBottom:24}}>
        {kpis.map(function(k) {
          return (
            <div key={k.label} style={{background:"#fff",border:"1px solid #e8edf4",borderRadius:18,padding:"20px 22px",boxShadow:"0 4px 20px rgba(15,23,42,.06)",position:"relative",overflow:"hidden"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>{k.label}</div>
              <div style={{fontSize:32,fontWeight:800,color:k.color,lineHeight:1,marginBottom:6}}>{k.value}</div>
              <div style={{fontSize:11,color:"#6b7280"}}>{k.sub}</div>
            </div>
          );
        })}
      </div>
      <div className="chart-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:18}}>
        <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:20,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
            {"Funil de Conversão"}
          </div>
          {convSteps.map(function(step, i) {
            var colors = ["#0f172a","#0369a1","#7c3aed","#b45309","#2d3a8c"];
            return (
              <div key={step.label} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <span style={{fontSize:12,fontWeight:600,color:colors[i]}}>{step.label}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,color:"#6b7280"}}>{step.count}</span>
                    <span style={{fontSize:11,fontWeight:700,color:colors[i],minWidth:32,textAlign:"right"}}>{step.pct+"%"}</span>
                  </div>
                </div>
                <div style={{height:6,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:step.pct+"%",background:colors[i],borderRadius:4,transition:"width .8s cubic-bezier(.22,1,.36,1)"}}/>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:20,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
            {"Contas por Semana"}
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120}}>
            {weeks.map(function(w, i) {
              var h = Math.round((w.count/maxWeek)*100);
              var isLast = i===weeks.length-1;
              return (
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <div style={{fontSize:9,fontWeight:700,color:isLast?"#3451d1":"#94a3b8"}}>{w.count||""}</div>
                  <div style={{width:"100%",height:h+"%",minHeight:w.count?4:2,background:isLast?"linear-gradient(180deg,#4361EE,#3451d1)":"#e2e8f0",borderRadius:"4px 4px 0 0",transition:"height .6s ease"}}/>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:6,marginTop:6}}>
            {weeks.map(function(w,i){
              return <div key={i} style={{flex:1,textAlign:"center",fontSize:8,color:i===weeks.length-1?"#3451d1":"#cbd5e1",overflow:"hidden"}}>{i===weeks.length-1?"Agora":"S-"+i}</div>;
            })}
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:18,marginBottom:18}}>
        <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
            {"Distribuição por Fit"}
          </div>
          {byFit.map(function(f) {
            return (
              <div key={f.fit} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontSize:12,fontWeight:700,color:f.color,background:f.bg,border:"1px solid "+f.border,borderRadius:6,padding:"2px 8px"}}>{"FIT "+f.fit}</span>
                  <span style={{fontSize:12,fontWeight:700,color:f.color}}>{f.count+" ("+f.pct+"%)"}</span>
                </div>
                <div style={{height:6,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:f.pct+"%",background:f.color,borderRadius:4}}/>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
            {"Distribuição por Tier"}
          </div>
          {byTier.map(function(t) {
            return (
              <div key={t.tier} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontSize:12,fontWeight:700,color:t.color}}>{t.tier}</span>
                  <span style={{fontSize:12,fontWeight:700,color:t.color}}>{t.count+" ("+t.pct+"%)"}</span>
                </div>
                <div style={{height:6,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:t.pct+"%",background:t.color,borderRadius:4}}/>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
            {"Top Setores"}
          </div>
          {bySetor.length===0 ? (
            <div style={{fontSize:12,color:"#6b7280"}}>Sem dados</div>
          ) : bySetor.map(function(s, i) {
            var barColors = ["#4361EE","#0ea5e9","#7c3aed","#f59e0b","#ef4444","#64748b"];
            var w = Math.round(s.count/maxSetor*100);
            return (
              <div key={s.setor} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:"#334155",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"70%"}}>{s.setor}</span>
                  <span style={{fontSize:11,fontWeight:700,color:barColors[i]||"#94a3b8",flexShrink:0}}>{s.count}</span>
                </div>
                <div style={{height:5,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:w+"%",background:barColors[i]||"#94a3b8",borderRadius:3}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
        <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
          {"Status Completo,"}
          {total} Contas
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {funnel.map(function(f) {
            var barH = f.count ? Math.round(f.count/maxFunnel*60)+16 : 8;
            return (
              <div key={f.status} style={{flex:1,minWidth:80,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
                <div style={{fontSize:22,fontWeight:800,color:f.color}}>{f.count}</div>
                <div style={{width:"100%",height:barH,background:f.bg,border:"1.5px solid "+f.border,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:f.color}}/>
                </div>
                <div style={{fontSize:9,fontWeight:600,color:f.color,textTransform:"uppercase",letterSpacing:.6,textAlign:"center"}}>{f.label}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginTop:18}}>
        <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
            {"Fit Score, Visão Donut"}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:24}}>
            <DonutChart size={120} hole={0.62} segments={byFit.map(function(f){return {value:f.count,color:f.color};})} centerLabel={total} centerSub="contas"/>
            <div style={{flex:1}}>
              {byFit.map(function(f){return (
                <div key={f.fit} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:f.color,flexShrink:0}}/>
                  <div style={{fontSize:11,color:"#334155",flex:1}}>{"FIT "+f.fit}</div>
                  <div style={{fontSize:12,fontWeight:700,color:f.color}}>{f.count}</div>
                  <div style={{fontSize:10,color:"#6b7280"}}>{f.pct+"%"}</div>
                </div>
              );})}
            </div>
          </div>
        </div>
        <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
            {"Funil, Semicírculo"}
          </div>
          <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
            <SemiCircleChart convSteps={convSteps}/>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
            {convSteps.map(function(step,i){
              var colors=["#0f172a","#0369a1","#7c3aed","#2d3a8c","#991b1b"];
              return <div key={step.label} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:8,height:8,borderRadius:"50%",background:colors[i]}}/><span style={{fontSize:10,color:"#64748b"}}>{step.label+": "+step.pct+"%"}</span></div>;
            })}
          </div>
        </div>
      </div>
      <div style={{background:"rgba(255,255,255,.95)",border:"1px solid rgba(228,235,244,.8)",borderRadius:20,padding:"22px 24px",boxShadow:"0 4px 24px rgba(15,23,42,.07)",marginTop:18}}>
        <div style={{fontSize:10,fontWeight:700,color:"#4361EE",letterSpacing:2,textTransform:"uppercase",marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:3,height:14,background:"linear-gradient(180deg,#4361EE,#3451d1)",borderRadius:3,boxShadow:"0 0 8px rgba(67,97,238,.4)"}}/>
          {"Métricas de Velocidade"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:14}}>
          {[
            {label:"Média por Semana", value:total?(weeks.reduce(function(s,w){return s+w.count;},0)/Math.max(1,weeks.filter(function(w){return w.count>0;}).length)).toFixed(1):0, sub:"contas mapeadas", color:"#0369a1"},
            {label:"Melhor Semana",    value:Math.max.apply(null,weeks.map(function(w){return w.count;})), sub:"contas em uma semana", color:"#7c3aed"},
            {label:"Taxa de Avanço",   value:total?Math.round(contacted/total*100)+"%":"0%", sub:"mapeado para contatado", color:"#3451d1"},
            {label:"Taxa de Reunião",  value:contacted?Math.round(meeting/contacted*100)+"%":"0%", sub:"contatado para reunião", color:"#2d3a8c"},
          ].map(function(m){return (
            <div key={m.label} style={{background:"#f8fafc",border:"1px solid #e8edf4",borderRadius:14,padding:"16px 18px"}}>
              <div style={{fontSize:9,color:"#6b7280",fontWeight:600,marginBottom:8,textTransform:"uppercase",letterSpacing:.8}}>{m.label}</div>
              <div style={{fontSize:28,fontWeight:800,color:m.color,lineHeight:1,marginBottom:4}}>{m.value}</div>
              <div style={{fontSize:11,color:"#6b7280"}}>{m.sub}</div>
            </div>
          );})}
        </div>
      </div>
    </div>
  );
}
// -- MAIN APP ------------------------------------------------------------------
function BetaBanner() {
  var _st_open = useState(false); var open = _st_open[0]; var setOpen = _st_open[1];
  var _st_form = useState({nome:"",assunto:"",mensagem:""}); var form = _st_form[0]; var setForm = _st_form[1];
  var _st_sending = useState(false); var sending = _st_sending[0]; var setSending = _st_sending[1];
  var _st_sent = useState(false); var sent = _st_sent[0]; var setSent = _st_sent[1];
  var _st_err = useState(""); var err = _st_err[0]; var setErr = _st_err[1];
  function handleSend() {
    if (!form.nome.trim() || !form.assunto.trim() || !form.mensagem.trim()) {
      setErr("Preencha todos os campos.");
      return;
    }
    setSending(true); setErr("");
    fetch("/api/feedback", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({nome:form.nome, assunto:form.assunto, mensagem:form.mensagem})
    })
    .then(function(r){ return r.json(); })
    .then(function(resp) {
      if (resp.ok) {
        setSending(false); setSent(true); setOpen(false);
        setForm({nome:"",assunto:"",mensagem:""});
      } else {
        setSending(false);
        setErr(resp.error || "Erro ao enviar. Tente novamente.");
      }
    })
    .catch(function() {
      setSending(false);
      setErr("Erro de conexao. Tente novamente.");
    });
  }
  function update(field, val) { setForm(function(f){ var n=Object.assign({},f); if(field==="nome")n.nome=val; else if(field==="assunto")n.assunto=val; else n.mensagem=val; return n; }); }
  var inputStyle = {width:"100%",background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:8,padding:"9px 12px",fontSize:12,color:"#0f172a",fontFamily:"inherit",outline:"none",boxSizing:"border-box"};
  return (
    <div style={{position:"relative",zIndex:200}}>
      <div style={{background:"linear-gradient(90deg,#0A0A0F 0%,#0d0d1a 100%)",borderBottom:"1px solid rgba(67,97,238,.25)",padding:"0 20px",height:40,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{background:"rgba(67,97,238,.15)",border:"1px solid rgba(67,97,238,.3)",color:"#4361EE",borderRadius:6,padding:"2px 9px",fontSize:9,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"}}>{"Beta"}</span>
          <span style={{fontSize:12,color:"#ffffff",opacity:.85}}>{"Esta é uma versão Beta , deixe sua sugestão ou comentário no botão ao lado"}</span>
        </div>
        <button onClick={function(){setOpen(true);setSent(false);setErr("");}} style={{background:"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:8,padding:"6px 16px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(67,97,238,.3)",letterSpacing:.3}}>
          {"Enviar Feedback"}
        </button>
      </div>
      {open && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(2px)"}} onClick={function(){setOpen(false);}}>
          <div style={{background:"#fff",borderRadius:20,padding:"28px 32px",width:"100%",maxWidth:440,boxShadow:"0 32px 80px rgba(15,23,42,.25)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:17,fontWeight:800,color:"#0f172a",marginBottom:2}}>{"Feedback , Mais Pipe Beta"}</div>
                <div style={{fontSize:11,color:"#6b7280"}}>{"Sua mensagem será enviada para a equipe Mais Pipe"}</div>
              </div>
              <button onClick={function(){setOpen(false);}} style={{background:"#f1f5f9",border:"none",borderRadius:8,width:28,height:28,cursor:"pointer",fontSize:14,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>{"x"}</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:"#64748b",display:"block",marginBottom:5}}>{"Nome"}</label>
                <input value={form.nome} onChange={function(e){update("nome",e.target.value);}} placeholder="Seu nome" style={inputStyle} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:"#64748b",display:"block",marginBottom:5}}>{"Assunto"}</label>
                <input value={form.assunto} onChange={function(e){update("assunto",e.target.value);}} placeholder="Ex: Sugestão de funcionalidade, Bug encontrado..." style={inputStyle} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:"#64748b",display:"block",marginBottom:5}}>{"Mensagem"}</label>
                <textarea value={form.mensagem} onChange={function(e){update("mensagem",e.target.value);}} placeholder="Descreva sua sugestão, problema ou comentário em detalhes..." rows={4} style={Object.assign({},inputStyle,{resize:"vertical",lineHeight:1.6})} onFocus={function(e){e.target.style.borderColor="#4361EE";}} onBlur={function(e){e.target.style.borderColor="#e2e8f0";}}/>
              </div>
              {err && <div style={{fontSize:11,color:"#ef4444",background:"#fff1f2",border:"1px solid #fecdd3",borderRadius:8,padding:"7px 12px"}}>{err}</div>}
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button onClick={handleSend} disabled={sending} style={{flex:1,background:sending?"#94a3b8":"linear-gradient(135deg,#4361EE,#3451d1)",color:"#fff",border:"none",borderRadius:10,padding:"11px 0",fontSize:12,fontWeight:700,cursor:sending?"not-allowed":"pointer",fontFamily:"inherit",boxShadow:sending?"none":"0 4px 12px rgba(67,97,238,.3)",transition:"all .2s"}}>
                  {sending?"Enviando...":"Enviar Feedback"}
                </button>
                <button onClick={function(){setOpen(false);}} style={{background:"#f8fafc",border:"1.5px solid #e2e8f0",color:"#64748b",borderRadius:10,padding:"11px 20px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{"Cancelar"}</button>
              </div>
              <div style={{fontSize:10,color:"#cbd5e1",textAlign:"center"}}>{"Sua mensagem sera enviada diretamente para a equipe + Pipe."}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default function App() {
  var _st_nav = useState("home"); var nav = _st_nav[0]; var setNav = _st_nav[1];
  var _st_accounts = useState([]); var accounts = _st_accounts[0]; var setAccounts = _st_accounts[1];
  var _st_loading = useState(true); var loading = _st_loading[0]; var setLoading = _st_loading[1];
  var _st_openAcc = useState(null); var openAcc = _st_openAcc[0]; var setOpenAcc = _st_openAcc[1];
  var _st_toast = useState(null); var toast = _st_toast[0]; var setToast = _st_toast[1];
  var _st_sidebarOpen = useState(false); var sidebarOpen = _st_sidebarOpen[0]; var setSidebarOpen = _st_sidebarOpen[1];
  var _st_sidebarExpanded = useState(true); var sidebarExpanded = _st_sidebarExpanded[0]; var setSidebarExpanded = _st_sidebarExpanded[1];
  var _st_seqCount = useState(0); var seqCount = _st_seqCount[0]; var setSeqCount = _st_seqCount[1];
  var _st_openSeq = useState(null); var openSeq = _st_openSeq[0]; var setOpenSeq = _st_openSeq[1];
  var _st_usage = useState(null); var usage = _st_usage[0]; var setUsage = _st_usage[1];
  var _st_mappingId = useState(null); var mappingId = _st_mappingId[0]; var setMappingId = _st_mappingId[1];
  function refreshUsage() { getUsage().then(setUsage); }
  function changePlan(planId) {
    var isDifferent = !usage || usage.plan !== planId;
    setPlan(planId, isDifferent).then(function(){ refreshUsage(); });
  }
  // Verifica e consome 1 credito para uma busca manual. Retorna Promise<bool>.
  function requestMapCredit() {
    return new Promise(function(resolve) {
      consumeMapping().then(function(res) {
        setUsage(res.usage);
        if (!res.ok) {
          if (res.reason === "limit") {
            showToast("Limite do plano atingido (" + res.usage.used + "/" + res.usage.limit + "). Faça upgrade para mapear mais.", "#ef4444");
          } else {
            showToast("Nao foi possivel registrar o uso.", "#ef4444");
          }
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }
  function showToast(msg, color) {
    setToast({msg:msg,color:color||"#3451d1"});
    setTimeout(function(){setToast(null);}, 3000);
  }
  useEffect(function() {
    refreshUsage();
    Promise.all([
      storageList("acc:"),
      storageList("seq:")
    ]).then(function(results) {
      var accKeys = results[0]; var seqKeys = results[1];
      setSeqCount(seqKeys.length);
      if (!accKeys.length) { setLoading(false); return; }
      return Promise.all(accKeys.map(storageGet)).then(function(items) {
        var valid = items.filter(Boolean).map(function(a){ if(a.mapped===undefined) a.mapped = !!a.data; return a; }).sort(function(a,b){return (b.savedAt||0)-(a.savedAt||0);});
        setAccounts(valid); setLoading(false);
      });
    }).catch(function(){setLoading(false);});
  }, []);
  function saveAccount(nome, data, liveMode, attachData, attachFileName) {
    var id = "acc:" + Date.now() + "-" + Math.random().toString(36).slice(2,7);
    var acc = { id:id, nome:nome, setor:(data.empresa&&data.empresa.setor)||"Empresa", fit:(data.fit&&data.fit.score)||"ALTO", tier:(data.estrategia&&data.estrategia.tier)||"Tier 2", status:"prospecting", mapped:true, liveMode:liveMode||false, savedAt:Date.now(), data:data, attachData:attachData||null, attachFileName:attachFileName||"" };
    storageSet(id, acc).then(function() {
      setAccounts(function(prev){return [acc].concat(prev);});
    });
    var enriched = (data.enriched && data.enriched.contacts && Array.isArray(data.enriched.contacts)) ? data.enriched.contacts : [];
    enriched.forEach(function(s) {
      var nomeReal = s.nome || s.name || "";
      if (!nomeReal) return;
      var cid = "contact:" + Date.now() + "-" + Math.random().toString(36).slice(2,7);
      var contact = { id:cid, nome:nomeReal, cargo:s.cargo||s.title||"", empresa:nome, email:s.email||"", emailValidated:false, linkedin:s.linkedin||"", savedAt:Date.now() };
      storageSet(cid, contact);
    });
  }
  // Importa contas da lista CSV como "unmapped" (sem custo, sem IA)
  function importAccounts(rows) {
    var existingNames = {};
    accounts.forEach(function(a){ existingNames[(a.nome||"").toLowerCase().trim()] = true; });
    var created = [];
    rows.forEach(function(row) {
      var key = (row.nome||"").toLowerCase().trim();
      if (!key || existingNames[key]) return;
      existingNames[key] = true;
      var id = "acc:" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
      var acc = {
        id:id, nome:row.nome, setor:"Aguardando mapeamento",
        fit:"-", tier:"-", status:"prospecting",
        mapped:false, site:row.site||"", linkedin:row.linkedin||"",
        liveMode:false, savedAt:Date.now(), data:null
      };
      created.push(acc);
      storageSet(id, acc);
    });
    if (created.length) {
      setAccounts(function(prev){ return created.concat(prev); });
      showToast(created.length + " conta" + (created.length!==1?"s":"") + " importada" + (created.length!==1?"s":"") + " (aguardando mapeamento).", "#10b981");
    } else {
      showToast("Nenhuma conta nova (todas ja existem na lista).", "#f59e0b");
    }
    return created.length;
  }

  // Mapeia uma conta sob demanda -> consome 1 credito do plano
  function mapAccount(acc) {
    return new Promise(function(resolve) {
      consumeMapping().then(function(res) {
        if (!res.ok) {
          if (res.reason === "limit") {
            showToast("Limite do plano atingido (" + res.usage.used + "/" + res.usage.limit + "). Faça upgrade para mapear mais.", "#ef4444");
          } else {
            showToast("Nao foi possivel registrar o uso.", "#ef4444");
          }
          setUsage(res.usage);
          resolve(false);
          return;
        }
        setUsage(res.usage);
        setMappingId(acc.id);
        var nome = acc.nome;
        var domain = acc.site ? extractDomain(acc.site) : extractDomain(nome);
        fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company:nome,context:""})})
          .then(function(r){ if(!r.ok) throw new Error("http"); return r.json(); })
          .then(function(resp){
            finishMapping(acc, buildData(nome, resp.results), true, domain);
            resolve(true);
          })
          .catch(function(){
            finishMapping(acc, buildData(nome, null), false, domain);
            resolve(true);
          });
      });
    });
  }

  function finishMapping(acc, data, liveMode, domain) {
    var updated = Object.assign({}, acc, {
      mapped:true, liveMode:liveMode, data:data,
      setor:(data.empresa&&data.empresa.setor)||"Empresa",
      fit:(data.fit&&data.fit.score)||"ALTO",
      tier:(data.estrategia&&data.estrategia.tier)||"Tier 2",
      mappedAt:Date.now()
    });
    storageSet(acc.id, updated);
    setAccounts(function(prev){ return prev.map(function(a){ return a.id===acc.id ? updated : a; }); });
    setMappingId(null);
    showToast("Conta mapeada: " + acc.nome, "#10b981");
  }

  function updateStatus(id, status) {
    setAccounts(function(prev) {
      return prev.map(function(a) {
        if (a.id!==id) return a;
        var updated = Object.assign({},a,{status:status});
        storageSet(id, updated);
        if (openAcc&&openAcc.id===id) setOpenAcc(updated);
        return updated;
      });
    });
    showToast("Status: " + STATUS_CONFIG[status].label);
  }
  function deleteAccount(id) {
    if (!window.confirm("Remover esta conta?")) return;
    storageDel(id).then(function() {
      setAccounts(function(prev){return prev.filter(function(a){return a.id!==id;});});
      showToast("Conta removida.", "#ef4444");
    });
  }
  var css = [
    "*{box-sizing:border-box;margin:0;padding:0}",
    "body{font-family:Inter,system-ui,Verdana,sans-serif;background:linear-gradient(135deg,#f0fdf8 0%,#f8fafc 50%,#f0f4ff 100%);min-height:100vh}",
    "@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",
    "@keyframes toastIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}",
    "::-webkit-scrollbar{width:5px;height:5px}",
    "::-webkit-scrollbar-track{background:#f1f5f9}",
    "::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}",
    "@media(max-width:768px){html,body{overflow-x:hidden!important;max-width:100vw!important}.main-content{padding:16px 12px!important;width:100%!important;box-sizing:border-box!important;min-width:0!important}.g2{grid-template-columns:1fr!important}.modal-grid{grid-template-columns:1fr!important}.kpi-grid{grid-template-columns:1fr 1fr!important}.chart-grid{grid-template-columns:1fr!important}.card-grid{grid-template-columns:1fr!important}.modal-box{max-width:calc(100vw - 16px)!important;border-radius:16px!important;width:100%!important}.modal-tabs{overflow-x:auto!important}.modal-tabs button{font-size:10px!important;padding:8px 10px!important}.status-chips{overflow-x:auto!important}}",
    "@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}",
    "@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}50%{box-shadow:0 0 0 6px rgba(67,97,238,.1)}}",
    "@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}",
    ".sidebar{transition:width .3s cubic-bezier(.22,1,.36,1)}",
    ".sidebar-label{transition:opacity .3s cubic-bezier(.4,0,.2,1),transform .3s cubic-bezier(.4,0,.2,1);white-space:nowrap;overflow:hidden}",
    ".sidebar-label.hidden{opacity:0;transform:translateX(-6px);pointer-events:none;width:0}",
    ".sidebar-label.visible{opacity:1;transform:translateX(0)}",
    ".toggle-btn{transition:all .25s cubic-bezier(.22,1,.36,1)}",
    ".toggle-btn:hover{background:rgba(67,97,238,.1) !important}",
    ".card-hover{transition:all .25s cubic-bezier(.22,1,.36,1)}",
    ".card-hover:hover{transform:translateY(-4px);box-shadow:0 20px 60px rgba(15,23,42,.12)}",
    ".glass{background:rgba(255,255,255,.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}",
    ".gradient-border{position:relative;background:#fff;border-radius:18px}",
    ".gradient-border::before{content:'';position:absolute;inset:-1.5px;border-radius:19px;background:linear-gradient(135deg,#10b981,#0ea5e9,#8b5cf6);z-index:-1;opacity:.4}",
    ".badge-glow{animation:glow 2.5s ease-in-out infinite}",
  ].join("");
  var NAV = [
    {id:"home",         emoji:"🏠", label:"Home"},
    {id:"search",       emoji:"🔍", label:"Busca"},
    {id:"accounts",     emoji:"📁", label:"Contas"},
    {id:"contacts",     emoji:"👥", label:"Contatos"},
    {id:"sequences",    emoji:"📬", label:"Sequências"},
    {id:"biblioteca",   emoji:"📚", label:"Biblioteca"},
    {id:"pipeline",     emoji:"📊", label:"Pipeline"},
    {id:"relatorios",   emoji:"📈", label:"Relatórios"},
    {id:"integracoes",  emoji:"🔌", label:"Integrações"},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"#f8fafc",overflowX:"clip",maxWidth:"100vw"}}>
      <BetaBanner/>
    <div style={{display:"flex",flex:1,overflowX:"clip",minWidth:0,width:"100%"}}>
      <style>{css}</style>
      <div className="sidebar" style={{width:sidebarExpanded?224:64,background:"#0A0A0F",borderRight:"1px solid #1a1a2e",display:"flex",flexDirection:"column",flexShrink:0,boxShadow:"4px 0 24px rgba(0,0,0,.4)",position:"relative",overflow:"hidden",transition:"width .35s cubic-bezier(.4,0,.2,1)"}}>
        <div style={{height:3,background:"linear-gradient(90deg,#4361EE,#7B5EA7,#A78BFA)",flexShrink:0}}/>
        {sidebarExpanded ? (
          <div style={{padding:"14px 14px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:9,overflow:"hidden",flex:1,minWidth:0}}>
                            <img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCACYAKEDASIAAhEBAxEB/8QAHAABAAICAwEAAAAAAAAAAAAAAAEHBggCBAUD/8QAQxAAAQIEAgYECwUGBwAAAAAAAAECAwQFEQYhBxIxQWGRE1FxsiY1UlNkc4GTlLPRFBUiVXQWIzM2YsElMkJjg4Tw/8QAGwEBAAIDAQEAAAAAAAAAAAAAAAQFAgYHAQP/xAAzEQACAQICBQkJAQEAAAAAAAAAAQIDBAURBhIhcdETMTM0QVKRobEVFiI1UVNhcsEUgf/aAAwDAQACEQMRAD8A0yAAAAAAAAAAAABKJdcj2aXhWv1KAkeSpc1FhrsejLNXsVbX9h9qNvVrvVpRcn+FmYynGCzk8jxQd+rUepUqJ0dQkpiWcuzpGKiL2LsX2HQMKlOdKTjNZP8AJ6pKSzQABgegAAAAAAAAAE3AAIAAAAAAAAABKbQDPtEOGYFWn41SnoSRJaUsjYbku18Rc0vwRM7b7oXQz8KIm5Cv9B+WHZ1fS0+W0sC9zsmi9rSo4dCUVtltf52s1nEJynWefYdOtU+Uq0jEkZ+EkWBESyou1q9adSp1mueIKdEpNZmqfEW7oEVzL9aJsX2pZTZZ6ZGv+k7+d6n61O40p9OLan/np1svizy/5k+BKwmb13HsyMaBKEHMy8AAAAAAAAAAAAAJIAAAAAAABJCAAuTQgvg/Op6Uny2lhohXmg9P8AnV9KTuNLERTtmjvyylufqzVr3p5HF+w1/0nfzvU/XJ3GmwD8kNftJy3xxU/XJ3WlNpx1GH7L0ZKwrpXu/qMaABywvwAAAAAAAAAAAAAAAATqr2e09yBAJ1V4cxqrw5jJggltr5ko3PO3MK1b5KnMZMFy6EEvhyd/Vp8tpn7MtpgOg1fB6ezS32tPltLAVM8jtejvy2lu/rNWvenkcYmZr/AKTUtjep+uTuNL/dkUDpOS+OKna38VN/9DSm036jD9l6MlYV0r3f1GMA5aq8OZGqvDmctyZfggnVXhzGqvDmMmCASqKm1CDwAkgAAAAAAltrpfYAZ3owwZCrrolQqSPSRhO1EY1bLFdvS+5E327OstiFQKLAhJCg0mRYxNiJAav9jytFPR/sHTuj23io/r1tdbmULkp2XR/C7a3soSUU3JJt79prF5cTnVkm9iZ0EpFLalvuuS+Hb9CUo1JXbS5L4dv0O+uYvYvOQpd1eBF15fU85aRS2rlS5L4dv0OTaRSnJnTJK/qG/Q7yhMhyFLurwGvL6nwlpSXlWqyWl4UFqrdUhsRqKvXkfdFJVSLH0UVBZRRjmSqXQ6cWm06LFdFjU+UiRHZuc+C1VXtVUO4ihczyUIzXxLMJtHnOpFLVfFcj8O36D7mpabKXJfDt+h6KC6XMFQpd1eBlryPPSjUq+dLkfcN+hzSk0lE8VSPw7fod29jjrZh29LurwDlJ9pi2KME0WsS0RIcpBkptU/dx4LEbnu1kTJUKKqUnHkJ6NJzLFZGgvVj2ruVDaBbauZQ+lxYC45n+htsho+3laiX/ALGiaZ4bQhRjcwilLPJ5duxvx2FthdxNydN7VkYeADnJdgAAAAAGa6NcaLhyM+TnWvi0+M7Wcjc3QnbNZE38U4XQtiWxdhmYgtjNrki1HbokTUcnai5oa5HNIsREsj3InabNhmlN1Y0uRyUormz7PPmIFxh9OtLW5mbHuxRhq3j6m/EIcFxThz89p3v0Nc+li+cdzJSNE847mWfvxc/bXnxI6wmHeZsYzFGG99epqf8AOgdijDd8q9Tffoa6dM9P9buZxWLE8t3MLTm5+2vPiPZMO8zZqnVGRqMJ0WQm4E0xrtVzoL9ZEXqO3uMA0HLfDs85y3X7Uma+raZ9tN9wu7ld2sK8lk3xKivTVKo4LsCnnzGIKFKTL5abrEhAisWzmRIyNc1eKHoZWKB0nOezG9U1XOT98mxf6GkHSHFqmGUI1aaTzeW3c+B9rO2VxNxby2F0vxPhpNlfpq/9hDimKMN/n1O9+hrn00Ty3cx0sTzjuZqHvxc/bXnxLH2TDvM2MXFGG/z6m+/QJifDaJ4+pvv0NculiecdzJSLE8t3Me/Nz9tefEeyYd5l3Yo0i0WnysSHTorahNqlmJDv0bV61dv7EKUnpmPOTcWZmYixI0Vyve5dqqp8nOVy3VVVTia/i+N3OKSXK7EuZLmJ1taQt18POwT2kApiSTlxBAAAAAAJQgAAAAE2yIABc2hBfB2d/Vp8tpYLSvdB/iCd/VJ8tpYNrKds0d+W0tz9Wate9PIPyQ1+0mOVcbVS/nk7rTYB65FAaT1RccVO3nU7jSm046jD9l6MlYV0r3cDGQAcsL8AAAAAAAAAAAAAAAAAAAAAAAAufQcng7Or6Wny2lgXK+0Hu8HZ1PS0+W0sFM0O2aO/LaW5+rNWvenkcX2sa/6Tktjepp/up3GmwERFtka/aTFVcbVO/nU7rSm046jD9l6Ml4V0r3cDGwAcsL4AAAAAAAlCAAAAAAAAAAAAAASm0gAGcaK8UQKHUIsnPPVknNat3rshvTY5eCpkvsLwgq2LBZGhOSIx6Xa5i3RU4Khqwm253pKsVSSh9FJ1GclmeTBjuYnJFsbfgmlU8Po8hVjrRXN9UVl3h/LS14vJmw+I63T6BIPnKhFRiIn4ISf54jtzWp/6xrrWp+LU6rMz8b+JHiOiKm5LrsTs2ew+c3NzE3FWLMx4seIqWV8R6uVfap8CFjukFTFXGOWrBdn5+rPtZ2at03nm2CATwNdJpAAAAAAAAAJy4ggAAAAAAAAAAAAAAAAAAAAbgAAAAAAAAAACb8AAAf/Z" alt="+pipe" style={{width:36,height:36,borderRadius:10,objectFit:"contain",flexShrink:0}}/>
              <div style={{minWidth:0,overflow:"hidden"}}>
                <div style={{fontSize:14,fontWeight:800,letterSpacing:"-0.3px",lineHeight:1.2,whiteSpace:"nowrap"}}><span style={{color:"#4361EE"}}>+</span><span style={{color:"#ffffff"}}> pipe</span></div>
                <div style={{fontSize:7.5,color:"#6b7280",fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",whiteSpace:"nowrap"}}>PROSPECTING TOOL Beta</div>
              </div>
            </div>
            <button onClick={function(){setSidebarExpanded(false);}} title="Recolher menu" style={{width:26,height:26,borderRadius:7,border:"none",background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#6b7280",flexShrink:0,padding:0,transition:"all .2s"}} onMouseEnter={function(e){e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color="#fff";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#6b7280";}}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          </div>
        ) : (
          <div style={{padding:"14px 0 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:8,flexShrink:0}}>
                      <img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCACYAKEDASIAAhEBAxEB/8QAHAABAAICAwEAAAAAAAAAAAAAAAEHBggCBAUD/8QAQxAAAQIEAgYECwUGBwAAAAAAAAECAwQFEQYhBxIxQWGRE1FxsiY1UlNkc4GTlLPRFBUiVXQWIzM2YsElMkJjg4Tw/8QAGwEBAAIDAQEAAAAAAAAAAAAAAAQFAgYHAQP/xAAzEQACAQICBQkJAQEAAAAAAAAAAQIDBAURBhIhcdETMTM0QVKRobEVFiI1UVNhcsEUgf/aAAwDAQACEQMRAD8A0yAAAAAAAAAAAABKJdcj2aXhWv1KAkeSpc1FhrsejLNXsVbX9h9qNvVrvVpRcn+FmYynGCzk8jxQd+rUepUqJ0dQkpiWcuzpGKiL2LsX2HQMKlOdKTjNZP8AJ6pKSzQABgegAAAAAAAAAE3AAIAAAAAAAAABKbQDPtEOGYFWn41SnoSRJaUsjYbku18Rc0vwRM7b7oXQz8KIm5Cv9B+WHZ1fS0+W0sC9zsmi9rSo4dCUVtltf52s1nEJynWefYdOtU+Uq0jEkZ+EkWBESyou1q9adSp1mueIKdEpNZmqfEW7oEVzL9aJsX2pZTZZ6ZGv+k7+d6n61O40p9OLan/np1svizy/5k+BKwmb13HsyMaBKEHMy8AAAAAAAAAAAAAJIAAAAAAABJCAAuTQgvg/Op6Uny2lhohXmg9P8AnV9KTuNLERTtmjvyylufqzVr3p5HF+w1/0nfzvU/XJ3GmwD8kNftJy3xxU/XJ3WlNpx1GH7L0ZKwrpXu/qMaABywvwAAAAAAAAAAAAAAAATqr2e09yBAJ1V4cxqrw5jJggltr5ko3PO3MK1b5KnMZMFy6EEvhyd/Vp8tpn7MtpgOg1fB6ezS32tPltLAVM8jtejvy2lu/rNWvenkcYmZr/AKTUtjep+uTuNL/dkUDpOS+OKna38VN/9DSm036jD9l6MlYV0r3f1GMA5aq8OZGqvDmctyZfggnVXhzGqvDmMmCASqKm1CDwAkgAAAAAAltrpfYAZ3owwZCrrolQqSPSRhO1EY1bLFdvS+5E327OstiFQKLAhJCg0mRYxNiJAav9jytFPR/sHTuj23io/r1tdbmULkp2XR/C7a3soSUU3JJt79prF5cTnVkm9iZ0EpFLalvuuS+Hb9CUo1JXbS5L4dv0O+uYvYvOQpd1eBF15fU85aRS2rlS5L4dv0OTaRSnJnTJK/qG/Q7yhMhyFLurwGvL6nwlpSXlWqyWl4UFqrdUhsRqKvXkfdFJVSLH0UVBZRRjmSqXQ6cWm06LFdFjU+UiRHZuc+C1VXtVUO4ihczyUIzXxLMJtHnOpFLVfFcj8O36D7mpabKXJfDt+h6KC6XMFQpd1eBlryPPSjUq+dLkfcN+hzSk0lE8VSPw7fod29jjrZh29LurwDlJ9pi2KME0WsS0RIcpBkptU/dx4LEbnu1kTJUKKqUnHkJ6NJzLFZGgvVj2ruVDaBbauZQ+lxYC45n+htsho+3laiX/ALGiaZ4bQhRjcwilLPJ5duxvx2FthdxNydN7VkYeADnJdgAAAAAGa6NcaLhyM+TnWvi0+M7Wcjc3QnbNZE38U4XQtiWxdhmYgtjNrki1HbokTUcnai5oa5HNIsREsj3InabNhmlN1Y0uRyUormz7PPmIFxh9OtLW5mbHuxRhq3j6m/EIcFxThz89p3v0Nc+li+cdzJSNE847mWfvxc/bXnxI6wmHeZsYzFGG99epqf8AOgdijDd8q9Tffoa6dM9P9buZxWLE8t3MLTm5+2vPiPZMO8zZqnVGRqMJ0WQm4E0xrtVzoL9ZEXqO3uMA0HLfDs85y3X7Uma+raZ9tN9wu7ld2sK8lk3xKivTVKo4LsCnnzGIKFKTL5abrEhAisWzmRIyNc1eKHoZWKB0nOezG9U1XOT98mxf6GkHSHFqmGUI1aaTzeW3c+B9rO2VxNxby2F0vxPhpNlfpq/9hDimKMN/n1O9+hrn00Ty3cx0sTzjuZqHvxc/bXnxLH2TDvM2MXFGG/z6m+/QJifDaJ4+pvv0NculiecdzJSLE8t3Me/Nz9tefEeyYd5l3Yo0i0WnysSHTorahNqlmJDv0bV61dv7EKUnpmPOTcWZmYixI0Vyve5dqqp8nOVy3VVVTia/i+N3OKSXK7EuZLmJ1taQt18POwT2kApiSTlxBAAAAAAJQgAAAAE2yIABc2hBfB2d/Vp8tpYLSvdB/iCd/VJ8tpYNrKds0d+W0tz9Wate9PIPyQ1+0mOVcbVS/nk7rTYB65FAaT1RccVO3nU7jSm046jD9l6MlYV0r3cDGQAcsL8AAAAAAAAAAAAAAAAAAAAAAAAufQcng7Or6Wny2lgXK+0Hu8HZ1PS0+W0sFM0O2aO/LaW5+rNWvenkcX2sa/6Tktjepp/up3GmwERFtka/aTFVcbVO/nU7rSm046jD9l6Ml4V0r3cDGwAcsL4AAAAAAAlCAAAAAAAAAAAAAASm0gAGcaK8UQKHUIsnPPVknNat3rshvTY5eCpkvsLwgq2LBZGhOSIx6Xa5i3RU4Khqwm253pKsVSSh9FJ1GclmeTBjuYnJFsbfgmlU8Po8hVjrRXN9UVl3h/LS14vJmw+I63T6BIPnKhFRiIn4ISf54jtzWp/6xrrWp+LU6rMz8b+JHiOiKm5LrsTs2ew+c3NzE3FWLMx4seIqWV8R6uVfap8CFjukFTFXGOWrBdn5+rPtZ2at03nm2CATwNdJpAAAAAAAAAJy4ggAAAAAAAAAAAAAAAAAAAAbgAAAAAAAAAACb8AAAf/Z" alt="+pipe" style={{width:40,height:40,borderRadius:12,objectFit:"contain"}}/>
            <button onClick={function(){setSidebarExpanded(true);}} title="Expandir menu" style={{width:26,height:26,borderRadius:7,border:"none",background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#6b7280",padding:0}} onMouseEnter={function(e){e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color="#fff";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#6b7280";}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        )}
        <div style={{height:1,background:"#f1f5f9",margin:"0 10px 8px",flexShrink:0}}/>
        <nav style={{padding:"0 8px",flex:1,overflow:"hidden"}}>
          {NAV.map(function(item) {
            var active = nav===item.id;
            return (
              <button key={item.id} onClick={function(){setNav(item.id);}} title={sidebarExpanded?"":item.label} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:sidebarExpanded?"10px 12px":"8px 0",justifyContent:sidebarExpanded?"flex-start":"center",borderRadius:12,border:"none",background:active?"linear-gradient(135deg,#4361EE,#3451d1)":"transparent",color:active?"#fff":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:active?600:500,marginBottom:4,transition:"all .3s cubic-bezier(.4,0,.2,1)",textAlign:"left",boxShadow:active?"0 4px 14px rgba(67,97,238,.3)":"none",position:"relative",willChange:"background,color"}} onMouseEnter={function(e){if(!active){e.currentTarget.style.background="rgba(67,97,238,.12)";e.currentTarget.style.color="#ffffff";}}} onMouseLeave={function(e){if(!active){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#6b7280";}}}>
                <span style={{fontSize:sidebarExpanded?16:20,flexShrink:0,transition:"font-size .2s ease"}}>{item.emoji}</span>
                <span className={"sidebar-label " + (sidebarExpanded?"visible":"hidden")} style={{flex:1}}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
        {sidebarExpanded && (
          <div style={{padding:"10px 14px 18px",borderTop:"1px solid #f1f5f9",flexShrink:0}}>
            <div style={{fontSize:10,color:"#6b7280",lineHeight:1.6}}>
              {accounts.length+" conta"+(accounts.length!==1?"s":"")+" salva"+(accounts.length!==1?"s":"")}
            </div>
          </div>
        )}
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,minWidth:0,width:0}}>
        <div className="main-content" style={{flex:1,overflowY:"auto",padding:"24px 28px",boxSizing:"border-box",width:"100%",minWidth:0}}>
          {loading ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",gap:12}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#4361EE"}}/>
              <span style={{color:"#6b7280",fontSize:13}}>Carregando...</span>
            </div>
          ) : (
            <div key={nav} style={{animation:"fadeUp .4s cubic-bezier(.4,0,.2,1) both"}}>
              {nav==="home"      && <HomeView accounts={accounts} onNav={setNav}/>}
              {nav==="search"    && <SearchView accounts={accounts} onSave={saveAccount} onOpenAccount={function(acc){setOpenAcc(acc);}} onUpdateAccount={function(updated){setAccounts(function(prev){return prev.map(function(a){return a.id===updated.id?updated:a;});});}} usage={usage} onRequestCredit={requestMapCredit} onImport={importAccounts} onChangePlan={changePlan}/>}
              {nav==="accounts"  && <AccountsView accounts={accounts} onOpen={setOpenAcc} onStatusChange={updateStatus} onDelete={deleteAccount} usage={usage} onImport={importAccounts} onMap={mapAccount} mappingId={mappingId} onChangePlan={changePlan}/>}
              {nav==="sequences" && <SequenceView accounts={accounts} showToast={showToast}/>}
              {nav==="relatorios"&& <InsightsView accounts={accounts}/>}
              {nav==="biblioteca" && <BibliotecaView showToast={showToast} onCountChange={setSeqCount} onOpenSeq={setOpenSeq}/>}
              {nav==="contacts" && <ContactsView showToast={showToast}/>}
              {nav==="integracoes" && <IntegrationsView/>}
              {nav==="pipeline"  && (
                <div>
                  <div style={{fontSize:28,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:"-0.6px"}}>Pipeline</div>
                  <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>{"Arraste os cards entre colunas para avançar ou recuar o estágio da prospecção."}</div>
                  <PipelineView accounts={accounts} onOpen={setOpenAcc} onStatusChange={updateStatus}/>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {openAcc && <AccountModal acc={openAcc} onClose={function(){setOpenAcc(null);}} onStatusChange={updateStatus}/>}
      {openSeq && <SequenceModal seq={openSeq} onClose={function(){setOpenSeq(null);}}/>}
      {toast && (
        <div style={{position:"fixed",bottom:28,right:28,background:toast.color,color:"#fff",borderRadius:14,padding:"14px 22px",fontSize:13,fontWeight:600,boxShadow:"0 12px 40px rgba(15,23,42,.2),0 0 0 1px rgba(255,255,255,.15)",animation:"toastIn .35s cubic-bezier(.22,1,.36,1)",zIndex:300,maxWidth:340,display:"flex",alignItems:"center",gap:10}}>
          {toast.msg}
        </div>
      )}
    </div>
    </div>
  );
}
