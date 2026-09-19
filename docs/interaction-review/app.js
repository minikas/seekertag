import {scenarios, inventory, refs} from './data.js';

const main=document.querySelector('#main');
const nav=document.querySelector('#scenario-nav');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel={corrigir:'Corrigir',refinar:'Refinar',manter:'Manter'};
let scenario=scenarios[0], index=scenario.start, view='simulacao';
let values;
function resetValues(){values={before:{message:'Posso buscar às 18h.',name:'Mochila verde',note:'Bolso lateral com chaveiro',amount:'0,05',currency:'SOL',category:'Bicicleta'},after:{message:'Posso buscar às 18h.',name:'Mochila verde',note:'Bolso lateral com chaveiro',amount:'0,05',currency:'SOL',category:'Bicicleta'}};}
resetValues();
const titles={home:'Meus objetos',detail:'Sua etiqueta',form:'Editar objeto',categories:'Categorias',categoryEditor:'Editar categoria',options:'Opções do objeto',reward:'Recompensa',currency:'Selecionar moeda',period:'Unidade do prazo',review:'Revisar depósito',reviewRenew:'Revisar renovação',reviewRelease:'Revisar pagamento',expired:'Reserva expirada',renew:'Renovar reserva',messages:'Conversas',chat:'Conversa · Mochila',notifications:'Notificações',preview:'Prévia como visitante',found:'Devolver objeto',finderChat:'Conversa com o dono',scanner:'Ler etiqueta',receiving:'Recompensa do objeto',address:'Sua carteira de recebimento',release:'Devolução e recompensa',account:'Minha conta',access:'Formas de entrar',theme:'Aparência',tags:'Tags',tagsFiltered:'Tags · Protegidos',nfc:'Gravar NFC',share:'Compartilhar',transfer:'Transferir etiqueta',lost:'Marcar como perdido?',delete:'Excluir categoria?',welcome:'SeekerTag',login:'Entrar no SeekerTag',help:'Como funciona',help2:'Como funciona',wallet:'Carteira externa'};
const row=(title,sub='',icon='◇')=>`<div class="wire-row"><span class="row-icon" aria-hidden="true">${icon}</span><span class="row-text"><strong>${esc(title)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</span><span aria-hidden="true">›</span></div>`;
const card=(title,sub='')=>`<div class="wire-card"><strong style="font-size:12px">${esc(title)}</strong>${sub?`<p class="wire-muted">${esc(sub)}</p>`:''}</div>`;
const muted=t=>`<p class="wire-muted">${esc(t)}</p>`;
const title=t=>`<p class="wire-title">${esc(t)}</p>`;
const field=(label,key,side,multiline=false)=>`<label class="wire-field">${esc(label)}${multiline?`<textarea data-field="${key}" data-side="${side}" rows="2">${esc(values[side][key]||'')}</textarea>`:`<input data-field="${key}" data-side="${side}" value="${esc(values[side][key]||'')}" autocomplete="off">`}</label>`;
function tabs(active,side){return `<div class="wire-tabs" aria-label="Abas ilustrativas">${['Meus objetos','Conversas','Tags'].map((x,i)=>`<span class="${active===i?'active':''}">${side==='before'?['⌂','◌','◇'][i]:esc(x)}</span>`).join('')}</div>`;}
function screenContent(screen,side){
  const currency=values[side].currency;
  switch(screen){
    case 'home':return title('Meus objetos')+`<div class="wire-stats"><div><b>3</b>Protegidos</div><div><b>1</b>Perdido</div><div><b>2</b>Reencontrados</div></div>`+card('＋ Adicionar objeto','Crie uma etiqueta para o que é seu.')+row('Mochila verde','Mochilas · protegido','▧')+row('Minhas chaves','Chaves · protegido','⚿')+row('Fone de ouvido','Eletrônicos · perdido','◉');
    case 'detail':return title('Mochila verde')+muted('Mochilas · Protegido')+`<div class="qr" aria-label="QR ilustrativo, sem link real"></div>`+muted('Escaneie para abrir a página deste objeto.')+`<div class="wire-stats"><div>↓ PDF</div><div>◉ NFC</div><div>↗ Compartilhar</div></div>`+card('Recompensa reservada','0,05 SOL · cenário fictício');
    case 'form':return field('Nome do objeto','name',side)+row('Mochilas','Categoria selecionada','▧')+field('Anotação particular','note',side)+card('Mensagem na etiqueta','Obrigado por cuidar do que é importante para mim.')+row('Recompensa (opcional)',`${values[side].amount} ${currency}`,'◇');
    case 'categories':return muted('Organize seus objetos do seu jeito.')+row('Mochilas','2 objetos','▧')+row('Chaves','1 objeto','⚿')+row(values[side].category,'Categoria personalizada','◇');
    case 'categoryEditor':return field('Nome da categoria','category',side)+muted('Ícone')+`<div class="wire-stats"><div>▧</div><div>⚿</div><div>◇</div><div>◉</div></div>`+muted('Cor')+`<div class="wire-stats"><div style="background:#bac5b3">✓</div><div style="background:#bcc4ca">○</div><div style="background:#ccbfb5">○</div></div>`+card('Prévia da categoria',values[side].category);
    case 'options':return row('Detalhes do objeto')+row('Editar objeto')+row('Ver como visitante')+row('Compartilhar PDF')+row('Marcar como perdido')+row('Arquivar objeto')+row('Transferir etiqueta');
    case 'reward':return field('Valor da recompensa','amount',side)+row(currency,'Moeda selecionada','◈')+`<div class="wire-stats"><div>25%</div><div>50%</div><div>75%</div><div>Máx.</div></div>`+card('Prazo da reserva','30 dias')+muted('Escolha o valor e o prazo antes de revisar o depósito.');
    case 'currency':return row('SOL','Solana',currency==='SOL'?'✓':'○')+row('USDC','USD Coin',currency==='USDC'?'✓':'○')+row('SKR','Seeker',currency==='SKR'?'✓':'○');
    case 'period':return row('Horas','','○')+row('Dias','','✓')+row('Meses','','○')+row('Anos','','○');
    case 'review':case 'reviewRenew':case 'reviewRelease':return card('DEVNET · exemplo fictício','Nenhuma transação será enviada.')+title(`${values[side].amount} ${currency}`)+row(screen==='reviewRelease'?'Destinatário':'Prazo',screen==='reviewRelease'?'Carteira ilustrativa de quem encontrou':'30 dias')+row('Taxas e custos','Apresentados na revisão real')+muted('A confirmação na carteira é uma etapa separada.');
    case 'wallet':return title('Confirmar na carteira')+card('Aplicativo externo','Assinatura ilustrativa. O protótipo não se conecta a carteiras.')+row('Operação','Depósito · Devnet')+muted('Cancelar deve devolver à mesma revisão, sem criar outra operação.');
    case 'expired':return card('Reserva expirada',`0,05 ${currency}`)+row('Renovar reserva','Definir um novo prazo')+row('Cancelar e recuperar','Disponível após o prazo');
    case 'renew':return muted('Acrescentar ao prazo atual')+card('30 dias','Unidade: dias')+muted('O valor continua reservado. Revise antes de assinar.');
    case 'messages':return title('Conversas')+row('Mochila verde','Ana · Encontrei sua mochila.','◌')+row('Fone de ouvido','Carlos · Podemos combinar?','◌');
    case 'chat':case 'finderChat':return muted(screen==='chat'?'Com Ana · contatos protegidos':'Você está falando com o dono.')+`<div class="bubble">Encontrei sua mochila. Está comigo, tudo certo!</div><div class="bubble own">Que bom! Obrigado por avisar.</div><div class="bubble">Podemos combinar a devolução?</div><div class="wire-spacer"></div>`+field('Mensagem · rascunho editável','message',side,true);
    case 'notifications':return title('Notificações')+muted('1 não lida')+card('Mochila verde · Ana','Encontrei sua mochila. Podemos combinar a devolução?')+row('Fone de ouvido','Conversa atualizada · ontem','◌');
    case 'preview':return title('Mochila verde')+card('Mensagem do dono','Obrigado por cuidar do que é importante para mim.')+card('Esta etiqueta é sua','Você está vendo como seu objeto aparece para quem o encontrar.');
    case 'found':return title('Mochila verde')+card('Mensagem do dono','Me envie uma mensagem para combinarmos a devolução.')+muted('Recompensa · 0,05 SOL')+field('Mensagem para o dono','message',side,true);
    case 'scanner':return `<div style="min-height:190px;border:1px dashed #9aa890;border-radius:16px;display:grid;place-items:center;color:#657857;font-size:12px">Câmera · representação</div>`+muted('Sem acesso à câmera. A leitura abaixo é simulada.')+card('Ou cole o link da etiqueta','https://…/found/…');
    case 'receiving':return card('Recompensa reservada','0,05 SOL')+muted('Informe onde deseja receber a recompensa após a devolução.');
    case 'address':return muted('Endereço fictício; não será salvo.')+`<label class="wire-field">Carteira Solana<input placeholder="Cole o endereço" autocomplete="off"></label>`+muted('Confira o destinatário antes de confirmar. Conectar carteira é opcional.');
    case 'release':return card('Recompensa reservada','0,05 SOL · exemplo')+row('Quem receberá','Carteira ilustrativa de Ana')+muted('Confirme somente se o objeto já estiver com você. O pagamento real é definitivo.');
    case 'account':return title('Minha conta')+card('Testuser','Perfil ilustrativo')+row('Aparência','Automático','◐')+row('Idioma','Português','◎')+row('Rede','Devnet','◈')+row('Formas de entrar')+row('Receber etiquetas')+row('Categorias')+row('Como funciona');
    case 'access':return muted('Escolha como acessar sua conta.')+row('Seeker / Solana','Vinculado à sua conta','✓')+row('Google','Vincular acesso','G')+row('Apple','Vincular acesso','○');
    case 'theme':return row('Igual ao dispositivo','','✓')+row('Claro','','○')+row('Escuro','','○');
    case 'tags':case 'tagsFiltered':return title(screen==='tags'?'4 objetos':'3 objetos')+card('Buscar objetos','Nome ou categoria')+(screen==='tagsFiltered'?muted('Filtro ativo: Protegidos'):'')+row('Mochila verde','Mochilas · protegido','▧')+row('Minhas chaves','Chaves · protegido','⚿')+row('Meu relógio','Acessórios · protegido','◷');
    case 'filter':return row('Todos','4 objetos','○')+row('Protegidos','3 objetos','✓')+row('Perdidos','1 objeto','○')+row('Reencontrados','2 objetos','○')+row('Arquivados','0 objetos','○');
    case 'nfc':return title('Aproxime a etiqueta')+muted('Encoste uma etiqueta NFC regravável na parte de trás do celular.')+card('Aguardando · ilustração','Nenhuma gravação física neste protótipo.');
    case 'share':return muted('Painel do sistema · ilustrativo')+row('Copiar link')+row('Compartilhar em outro app');
    case 'transfer':return card('Mochila verde','Objeto que será transferido')+`<label class="wire-field">ID ou carteira do destinatário<input placeholder="ID da conta ou carteira" autocomplete="off"></label>`+muted('A transferência real exige confirmação de identidade.');
    case 'lost':return muted('Este objeto passará a ser exibido como perdido.')+card('Mochila verde','A ação depende de confirmação.');
    case 'delete':return muted('Escolha para onde mover os objetos desta categoria.')+card('Mochilas','Categoria de destino ilustrativa')+muted('As etiquetas e os QRs serão mantidos.');
    case 'welcome':return `<div style="padding:30px 0;font-size:66px;text-align:center;color:#7d9071">◇</div>`+title('O que é seu, sempre perto.')+muted('Uma etiqueta. Um caminho de volta.');
    case 'login':return row('Continuar com Seeker / Solana','','◈')+row('Continuar com Google','','G')+row('Continuar com Apple','','○');
    case 'help':return muted('ETAPA 1 DE 3')+title('Seu objeto ganha uma identidade')+muted('Adicione um nome e crie sua etiqueta com QR.');
    case 'help2':return muted('ETAPA 2 DE 3')+title('Leve a etiqueta com seu objeto')+muted('Baixe e imprima o QR ou grave uma etiqueta NFC.');
    default:return '';
  }
}
function phone(side){
  const current=scenario.steps[index], layers=current[side];
  return `<div class="phone" data-phone="${side}" role="group" aria-label="${side==='before'?'Atual':'Proposta'}: ${esc(current.label)}"><div class="phone-status"><span>9:41</span><span aria-hidden="true">▴ ▰</span></div><div class="viewport">${layers.map((layer,i)=>{
    const active=i===layers.length-1, modal=['sheet','dialog'].includes(layer.kind);
    const backdrop=modal&&(side==='before'||active)?`<div class="scrim" aria-hidden="true" style="z-index:${i*2}"></div>`:'';
    return `${backdrop}<section class="layer ${layer.kind}" data-screen="${layer.screen}" ${!active?'inert aria-hidden="true"':''} style="top:${layer.top}px;z-index:${i*2+1};${layer.kind==='dialog'?'left:16px;right:16px;':''}">${layer.kind==='sheet'?'<div class="handle" aria-hidden="true"></div>':''}<div class="wire-header">${index>0&&active?`<button class="wire-back" data-action="back" aria-label="Voltar no fluxo ${side==='before'?'atual':'proposto'}">${modal?'×':'←'}</button>`:''}<strong>${esc(titles[layer.screen])}</strong>${side==='after'&&modal?'<span style="font-size:9px;color:#6c7b63">TAREFA</span>':''}</div><div class="wire-body">${screenContent(layer.screen,side)}</div>${active&&current.action?`<div class="wire-footer"><button class="wire-action ${/Cancelar/.test(current.action)?'secondary':''}" data-action="next">${esc(current.action)} <span aria-hidden="true">${/Cancelar|Voltar|Fechar/.test(current.action)?'↩':'→'}</span></button></div>`:''}${active&&!current.action?muted('Fim deste percurso. Use Reiniciar para comparar novamente.'):''}${['home','messages','tags','tagsFiltered'].includes(layer.screen)?tabs(layer.screen==='messages'?1:layer.screen.startsWith('tags')?2:0,side):''}</section>`;
  }).join('')}</div><div class="home-indicator"></div></div><div class="stack" aria-label="Estrutura de camadas">${layers.map((l,i)=>`${i?'<i>›</i>':''}<span>${esc(titles[l.screen])}</span>`).join('')}</div><p class="state-note">${esc(current[side+'Note'])}</p>`;
}
function renderNav(){
  document.querySelector('#count').textContent=inventory.length;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');});
  let group='';nav.innerHTML=view==='simulacao'?scenarios.map(s=>{let header='';if(group!==s.group){group=s.group;header=`<p class="scenario-group">${esc(group)}</p>`;}return `${header}<button data-scenario="${s.id}" class="scenario-link ${scenario.id===s.id?'active':''}" ${scenario.id===s.id?'aria-current="true"':''}><span class="dot ${s.status}"></span>${esc(s.title)}</button>`;}).join(''):'';
}
function intro(label,heading,description,badge=''){return `<div class="intro"><div><span class="label">${label}</span><h1>${heading}</h1><p>${description}</p></div>${badge?`<span class="pill">${badge}</span>`:''}</div>`;}
function renderSimulation(){
  main.innerHTML=intro('ANÁLISE DE NAVEGAÇÃO','O contexto também faz parte da tela.','Compare o comportamento derivado do código com uma proposta de hierarquia. Clique nas ações dos celulares ou avance pelas etapas.',`${scenarios.length} percursos · ${inventory.length} interações`)+`<div class="section-line"></div><div class="flow-head"><div><h2>${esc(scenario.title)} <span class="status ${scenario.status}">${statusLabel[scenario.status]}</span></h2><p>${esc(scenario.subtitle)}</p></div><div class="controls"><button class="control" data-action="reset">↺ Reiniciar</button><button class="control" data-action="prev" ${index===0?'disabled':''} aria-label="Etapa anterior">←</button><button class="control primary" data-action="next" ${index===scenario.steps.length-1?'disabled':''}>Avançar →</button></div></div><div class="steps" aria-label="Etapas do percurso">${scenario.steps.map((s,i)=>`<button class="step ${i===index?'active':''}" data-step="${i}" ${i===index?'aria-current="step"':''}><span>${i+1}</span>${esc(s.label)}</button>`).join('')}</div><div class="comparison"><article class="comparison-panel"><div class="panel-title"><h3>01 / Como é hoje</h3><span>Estrutura do código atual</span></div>${phone('before')}</article><article class="comparison-panel"><div class="panel-title"><h3>02 / Como ficaria</h3><span>Proposta para discussão</span></div>${phone('after')}</article></div><p class="hint">Ações sincronizadas para comparar a mesma etapa. Camadas abaixo ficam inativas. Wireframe esquemático: alturas ilustrativas, sem reproduzir gestos ou teclado nativo.</p><div class="finding"><div><b>O QUE ENCONTREI</b><p>${esc(scenario.problem)}</p></div><div><b>PROPOSTA PARA ESTE FLUXO</b><p>${esc(scenario.proposal)}</p></div></div><div class="evidence">Evidência: <code>${esc(scenario.evidence)}</code><br>Base da decisão: ${scenario.refs.map(id=>{const ref=refs.find(r=>r.id===id);return `<a href="${ref.url}" target="_blank" rel="noreferrer">${esc(ref.title)} ↗</a>`;}).join(' · ')}<br>Análise estática do app móvel; hipóteses de comportamento nativo precisam de validação em aparelho. <a href="AUDIT.md" target="_blank">Abrir relatório completo</a>.</div>`;
}
function renderInventory(){
  main.innerHTML=intro('MAPA COMPLETO DO APP MÓVEL',`${inventory.length} interações, uma hierarquia explícita.`,'Cada linha registra o comportamento atual, a direção proposta e a evidência no código. “Manter” também é uma decisão de design.')+`<div class="table-tools"><input id="search" type="search" aria-label="Buscar interações" placeholder="Buscar fluxo, tela ou arquivo…"><select id="status" aria-label="Filtrar por decisão"><option value="">Todas as decisões</option><option value="corrigir">Corrigir</option><option value="refinar">Refinar</option><option value="manter">Manter</option></select></div><p class="hint" id="result-count" aria-live="polite"></p><div class="table-wrap"><table><thead><tr><th>Interação</th><th>Decisão</th><th>Hoje</th><th>Proposta</th></tr></thead><tbody id="rows"></tbody></table></div><p class="hint">Escopo: navegação, sobreposições e ações da interface móvel. APIs, blockchain e permissões externas são descritas como fronteiras do fluxo; não são executadas pelo protótipo. ProfileMenu.tsx está sem importação no app atual e não foi contado como fluxo ativo.</p>`;
  document.querySelector('#search').addEventListener('input',renderRows);document.querySelector('#status').addEventListener('change',renderRows);renderRows();
}
function renderRows(){
  const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=normalize(document.querySelector('#search').value), filter=document.querySelector('#status').value;
  const rows=inventory.filter(r=>(!filter||r[1]===filter)&&normalize(r.join(' ')).includes(q));
  document.querySelector('#rows').innerHTML=rows.map(r=>`<tr><td><button style="padding:0;text-align:left;text-decoration:underline;text-underline-offset:3px" data-scenario="${r[5]}">${esc(r[0])} ↗</button><small>${esc(r[4])}</small></td><td><span class="status ${r[1]}">${statusLabel[r[1]]}</span></td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma interação corresponde à busca.</td></tr>';
  document.querySelector('#result-count').textContent=`${rows.length} de ${inventory.length} interações`;
}
function renderCriteria(){
  main.innerHTML=intro('CRITÉRIOS E PESQUISA','Escolher a relação antes da apresentação.','Referências primárias na web e no GitHub, consultadas em 19/09/2026. A aplicação ao SeekerTag é uma proposta de design baseada na leitura do código.')+`<div class="principles"><p><b>01 · Mesmo nível.</b> Abas trocam destinos irmãos e preservam o estado de cada um.</p><p><b>02 · Conteúdo mais específico.</b> Páginas entram no histórico: Conta → Categorias, lista → conversa, objeto → informações.</p><p><b>03 · Tarefa contextual.</b> Editar, escolher moeda e confirmar uma ação abrem sobre sua origem. Fechar sai só da tarefa ativa.</p><p><b>04 · Etapas da mesma tarefa.</b> Valor → revisão pode mudar dentro do mesmo painel. Evitar profundidade modal desnecessária.</p><p><b>05 · Contrato de retorno.</b> Teclado, camada ativa e página têm uma ordem explícita. Rascunho, rolagem e foco sobrevivem às consultas.</p></div><div class="ref-grid">${refs.map(r=>`<article class="ref-card"><span class="label">FONTE PRIMÁRIA</span><h2>${esc(r.title)}</h2><p>${esc(r.text)}</p><a href="${r.url}" target="_blank" rel="noreferrer">Consultar referência ↗</a></article>`).join('')}</div><div class="ref-card"><h2>O que este protótipo comprova</h2><p>Mostra a proposta de camadas e retorno, com ações sincronizadas e rascunho editável. Não executa o aplicativo React Native. Desmontagens são constatadas no código; efeitos de gestos, IME, TalkBack e modais nativos ainda exigem teste no Android. Alturas são ilustrativas. Nenhuma alteração foi feita em apps/mobile.</p></div>`;
}
function updateHash(){history.replaceState(null,'',`#${view}${view==='simulacao'?`/${scenario.id}/${index}`:''}`);}
function render(){renderNav();if(view==='inventario')renderInventory();else if(view==='criterios')renderCriteria();else renderSimulation();updateHash();}
function move(next,{focus=false}={}){
  const target=Math.max(0,Math.min(scenario.steps.length-1,next));
  if(scenario.id==='conversa'&&index===0&&target>0)values.before.message='';
  if(scenario.id==='seletores'&&target>=2){values.before.currency='USDC';values.after.currency='USDC';}
  index=target;render();document.querySelector('#announcer').textContent=`${scenario.title}. Etapa ${index+1}: ${scenario.steps[index].label}`;
  if(focus)main.querySelector(`.step[data-step="${index}"]`)?.focus({preventScroll:true});
}
// Voltar no celular segue a tarefa; as setas externas percorrem a comparação.
function flowBack(){
  const routes={editar:{2:3,3:0},categorias:{1:4,2:1,3:4,4:0},'categoria-conta':{2:1,3:4,4:1},recompensa:{1:2,2:0},seletores:{1:2,3:4},revisao:{2:3,3:0},renovar:{1:0,2:1},conversa:{1:2,2:0},notificacao:{1:2,2:0},visitante:{1:2,2:0},encontrou:{2:1,3:2,4:3},devolucao:{1:0,2:1},conta:{1:2,3:4,4:0},abas:{2:1,3:0},nfc:{1:2,3:4},transferir:{1:2,3:4},entrada:{1:0,3:2,4:3}};
  move(routes[scenario.id]?.[index]??index-1,{focus:true});
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.view){view=button.dataset.view;render();return;}
  if(button.dataset.scenario){scenario=scenarios.find(s=>s.id===button.dataset.scenario);index=scenario.start;view='simulacao';resetValues();render();return;}
  if(button.dataset.step!==undefined){move(Number(button.dataset.step),{focus:true});return;}
  if(button.dataset.action==='next')move(index+1,{focus:true});
  if(button.dataset.action==='prev')move(index-1,{focus:true});
  if(button.dataset.action==='back')flowBack();
  if(button.dataset.action==='reset'){resetValues();move(0,{focus:true});}
});
document.addEventListener('input',event=>{
  const el=event.target,key=el.dataset.field,side=el.dataset.side;if(!key||!side)return;
  values[side][key]=el.value;
  const other=side==='before'?'after':'before';
  // Inputs begin synchronized. Once the current chat remounts, drafts differ.
  if(scenario.id!=='conversa'||index===0||key!=='message'){
    values[other][key]=el.value;
    main.querySelectorAll(`[data-field="${key}"][data-side="${other}"]`).forEach(input=>{input.value=el.value;});
  }
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&view==='simulacao'&&index>0){event.preventDefault();flowBack();}
});
function readHash(){const [v,id,n]=location.hash.slice(1).split('/');if(['simulacao','inventario','criterios'].includes(v))view=v;const found=scenarios.find(s=>s.id===id);if(found){scenario=found;index=Number.isInteger(Number(n))?Math.max(0,Math.min(found.steps.length-1,Number(n))):found.start;}resetValues();if(scenario.id==='conversa'&&index>0)values.before.message='';if(scenario.id==='seletores'&&index>=2){values.before.currency='USDC';values.after.currency='USDC';}}
window.addEventListener('hashchange',()=>{readHash();render();});
readHash();render();
