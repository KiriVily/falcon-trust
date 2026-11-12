p='index.html'
src=open(p,encoding='utf-8',newline='').read()
def rep(old,new):
    global src
    assert src.count(old)==1,(old[:60],src.count(old))
    src=src.replace(old,new)

# styles
rep("footer{border-top:1px solid var(--line)",
""".ah{font-size:12.5px;color:var(--mu);letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:24px 0 10px}
.ar{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;justify-content:space-between;padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:var(--card)}.ar+.ar{margin-top:10px}
.ar>div{min-width:0;flex:1 1 200px}.ar b{display:block;overflow-wrap:anywhere}.ar small{display:block;color:var(--mu);font-size:13px;overflow-wrap:anywhere}.ar .row{gap:8px;align-items:center}
.btn.sm{min-height:42px;padding:8px 14px;font-size:14px}.ad .ar input{width:130px;flex:1 1 130px;min-height:42px;padding:8px 12px}
footer{border-top:1px solid var(--line)""")

# cabinet: access card
rep('<div class="grid g3" style="margin:22px 0"><div class="card"><small class="mu">До отправки</small>',
    '<div class="card" id="acb" hidden style="margin-top:18px"></div>\n<div class="grid g3" style="margin:22px 0"><div class="card"><small class="mu">До отправки</small>')

# admin panel: tabs + access view
rep('<div class="w adw"><div id="adl"><input id="adq"',
    '<div class="w adw"><div class="tabs" id="adtb" hidden style="margin:18px 0 0" role="group" aria-label="Раздел панели"><button type="button" class="tab on" data-v="o">Заказы</button><button type="button" class="tab" data-v="a">Доступы<span id="adpc"></span></button></div><div id="ada" hidden></div><div id="adl"><input id="adq"')

# photo: a dropped file was shown as added but never sent
rep("const pick=f=>{if(f&&f.type.startsWith('image/')){$('#dt').textContent='Фото добавлено: '+f.name;dz.classList.remove('o')}else toast('Нужен файл-изображение')};",
    "let pf=null;const pick=f=>{dz.classList.remove('o');if(f&&f.type.startsWith('image/')){pf=f;$('#dt').textContent='Фото добавлено: '+f.name}else if(f)toast('Нужен файл-изображение')};")
rep("url:$('#url').value},$('#bt'),fi.files[0]);if(ok){fi.value='';$('#dt').textContent=dt0}};",
    "url:$('#url').value},$('#bt'),pf);if(ok){pf=null;fi.value='';$('#dt').textContent=dt0}};")

# cabinet + panel hooks
rep("$('#cad').hidden=!ME.admin;cbx()}", "$('#cad').hidden=!ME.admin;cbx();renderAcc()}")
rep("function openAd(){try{TG&&TG.expand&&TG.expand()}catch(e){}ad.classList.add('o');document.body.style.overflow='hidden';if(BB)BB.show();showList();loadList()}",
    "function openAd(){try{TG&&TG.expand&&TG.expand()}catch(e){}ad.classList.add('o');document.body.style.overflow='hidden';if(BB)BB.show();showList();loadList();loadAcc()}")
rep("$('#adt').textContent='Заказы';renderList();ad.scrollTop=0}", "$('#adt').textContent='Заказы';renderList();adView();ad.scrollTop=0}")
rep("function openForm(o){AD.cur=o||null;$('#adl').hidden=true;$('#adf').hidden=false;",
    "function openForm(o){AD.cur=o||null;$('#adl').hidden=true;$('#adtb').hidden=true;$('#ada').hidden=true;$('#adf').hidden=false;")

new_js = r"""// ===== доступ к кабинету клиента: пользователь просит, сотрудник подтверждает (проверка — на сервере)
const hasAcc=()=>!!(ME&&Array.isArray(ME.access));
const dg=v=>String(v||'').replace(/[\s№#]/g,'');
let accForm=false;
function renderAcc(){const b=$('#acb');if(!hasAcc()){b.hidden=true;return}b.hidden=false;
if(ME.blocked){b.innerHTML='<h3>Доступ к кабинету ограничен</h3><p class="mu">Чтобы разобраться, напишите менеджеру.</p>';return}
const A=ME.access,act=A.filter(a=>a.status=='active'),pen=A.filter(a=>a.status=='pending'),rej=A.filter(a=>a.status=='rejected');
const nm=a=>a.client?'№ '+H(a.client):'без номера';
const form=`<form id="acf" novalidate style="margin-top:14px"><div class="f2"><div><label for="ac_n">Номер клиента</label><input id="ac_n" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="Например: 916"></div><div><label for="ac_m">Комментарий (необязательно)</label><input id="ac_m" maxlength="300" autocomplete="off" placeholder="Имя или название компании"></div></div><button class="btn p">Запросить доступ</button><p class="mu" style="font-size:13px;margin-top:12px">Не знаете номер — оставьте поле пустым, менеджер уточнит. Одного номера для входа недостаточно: доступ открывает сотрудник после проверки.</p></form>`;
let h='';
if(act.length)h+=`<h3>${act.length>1?'Ваши кабинеты':'Кабинет клиента'}: ${act.map(nm).join(', ')}</h3><p class="mu">Доступ подтверждён сотрудником. Грузы, выкупы и финансы по кабинету появятся здесь, когда эти разделы будут подключены.</p>`;
else if(!pen.length)h+='<h3>Подключите кабинет клиента</h3><p class="mu">Укажите ваш номер клиента Falcon Trust — сотрудник проверит и откроет доступ.</p>';
pen.forEach(a=>h+=`<p class="note" style="margin-top:${h?12:0}px">Запрос на доступ к кабинету ${nm(a)} отправлен. Ждём подтверждения сотрудника — сообщим в Telegram.</p>`);
rej.forEach(a=>h+=`<p class="note" style="margin-top:12px">Запрос по кабинету ${nm(a)} отклонён. Если это ошибка — напишите менеджеру.</p>`);
if(!act.length&&!pen.length||accForm)h+=form;else if(pen.length<3)h+='<button type="button" class="btn sm" id="acm" style="margin-top:14px">Подключить ещё один кабинет</button>';
b.innerHTML=h}
$('#acb').addEventListener('click',e=>{if(e.target.id=='acm'){accForm=true;renderAcc();$('#ac_n').focus()}});
$('#acb').addEventListener('submit',async e=>{e.preventDefault();const c=dg($('#ac_n').value),b=e.target.querySelector('button');if(b.disabled)return;
if(c&&!/^\d{1,8}$/.test(c)){$('#ac_n').classList.add('bad');$('#ac_n').focus();hap('error');return toast('Номер клиента — только цифры')}
b.disabled=true;b.textContent='Отправляем…';
try{const j=await apiP('access_req',{client:c,note:$('#ac_m').value});ME.access=j.access||[];accForm=false;renderAcc();toast('Запрос отправлен. Сотрудник подтвердит доступ',4000);hap('success')}
catch(err){toast(err.message,4500);hap('error');b.disabled=false;b.textContent='Запросить доступ'}});
// ===== панель администратора: доступы (кто какой кабинет видит, блокировка, администраторы)
AD.v='o';const AC={access:[],admins:[],blocked:[],owner:false};
function adView(){const a=AD.v=='a';$('#adtb').hidden=!hasAcc();$$('#adtb .tab').forEach(t=>{const on=t.dataset.v==AD.v;t.classList.toggle('on',on);t.setAttribute('aria-pressed',on)});$('#adl').hidden=a;$('#ada').hidden=!a;$('#adn').hidden=a;$('#adt').textContent=a?'Доступы':'Заказы'}
$('#adtb').onclick=e=>{const t=e.target.closest('.tab');if(!t)return;AD.v=t.dataset.v;adView();if(AD.v=='a')loadAcc();hsel();ad.scrollTop=0};
const who=r=>H([r.name||'Без имени',r.username?'@'+r.username:'','ID '+r.tg_id].filter(Boolean).join(' · '));
async function loadAcc(){if(!hasAcc())return;try{Object.assign(AC,await apiP('acc_list'));renderAcl()}catch(e){$('#ada').innerHTML=`<div class="emp" style="margin-top:18px">${H(e.message)}</div>`}}
function renderAcl(){const P=AC.access.filter(a=>a.status=='pending'),A=AC.access.filter(a=>a.status=='active');
$('#adpc').textContent=P.length?' · '+P.length:'';
const bt=(t,a,d='',c='')=>`<button type="button" class="btn sm ${c}" data-a="${a}" ${d}>${t}</button>`;
const row=(m,s,x)=>`<div class="ar"><div><b>${m}</b><small>${s}</small></div><span class="row">${x}</span></div>`;
const hint=t=>`<p class="mu" style="font-size:13px;margin-top:8px">${t}</p>`;
let h='<h4 class="ah">Ждут подтверждения</h4>'+(P.length?P.map(a=>row(who(a),H(fdt(a.created))+(a.note?' · '+H(a.note):''),`<input data-c="${a.id}" value="${H(a.client)}" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="№ клиента" aria-label="Номер клиента">${bt('Подтвердить','ok',`data-id="${a.id}"`,'p')}${bt('Отклонить','no',`data-id="${a.id}"`)}`)).join('')+hint('Подтверждайте, только если уверены, что это ваш клиент: после этого он увидит данные кабинета с этим номером.'):'<div class="emp">Новых запросов нет</div>');
h+='<h4 class="ah">Подключённые кабинеты</h4>'+(A.length?A.map(a=>row('№ '+H(a.client),who(a)+(a.blocked?' · заблокирован':''),bt('Отключить','del',`data-id="${a.id}"`)+(a.blocked?'':bt('Заблокировать','blk',`data-u="${H(a.tg_id)}"`)))).join(''):'<div class="emp">Пока никого</div>');
h+='<h4 class="ah">Привязать по Telegram ID</h4><div class="ar"><span class="row" style="flex:1"><input id="ac_u" inputmode="numeric" maxlength="16" autocomplete="off" placeholder="Telegram ID" aria-label="Telegram ID"><input id="ac_c" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="№ клиента" aria-label="Номер клиента">'+bt('Привязать','add','','p')+'</span></div>'+hint('ID есть в заявке клиента (строка «ID …»).');
if(AC.blocked.length)h+='<h4 class="ah">Заблокированные</h4>'+AC.blocked.map(u=>row(who(u),'Не видит кабинет',bt('Разблокировать','unb',`data-u="${H(u.tg_id)}"`))).join('');
if(AC.owner)h+='<h4 class="ah">Администраторы</h4>'+AC.admins.map(u=>row(who(u),'Видит панель администратора',bt('Убрать','radm',`data-u="${H(u.tg_id)}"`))).join('')+'<div class="ar"><span class="row" style="flex:1"><input id="ac_a" inputmode="numeric" maxlength="16" autocomplete="off" placeholder="Telegram ID" aria-label="Telegram ID нового администратора">'+bt('Сделать администратором','adm')+'</span></div>'+hint('Администратор видит эту панель: заказы и доступы. Назначать и убирать администраторов можете только вы как владелец.');
$('#ada').innerHTML=h}
$('#ada').onclick=async e=>{const b=e.target.closest('[data-a]');if(!b||b.disabled)return;const a=b.dataset.a,id=+b.dataset.id,u=b.dataset.u;let act,x,q;
const bad=t=>{hap('error');toast(t)};
if(a=='ok'){const c=dg($(`#ada [data-c="${id}"]`).value);if(!/^\d{1,8}$/.test(c))return bad('Укажите номер клиента — только цифры');act='acc_set';x={id,status:'active',client:c}}
else if(a=='no'){act='acc_set';x={id,status:'rejected'};q='Отклонить запрос?'}
else if(a=='del'){act='acc_del';x={id};q='Отключить этот кабинет у пользователя?'}
else if(a=='blk'||a=='unb'){act='user_block';x={tg_id:u,blocked:a=='blk'};if(a=='blk')q='Заблокировать пользователя? Он перестанет видеть кабинет.'}
else if(a=='add'){const t=dg($('#ac_u').value),c=dg($('#ac_c').value);if(!/^\d{1,16}$/.test(t)||!/^\d{1,8}$/.test(c))return bad('Укажите Telegram ID и номер клиента — только цифры');act='acc_add';x={tg_id:t,client:c}}
else if(a=='adm'||a=='radm'){const t=a=='adm'?dg($('#ac_a').value):u;if(!/^\d{1,16}$/.test(t))return bad('Telegram ID — только цифры');act='user_role';x={tg_id:t,admin:a=='adm'};if(a=='radm')q='Убрать администратора?'}
else return;
if(q&&!(await ask(q)))return;b.disabled=true;
try{const j=await apiP(act,x);const nf=j.notified===false;toast(nf?'Готово. Сообщить пользователю не удалось — он ещё не запускал бота':'Готово',nf?5500:2600);hap('success');await loadAcc();loadMe()}
catch(err){toast(err.message,4500);hap('error');b.disabled=false}};
</script></body></html>"""
assert src.rstrip().endswith('</script></body></html>')
i=src.rindex('</script></body></html>')
src=src[:i]+new_js+src[i+len('</script></body></html>'):]
open(p,'w',encoding='utf-8',newline='').write(src)
print('patched',len(src))
