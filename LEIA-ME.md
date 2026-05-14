# Sistema Financeiro Distrital — versão reconstruída

Esta versão foi reconstruída a partir dos ficheiros enviados na conversa.

## Alterações principais

1. `Lancamento.gs` foi reconstruído para gravar lançamentos por nome da coluna, não por posição fixa.
2. O botão **Submeter para Aprovação** passa a chamar `Lancamento_createAndSubmit`, evitando o erro de criar o lançamento e depois falhar na submissão.
3. O sistema passa a usar **ENTRADA** e **SAIDA** internamente, mas continua a reconhecer dados antigos com `RECEITA` e `DESPESA`.
4. `Approvals.gs` cria automaticamente aprovações pendentes quando encontra lançamentos `SUBMETIDO` sem registo na folha `APROVACOES`.
5. Foram removidos ficheiros/funções duplicadas que podiam causar comportamento imprevisível no Apps Script.
6. Foram adicionados `sw.js` e `vercel.json`.
7. `config.js` foi reforçado para expor `APP_CONFIG` no escopo global do navegador.

## Estrutura

- Ficheiros da raiz: frontend para Vercel/GitHub.
- Pasta `apps_script`: ficheiros a copiar para o projecto Google Apps Script.

## Instalação

1. No Google Apps Script, substitua os ficheiros pelo conteúdo da pasta `apps_script`.
2. Guarde tudo.
3. Faça `Deploy > Manage deployments > Edit > Version > New version > Deploy`.
4. No Vercel/GitHub, substitua os ficheiros da raiz.
5. Confirme se `config.js` aponta para o URL `/exec` do novo deployment do Apps Script.

## Teste obrigatório

1. Entrar como Tesoureiro Local.
2. Criar lançamento do tipo Entrada ou Saída.
3. Clicar em **Submeter para Aprovação**.
4. Entrar como Tesoureiro Distrital.
5. Abrir **Aprovações** e confirmar que o lançamento aparece pendente.
