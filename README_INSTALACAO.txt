PACOTE FINAL — Sistema Financeiro Distrital

1. Para o Vercel/GitHub:
   Coloque na raiz do repositório estes ficheiros:
   - index.html
   - style.css
   - app.js
   - config.js
   - manifest.json
   - sw.js
   - vercel.json
   - icon-152.png
   - icon-192.png
   - icon-512.png

2. Para o Google Apps Script:
   Os ficheiros do backend estão na pasta apps_script/.
   Copie os ficheiros .gs e appsscript.json para o projecto Apps Script.

3. Sobre o erro "APP_CONFIG is not defined":
   Ocorre quando o config.js não está na mesma pasta do index.html ou não foi carregado antes do app.js.
   Nesta versão, o config.js foi reforçado com:
   var APP_CONFIG = window.APP_CONFIG = {...};

4. Depois de actualizar no Vercel:
   - Faça redeploy.
   - Abra o site em janela anónima ou limpe a cache.
   - Se já instalou como app/PWA, remova e instale novamente para evitar cache antiga.

5. Terminologia:
   O frontend passa a mostrar Entrada/Saída.
   O backend mantém compatibilidade com dados antigos marcados como RECEITA/DESPESA.


ACTUALIZAÇÃO: o dashboard agora mostra Entradas Submetidas, Saídas Submetidas e Saldo Projectado. O Saldo Aprovado continua a considerar apenas lançamentos aprovados.


VERSAO v3:
- Corrigido o caso em que existem lancamentos SUBMETIDOS, mas a folha APROVACOES nao contem o registo PENDENTE correspondente.
- A funcao Approval_listPending() agora repara automaticamente essas pendencias antigas antes de listar.
- Tambem considera decisoes vazias como pendentes, para compatibilidade com dados antigos.
