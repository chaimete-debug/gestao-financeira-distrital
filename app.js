/* ══════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════ */

function showMessage(text, ok, elementId='msg'){
  const el=document.getElementById(elementId); if(!el) return;
  el.className='msg '+(ok?'ok':'err'); el.textContent=text||'';
  if(ok) setTimeout(()=>{ if(el.textContent===text) el.innerHTML=''; },5000);
}

/* Modal de confirmação — sem mostrar nome do servidor */
function confirmar(texto, onSim){
  const over=document.createElement('div');
  over.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
  over.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
    <p style="font-size:15px;color:#2c3e50;margin:0 0 22px;line-height:1.5;">${texto}</p>
    <div style="display:flex;gap:12px;justify-content:center;">
      <button id="_cfNo" style="padding:10px 24px;border-radius:10px;border:2px solid #dee2e6;background:#fff;font-weight:600;cursor:pointer;font-size:14px;">Cancelar</button>
      <button id="_cfSim" style="padding:10px 24px;border-radius:10px;border:0;background:linear-gradient(135deg,#123b7a,#1e4d8f);color:#fff;font-weight:700;cursor:pointer;font-size:14px;">Confirmar</button>
    </div>
  </div>`;
  document.body.appendChild(over);
  over.querySelector('#_cfNo').onclick=()=>over.remove();
  over.querySelector('#_cfSim').onclick=()=>{ over.remove(); onSim(); };
}

/* Mensagem de erro sem alert() nativo */
function mostrarErro(texto){
  const over=document.createElement('div');
  over.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
  over.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
    <p style="font-size:15px;color:#721c24;margin:0 0 22px;line-height:1.5;">❌ ${texto}</p>
    <button style="padding:10px 28px;border-radius:10px;border:0;background:linear-gradient(135deg,#dc3545,#c82333);color:#fff;font-weight:700;cursor:pointer;font-size:14px;" onclick="this.closest('div').parentElement.remove()">Fechar</button>
  </div>`;
  document.body.appendChild(over);
}
function setLoading(state,btnId='btnLogin'){
  const btn=document.getElementById(btnId); if(!btn) return;
  btn.disabled=state;
  if(btnId==='btnLogin') btn.textContent=state?'⏳ A processar...':'Iniciar sessão';
}
function formatMoney(v){ return Number(v||0).toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2})+' MZN'; }
function safeText(v){ return v==null||v===''?'-':String(v); }
function getToken(){ return sessionStorage.getItem('app_token')||''; }
function getUser(){ try{ return JSON.parse(sessionStorage.getItem('app_user')||'{}'); }catch(e){ return {}; } }

function statusBadge(s){
  const m={'APROVADO':['badge-success','✅ Aprovado'],'SUBMETIDO':['badge-warning','📤 Submetido'],
           'RASCUNHO':['badge-info','📝 Rascunho'],'REJEITADO':['badge-danger','❌ Rejeitado']};
  const [cls,lbl]=m[String(s||'').toUpperCase()]||['badge-info',safeText(s)];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

/* ══════════════════════════════════════════════════════
   API  — com cache e deduplicação de pedidos
══════════════════════════════════════════════════════ */

/* Cache geral: fnName+args → resultado, expira após TTL */
const _cache = {};
const _TTL   = { default: 30000, list: 60000, opts: 120000 }; // ms

/* Pedidos em curso: evita chamadas duplicadas simultâneas */
const _pending = {};

async function apiCall(action,args=[]){
  const r=await fetch(APP_CONFIG.API_URL,{method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action,args})});
  if(!r.ok) throw new Error('Falha de comunicação com o servidor.');
  return await r.json();
}

async function serverCall(fnName,args,onSuccess,onFailure){
  const key = fnName + '|' + JSON.stringify(args||[]);

  // Funções que NÃO devem ser cacheadas (escrita/mutação)
  const noCache = ['Lancamento_create','Lancamento_createAndSubmit','Lancamento_submit','Approval_decide','Approval_listPending','Approval_repararPendencias',
    'User_create','User_toggleActive','Igreja_create','Igreja_toggleActive',
    'Departamento_create','Departamento_toggleActive','Auth_logout',
    'SaldoInicial_saveBulk','SaldoInicial_delete'];

  const useCache = !noCache.includes(fnName);
  const ttl = fnName.includes('getFormOptions')||fnName.includes('Opts') ? _TTL.opts
             : fnName.includes('list')||fnName.includes('List')||fnName.includes('listar') ? _TTL.list
             : _TTL.default;

  // Servir do cache se válido
  if(useCache && _cache[key] && Date.now() - _cache[key].ts < ttl){
    if(onSuccess) onSuccess(_cache[key].data);
    return;
  }

  // Se já há pedido igual em curso, encadear callback
  if(useCache && _pending[key]){
    _pending[key].push({onSuccess,onFailure});
    return;
  }

  if(useCache) _pending[key] = [{onSuccess,onFailure}];

  try{
    const res=await apiCall('Server_call',[getToken(),fnName,args||[]]);

    // Sessão expirada — logout automático e limpo, sem spinner
    if(res && res.expired===true){
      sessionStorage.clear(); invalidarCache();
      document.getElementById('appView')?.classList.add('hidden');
      document.getElementById('authView')?.classList.remove('hidden');
      document.getElementById('username').value='';
      document.getElementById('password').value='';
      showMessage('⏳ A sessão expirou. Faça login novamente.',false);
      if(useCache){ const cbs=_pending[key]||[]; delete _pending[key]; cbs.forEach(cb=>{ try{ if(cb.onFailure) cb.onFailure(new Error('Sessão expirada')); }catch(e){} }); }
      return;
    }

    if(res&&res.success===false) throw new Error(res.message||'Erro no servidor.');

    if(useCache){
      _cache[key] = {data:res, ts:Date.now()};
      const cbs = _pending[key]||[];
      delete _pending[key];
      cbs.forEach(cb=>{ try{ if(cb.onSuccess) cb.onSuccess(res); }catch(e){} });
    } else {
      // Invalidar cache de listas relacionadas após mutação
      Object.keys(_cache).forEach(k=>{
        if(k.includes('listAll')||k.includes('listPending')||k.includes('getSummary')||
           k.includes('resumo')||k.includes('getFormOptions')) delete _cache[k];
      });
      if(onSuccess) onSuccess(res);
    }
  }catch(err){
    if(useCache){
      const cbs = _pending[key]||[];
      delete _pending[key];
      cbs.forEach(cb=>{ try{ if(cb.onFailure) cb.onFailure(err); }catch(e){} });
    } else {
      if(onFailure) onFailure(err);
    }
  }
}

/* ── Cache de opções do formulário ── */
let _opts=null;

function getOpts(cb){
  if(_opts){ cb(_opts); return; }
  serverCall('Lancamento_getFormOptions',[],function(res){ _opts=res; cb(res); },function(){ cb(null); });
}

function invalidarCache(){
  Object.keys(_cache).forEach(k=>delete _cache[k]);
  _opts=null;
}

/* helpers para resolver nomes a partir do cache */
function nomeDepto(id){
  if(!_opts||!id) return safeText(id);
  const d=(_opts.departamentos||[]).find(x=>String(x.id_departamento)===String(id));
  return d?safeText(d.nome_departamento):safeText(id);
}
function nomeRubrica(id){
  if(!_opts||!id) return safeText(id);
  const r=(_opts.rubricas||[]).find(x=>String(x.id_rubrica)===String(id));
  return r?safeText(r.nome_rubrica):safeText(id);
}
function nomeGrupo(id){
  if(!_opts||!id) return safeText(id);
  const g=(_opts.grupos||[]).find(x=>String(x.id_grupo)===String(id));
  return g?safeText(g.nome_grupo):safeText(id);
}
function nomeIgreja(id){
  if(!_opts||!id) return safeText(id);
  const i=(_opts.igrejas||[]).find(x=>String(x.id_igreja)===String(id));
  return i?safeText(i.nome_igreja):safeText(id);
}
function nomeConta(id){
  if(!_opts||!id) return safeText(id);
  const c=(_opts.contas||[]).find(x=>String(x.id_conta)===String(id));
  return c?safeText(c.nome_conta):safeText(id);
}

/* ══════════════════════════════════════════════════════
   SHELL
══════════════════════════════════════════════════════ */

function setMainIdentity(user){
  document.getElementById('welcomeText').textContent='👋 Sessão iniciada por '+safeText(user.nome_completo)+'.';
  document.getElementById('kpiUser').textContent   =safeText(user.nome_completo);
  document.getElementById('kpiPerfil').textContent =safeText(user.id_perfil);
  document.getElementById('kpiIgreja').textContent =safeText(user.nome_igreja||user.id_igreja||'-');
}
function setActiveMenu(lbl){ document.querySelectorAll('#menuList li').forEach(li=>li.classList.toggle('active',li.textContent===lbl)); }
function toggleMenu(){
  const btn=document.getElementById('menuToggle'),list=document.getElementById('menuList');
  if(!btn||!list) return; const o=list.classList.toggle('open'); btn.classList.toggle('open',o);
}
function closeMenuOnMobile(){
  if(window.innerWidth<=680){ document.getElementById('menuList')?.classList.remove('open'); document.getElementById('menuToggle')?.classList.remove('open'); }
}
function renderMenu(menu){
  const ul=document.getElementById('menuList'); ul.innerHTML='';
  const src=Array.isArray(menu)&&menu.length?menu:[
    {label:'📊 Dashboard'},{label:'📝 Lançamentos'},{label:'✓ Aprovações'},
    {label:'📈 Orçamentos'},{label:'📄 Relatórios'},{label:'⚙️ Administração'}];
  src.forEach(function(item){
    const lbl=typeof item==='string'?item:(item.label||item.nome||item.modulo||'Sem nome');
    const li=document.createElement('li'); li.textContent=lbl;
    li.addEventListener('click',function(){
      closeMenuOnMobile();
      const k=String(lbl).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
      if(k.includes('dashboard'))     openDashboard();
      else if(k.includes('lancament')) openLancamentos();
      else if(k.includes('aprovac'))   openApprovals();
      else if(k.includes('orcament'))  openOrcamentos();
      else if(k.includes('relator'))   openRelatorios();
      else if(k.includes('administrac')) openAdministracao();
    });
    ul.appendChild(li);
  });
}
function renderApp(user,menu){
  document.getElementById('authView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  setMainIdentity(user||{}); renderMenu(menu||[]); _opts=null;
  // pré-carregar opções em background
  getOpts(function(){});
  openDashboard();
}

/* ══════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════ */

async function login(){
  const username=document.getElementById('username').value.trim();
  const password=document.getElementById('password').value;
  document.getElementById('username').value=username;
  if(!username||!password){ showMessage('❌ Preencha username e palavra-passe.',false); return; }
  setLoading(true); showMessage('⏳ A autenticar...',true);
  try{
    const res=await apiCall('Auth_login',[username,password]);
    setLoading(false);
    if(!res||!res.success){ showMessage('❌ '+(res?.message||'Credenciais inválidas.'),false); document.getElementById('password').value=''; return; }
    sessionStorage.setItem('app_token',res.token||'');
    sessionStorage.setItem('app_user',JSON.stringify(res.user||{}));
    sessionStorage.setItem('app_menu',JSON.stringify(res.menu||[]));
    showMessage('✅ Login efectuado!',true);
    setTimeout(()=>renderApp(res.user||{},res.menu||[]),500);
  }catch(err){ setLoading(false); showMessage('❌ Erro: '+(err.message||'Tente novamente.'),false); document.getElementById('password').value=''; }
}
async function logout(){
  try{
    await apiCall('Auth_logout',[getToken()]); sessionStorage.clear(); invalidarCache();
    document.getElementById('appView').classList.add('hidden');
    document.getElementById('authView').classList.remove('hidden');
    document.getElementById('username').value=''; document.getElementById('password').value='';
    showMessage('',true);
  }catch(err){ mostrarErro('❌ '+(err.message||'Falha ao terminar sessão')); }
}

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */

function openDashboard(){
  setActiveMenu('📊 Dashboard');
  document.getElementById('contentTitle').textContent='📊 Dashboard Financeiro';
  const agora=new Date(),anoActual=agora.getFullYear(),mesActual=agora.getMonth()+1;
  const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let anosH=''; for(let a=anoActual+1;a>=anoActual-3;a--) anosH+=`<option value="${a}"${a===anoActual?' selected':''}>${a}</option>`;
  const mesesH=meses.map((m,i)=>`<option value="${i+1}"${i+1===mesActual?' selected':''}>${m}</option>`).join('');

  document.getElementById('contentArea').innerHTML=`
    <div class="grid" style="margin-top:0;">
      <div class="card"><div class="card-title">📈 Entradas Aprovadas</div><div id="dashEntradas" class="card-value">0,00 MZN</div></div>
      <div class="card"><div class="card-title">📉 Saídas Aprovadas</div><div id="dashSaidas" class="card-value">0,00 MZN</div></div>
      <div class="card"><div class="card-title">💰 Saldo Aprovado</div><div id="dashSaldo" class="card-value">0,00 MZN</div></div>
      <div class="card"><div class="card-title">📤 Entradas Submetidas</div><div id="dashEntradasSubmetidas" class="card-value">0,00 MZN</div></div>
      <div class="card"><div class="card-title">📥 Saídas Submetidas</div><div id="dashSaidasSubmetidas" class="card-value">0,00 MZN</div></div>
      <div class="card"><div class="card-title">🧮 Saldo Projectado</div><div id="dashSaldoProjectado" class="card-value">0,00 MZN</div></div>
      <div class="card"><div class="card-title">⏳ Submetidos</div><div id="dashPendentes" class="card-value">0</div></div>
      <div class="card"><div class="card-title">📝 Rascunhos</div><div id="dashRascunhos" class="card-value">0</div></div>
      <div class="card"><div class="card-title">❌ Rejeitados</div><div id="dashRejeitados" class="card-value">0</div></div>
    </div>
    <div class="box" style="margin-top:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:15px;">
        <strong>📊 Resumo por Departamento</strong>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%;">
          <select id="dash_mes" style="flex:1;min-width:110px;padding:10px 12px;">${mesesH}</select>
          <select id="dash_ano" style="flex:1;min-width:80px;padding:10px 12px;">${anosH}</select>
          <button class="info" style="width:auto;margin-top:0;padding:10px 18px;" onclick="loadDashDeptos()">Actualizar</button>
        </div>
      </div>
      <div id="dashDeptosWrap" class="muted">A carregar...</div>
    </div>`;

  serverCall('Dashboard_getSummary',[{}],function(s){
    const saldoAprovado = Number(s?.saldo_aprovado ?? s?.saldo ?? 0);
    const entradasSubmetidas = Number(s?.entradas_submetidas ?? s?.receitas_submetidas ?? 0);
    const saidasSubmetidas = Number(s?.saidas_submetidas ?? s?.despesas_submetidas ?? 0);
    const saldoProjectado = Number(s?.saldo_projectado ?? (saldoAprovado + entradasSubmetidas - saidasSubmetidas));

    document.getElementById('dashEntradas').textContent  =formatMoney(s?.entradas_aprovadas ?? s?.receitas_aprovadas);
    document.getElementById('dashSaidas').textContent  =formatMoney(s?.saidas_aprovadas ?? s?.despesas_aprovadas);
    document.getElementById('dashSaldo').textContent     =formatMoney(saldoAprovado);
    document.getElementById('dashEntradasSubmetidas').textContent =formatMoney(entradasSubmetidas);
    document.getElementById('dashSaidasSubmetidas').textContent   =formatMoney(saidasSubmetidas);
    document.getElementById('dashSaldoProjectado').textContent    =formatMoney(saldoProjectado);
    document.getElementById('dashPendentes').textContent =String(s?.pendentes??0);
    document.getElementById('dashRascunhos').textContent =String(s?.rascunhos??0);
    document.getElementById('dashRejeitados').textContent=String(s?.rejeitados??0);
    document.getElementById('kpiSaldo').textContent=formatMoney(saldoProjectado);
    const igNome=s?.igreja_nome||'';
    if(igNome) document.getElementById('kpiIgreja').textContent=igNome;
  },function(err){
    const w=document.getElementById('dashDeptosWrap');
    if(w) w.innerHTML=`<div class="err">❌ ${err?.message||'Erro'}</div>`;
  });
  loadDashDeptos();
}

function loadDashDeptos(){
  const wrap=document.getElementById('dashDeptosWrap'); if(!wrap) return;
  wrap.innerHTML='⏳ A carregar...';
  const mes=Number(document.getElementById('dash_mes')?.value||new Date().getMonth()+1);
  const ano=Number(document.getElementById('dash_ano')?.value||new Date().getFullYear());
  const nomeMes=['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  serverCall('Dashboard_resumoDeptos',[{ano,mes}],function(res){
    const linhas=Array.isArray(res?.linhas)?res.linhas:[];
    const periodo=`${nomeMes[res?.mes]||mes} ${res?.ano||ano}`;
    const igNome=res?.igreja_nome?` — ${res.igreja_nome}`:'';
    if(!linhas.length){ wrap.innerHTML=`<div class="info">ℹ️ Sem lançamentos aprovados em ${periodo}${igNome}.</div>`; return; }
    wrap.innerHTML=tabelaDeptos(linhas,res)+`<div class="muted" style="margin-top:6px;font-size:12px;">📅 ${periodo}${igNome}</div>`;
  },function(err){ wrap.innerHTML=`<div class="err">❌ ${err?.message||'Falha'}</div>`; });
}

function tabelaDeptos(linhas,res){
  return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table>
    <thead><tr><th>Departamento</th><th style="text-align:right;">Entradas</th><th style="text-align:right;">Saídas</th><th style="text-align:right;">Saldo</th></tr></thead>
    <tbody>${linhas.map(l=>`<tr>
      <td><strong>${safeText(l.nome_departamento)}</strong></td>
      <td style="text-align:right;color:#28a745;">${formatMoney(l.entrada)}</td>
      <td style="text-align:right;color:#dc3545;">${formatMoney(l.saida)}</td>
      <td style="text-align:right;font-weight:700;color:${Number(l.saldo||0)>=0?'#28a745':'#dc3545'};">${formatMoney(l.saldo)}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr style="border-top:2px solid #dee2e6;font-weight:700;background:#f8f9fa;">
      <td>TOTAL</td>
      <td style="text-align:right;color:#28a745;">${formatMoney(res.totalEntrada)}</td>
      <td style="text-align:right;color:#dc3545;">${formatMoney(res.totalSaida)}</td>
      <td style="text-align:right;color:${Number(res.totalSaldo||0)>=0?'#28a745':'#dc3545'};">${formatMoney(res.totalSaldo)}</td>
    </tr></tfoot></table></div>`;
}

/* ══════════════════════════════════════════════════════
   LANÇAMENTOS
══════════════════════════════════════════════════════ */

function openLancamentos(){
  setActiveMenu('📝 Lançamentos');
  document.getElementById('contentTitle').textContent='📝 Gestão de Lançamentos';
  const agora=new Date();
  const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let anosH=''; for(let a=agora.getFullYear()+1;a>=agora.getFullYear()-3;a--) anosH+=`<option value="${a}"${a===agora.getFullYear()?' selected':''}>${a}</option>`;
  const mesesH=meses.map((m,i)=>`<option value="${i+1}"${i+1===agora.getMonth()+1?' selected':''}>${m}</option>`).join('');

  document.getElementById('contentArea').innerHTML=`
    <div class="box" style="margin-top:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <strong>📋 Lista de Lançamentos</strong>
        <button class="success" style="width:auto;margin-top:0;padding:9px 18px;" onclick="mostrarFormLancamento()">＋ Novo Lançamento</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <select id="lanc_mes" style="flex:1;min-width:110px;padding:9px 12px;">${mesesH}</select>
        <select id="lanc_ano" style="flex:1;min-width:80px;padding:9px 12px;">${anosH}</select>
        <select id="lanc_estado" style="flex:1;min-width:130px;padding:9px 12px;">
          <option value="">Todos os estados</option>
          <option value="RASCUNHO">📝 Rascunho</option>
          <option value="SUBMETIDO">📤 Submetido</option>
          <option value="APROVADO">✅ Aprovado</option>
          <option value="REJEITADO">❌ Rejeitado</option>
        </select>
        <button class="info" style="width:auto;margin-top:0;padding:9px 18px;" onclick="carregarLancamentos()">🔍 Filtrar</button>
      </div>
      <div id="lancTableWrap" class="muted">A carregar...</div>
    </div>`;

  // garantir cache antes de carregar lista
  getOpts(function(){ carregarLancamentos(); });
}

function carregarLancamentos(){
  const wrap=document.getElementById('lancTableWrap'); if(!wrap) return;
  wrap.innerHTML='⏳ A carregar...';
  const estado=document.getElementById('lanc_estado')?.value||'';
  const mes=Number(document.getElementById('lanc_mes')?.value||0);
  const ano=Number(document.getElementById('lanc_ano')?.value||0);
  // Construir filtros apenas com valores válidos (sem undefined)
  const filtros={};
  if(estado) filtros.estado=estado;
  if(mes>0)  filtros.mes=mes;
  if(ano>0)  filtros.ano=ano;
  serverCall('Lancamento_listAll',[filtros],function(res){
    const rows=Array.isArray(res)?res:[];
    if(!rows.length){ wrap.innerHTML='<div class="info">ℹ️ Sem lançamentos para este filtro.</div>'; return; }
    wrap.innerHTML=`<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table>
      <thead><tr><th>Data</th><th>Nº Doc.</th><th>Descrição</th><th>Grupo</th><th>Rubrica</th><th>Departamento</th>
      <th style="text-align:right;">Valor</th><th>Tipo</th><th>Estado</th><th>Acções</th></tr></thead>
      <tbody>${rows.map(l=>`<tr>
        <td style="white-space:nowrap;">${safeText(l.data_movimento)}</td>
        <td style="white-space:nowrap;font-size:11px;color:#6c757d;">${safeText(l.numero_documento)}</td>
        <td>${safeText(l.descricao)}</td>
        <td>${nomeGrupo(l.id_grupo)}</td>
        <td>${nomeRubrica(l.id_rubrica)}</td>
        <td>${nomeDepto(l.id_departamento)}</td>
        <td style="text-align:right;font-weight:600;">${formatMoney(l.valor)}</td>
        <td style="white-space:nowrap;">${l.tipo_movimento==='ENTRADA'?'📈 Entrada':'📉 Saída'}</td>
        <td>${statusBadge(l.estado)}</td>
        <td class="row-actions">${l.estado==='RASCUNHO'?`
          <button class="success" style="font-size:12px;padding:6px 10px;min-height:32px;" onclick="submeterLancamento('${l.id_lancamento}')">📤 Submeter</button>`:''}
          <button class="info" style="font-size:12px;padding:6px 10px;min-height:32px;" onclick="abrirAnexos('${l.id_lancamento}','${safeText(l.descricao).replace(/'/g,"\\'")}',${l.tem_anexo?'true':'false'})">${l.tem_anexo?'📎 Ver':'📎 Anexar'}</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;
  },function(err){ wrap.innerHTML=`<div class="err">❌ ${err?.message||'Falha ao carregar lançamentos'}</div>`; });
}

function mostrarFormLancamento(){
  const agora=new Date();
  document.getElementById('contentArea').innerHTML=`
    <div class="box" style="margin-top:0;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
        <button class="secondary" style="width:auto;margin-top:0;padding:8px 16px;font-size:14px;" onclick="openLancamentos()">← Voltar à lista</button>
        <strong style="font-size:16px;">＋ Novo Lançamento</strong>
      </div>
      <div id="msgLanc" class="msg" style="margin-bottom:4px;"></div>
      <div class="section-grid">
        <div>
          <label>Tipo de Movimento *</label>
          <select id="fl_tipo" onchange="actualizarRubricas()">
            <option value="ENTRADA">📈 Entrada</option>
            <option value="SAIDA">📉 Saída</option>
          </select>
          <label>Data *</label>
          <input type="date" id="fl_data" value="${agora.toISOString().split('T')[0]}">
          <label>Valor (MZN) *</label>
          <input type="number" id="fl_valor" step="0.01" min="0.01" placeholder="0.00">
          <label>Igreja</label>
          <select id="fl_igreja"><option value="">A carregar...</option></select>
          <label>Departamento *</label>
          <select id="fl_depto"><option value="">A carregar...</option></select>
        </div>
        <div>
          <label>Grupo *</label>
          <select id="fl_grupo" onchange="actualizarRubricas()"><option value="">A carregar...</option></select>
          <label>Rubrica *</label>
          <select id="fl_rubrica"><option value="">Seleccione o grupo primeiro</option></select>
          <label>Conta *</label>
          <select id="fl_conta"><option value="">A carregar...</option></select>
          <label>Descrição *</label>
          <textarea id="fl_descricao" rows="3" placeholder="Descreva o movimento..."></textarea>
        </div>
      </div>

      <hr class="soft">

      <!-- Comprovativo -->
      <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:12px;padding:16px;margin-bottom:4px;">
        <label style="margin:0 0 8px;display:block;">📎 Comprovativo <span style="color:#6c757d;font-weight:400;font-size:12px;">(opcional — PDF, imagem, Word, Excel — máx. 10MB)</span></label>
        <input type="file" id="fl_comprovativo" accept=".pdf,.jpg,.jpeg,.png,.gif,.xlsx,.xls,.doc,.docx"
          style="width:100%;padding:10px;border:2px dashed #dee2e6;border-radius:10px;font-size:13px;cursor:pointer;background:#fff;">
        <div id="fl_comp_preview" style="margin-top:8px;font-size:12px;color:#6c757d;"></div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">
        <button class="secondary" style="width:auto;margin-top:0;padding:11px 22px;" onclick="openLancamentos()">✖ Cancelar</button>
        <button class="info" style="width:auto;margin-top:0;padding:11px 22px;" onclick="guardarLancamento('RASCUNHO')">💾 Guardar Rascunho</button>
        <button class="success" style="width:auto;margin-top:0;padding:11px 22px;" onclick="guardarLancamento('SUBMETER')">📤 Submeter para Aprovação</button>
      </div>
    </div>`;

  // Preview do ficheiro seleccionado
  document.getElementById('fl_comprovativo')?.addEventListener('change', function(){
    const f=this.files[0];
    const prev=document.getElementById('fl_comp_preview');
    if(!f){ prev.innerHTML=''; return; }
    const size=(f.size/1024).toFixed(0);
    prev.innerHTML=`✅ <strong>${f.name}</strong> (${size} KB) — pronto para carregar`;
    prev.style.color='#155724';
  });

  getOpts(function(opts){
    if(!opts){ showMessage('❌ Erro ao carregar opções do formulário.',false,'msgLanc'); return; }
    const selI=document.getElementById('fl_igreja');
    if(selI){
      selI.innerHTML='<option value="">Todas / N/A</option>'+
        (opts.igrejas||[]).map(i=>`<option value="${i.id_igreja}">${safeText(i.nome_igreja)}</option>`).join('');
      if(opts.contexto?.id_igreja) selI.value=opts.contexto.id_igreja;
    }
    const selD=document.getElementById('fl_depto');
    if(selD){
      selD.innerHTML='<option value="">Seleccione departamento</option>'+
        (opts.departamentos||[]).map(d=>`<option value="${d.id_departamento}">${safeText(d.nome_departamento)}</option>`).join('');
      if(opts.contexto?.id_departamento) selD.value=opts.contexto.id_departamento;
    }
    const selG=document.getElementById('fl_grupo');
    if(selG){
      selG.innerHTML='<option value="">Seleccione grupo</option>'+
        (opts.grupos||[]).map(g=>`<option value="${g.id_grupo}">${safeText(g.nome_grupo)}</option>`).join('');
    }
    const selC=document.getElementById('fl_conta');
    if(selC){
      selC.innerHTML='<option value="">Seleccione conta</option>'+
        (opts.contas||[]).map(c=>`<option value="${c.id_conta}">${safeText(c.nome_conta)}</option>`).join('');
    }
  });
}


function actualizarRubricas(){
  const idGrupo=document.getElementById('fl_grupo')?.value;
  const tipo=document.getElementById('fl_tipo')?.value;
  const sel=document.getElementById('fl_rubrica'); if(!sel) return;
  if(!idGrupo){ sel.innerHTML='<option value="">Seleccione o grupo primeiro</option>'; return; }
  sel.innerHTML='<option value="">A carregar rubricas...</option>';
  serverCall('Lancamento_getRubricasPorGrupo',[idGrupo],function(arr){
    const lista=Array.isArray(arr)?arr:[];
    const fil=lista.filter(r=>!r.tipo_movimento||!tipo||r.tipo_movimento===tipo);
    if(!fil.length){ sel.innerHTML='<option value="">Sem rubricas para este grupo/tipo</option>'; return; }
    sel.innerHTML='<option value="">Seleccione rubrica</option>'+
      fil.map(r=>`<option value="${r.id_rubrica}">${safeText(r.nome_rubrica)}</option>`).join('');
  },function(){ sel.innerHTML='<option value="">Erro ao carregar rubricas</option>'; });
}


function guardarLancamento(modo){
  const tipo    =document.getElementById('fl_tipo')?.value;
  const data    =document.getElementById('fl_data')?.value;
  const valor   =document.getElementById('fl_valor')?.value;
  const depto   =document.getElementById('fl_depto')?.value;
  const grupo   =document.getElementById('fl_grupo')?.value;
  const rubrica =document.getElementById('fl_rubrica')?.value;
  const conta   =document.getElementById('fl_conta')?.value;
  const descricao=document.getElementById('fl_descricao')?.value?.trim();
  const igreja  =document.getElementById('fl_igreja')?.value;
  const ficheiro=document.getElementById('fl_comprovativo')?.files?.[0]||null;

  if(!tipo||!data||!valor||!depto||!grupo||!rubrica||!conta||!descricao){
    showMessage('❌ Preencha todos os campos obrigatórios.',false,'msgLanc'); return; }
  if(Number(valor)<=0){ showMessage('❌ O valor deve ser maior que zero.',false,'msgLanc'); return; }
  if(ficheiro && ficheiro.size>10*1024*1024){ showMessage('❌ O comprovativo não pode ultrapassar 10MB.',false,'msgLanc'); return; }

  const payload={tipo_movimento:tipo,data_movimento:data,valor:Number(valor),
    id_departamento:depto,id_grupo:grupo,id_rubrica:rubrica,id_conta:conta,descricao,id_igreja:igreja||''};

  showMessage('⏳ A guardar...',true,'msgLanc');

  // Função que faz upload do comprovativo se existir
  function uploadSeExistir(idLancamento, onDone){
    if(!ficheiro){ onDone(); return; }
    showMessage('⏳ A carregar comprovativo...',true,'msgLanc');
    const reader=new FileReader();
    reader.onload=function(e){
      serverCall('Anexo_upload',[{
        id_lancamento: idLancamento,
        nome_ficheiro: ficheiro.name,
        tipo_ficheiro: ficheiro.type,
        dados_base64:  e.target.result
      }],function(){ onDone(); },
      function(){ onDone(); }); // mesmo com erro no upload, continua
    };
    reader.readAsDataURL(ficheiro);
  }

  if(modo==='SUBMETER'){
    serverCall('Lancamento_createAndSubmit',[payload],function(res){
      const idLanc=res?.id_lancamento||res?.id;
      uploadSeExistir(idLanc||'', function(){
        showMessage('✅ Lançamento submetido para aprovação!'+(ficheiro?' Comprovativo anexado.':''),true,'msgLanc');
        setTimeout(()=>{ openLancamentos(); },1500);
      });
    },function(err){ showMessage('❌ '+(err?.message||'Falha ao submeter lançamento.'),false,'msgLanc'); });
  } else {
    serverCall('Lancamento_create',[payload],function(res){
      const idLanc=res?.id_lancamento||res?.id;
      uploadSeExistir(idLanc||'', function(){
        showMessage('✅ Rascunho guardado!'+(ficheiro?' Comprovativo anexado.':''),true,'msgLanc');
        setTimeout(()=>{ openLancamentos(); },1500);
      });
    },function(err){ showMessage('❌ '+err?.message,false,'msgLanc'); });
  }
}

function submeterLancamento(id){
  confirmar('Submeter este lançamento para aprovação?', function(){
    serverCall('Lancamento_submit',[id],function(){ carregarLancamentos(); },
      function(err){ mostrarErro(err?.message||'Falha ao submeter'); });
  });
}

/* ══════════════════════════════════════════════════════
   ANEXOS / COMPROVATIVOS
══════════════════════════════════════════════════════ */

function abrirAnexos(idLancamento, descricao, temAnexo){
  const over=document.createElement('div');
  over.id='anexosModal';
  over.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  over.innerHTML=`<div style="background:#fff;border-radius:16px;padding:24px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-height:90vh;overflow-y:auto;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="margin:0;font-size:16px;color:#2c3e50;">📎 Comprovativos</h3>
      <button onclick="document.getElementById('anexosModal').remove()" style="width:auto;margin:0;padding:6px 14px;font-size:13px;background:#6c757d;">✖ Fechar</button>
    </div>
    <p class="muted" style="margin:0 0 16px;font-size:13px;">${safeText(descricao)}</p>
    <div id="anexosListaWrap" class="muted">A carregar...</div>
    <hr class="soft" style="margin:16px 0;">
    <strong style="font-size:13px;display:block;margin-bottom:10px;">➕ Adicionar Comprovativo</strong>
    <input type="file" id="anexoFicheiro" accept=".pdf,.jpg,.jpeg,.png,.gif,.xlsx,.xls,.doc,.docx"
      style="width:100%;padding:8px;border:2px dashed #dee2e6;border-radius:10px;font-size:13px;cursor:pointer;">
    <div id="anexoProgresso" style="margin-top:8px;"></div>
    <button class="success" style="margin-top:12px;padding:10px 20px;width:auto;" onclick="uploadAnexo('${idLancamento}')">📤 Carregar Ficheiro</button>
  </div>`;
  document.body.appendChild(over);
  carregarAnexos(idLancamento);
}

function carregarAnexos(idLancamento){
  const wrap=document.getElementById('anexosListaWrap'); if(!wrap) return;
  wrap.innerHTML='⏳ A carregar...';
  serverCall('Anexo_listar',[idLancamento],function(res){
    const lista=Array.isArray(res)?res:[];
    if(!lista.length){ wrap.innerHTML='<div class="muted" style="font-size:13px;">Sem comprovativos anexados.</div>'; return; }
    wrap.innerHTML=lista.map(a=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px;background:#f8f9fa;border-radius:8px;margin-bottom:6px;">
        <span style="font-size:20px;">${a.tipo_ficheiro?.includes('pdf')?'📄':a.tipo_ficheiro?.includes('image')?'🖼️':'📁'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeText(a.nome_ficheiro)}</div>
          <div style="font-size:11px;color:#6c757d;">${safeText(a.carregado_em||'').split('T')[0]}</div>
        </div>
        <a href="${a.link_drive}" target="_blank" style="font-size:12px;padding:5px 10px;background:#17a2b8;color:#fff;border-radius:6px;text-decoration:none;white-space:nowrap;">👁️ Ver</a>
        <button onclick="eliminarAnexo('${a.id_anexo}','${idLancamento}')" style="width:auto;margin:0;padding:5px 10px;font-size:12px;min-height:unset;background:#dc3545;">🗑️</button>
      </div>`).join('');
  },function(err){ wrap.innerHTML=`<div class="err">❌ ${err?.message||'Falha'}</div>`; });
}

function uploadAnexo(idLancamento){
  const input=document.getElementById('anexoFicheiro');
  const prog=document.getElementById('anexoProgresso');
  if(!input?.files?.length){ prog.innerHTML='<div class="err">❌ Seleccione um ficheiro.</div>'; return; }

  const file=input.files[0];
  const maxSize=10*1024*1024; // 10MB
  if(file.size>maxSize){ prog.innerHTML='<div class="err">❌ Ficheiro muito grande. Máximo 10MB.</div>'; return; }

  prog.innerHTML='⏳ A carregar ficheiro...';

  const reader=new FileReader();
  reader.onload=function(e){
    const base64=e.target.result;
    serverCall('Anexo_upload',[{
      id_lancamento: idLancamento,
      nome_ficheiro: file.name,
      tipo_ficheiro: file.type,
      dados_base64:  base64
    }],function(res){
      prog.innerHTML='<div class="ok">✅ Comprovativo carregado com sucesso!</div>';
      input.value='';
      // Invalidar cache e recarregar lista
      Object.keys(_cache).forEach(k=>{ if(k.includes('listAll')) delete _cache[k]; });
      setTimeout(()=>{ carregarAnexos(idLancamento); prog.innerHTML=''; }, 1200);
    },function(err){ prog.innerHTML=`<div class="err">❌ ${err?.message||'Falha ao carregar'}</div>`; });
  };
  reader.readAsDataURL(file);
}

function eliminarAnexo(idAnexo, idLancamento){
  confirmar('Eliminar este comprovativo? Esta acção é irreversível.', function(){
    serverCall('Anexo_eliminar',[idAnexo],function(){
      carregarAnexos(idLancamento);
      Object.keys(_cache).forEach(k=>{ if(k.includes('listAll')) delete _cache[k]; });
    },function(err){ mostrarErro(err?.message||'Falha'); });
  });
}

/* ══════════════════════════════════════════════════════
   APROVAÇÕES
══════════════════════════════════════════════════════ */

function openApprovals(){
  setActiveMenu('✓ Aprovações');
  document.getElementById('contentTitle').textContent='✓ Aprovações Pendentes';
  document.getElementById('contentArea').innerHTML=`
    <div class="box" style="margin-top:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <strong>⏳ Lançamentos a Aprovar</strong>
        <button class="info" style="width:auto;margin-top:0;padding:9px 18px;" onclick="carregarAprovacoes()">🔄 Actualizar</button>
      </div>
      <div id="aprovTableWrap" class="muted">A carregar...</div>
    </div>`;
  getOpts(function(){ carregarAprovacoes(); });
}

function carregarAprovacoes(){
  const wrap=document.getElementById('aprovTableWrap'); if(!wrap) return;
  wrap.innerHTML='⏳ A carregar...';
  const user=getUser();
  const perfil=String(user.id_perfil||'').toUpperCase();

  serverCall('Approval_listPending',[],function(res){
    const rows=Array.isArray(res)?res.filter(Boolean):[];
    if(!rows.length){
      let msg='';
      if(perfil==='ADMIN_GERAL'){
        msg=`<div class="info">🖥️ O perfil IT/Helpdesk (ADMIN_GERAL) não participa no fluxo de aprovação financeira.<br>
          <small style="color:#6c757d;">As aprovações são da responsabilidade do TESOUREIRO_DISTRITAL.</small></div>`;
      } else if(perfil==='TESOUREIRO_DISTRITAL'){
        msg=`<div class="info">✅ Sem lançamentos pendentes de aprovação.</div>`;
      } else {
        msg=`<div class="info">✅ Sem lançamentos pendentes de aprovação para o perfil <strong>${safeText(user.id_perfil)}</strong>.</div>`;
      }
      wrap.innerHTML=msg; return;
    }
    wrap.innerHTML=`<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table>
      <thead><tr><th>Data</th><th>Descrição</th><th>Grupo</th><th>Rubrica</th><th>Departamento</th>
      <th>Igreja</th><th style="text-align:right;">Valor</th><th>Tipo</th><th>Acções</th></tr></thead>
      <tbody>${rows.map(l=>`<tr>
        <td style="white-space:nowrap;">${safeText(l.data_movimento||l.data_lancamento)}</td>
        <td>${safeText(l.descricao)}</td>
        <td>${nomeGrupo(l.id_grupo)}</td>
        <td>${nomeRubrica(l.id_rubrica)}</td>
        <td>${nomeDepto(l.id_departamento)}</td>
        <td>${nomeIgreja(l.id_igreja)}</td>
        <td style="text-align:right;font-weight:600;">${formatMoney(l.valor)}</td>
        <td style="white-space:nowrap;">${l.tipo_movimento==='ENTRADA'||l.tipo_movimento==='RECEITA'?'📈 Entrada':'📉 Saída'}</td>
        <td class="row-actions">
          <button class="success" style="font-size:12px;padding:6px 10px;min-height:32px;" onclick="decidirAprovacao('${l.id_aprovacao}','APROVADO')">✅ Aprovar</button>
          <button class="danger"  style="font-size:12px;padding:6px 10px;min-height:32px;" onclick="decidirAprovacao('${l.id_aprovacao}','REJEITADO')">❌ Rejeitar</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;
  },function(err){ wrap.innerHTML=`<div class="err">❌ ${err?.message||'Falha'}</div>`; });
}

function decidirAprovacao(idAprovacao,decisao){
  if(decisao==='REJEITADO'){
    // Usar modal de texto em vez de prompt() nativo
    const over=document.createElement('div');
    over.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    over.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <p style="font-size:15px;font-weight:600;color:#2c3e50;margin:0 0 12px;">Motivo da rejeição</p>
      <textarea id="_rejMotivo" rows="3" style="width:100%;padding:10px;border:2px solid #e0e0e0;border-radius:10px;font-size:14px;resize:vertical;" placeholder="Indique o motivo (obrigatório)..."></textarea>
      <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
        <button onclick="this.closest('div').parentElement.remove()" style="padding:10px 20px;border-radius:10px;border:2px solid #dee2e6;background:#fff;font-weight:600;cursor:pointer;">Cancelar</button>
        <button id="_rejBtn" style="padding:10px 20px;border-radius:10px;border:0;background:linear-gradient(135deg,#dc3545,#c82333);color:#fff;font-weight:700;cursor:pointer;">❌ Rejeitar</button>
      </div>
    </div>`;
    document.body.appendChild(over);
    over.querySelector('#_rejBtn').onclick=function(){
      const motivo=over.querySelector('#_rejMotivo').value.trim();
      if(!motivo){ over.querySelector('#_rejMotivo').style.borderColor='#dc3545'; return; }
      over.remove();
      serverCall('Approval_decide',[idAprovacao,'REJEITADO',motivo],function(){
        carregarAprovacoes();
        serverCall('Dashboard_getSummary',[{}],function(s){ const el=document.getElementById('kpiSaldo'); if(el) el.textContent=formatMoney(s?.saldo_projectado ?? s?.saldo); },()=>{});
      },function(err){ mostrarErro(err?.message||'Falha ao rejeitar'); });
    };
  } else {
    confirmar('Confirmar aprovação deste lançamento?', function(){
      serverCall('Approval_decide',[idAprovacao,'APROVADO',''],function(){
        carregarAprovacoes();
        serverCall('Dashboard_getSummary',[{}],function(s){ const el=document.getElementById('kpiSaldo'); if(el) el.textContent=formatMoney(s?.saldo_projectado ?? s?.saldo); },()=>{});
      },function(err){ mostrarErro(err?.message||'Falha ao aprovar'); });
    });
  }
}

/* ══════════════════════════════════════════════════════
   ORÇAMENTOS
══════════════════════════════════════════════════════ */

function openOrcamentos(){
  setActiveMenu('📈 Orçamentos');
  document.getElementById('contentTitle').textContent='📈 Orçamentos';
  const agora=new Date(),ano=agora.getFullYear(),mes=agora.getMonth()+1;
  const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let anosH=''; for(let a=ano+1;a>=ano-3;a--) anosH+=`<option value="${a}"${a===ano?' selected':''}>${a}</option>`;
  const mesesH=meses.map((m,i)=>`<option value="${i+1}"${i+1===mes?' selected':''}>${m}</option>`).join('');

  document.getElementById('contentArea').innerHTML=`
    <div class="box" style="margin-top:0;">
      <h3>📊 Resumo Mensal por Departamento</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <select id="orc_mes" style="flex:1;min-width:110px;padding:9px 12px;">${mesesH}</select>
        <select id="orc_ano" style="flex:1;min-width:80px;padding:9px 12px;">${anosH}</select>
        <button class="info" style="width:auto;margin-top:0;padding:9px 18px;" onclick="carregarOrcamentoMensal()">🔍 Ver</button>
      </div>
      <div id="orcMensalWrap" class="muted">Clique em "Ver" para carregar.</div>
    </div>
    <div class="box" style="margin-top:16px;">
      <h3>📋 Resumo Geral de Orçamentos</h3>
      <div id="orcResumoWrap" class="muted">A carregar...</div>
    </div>`;

  getOpts(function(){
    serverCall('Orcamento_listResumo',[],function(res){
      const wrap=document.getElementById('orcResumoWrap'); if(!wrap) return;
      const itens=Array.isArray(res?.itens)?res.itens:[];
      wrap.innerHTML=`<div style="margin-bottom:12px;"><strong>Total Orçado: </strong>${formatMoney(res?.totalOrcado)} &nbsp;|&nbsp; <strong>Quantidade: </strong>${safeText(res?.quantidade)}</div>`+
        (itens.length?`<div style="overflow-x:auto;"><table>
          <thead><tr><th>Rubrica</th><th>Ano</th><th>Departamento</th><th>Igreja</th><th style="text-align:right;">Valor Orçado</th></tr></thead>
          <tbody>${itens.slice(0,30).map(o=>`<tr>
            <td>${nomeRubrica(o.id_rubrica)}</td>
            <td>${safeText(o.ano)}</td>
            <td>${nomeDepto(o.id_departamento)}</td>
            <td>${nomeIgreja(o.id_igreja)}</td>
            <td style="text-align:right;">${formatMoney(o.valor_orcado)}</td>
          </tr>`).join('')}</tbody></table></div>`:'<div class="info">ℹ️ Sem orçamentos registados.</div>');
    },function(err){ const w=document.getElementById('orcResumoWrap'); if(w) w.innerHTML=`<div class="err">❌ ${err?.message}</div>`; });
  });
}

function carregarOrcamentoMensal(){
  const wrap=document.getElementById('orcMensalWrap'); if(!wrap) return;
  wrap.innerHTML='⏳ A carregar...';
  const mes=Number(document.getElementById('orc_mes')?.value||new Date().getMonth()+1);
  const ano=Number(document.getElementById('orc_ano')?.value||new Date().getFullYear());
  serverCall('Orcamento_resumoMensal',[{mes,ano}],function(res){
    const linhas=Array.isArray(res?.linhas)?res.linhas:[];
    if(!linhas.length){ wrap.innerHTML='<div class="info">ℹ️ Sem dados para este período.</div>'; return; }
    wrap.innerHTML=tabelaDeptos(linhas,res);
  },function(err){ wrap.innerHTML=`<div class="err">❌ ${err?.message||'Falha'}</div>`; });
}

/* ══════════════════════════════════════════════════════
   RELATÓRIOS — por Departamento e por Rubrica
   (ambos respeitam o scope do utilizador via backend)
══════════════════════════════════════════════════════ */

function openRelatorios(){
  setActiveMenu('📄 Relatórios');
  document.getElementById('contentTitle').textContent='📄 Relatórios Financeiros';
  const agora=new Date(),ano=agora.getFullYear(),mes=agora.getMonth()+1;
  const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let anosH=''; for(let a=2030;a>=2020;a--) anosH+=`<option value="${a}"${a===ano?' selected':''}>${a}</option>`;
  const mesesInicioH=meses.map((m,i)=>`<option value="${i+1}"${i+1===1?' selected':''}>${m}</option>`).join('');
  const mesesFimH=meses.map((m,i)=>`<option value="${i+1}"${i+1===mes?' selected':''}>${m}</option>`).join('');

  document.getElementById('contentArea').innerHTML=`
    <div class="section-grid" style="margin-top:0;">

      <div class="box" style="margin-top:0;">
        <h3>🏢 Relatório por Departamento</h3>
        <div style="background:#f0f4ff;border-radius:10px;padding:12px;margin-bottom:12px;">
          <div style="font-size:12px;color:#6c757d;margin-bottom:8px;font-weight:600;">📅 PERÍODO</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <div style="flex:1;min-width:110px;">
              <label style="font-size:11px;margin:0 0 4px;display:block;">Mês Início</label>
              <select id="relD_mes_ini" style="padding:8px 10px;font-size:13px;width:100%;">${mesesInicioH}</select>
            </div>
            <div style="flex:1;min-width:110px;">
              <label style="font-size:11px;margin:0 0 4px;display:block;">Mês Fim</label>
              <select id="relD_mes_fim" style="padding:8px 10px;font-size:13px;width:100%;">${mesesFimH}</select>
            </div>
            <div style="flex:1;min-width:80px;">
              <label style="font-size:11px;margin:0 0 4px;display:block;">Ano</label>
              <select id="relD_ano" style="padding:8px 10px;font-size:13px;width:100%;">${anosH}</select>
            </div>
          </div>
        </div>
        <button class="info" onclick="gerarRelatorioDeptos()">📥 Gerar Relatório</button>
        <div id="relDWrap" style="margin-top:14px;"></div>
      </div>

      <div class="box" style="margin-top:0;">
        <h3>📂 Relatório por Rubrica</h3>
        <div style="background:#f0f4ff;border-radius:10px;padding:12px;margin-bottom:12px;">
          <div style="font-size:12px;color:#6c757d;margin-bottom:8px;font-weight:600;">📅 PERÍODO</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <div style="flex:1;min-width:110px;">
              <label style="font-size:11px;margin:0 0 4px;display:block;">Mês Início</label>
              <select id="relR_mes_ini" style="padding:8px 10px;font-size:13px;width:100%;">${mesesInicioH}</select>
            </div>
            <div style="flex:1;min-width:110px;">
              <label style="font-size:11px;margin:0 0 4px;display:block;">Mês Fim</label>
              <select id="relR_mes_fim" style="padding:8px 10px;font-size:13px;width:100%;">${mesesFimH}</select>
            </div>
            <div style="flex:1;min-width:80px;">
              <label style="font-size:11px;margin:0 0 4px;display:block;">Ano</label>
              <select id="relR_ano" style="padding:8px 10px;font-size:13px;width:100%;">${anosH}</select>
            </div>
          </div>
        </div>
        <button class="info" onclick="gerarRelatorioRubricas()">📥 Gerar Relatório</button>
        <div id="relRWrap" style="margin-top:14px;"></div>
      </div>

    </div>`;
}

function labelPeriodo(mesInicio, mesFim, ano){
  const nomeMes=['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  if(mesInicio===mesFim) return `${nomeMes[mesInicio]} ${ano}`;
  return `${nomeMes[mesInicio]} a ${nomeMes[mesFim]} de ${ano}`;
}

function gerarRelatorioDeptos(){
  const mesInicio=Number(document.getElementById('relD_mes_ini')?.value||1);
  const mesFim=Number(document.getElementById('relD_mes_fim')?.value||new Date().getMonth()+1);
  const ano=Number(document.getElementById('relD_ano')?.value||new Date().getFullYear());
  const wrap=document.getElementById('relDWrap'); if(!wrap) return;

  if(mesInicio>mesFim){ wrap.innerHTML=`<div class="err">❌ O mês de início não pode ser posterior ao mês de fim.</div>`; return; }

  wrap.innerHTML='⏳ A gerar...';
  const label=labelPeriodo(mesInicio,mesFim,ano);

  serverCall('Dashboard_resumoDeptos',[{mes:mesInicio, mesInicio, mesFim, ano, periodo:'livre'}],function(res){
    const linhas=Array.isArray(res?.linhas)?res.linhas:[];
    const igNome=res?.igreja_nome?` — ${res.igreja_nome}`:'';
    if(!linhas.length){ wrap.innerHTML=`<div class="info">ℹ️ Sem dados aprovados em ${label}${igNome}.</div>`; return; }
    wrap.innerHTML=
      `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        <div style="font-weight:600;">📅 ${label}${igNome}</div>
        <div style="display:flex;gap:8px;">
          <button class="success" style="width:auto;margin-top:0;padding:8px 16px;font-size:13px;"
            onclick="exportarPDF('relD_content','Relatório por Departamento — ${label.replace(/'/g,"\\'")}')">🖨️ PDF</button>
          <button class="secondary" style="width:auto;margin-top:0;padding:8px 16px;font-size:13px;"
            onclick="exportarWord('relD_content','Relatório por Departamento — ${label.replace(/'/g,"\\'")}')">📄 Word</button>
        </div>
      </div>
      <div id="relD_content">`+resumoCards(res)+tabelaDeptos(linhas,res)+`</div>`;
  },function(err){ wrap.innerHTML=`<div class="err">❌ ${err?.message||'Falha'}</div>`; });
}

function gerarRelatorioRubricas(){
  const mesInicio=Number(document.getElementById('relR_mes_ini')?.value||1);
  const mesFim=Number(document.getElementById('relR_mes_fim')?.value||new Date().getMonth()+1);
  const ano=Number(document.getElementById('relR_ano')?.value||new Date().getFullYear());
  const wrap=document.getElementById('relRWrap'); if(!wrap) return;

  if(mesInicio>mesFim){ wrap.innerHTML=`<div class="err">❌ O mês de início não pode ser posterior ao mês de fim.</div>`; return; }

  wrap.innerHTML='⏳ A gerar...';
  const label=labelPeriodo(mesInicio,mesFim,ano);

  serverCall('Lancamento_listAll',[{estado:'APROVADO', mesInicio, mesFim, ano}],function(rows){
    const lancamentos=Array.isArray(rows)?rows:[];
    const filtrados=lancamentos.filter(function(l){
      const lMes=Number(l.mes||0),lAno=Number(l.ano||0);
      return lAno===ano && lMes>=mesInicio && lMes<=mesFim;
    });
    if(!filtrados.length){ wrap.innerHTML=`<div class="info">ℹ️ Sem lançamentos aprovados em ${label}.</div>`; return; }

    const agrupado={};
    filtrados.forEach(function(l){
      const idRub=String(l.id_rubrica||'').trim()||'(sem rubrica)';
      const tipo=String(l.tipo_movimento||'').trim().toUpperCase();
      const valor=Number(l.valor||0);
      if(!agrupado[idRub]){ agrupado[idRub]={id_rubrica:idRub,nome_rubrica:nomeRubrica(idRub),nome_grupo:nomeGrupo(l.id_grupo),tipo_movimento:tipo,entrada:0,saida:0}; }
      if(tipo==='ENTRADA'||tipo==='RECEITA') agrupado[idRub].entrada+=valor;
      if(tipo==='SAIDA'||tipo==='DESPESA')   agrupado[idRub].saida+=valor;
    });

    const linhas=Object.values(agrupado).map(function(g){ return {...g,saldo:g.entrada-g.saida}; })
      .sort((a,b)=>(a.nome_grupo||'').localeCompare(b.nome_grupo||'')||(a.nome_rubrica||'').localeCompare(b.nome_rubrica||''));
    const totalEntrada=linhas.reduce((s,l)=>s+l.entrada,0);
    const totalSaida=linhas.reduce((s,l)=>s+l.saida,0);
    const res={linhas,totalEntrada,totalSaida,totalSaldo:totalEntrada-totalSaida};

    wrap.innerHTML=
      `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        <div style="font-weight:600;">📅 ${label}</div>
        <div style="display:flex;gap:8px;">
          <button class="success" style="width:auto;margin-top:0;padding:8px 16px;font-size:13px;"
            onclick="exportarPDF('relR_content','Relatório por Rubrica — ${label.replace(/'/g,"\\'")}')">🖨️ PDF</button>
          <button class="secondary" style="width:auto;margin-top:0;padding:8px 16px;font-size:13px;"
            onclick="exportarWord('relR_content','Relatório por Rubrica — ${label.replace(/'/g,"\\'")}')">📄 Word</button>
        </div>
      </div>
      <div id="relR_content">`+resumoCards(res)+tabelaRubricas(linhas,res)+`</div>`;

  },function(err){ wrap.innerHTML=`<div class="err">❌ ${err?.message||'Falha'}</div>`; });
}

/* ── EXPORTAÇÃO PDF ── */
function exportarPDF(contentId, titulo){
  const el=document.getElementById(contentId);
  if(!el){ mostrarErro('Conteúdo não encontrado.'); return; }

  const win=window.open('','_blank','width=900,height=700');
  const html=`<!DOCTYPE html><html lang="pt"><head>
    <meta charset="UTF-8">
    <title>${titulo}</title>
    <style>
      *{ box-sizing:border-box; margin:0; padding:0; }
      body{ font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#222; padding:24px; }
      h1{ font-size:16px; color:#123b7a; margin-bottom:4px; }
      .sub{ font-size:11px; color:#666; margin-bottom:18px; }
      .cards{ display:flex; gap:12px; margin-bottom:16px; }
      .card{ flex:1; border:1px solid #dee2e6; border-radius:8px; padding:10px 14px; }
      .card-title{ font-size:10px; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; }
      .card-val{ font-size:15px; font-weight:700; }
      .verde{ color:#28a745; } .vermelho{ color:#dc3545; }
      table{ width:100%; border-collapse:collapse; font-size:11px; margin-top:8px; }
      th{ background:#123b7a; color:#fff; padding:7px 8px; text-align:left; font-size:10px; white-space:nowrap; }
      td{ padding:6px 8px; border-bottom:1px solid #e9ecef; vertical-align:middle; }
      tr:nth-child(even){ background:#f8f9fa; }
      tfoot tr{ background:#e8edf4 !important; font-weight:700; border-top:2px solid #123b7a; }
      .right{ text-align:right; }
      @media print{
        body{ padding:12px; }
        button{ display:none !important; }
        @page{ margin:1cm; size:A4 landscape; }
      }
    </style>
  </head><body>
    <h1>Igreja do Nazareno - Distrito da Matola</h1>
    <div class="sub">${titulo} &nbsp;|&nbsp; Gerado em ${new Date().toLocaleString('pt-MZ')}</div>
    ${el.innerHTML}
    <script>
      window.onload=function(){
        // Remove emoji icons that don't print well
        document.querySelectorAll('button').forEach(b=>b.remove());
        setTimeout(function(){ window.print(); },400);
      };
    <\/script>
  </body></html>`;

  win.document.write(html);
  win.document.close();
}

/* ── EXPORTAÇÃO WORD (.doc via HTML) ── */
function exportarWord(contentId, titulo){
  const el=document.getElementById(contentId);
  if(!el){ mostrarErro('Conteúdo não encontrado.'); return; }

  const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word"
    xmlns="http://www.w3.org/TR/REC-html40">
  <head>
    <meta charset="UTF-8">
    <meta name="ProgId" content="Word.Document">
    <meta name="Generator" content="Microsoft Word 15">
    <title>${titulo}</title>
    <!--[if gte mso 9]>
    <xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
    <![endif]-->
    <style>
      body{ font-family:Arial,sans-serif; font-size:11pt; color:#000; margin:2cm; }
      h1{ font-size:14pt; color:#123b7a; margin-bottom:4pt; }
      .sub{ font-size:9pt; color:#666; margin-bottom:14pt; }
      .cards{ display:flex; gap:10pt; margin-bottom:14pt; }
      .card{ border:1pt solid #ccc; padding:8pt 12pt; min-width:120pt; }
      .card-title{ font-size:8pt; color:#666; text-transform:uppercase; margin-bottom:3pt; }
      .card-val{ font-size:13pt; font-weight:bold; }
      .verde{ color:#28a745; } .vermelho{ color:#dc3545; }
      table{ width:100%; border-collapse:collapse; font-size:10pt; }
      th{ background:#123b7a; color:#fff; padding:5pt 6pt; text-align:left; font-size:9pt; }
      td{ padding:4pt 6pt; border-bottom:1pt solid #e0e0e0; }
      tfoot tr td{ font-weight:bold; border-top:2pt solid #123b7a; background:#eef2f8; }
      .right{ text-align:right; }
    </style>
  </head>
  <body>
    <h1>Igreja do Nazareno - Distrito da Matola</h1>
    <div class="sub">${titulo} &nbsp;|&nbsp; Gerado em ${new Date().toLocaleString('pt-MZ')}</div>
    ${el.innerHTML.replace(/<button[^>]*>.*?<\/button>/gs,'').replace(/📈|📉|📅|⚠️|✅|🚫|📝|💰|🏢|📂/g,'')}
  </body></html>`;

  const blob=new Blob(['\ufeff'+html],{type:'application/msword;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=titulo.replace(/[^a-zA-Z0-9À-ÿ\s\-]/g,'').trim()+'.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function resumoCards(res){
  const saldo=Number(res.totalSaldo||0);
  return `<div class="cards" style="display:flex;gap:10px;margin:0 0 12px;flex-wrap:wrap;">
    <div class="card" style="flex:1;min-width:120px;cursor:default;padding:12px;"><div class="card-title">Entradas</div><div class="card-val verde">${formatMoney(res.totalEntrada)}</div></div>
    <div class="card" style="flex:1;min-width:120px;cursor:default;padding:12px;"><div class="card-title">Saídas</div><div class="card-val vermelho">${formatMoney(res.totalSaida)}</div></div>
    <div class="card" style="flex:1;min-width:120px;cursor:default;padding:12px;"><div class="card-title">Saldo</div><div class="card-val ${saldo>=0?'verde':'vermelho'}">${formatMoney(saldo)}</div></div>
  </div>`;
}

function tabelaRubricas(linhas,res){
  return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table>
    <thead><tr><th>Grupo</th><th>Rubrica</th><th>Tipo</th>
    <th class="right">Entradas</th><th class="right">Saídas</th><th class="right">Saldo</th></tr></thead>
    <tbody>${linhas.map(l=>`<tr>
      <td>${safeText(l.nome_grupo)}</td>
      <td><strong>${safeText(l.nome_rubrica)}</strong></td>
      <td style="white-space:nowrap;">${l.tipo_movimento==='ENTRADA'||l.tipo_movimento==='RECEITA'?'📈 Entrada':l.tipo_movimento==='SAIDA'||l.tipo_movimento==='DESPESA'?'📉 Saída':'-'}</td>
      <td class="right verde">${formatMoney(l.entrada)}</td>
      <td class="right vermelho">${formatMoney(l.saida)}</td>
      <td class="right" style="font-weight:700;color:${Number(l.saldo||0)>=0?'#28a745':'#dc3545'};">${formatMoney(l.saldo)}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr style="border-top:2px solid #dee2e6;font-weight:700;background:#f8f9fa;">
      <td colspan="3">TOTAL</td>
      <td class="right verde">${formatMoney(res.totalEntrada)}</td>
      <td class="right vermelho">${formatMoney(res.totalSaida)}</td>
      <td class="right" style="color:${Number(res.totalSaldo||0)>=0?'#28a745':'#dc3545'};">${formatMoney(res.totalSaldo)}</td>
    </tr></tfoot></table></div>`;
}

/* ══════════════════════════════════════════════════════
   ADMINISTRAÇÃO
══════════════════════════════════════════════════════ */

function openAdministracao(){
  setActiveMenu('⚙️ Administração');
  document.getElementById('contentTitle').textContent='⚙️ Administração do Sistema';
  document.getElementById('contentArea').innerHTML=`
    <div class="section-grid" style="margin-top:0;">
      <div class="box" style="margin-top:0;cursor:pointer;border:2px solid transparent;" onclick="adminTab('utilizadores')" id="tab_utilizadores">
        <h3>👥 Utilizadores</h3><p class="muted">Gerir contas e permissões.</p></div>
      <div class="box" style="margin-top:0;cursor:pointer;border:2px solid transparent;" onclick="adminTab('perfis')" id="tab_perfis">
        <h3>🎯 Perfis & Aprovações</h3><p class="muted">Visualizar perfis, acessos e limites de aprovação.</p></div>
      <div class="box" style="margin-top:0;cursor:pointer;border:2px solid transparent;" onclick="adminTab('departamentos')" id="tab_departamentos">
        <h3>🏢 Departamentos</h3><p class="muted">Gerir departamentos.</p></div>
      <div class="box" style="margin-top:0;cursor:pointer;border:2px solid transparent;" onclick="adminTab('igrejas')" id="tab_igrejas">
        <h3>⛪ Igrejas</h3><p class="muted">Gerir igrejas e entidades.</p></div>
      <div class="box" style="margin-top:0;cursor:pointer;border:2px solid transparent;border-left:4px solid #f0ad4e;" onclick="adminTab('saldos_iniciais')" id="tab_saldos_iniciais">
        <h3>🏦 Saldos Iniciais</h3><p class="muted">Migração: introduzir saldos de abertura por departamento e rubrica.</p></div>
    </div>
    <div id="adminContentWrap" style="margin-top:4px;"></div>`;
}
function adminTab(tab){
  ['utilizadores','perfis','departamentos','igrejas','saldos_iniciais'].forEach(t=>{
    const el=document.getElementById('tab_'+t);
    if(el) el.style.borderColor=t===tab?'#123b7a':'transparent';
  });
  if(tab==='utilizadores')    adminUtilizadores();
  if(tab==='perfis')          adminPerfis();
  if(tab==='departamentos')   adminDepartamentos();
  if(tab==='igrejas')         adminIgrejas();
  if(tab==='saldos_iniciais') adminSaldosIniciais();
}

/* ── Perfis & Aprovações ── */
function adminPerfis(){
  const wrap=document.getElementById('adminContentWrap');



  const perfis = [
    {
      id: 'ADMIN_GERAL',
      icon: '🖥️',
      nome: 'Administrador Geral (IT)',
      scope: 'Distrital — suporte técnico e configuração',
      scopeColor: '#5a3e99',
      modulos: ['Dashboard','Lançamentos','Aprovações','Orçamentos','Relatórios','Administração'],
      aprovacao: 'IT/Helpdesk — não aprova lançamentos financeiros',
      aprovacaoCor: '#6c757d',
      podeSubmeter: false,
      podeAprovar: false,
      nivelAprovacao: null,
    },
    {
      id: 'TESOUREIRO_DISTRITAL',
      icon: '💼',
      nome: 'Tesoureiro Distrital',
      scope: 'Distrital — vê tudo',
      scopeColor: '#123b7a',
      modulos: ['Dashboard','Lançamentos','Aprovações','Orçamentos','Relatórios'],
      aprovacao: 'Nível 1 — todos os lançamentos submetidos',
      aprovacaoCor: '#155724',
      podeSubmeter: true,
      podeAprovar: true,
      nivelAprovacao: 1,
    },
    {
      id: 'TESOUREIRO_LOCAL',
      icon: '🏠',
      nome: 'Tesoureiro Local',
      scope: 'Local — apenas a sua igreja',
      scopeColor: '#0c5460',
      modulos: ['Dashboard','Lançamentos'],
      aprovacao: 'Não aprova — submete para o Tesoureiro Distrital',
      aprovacaoCor: '#6c757d',
      podeSubmeter: true,
      podeAprovar: false,
      nivelAprovacao: null,
    },
    {
      id: 'RESPONSAVEL_DEPARTAMENTAL',
      icon: '🏢',
      nome: 'Responsável Departamental',
      scope: 'Departamental — apenas o seu departamento',
      scopeColor: '#5a3e99',
      modulos: ['Dashboard','Lançamentos'],
      aprovacao: 'Não aprova — submete para o Tesoureiro Distrital',
      aprovacaoCor: '#6c757d',
      podeSubmeter: true,
      podeAprovar: false,
      nivelAprovacao: null,
    },
    {
      id: 'ADMIN_DISTRITAL',
      icon: '📋',
      nome: 'Administrador Distrital',
      scope: 'Distrital — vê tudo',
      scopeColor: '#123b7a',
      modulos: ['Dashboard','Lançamentos','Aprovações','Orçamentos','Relatórios','Administração'],
      aprovacao: 'Sem aprovação definida — depende das permissões configuradas',
      aprovacaoCor: '#6c757d',
      podeSubmeter: true,
      podeAprovar: false,
      nivelAprovacao: null,
    },
  ];

  wrap.innerHTML=`
    <div class="box" style="margin-top:0;">
      <div style="margin-bottom:16px;">
        <strong style="font-size:15px;">🎯 Perfis de Utilizador e Fluxo de Aprovação</strong>
        <p class="muted" style="margin:6px 0 0;">Resumo dos perfis existentes, os seus acessos e como funcionam as aprovações de lançamentos.</p>
      </div>

      <!-- Tabela de perfis -->
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:24px;">
        <table>
          <thead>
            <tr>
              <th>Perfil</th>
              <th>Âmbito de Dados</th>
              <th>Módulos com Acesso</th>
              <th>Pode Submeter</th>
              <th>Papel na Aprovação</th>
            </tr>
          </thead>
          <tbody>
            ${perfis.map(p=>`<tr>
              <td>
                <div style="font-weight:700;font-size:14px;">${p.icon} ${p.nome}</div>
                <div style="font-size:11px;color:#6c757d;margin-top:2px;font-family:monospace;">${p.id}</div>
              </td>
              <td><span style="background:${p.scopeColor}18;color:${p.scopeColor};padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;">${p.scope}</span></td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${p.modulos.map(m=>`<span class="badge badge-info" style="font-size:10px;">${m}</span>`).join('')}
                </div>
              </td>
              <td style="text-align:center;">${p.podeSubmeter?'<span class="badge badge-success">✅ Sim</span>':'<span class="badge badge-danger">❌ Não</span>'}</td>
              <td>
                <span style="background:${p.aprovacaoCor}18;color:${p.aprovacaoCor};padding:4px 8px;border-radius:6px;font-size:12px;">${p.aprovacao}</span>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <!-- Fluxo visual de aprovação -->
      <hr class="soft">
      <strong style="font-size:14px;display:block;margin-bottom:14px;">🔄 Fluxo de Aprovação de Lançamentos</strong>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px;">
        <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">📝</div>
          <div style="font-weight:700;color:#2c3e50;margin-bottom:4px;">1. Criação</div>
          <div style="font-size:12px;color:#6c757d;">Tesoureiro Local ou Responsável Departamental cria o lançamento como <strong>Rascunho</strong></div>
        </div>
        <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">📤</div>
          <div style="font-weight:700;color:#2c3e50;margin-bottom:4px;">2. Submissão</div>
          <div style="font-size:12px;color:#6c757d;">Lançamento passa a <strong>Submetido</strong> e vai para fila do <strong>Tesoureiro Distrital</strong></div>
        </div>
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">✅</div>
          <div style="font-weight:700;color:#155724;margin-bottom:4px;">3. Aprovação Final</div>
          <div style="font-size:12px;color:#155724;"><strong>Tesoureiro Distrital</strong> aprova ou rejeita. Decisão definitiva — lançamento fica <strong>Aprovado</strong>.</div>
        </div>
        <div style="background:#e8edf4;border:1px solid #c0cfe0;border-radius:12px;padding:16px;text-align:center;opacity:0.85;">
          <div style="font-size:28px;margin-bottom:8px;">🖥️</div>
          <div style="font-weight:700;color:#4a5568;margin-bottom:4px;">Admin Geral — IT</div>
          <div style="font-size:12px;color:#6c757d;"><strong>Suporte técnico / Helpdesk</strong> — gere o sistema mas <strong>não participa</strong> no fluxo de aprovação financeira</div>
        </div>
      </div>

      <!-- Tabela de utilizadores actuais por perfil -->
      <hr class="soft">
      <strong style="font-size:14px;display:block;margin-bottom:14px;">👥 Utilizadores por Perfil</strong>
      <div id="perfisUtilWrap" class="muted">A carregar...</div>
    </div>`;

  // Carregar utilizadores E garantir cache de nomes
  getOpts(function(opts){
    serverCall('User_list',[],function(res){
      const w=document.getElementById('perfisUtilWrap'); if(!w) return;
      const users=Array.isArray(res)?res:[];
      if(!users.length){ w.innerHTML='<div class="info">ℹ️ Sem utilizadores.</div>'; return; }

      // Construir mapas de id → nome a partir das opções carregadas
      const igrejaMap={};
      (opts?.igrejas||[]).forEach(i=>{ igrejaMap[String(i.id_igreja)]=i.nome_igreja; });
      const deptoMap={};
      (opts?.departamentos||[]).forEach(d=>{ deptoMap[String(d.id_departamento)]=d.nome_departamento; });

      // Resolver nome de igreja (pode vir como id ou código)
      function resolveIgreja(u){
        if(u.nome_igreja) return u.nome_igreja;
        const id=String(u.id_igreja||'');
        return igrejaMap[id] || id || '-';
      }
      function resolveDepto(u){
        if(u.nome_departamento) return u.nome_departamento;
        const id=String(u.id_departamento||'');
        return deptoMap[id] || id || '-';
      }

      // Agrupar por perfil
      const grupos={};
      users.forEach(u=>{
        const p=u.id_perfil||'(sem perfil)';
        if(!grupos[p]) grupos[p]=[];
        grupos[p].push(u);
      });

      const ordem=['ADMIN_GERAL','TESOUREIRO_DISTRITAL','ADMIN_DISTRITAL','TESOUREIRO_LOCAL','RESPONSAVEL_DEPARTAMENTAL'];
      const chaves=[...ordem.filter(k=>grupos[k]),...Object.keys(grupos).filter(k=>!ordem.includes(k))];

      w.innerHTML=`<div style="overflow-x:auto;"><table>
        <thead><tr><th>Perfil</th><th>Nome</th><th>Username</th><th>Igreja</th><th>Departamento</th><th>Estado</th></tr></thead>
        <tbody>${chaves.flatMap(perfil=>
          grupos[perfil].map((u,i)=>`<tr style="${i===0?'border-top:2px solid #dee2e6;':''}">
            ${i===0?`<td rowspan="${grupos[perfil].length}" style="font-weight:700;vertical-align:top;padding-top:14px;white-space:nowrap;">
              <span style="font-size:13px;">${perfis.find(p=>p.id===perfil)?.icon||'👤'} ${perfis.find(p=>p.id===perfil)?.nome||perfil}</span><br>
              <span style="font-size:10px;color:#6c757d;font-family:monospace;">${perfil}</span>
            </td>`:''}
            <td>${safeText(u.nome_completo)}</td>
            <td style="font-family:monospace;font-size:12px;">${safeText(u.username)}</td>
            <td>${safeText(resolveIgreja(u))}</td>
            <td>${safeText(resolveDepto(u))}</td>
            <td>${u.activo!==false&&String(u.activo||'').toUpperCase()!=='FALSE'?'<span class="badge badge-success">✅ Activo</span>':'<span class="badge badge-danger">🚫 Inactivo</span>'}</td>
          </tr>`)
        ).join('')}</tbody>
      </table></div>`;
    },function(err){ const w=document.getElementById('perfisUtilWrap'); if(w) w.innerHTML=`<div class="err">❌ ${err?.message}</div>`; });
  });
}

/* ── Utilizadores ── */
function adminUtilizadores(){
  const wrap=document.getElementById('adminContentWrap');
  wrap.innerHTML=`<div class="box" style="margin-top:0;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <strong>👥 Utilizadores</strong>
      <button class="success" style="width:auto;margin-top:0;padding:9px 18px;" onclick="mostrarFormUtilizador()">＋ Novo</button>
    </div>
    <div id="utilTableWrap" class="muted">A carregar...</div>
  </div>`;
  getOpts(function(opts){
    serverCall('User_list',[],function(res){
      const rows=Array.isArray(res)?res:[];
      const w=document.getElementById('utilTableWrap'); if(!w) return;
      if(!rows.length){ w.innerHTML='<div class="info">ℹ️ Sem utilizadores.</div>'; return; }

      const igrejaMap={};
      (opts?.igrejas||[]).forEach(i=>{ igrejaMap[String(i.id_igreja)]=i.nome_igreja; });
      const deptoMap={};
      (opts?.departamentos||[]).forEach(d=>{ deptoMap[String(d.id_departamento)]=d.nome_departamento; });
      const resolveIg=u=>u.nome_igreja||igrejaMap[String(u.id_igreja||'')]||safeText(u.id_igreja);
      const resolveDep=u=>u.nome_departamento||deptoMap[String(u.id_departamento||'')]||safeText(u.id_departamento);

      w.innerHTML=`<div style="overflow-x:auto;"><table>
        <thead><tr><th>Nome</th><th>Username</th><th>Perfil</th><th>Igreja</th><th>Departamento</th><th>Estado</th><th>Acções</th></tr></thead>
        <tbody>${rows.map(u=>{
          const activo=u.activo!==false&&String(u.activo||'').toUpperCase()!=='FALSE';
          return `<tr>
            <td>${safeText(u.nome_completo)}</td>
            <td>${safeText(u.username)}</td>
            <td><span class="badge badge-info">${safeText(u.id_perfil)}</span></td>
            <td>${resolveIg(u)}</td>
            <td>${resolveDep(u)}</td>
            <td>${activo?'<span class="badge badge-success">✅ Activo</span>':'<span class="badge badge-danger">🚫 Inactivo</span>'}</td>
            <td class="row-actions">
              <button class="${activo?'danger':'success'}" style="font-size:12px;padding:6px 10px;min-height:32px;"
                onclick="toggleUtilizador('${u.id_utilizador}')">${activo?'🚫 Desactivar':'✅ Activar'}</button>
            </td></tr>`;
        }).join('')}</tbody></table></div>`;
    },function(err){ const w=document.getElementById('utilTableWrap'); if(w) w.innerHTML=`<div class="err">❌ ${err?.message}</div>`; });
  });
}

function mostrarFormUtilizador(){
  serverCall('User_getFormOptions',[],function(opts){
    const perfis=Array.isArray(opts?.perfis)?opts.perfis:['ADMIN_GERAL','ADMIN_DISTRITAL','TESOUREIRO_DISTRITAL','TESOUREIRO_LOCAL','APROVADOR','VISUALIZADOR'];
    const perfisOpts=perfis.map(p=>typeof p==='string'
      ?`<option value="${p}">${p}</option>`
      :`<option value="${p.id_perfil}">${safeText(p.nome_perfil||p.id_perfil)}</option>`
    ).join('');
    const igrejas=Array.isArray(opts?.igrejas)?opts.igrejas:(_opts?.igrejas||[]);
    const deptos=Array.isArray(opts?.departamentos)?opts.departamentos:(_opts?.departamentos||[]);
    renderFormUtil(perfisOpts,igrejas,deptos);
  },function(){
    const fallbackOpts=['ADMIN_GERAL','ADMIN_DISTRITAL','TESOUREIRO_DISTRITAL','TESOUREIRO_LOCAL','APROVADOR','VISUALIZADOR']
      .map(p=>`<option value="${p}">${p}</option>`).join('');
    renderFormUtil(fallbackOpts,_opts?.igrejas||[],_opts?.departamentos||[]);
  });
}

function renderFormUtil(perfisOpts,igrejas,deptos){
  const wrap=document.getElementById('adminContentWrap');
  wrap.innerHTML=`<div class="box" style="margin-top:0;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
      <button class="secondary" style="width:auto;margin-top:0;padding:8px 16px;font-size:14px;" onclick="adminTab('utilizadores')">← Voltar à lista</button>
      <strong style="font-size:16px;">＋ Novo Utilizador</strong>
    </div>
    <div id="msgUtil" class="msg" style="margin-bottom:4px;"></div>
    <div class="section-grid">
      <div>
        <label>Nome Completo *</label><input type="text" id="fu_nome" placeholder="Nome completo">
        <label>Username *</label><input type="text" id="fu_username" placeholder="username">
        <label>Palavra-passe *</label><input type="password" id="fu_pass" placeholder="••••••••">
        <label>E-mail</label><input type="email" id="fu_email" placeholder="email@exemplo.com">
      </div>
      <div>
        <label>Perfil *</label>
        <select id="fu_perfil">${perfisOpts}</select>
        <label>Igreja</label>
        <select id="fu_igreja"><option value="">Sem igreja específica</option>${igrejas.map(i=>`<option value="${i.id_igreja}">${safeText(i.nome_igreja)}</option>`).join('')}</select>
        <label>Departamento</label>
        <select id="fu_depto"><option value="">Sem departamento específico</option>${deptos.map(d=>`<option value="${d.id_departamento}">${safeText(d.nome_departamento)}</option>`).join('')}</select>
      </div>
    </div>
    <hr class="soft">
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="secondary" style="width:auto;margin-top:0;padding:11px 22px;" onclick="adminTab('utilizadores')">✖ Cancelar</button>
      <button class="success" style="width:auto;margin-top:0;padding:11px 22px;" onclick="guardarUtilizador()">💾 Criar Utilizador</button>
    </div>
  </div>`;
}
function guardarUtilizador(){
  const nome=document.getElementById('fu_nome')?.value?.trim();
  const uname=document.getElementById('fu_username')?.value?.trim();
  const pass=document.getElementById('fu_pass')?.value;
  const email=document.getElementById('fu_email')?.value?.trim();
  const perfil=document.getElementById('fu_perfil')?.value;
  const igreja=document.getElementById('fu_igreja')?.value;
  const depto=document.getElementById('fu_depto')?.value;
  if(!nome||!uname||!pass||!perfil){ showMessage('❌ Preencha os campos obrigatórios.',false,'msgUtil'); return; }
  showMessage('⏳ A criar...',true,'msgUtil');
  serverCall('User_create',[{nome_completo:nome,username:uname,password:pass,email,id_perfil:perfil,id_igreja:igreja||'',id_departamento:depto||''}],function(){
    showMessage('✅ Utilizador criado!',true,'msgUtil'); invalidarCache();
    setTimeout(()=>{ adminTab('utilizadores'); },1200);
  },function(err){ showMessage('❌ '+err?.message,false,'msgUtil'); });
}
function toggleUtilizador(id){
  confirmar('Alterar estado deste utilizador?', function(){
    serverCall('User_toggleActive',[id],function(){ adminUtilizadores(); },
      function(err){ mostrarErro(err?.message||'Falha'); });
  });
}

/* ── Departamentos ── */
function adminDepartamentos(){
  const wrap=document.getElementById('adminContentWrap');
  wrap.innerHTML=`<div class="box" style="margin-top:0;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <strong>🏢 Departamentos</strong>
      <button class="success" style="width:auto;margin-top:0;padding:9px 18px;" onclick="mostrarFormDepto()">＋ Novo</button>
    </div>
    <div id="deptoTableWrap" class="muted">A carregar...</div>
  </div>`;
  serverCall('Departamento_list',[],function(res){
    const rows=Array.isArray(res)?res:[];
    const w=document.getElementById('deptoTableWrap'); if(!w) return;
    if(!rows.length){ w.innerHTML='<div class="info">ℹ️ Sem departamentos.</div>'; return; }
    w.innerHTML=`<div style="overflow-x:auto;"><table>
      <thead><tr><th>Nome</th><th>Código</th><th>Tipo</th><th>Responsável</th><th>Estado</th><th>Acções</th></tr></thead>
      <tbody>${rows.map(d=>{
        const activo=String(d.estado||'').toUpperCase()!=='INACTIVO';
        return `<tr>
          <td><strong>${safeText(d.nome_departamento)}</strong></td>
          <td>${safeText(d.codigo_departamento||d.id_departamento)}</td>
          <td>${safeText(d.tipo||'-')}</td>
          <td>${safeText(d.responsavel_nome||'-')}</td>
          <td>${activo?'<span class="badge badge-success">✅ Activo</span>':'<span class="badge badge-danger">🚫 Inactivo</span>'}</td>
          <td class="row-actions">
            <button class="${activo?'danger':'success'}" style="font-size:12px;padding:6px 10px;min-height:32px;"
              onclick="toggleDepto('${d.id_departamento}')">${activo?'🚫 Desactivar':'✅ Activar'}</button>
          </td></tr>`;
      }).join('')}</tbody></table></div>`;
    // invalidar cache para forçar reload de nomes na próxima chamada
    _opts=null;
  },function(err){ const w=document.getElementById('deptoTableWrap'); if(w) w.innerHTML=`<div class="err">❌ ${err?.message}</div>`; });
}
function mostrarFormDepto(){
  const wrap=document.getElementById('adminContentWrap');
  wrap.innerHTML=`<div class="box" style="margin-top:0;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
      <button class="secondary" style="width:auto;margin-top:0;padding:8px 16px;font-size:14px;" onclick="adminTab('departamentos')">← Voltar à lista</button>
      <strong style="font-size:16px;">＋ Novo Departamento</strong>
    </div>
    <div id="msgDepto" class="msg" style="margin-bottom:4px;"></div>
    <div class="section-grid">
      <div>
        <label>Nome *</label><input type="text" id="fd_nome" placeholder="Nome do departamento">
        <label>Código</label><input type="text" id="fd_codigo" placeholder="Ex: DEP-001">
      </div>
      <div>
        <label>Tipo</label><input type="text" id="fd_tipo" placeholder="Ex: Pastoral, Financeiro...">
        <label>Responsável</label><input type="text" id="fd_resp" placeholder="Nome do responsável">
      </div>
    </div>
    <hr class="soft">
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="secondary" style="width:auto;margin-top:0;padding:11px 22px;" onclick="adminTab('departamentos')">✖ Cancelar</button>
      <button class="success" style="width:auto;margin-top:0;padding:11px 22px;" onclick="guardarDepto()">💾 Criar Departamento</button>
    </div>
  </div>`;
}
function guardarDepto(){
  const nome=document.getElementById('fd_nome')?.value?.trim();
  const codigo=document.getElementById('fd_codigo')?.value?.trim();
  const tipo=document.getElementById('fd_tipo')?.value?.trim();
  const resp=document.getElementById('fd_resp')?.value?.trim();
  if(!nome){ showMessage('❌ O nome é obrigatório.',false,'msgDepto'); return; }
  showMessage('⏳ A criar...',true,'msgDepto');
  serverCall('Departamento_create',[{nome_departamento:nome,codigo_departamento:codigo,tipo,responsavel_nome:resp}],function(){
    showMessage('✅ Departamento criado!',true,'msgDepto'); invalidarCache();
    setTimeout(()=>{ adminTab('departamentos'); },1200);
  },function(err){ showMessage('❌ '+err?.message,false,'msgDepto'); });
}
function toggleDepto(id){
  confirmar('Alterar estado deste departamento?', function(){
    serverCall('Departamento_toggleActive',[id],function(){ invalidarCache(); adminDepartamentos(); },
      function(err){ mostrarErro(err?.message||'Falha'); });
  });
}

/* ── Igrejas ── */
function adminIgrejas(){
  const wrap=document.getElementById('adminContentWrap');
  wrap.innerHTML=`<div class="box" style="margin-top:0;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <strong>⛪ Igrejas</strong>
      <button class="success" style="width:auto;margin-top:0;padding:9px 18px;" onclick="mostrarFormIgreja()">＋ Nova</button>
    </div>
    <div id="igrejaTableWrap" class="muted">A carregar...</div>
  </div>`;
  serverCall('Igreja_list',[],function(res){
    const rows=Array.isArray(res)?res:[];
    const w=document.getElementById('igrejaTableWrap'); if(!w) return;
    if(!rows.length){ w.innerHTML='<div class="info">ℹ️ Sem igrejas.</div>'; return; }
    w.innerHTML=`<div style="overflow-x:auto;"><table>
      <thead><tr><th>Nome</th><th>Código</th><th>Zona</th><th>Tesoureiro</th><th>Estado</th><th>Acções</th></tr></thead>
      <tbody>${rows.map(g=>{
        const activa=String(g.estado||'').toUpperCase()!=='INACTIVA';
        return `<tr>
          <td><strong>${safeText(g.nome_igreja)}</strong></td>
          <td>${safeText(g.codigo_igreja||g.id_igreja)}</td>
          <td>${safeText(g.zona||'-')}</td>
          <td>${safeText(g.tesoureiro_nome||'-')}</td>
          <td>${activa?'<span class="badge badge-success">✅ Activa</span>':'<span class="badge badge-danger">🚫 Inactiva</span>'}</td>
          <td class="row-actions">
            <button class="${activa?'danger':'success'}" style="font-size:12px;padding:6px 10px;min-height:32px;"
              onclick="toggleIgreja('${g.id_igreja}')">${activa?'🚫 Desactivar':'✅ Activar'}</button>
          </td></tr>`;
      }).join('')}</tbody></table></div>`;
    _opts=null;
  },function(err){ const w=document.getElementById('igrejaTableWrap'); if(w) w.innerHTML=`<div class="err">❌ ${err?.message}</div>`; });
}
function mostrarFormIgreja(){
  const wrap=document.getElementById('adminContentWrap');
  wrap.innerHTML=`<div class="box" style="margin-top:0;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
      <button class="secondary" style="width:auto;margin-top:0;padding:8px 16px;font-size:14px;" onclick="adminTab('igrejas')">← Voltar à lista</button>
      <strong style="font-size:16px;">＋ Nova Igreja</strong>
    </div>
    <div id="msgIgreja" class="msg" style="margin-bottom:4px;"></div>
    <div class="section-grid">
      <div>
        <label>Nome *</label><input type="text" id="fi_nome" placeholder="Nome da igreja">
        <label>Código</label><input type="text" id="fi_codigo" placeholder="Ex: IGR-001">
        <label>Zona</label><input type="text" id="fi_zona" placeholder="Ex: Norte, Sul...">
      </div>
      <div>
        <label>Circuito</label><input type="text" id="fi_circuito" placeholder="Circuito">
        <label>Tesoureiro</label><input type="text" id="fi_tes" placeholder="Nome do tesoureiro">
        <label>Contacto</label><input type="text" id="fi_cont" placeholder="Telefone">
      </div>
    </div>
    <hr class="soft">
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="secondary" style="width:auto;margin-top:0;padding:11px 22px;" onclick="adminTab('igrejas')">✖ Cancelar</button>
      <button class="success" style="width:auto;margin-top:0;padding:11px 22px;" onclick="guardarIgreja()">💾 Criar Igreja</button>
    </div>
  </div>`;
}
function guardarIgreja(){
  const nome=document.getElementById('fi_nome')?.value?.trim();
  const codigo=document.getElementById('fi_codigo')?.value?.trim();
  const zona=document.getElementById('fi_zona')?.value?.trim();
  const circuito=document.getElementById('fi_circuito')?.value?.trim();
  const tes=document.getElementById('fi_tes')?.value?.trim();
  const cont=document.getElementById('fi_cont')?.value?.trim();
  if(!nome){ showMessage('❌ O nome é obrigatório.',false,'msgIgreja'); return; }
  showMessage('⏳ A criar...',true,'msgIgreja');
  serverCall('Igreja_create',[{nome_igreja:nome,codigo_igreja:codigo,zona,circuito,tesoureiro_nome:tes,tesoureiro_contacto:cont}],function(){
    showMessage('✅ Igreja criada!',true,'msgIgreja'); invalidarCache();
    setTimeout(()=>{ adminTab('igrejas'); },1200);
  },function(err){ showMessage('❌ '+err?.message,false,'msgIgreja'); });
}
function toggleIgreja(id){
  confirmar('Alterar estado desta igreja?', function(){
    serverCall('Igreja_toggleActive',[id],function(){ invalidarCache(); adminIgrejas(); },
      function(err){ mostrarErro(err?.message||'Falha'); });
  });
}

/* ══════════════════════════════════════════════════════
   SALDOS INICIAIS (Migração de dados)
══════════════════════════════════════════════════════ */

function adminSaldosIniciais(){
  const wrap=document.getElementById('adminContentWrap');
  wrap.innerHTML=`
    <div class="box" style="margin-top:0;">
      <div style="margin-bottom:18px;">
        <strong style="font-size:15px;">🏦 Saldos Iniciais — Migração de Dados</strong>
        <p class="muted" style="margin:6px 0 0;">Introduza os saldos de abertura para transferir os dados do sistema anterior para este. Os saldos serão usados como ponto de partida nos relatórios e no dashboard.</p>
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:12px 14px;margin-top:12px;font-size:13px;color:#856404;">
          ⚠️ <strong>Atenção:</strong> Certifique-se de que os valores estão correctos antes de guardar. Introduza saldos positivos para saldos a favor e negativos para saldos a descoberto.
        </div>
      </div>

      <!-- Sub-tabs -->
      <div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;">
        <button id="stab_deptos" class="info" style="width:auto;margin-top:0;padding:9px 20px;font-size:14px;" onclick="saldosTab('deptos')">🏢 Por Departamento</button>
        <button id="stab_rubricas" class="secondary" style="width:auto;margin-top:0;padding:9px 20px;font-size:14px;" onclick="saldosTab('rubricas')">📂 Por Rubrica</button>
        <button id="stab_lista" class="secondary" style="width:auto;margin-top:0;padding:9px 20px;font-size:14px;" onclick="saldosTab('lista')">📋 Ver Todos</button>
      </div>

      <div id="saldosContentWrap"></div>
    </div>`;

  saldosTab('deptos');
}

function saldosTab(tab){
  ['deptos','rubricas','lista'].forEach(t=>{
    const btn=document.getElementById('stab_'+t);
    if(!btn) return;
    btn.className=t===tab?'info':'secondary';
    btn.style.cssText='width:auto;margin-top:0;padding:9px 20px;font-size:14px;';
  });
  if(tab==='deptos')   saldosFormDeptos();
  if(tab==='rubricas') saldosFormRubricas();
  if(tab==='lista')    saldosListaTodos();
}

/* ── Formulário: saldo inicial por Departamento ── */
function saldosFormDeptos(){
  const wrap=document.getElementById('saldosContentWrap'); if(!wrap) return;
  wrap.innerHTML='<div class="muted">⏳ A carregar departamentos...</div>';

  getOpts(function(opts){
    const deptos=(opts?.departamentos||[]).filter(d=>String(d.estado||'').toUpperCase()!=='INACTIVO');
    const igrejas=opts?.igrejas||[];

    if(!deptos.length){ wrap.innerHTML='<div class="info">ℹ️ Sem departamentos activos. Crie departamentos primeiro.</div>'; return; }

    const ano=new Date().getFullYear();
    let anosH=''; for(let a=ano;a>=ano-5;a--) anosH+=`<option value="${a}"${a===ano?' selected':''}>${a}</option>`;

    const igrejaOpts='<option value="">Global / Todos</option>'+igrejas.map(i=>`<option value="${i.id_igreja}">${safeText(i.nome_igreja)}</option>`).join('');

    wrap.innerHTML=`
      <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
          <div style="flex:1;min-width:130px;">
            <label style="margin:0 0 6px;display:block;font-size:13px;">📅 Ano de Referência</label>
            <select id="si_ano_d" style="padding:9px 12px;">${anosH}</select>
          </div>
          <div style="flex:2;min-width:160px;">
            <label style="margin:0 0 6px;display:block;font-size:13px;">⛪ Igreja (opcional)</label>
            <select id="si_igr_d" style="padding:9px 12px;">${igrejaOpts}</select>
          </div>
        </div>
      </div>

      <div id="msgSaldoD" class="msg" style="margin-bottom:8px;"></div>

      <div style="overflow-x:auto;">
        <table id="tblSaldoDeptos">
          <thead>
            <tr>
              <th>Departamento</th>
              <th style="text-align:right;min-width:180px;">Saldo Inicial (MZN)</th>
              <th style="min-width:220px;">Observação</th>
            </tr>
          </thead>
          <tbody>
            ${deptos.map(d=>`
              <tr>
                <td>
                  <strong>${safeText(d.nome_departamento)}</strong>
                  <div style="font-size:11px;color:#6c757d;">${safeText(d.codigo_departamento||d.id_departamento)}</div>
                </td>
                <td>
                  <input type="number" step="0.01"
                    id="sid_val_${d.id_departamento}"
                    placeholder="0,00"
                    style="text-align:right;padding:9px 12px;border-radius:8px;border:2px solid #e0e0e0;font-size:14px;font-weight:600;width:100%;min-width:160px;">
                </td>
                <td>
                  <input type="text"
                    id="sid_obs_${d.id_departamento}"
                    placeholder="Ex: Saldo de transferência do sistema anterior"
                    style="padding:9px 12px;border-radius:8px;border:2px solid #e0e0e0;font-size:13px;width:100%;min-width:200px;">
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="secondary" style="width:auto;margin-top:0;padding:11px 22px;" onclick="saldosLimparFormDeptos(${JSON.stringify(deptos.map(d=>d.id_departamento))})">🧹 Limpar Campos</button>
        <button class="success" style="width:auto;margin-top:0;padding:11px 26px;" onclick="saldosGuardarDeptos(${JSON.stringify(deptos.map(d=>d.id_departamento))})">💾 Guardar Saldos de Departamentos</button>
      </div>
      <p class="muted" style="margin-top:10px;font-size:12px;">Deixe o campo em branco (ou zero) para não alterar o saldo desse departamento.</p>`;

    // Pré-carregar saldos existentes
    saldosPreencherDeptos(deptos.map(d=>d.id_departamento));
  });
}

function saldosPreencherDeptos(ids){
  serverCall('SaldoInicial_listDeptos',[],function(res){
    const lista=Array.isArray(res)?res:[];
    lista.forEach(function(item){
      const vid=document.getElementById('sid_val_'+item.id_departamento);
      const oid=document.getElementById('sid_obs_'+item.id_departamento);
      if(vid && item.saldo_inicial!=null && item.saldo_inicial!=='') vid.value=item.saldo_inicial;
      if(oid && item.observacao) oid.value=item.observacao;
    });
  },function(){ /* silencioso — backend pode ainda não ter a função */ });
}

function saldosLimparFormDeptos(ids){
  ids.forEach(function(id){
    const v=document.getElementById('sid_val_'+id);
    const o=document.getElementById('sid_obs_'+id);
    if(v) v.value='';
    if(o) o.value='';
  });
  showMessage('🧹 Campos limpos.',true,'msgSaldoD');
}

function saldosGuardarDeptos(ids){
  const ano=Number(document.getElementById('si_ano_d')?.value||new Date().getFullYear());
  const igreja=document.getElementById('si_igr_d')?.value||'';

  const entradas=[];
  ids.forEach(function(id){
    const raw=document.getElementById('sid_val_'+id)?.value?.trim();
    if(raw===''||raw===null||raw===undefined) return;
    const val=parseFloat(raw);
    if(isNaN(val)) return;
    const obs=document.getElementById('sid_obs_'+id)?.value?.trim()||'';
    entradas.push({id_departamento:id, saldo_inicial:val, ano, id_igreja:igreja, observacao:obs});
  });

  if(!entradas.length){
    showMessage('⚠️ Não foram introduzidos valores. Preencha pelo menos um saldo.',false,'msgSaldoD'); return;
  }

  showMessage(`⏳ A guardar ${entradas.length} saldo(s)...`,true,'msgSaldoD');

  // Guardar sequencialmente com feedback
  let ok=0, erros=0;
  function gravar(i){
    if(i>=entradas.length){
      const msg = erros===0
        ? `✅ ${ok} saldo(s) guardado(s) com sucesso!`
        : `⚠️ ${ok} guardado(s), ${erros} com erro.`;
      showMessage(msg, erros===0,'msgSaldoD');
      if(erros===0) invalidarCache();
      return;
    }
    serverCall('SaldoInicial_set',[entradas[i]],function(){ ok++; gravar(i+1); },
      function(err){ erros++; gravar(i+1); });
  }
  gravar(0);
}

/* ── Formulário: saldo inicial por Rubrica ── */
function saldosFormRubricas(){
  const wrap=document.getElementById('saldosContentWrap'); if(!wrap) return;
  wrap.innerHTML='<div class="muted">⏳ A carregar rubricas...</div>';

  getOpts(function(opts){
    const rubricas=(opts?.rubricas||[]);
    const grupos=(opts?.grupos||[]);
    const igrejas=opts?.igrejas||[];
    const deptos=(opts?.departamentos||[]);

    if(!rubricas.length){ wrap.innerHTML='<div class="info">ℹ️ Sem rubricas disponíveis.</div>'; return; }

    // Agrupar rubricas por grupo
    const grupoMap={};
    grupos.forEach(g=>{ grupoMap[String(g.id_grupo)]=g.nome_grupo; });
    const porGrupo={};
    rubricas.forEach(r=>{
      const gid=String(r.id_grupo||'Sem Grupo');
      if(!porGrupo[gid]) porGrupo[gid]=[];
      porGrupo[gid].push(r);
    });

    const ano=new Date().getFullYear();
    let anosH=''; for(let a=ano;a>=ano-5;a--) anosH+=`<option value="${a}"${a===ano?' selected':''}>${a}</option>`;

    const igrejaOpts='<option value="">Global / Todos</option>'+igrejas.map(i=>`<option value="${i.id_igreja}">${safeText(i.nome_igreja)}</option>`).join('');
    const deptoOpts='<option value="">Todos / N/A</option>'+deptos.map(d=>`<option value="${d.id_departamento}">${safeText(d.nome_departamento)}</option>`).join('');

    // Construir linhas agrupadas por grupo
    let tbodyHTML='';
    Object.keys(porGrupo).forEach(function(gid){
      const nomeGrupo = grupoMap[gid]||gid;
      tbodyHTML+=`<tr style="background:#f0f4ff;">
        <td colspan="3" style="padding:8px 10px;font-weight:700;color:#123b7a;font-size:12px;letter-spacing:0.5px;">
          📁 ${safeText(nomeGrupo)}
        </td>
      </tr>`;
      porGrupo[gid].forEach(function(r){
        const tipo=r.tipo_movimento==='ENTRADA'?'<span style="color:#28a745;font-size:11px;">📈 Entrada</span>':
                   r.tipo_movimento==='SAIDA'?'<span style="color:#dc3545;font-size:11px;">📉 Saída</span>':
                   '<span style="color:#6c757d;font-size:11px;">—</span>';
        tbodyHTML+=`<tr>
          <td style="padding-left:20px;">
            <strong>${safeText(r.nome_rubrica)}</strong>&nbsp;${tipo}
            <div style="font-size:11px;color:#6c757d;">${safeText(r.codigo_rubrica||r.id_rubrica)}</div>
          </td>
          <td>
            <input type="number" step="0.01"
              id="sir_val_${r.id_rubrica}"
              placeholder="0,00"
              style="text-align:right;padding:9px 12px;border-radius:8px;border:2px solid #e0e0e0;font-size:14px;font-weight:600;width:100%;min-width:150px;">
          </td>
          <td>
            <input type="text"
              id="sir_obs_${r.id_rubrica}"
              placeholder="Observação (opcional)"
              style="padding:9px 12px;border-radius:8px;border:2px solid #e0e0e0;font-size:13px;width:100%;min-width:190px;">
          </td>
        </tr>`;
      });
    });

    wrap.innerHTML=`
      <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
          <div style="flex:1;min-width:120px;">
            <label style="margin:0 0 6px;display:block;font-size:13px;">📅 Ano</label>
            <select id="si_ano_r" style="padding:9px 12px;">${anosH}</select>
          </div>
          <div style="flex:2;min-width:150px;">
            <label style="margin:0 0 6px;display:block;font-size:13px;">⛪ Igreja</label>
            <select id="si_igr_r" style="padding:9px 12px;">${igrejaOpts}</select>
          </div>
          <div style="flex:2;min-width:160px;">
            <label style="margin:0 0 6px;display:block;font-size:13px;">🏢 Departamento</label>
            <select id="si_dep_r" style="padding:9px 12px;">${deptoOpts}</select>
          </div>
        </div>
      </div>

      <div id="msgSaldoR" class="msg" style="margin-bottom:8px;"></div>

      <div style="overflow-x:auto;">
        <table id="tblSaldoRubricas">
          <thead>
            <tr>
              <th>Rubrica</th>
              <th style="text-align:right;min-width:170px;">Saldo Inicial (MZN)</th>
              <th style="min-width:200px;">Observação</th>
            </tr>
          </thead>
          <tbody>${tbodyHTML}</tbody>
        </table>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="secondary" style="width:auto;margin-top:0;padding:11px 22px;" onclick="saldosLimparFormRubricas(${JSON.stringify(rubricas.map(r=>r.id_rubrica))})">🧹 Limpar Campos</button>
        <button class="success" style="width:auto;margin-top:0;padding:11px 26px;" onclick="saldosGuardarRubricas(${JSON.stringify(rubricas.map(r=>r.id_rubrica))})">💾 Guardar Saldos de Rubricas</button>
      </div>
      <p class="muted" style="margin-top:10px;font-size:12px;">Deixe o campo em branco (ou zero) para não alterar o saldo dessa rubrica.</p>`;

    // Pré-carregar saldos existentes
    saldosPreencherRubricas();
  });
}

function saldosPreencherRubricas(){
  serverCall('SaldoInicial_listRubricas',[],function(res){
    const lista=Array.isArray(res)?res:[];
    lista.forEach(function(item){
      const vid=document.getElementById('sir_val_'+item.id_rubrica);
      const oid=document.getElementById('sir_obs_'+item.id_rubrica);
      if(vid && item.saldo_inicial!=null && item.saldo_inicial!=='') vid.value=item.saldo_inicial;
      if(oid && item.observacao) oid.value=item.observacao;
    });
  },function(){ /* silencioso */ });
}

function saldosLimparFormRubricas(ids){
  ids.forEach(function(id){
    const v=document.getElementById('sir_val_'+id);
    const o=document.getElementById('sir_obs_'+id);
    if(v) v.value='';
    if(o) o.value='';
  });
  showMessage('🧹 Campos limpos.',true,'msgSaldoR');
}

function saldosGuardarRubricas(ids){
  const ano=Number(document.getElementById('si_ano_r')?.value||new Date().getFullYear());
  const igreja=document.getElementById('si_igr_r')?.value||'';
  const depto=document.getElementById('si_dep_r')?.value||'';

  const entradas=[];
  ids.forEach(function(id){
    const raw=document.getElementById('sir_val_'+id)?.value?.trim();
    if(raw===''||raw===null||raw===undefined) return;
    const val=parseFloat(raw);
    if(isNaN(val)) return;
    const obs=document.getElementById('sir_obs_'+id)?.value?.trim()||'';
    entradas.push({id_rubrica:id, saldo_inicial:val, ano, id_igreja:igreja, id_departamento:depto, observacao:obs});
  });

  if(!entradas.length){
    showMessage('⚠️ Não foram introduzidos valores. Preencha pelo menos um saldo.',false,'msgSaldoR'); return;
  }

  showMessage(`⏳ A guardar ${entradas.length} saldo(s)...`,true,'msgSaldoR');

  let ok=0, erros=0;
  function gravar(i){
    if(i>=entradas.length){
      const msg = erros===0
        ? `✅ ${ok} saldo(s) de rubrica guardado(s) com sucesso!`
        : `⚠️ ${ok} guardado(s), ${erros} com erro.`;
      showMessage(msg, erros===0,'msgSaldoR');
      if(erros===0) invalidarCache();
      return;
    }
    serverCall('SaldoInicial_setRubrica',[entradas[i]],function(){ ok++; gravar(i+1); },
      function(err){ erros++; gravar(i+1); });
  }
  gravar(0);
}

/* ── Lista consolidada de todos os saldos iniciais ── */
function saldosListaTodos(){
  const wrap=document.getElementById('saldosContentWrap'); if(!wrap) return;
  wrap.innerHTML='<div class="muted">⏳ A carregar saldos registados...</div>';

  // Carregar deptos e rubricas em paralelo
  let dadosD=null, dadosR=null, erroD=false, erroR=false;

  function tentar(){
    if(dadosD===null||dadosR===null) return; // ainda a aguardar

    wrap.innerHTML='';

    // --- Saldos por Departamento ---
    const secD=document.createElement('div');
    secD.className='box';
    secD.style.marginTop='0';
    const listaD=Array.isArray(dadosD)?dadosD:[];
    if(erroD){
      secD.innerHTML='<strong>🏢 Saldos por Departamento</strong><div class="err" style="margin-top:10px;">❌ Erro ao carregar.</div>';
    } else if(!listaD.length){
      secD.innerHTML='<strong>🏢 Saldos por Departamento</strong><div class="info" style="margin-top:10px;">ℹ️ Sem saldos iniciais de departamentos registados.</div>';
    } else {
      const totalD=listaD.reduce((s,x)=>s+Number(x.saldo_inicial||0),0);
      secD.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <strong>🏢 Saldos por Departamento</strong>
        <span style="font-size:13px;color:#6c757d;">Total: <strong style="color:${totalD>=0?'#28a745':'#dc3545'};">${formatMoney(totalD)}</strong></span>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Departamento</th><th>Ano</th><th>Igreja</th><th style="text-align:right;">Saldo Inicial</th><th>Observação</th><th>Registado em</th><th>Acções</th></tr></thead>
          <tbody>${listaD.map(x=>{
            const v=Number(x.saldo_inicial||0);
            return `<tr>
              <td><strong>${safeText(x.nome_departamento||x.id_departamento)}</strong></td>
              <td>${safeText(x.ano)}</td>
              <td>${safeText(x.nome_igreja||x.id_igreja||'—')}</td>
              <td style="text-align:right;font-weight:700;color:${v>=0?'#28a745':'#dc3545'};">${formatMoney(v)}</td>
              <td style="font-size:12px;color:#6c757d;">${safeText(x.observacao||'—')}</td>
              <td style="font-size:11px;white-space:nowrap;color:#6c757d;">${safeText(x.criado_em||'').split('T')[0]||'—'}</td>
              <td class="row-actions">
                <button class="danger" style="font-size:12px;padding:6px 10px;min-height:32px;"
                  onclick="saldosEliminar('depto','${x.id_saldo||x.id_departamento}','${safeText(x.nome_departamento||x.id_departamento).replace(/'/g,"\\'")}')">🗑️</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
    }
    wrap.appendChild(secD);

    // --- Saldos por Rubrica ---
    const secR=document.createElement('div');
    secR.className='box';
    secR.style.marginTop='16px';
    const listaR=Array.isArray(dadosR)?dadosR:[];
    if(erroR){
      secR.innerHTML='<strong>📂 Saldos por Rubrica</strong><div class="err" style="margin-top:10px;">❌ Erro ao carregar.</div>';
    } else if(!listaR.length){
      secR.innerHTML='<strong>📂 Saldos por Rubrica</strong><div class="info" style="margin-top:10px;">ℹ️ Sem saldos iniciais de rubricas registados.</div>';
    } else {
      const totalR=listaR.reduce((s,x)=>s+Number(x.saldo_inicial||0),0);
      secR.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <strong>📂 Saldos por Rubrica</strong>
        <span style="font-size:13px;color:#6c757d;">Total: <strong style="color:${totalR>=0?'#28a745':'#dc3545'};">${formatMoney(totalR)}</strong></span>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Rubrica</th><th>Grupo</th><th>Ano</th><th>Igreja</th><th>Departamento</th><th style="text-align:right;">Saldo Inicial</th><th>Observação</th><th>Acções</th></tr></thead>
          <tbody>${listaR.map(x=>{
            const v=Number(x.saldo_inicial||0);
            return `<tr>
              <td><strong>${safeText(x.nome_rubrica||x.id_rubrica)}</strong></td>
              <td style="font-size:12px;">${safeText(x.nome_grupo||'—')}</td>
              <td>${safeText(x.ano)}</td>
              <td style="font-size:12px;">${safeText(x.nome_igreja||x.id_igreja||'—')}</td>
              <td style="font-size:12px;">${safeText(x.nome_departamento||x.id_departamento||'—')}</td>
              <td style="text-align:right;font-weight:700;color:${v>=0?'#28a745':'#dc3545'};">${formatMoney(v)}</td>
              <td style="font-size:12px;color:#6c757d;">${safeText(x.observacao||'—')}</td>
              <td class="row-actions">
                <button class="danger" style="font-size:12px;padding:6px 10px;min-height:32px;"
                  onclick="saldosEliminar('rubrica','${x.id_saldo||x.id_rubrica}','${safeText(x.nome_rubrica||x.id_rubrica).replace(/'/g,"\\'")}')">🗑️</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
    }
    wrap.appendChild(secR);
  }

  serverCall('SaldoInicial_listDeptos',[],
    function(res){ dadosD=res; tentar(); },
    function(){ dadosD=[]; erroD=true; tentar(); });

  serverCall('SaldoInicial_listRubricas',[],
    function(res){ dadosR=res; tentar(); },
    function(){ dadosR=[]; erroR=true; tentar(); });
}

function saldosEliminar(tipo, id, nome){
  confirmar(`Eliminar o saldo inicial de <strong>${nome}</strong>? Esta acção é irreversível.`, function(){
    const fn=tipo==='rubrica'?'SaldoInicial_delete':'SaldoInicial_delete';
    serverCall(fn,[{tipo, id}],function(){
      invalidarCache();
      saldosListaTodos();
    },function(err){ mostrarErro(err?.message||'Falha ao eliminar'); });
  });
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */

window.addEventListener('load',function(){
  const rawUser=sessionStorage.getItem('app_user');
  const rawMenu=sessionStorage.getItem('app_menu');
  if(rawUser){ renderApp(JSON.parse(rawUser),rawMenu?JSON.parse(rawMenu):[]); }
});
document.addEventListener('DOMContentLoaded',function(){
  const pwd=document.getElementById('password');
  const usr=document.getElementById('username');
  if(pwd) pwd.addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
  if(usr) usr.addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
});
