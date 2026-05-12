# Relatório de análise — Sistema Financeiro Distrital

## Alteração aplicada

A terminologia visível ao utilizador foi alterada de **Receita/Receitas** para **Entrada/Entradas** e de **Despesa/Despesas** para **Saída/Saídas**.

No backend, foi introduzida normalização para aceitar simultaneamente os valores antigos e novos:

- `RECEITA` e `ENTRADA` contam como `ENTRADA`;
- `DESPESA`, `SAIDA` e `SAÍDA` contam como `SAIDA`.

Isto evita quebrar dados antigos já existentes na folha `LANCAMENTOS`.

## Ficheiros alterados

- `app.js`
- `Utils.gs`
- `Lancamento.gs`
- `Dashboard.gs`
- `Dashboard_resumoRubricas.gs`
- `Reports.gs`
- `Orcamentos.gs`
- `PopularDados.gs`
- `FixData.gs`
- `Setup.gs`
- `Server_call.gs`
- `Approvals.gs`
- `SaldosIniciais.gs`

## Problemas identificados

### 1. Conflito de funções duplicadas

Foram encontradas funções com o mesmo nome em ficheiros diferentes. Isto é perigoso em Google Apps Script porque todos os ficheiros são executados no mesmo namespace global.

Duplicações relevantes:

- `doPost` em `Api.gs` e `doPost.gs`;
- `doGet` em `Api.gs`, `Code.gs` e `doPost.gs`;
- `User_list`, `User_create`, `User_getFormOptions`, `User_toggleActive`, `User_updateLastLogin` em `Users.gs` e `Admin.gs`;
- `Dashboard_resumoRubricas` em `Dashboard.gs` e `Dashboard_resumoRubricas.gs`;
- `Lancamento_listAll` em `Lancamento.gs` e `Server_call.gs`;
- `Auth_requireActor` e `Auth_getActorSafe` em `Utils.gs` e `Auth.gs`;
- `Sheet_get` em `Config.gs` e `Utils.gs`.

Recomendação: manter apenas uma versão oficial de cada função ou renomear funções auxiliares para evitar sobrescrita silenciosa.

### 2. Frontend chamava funções de saldos iniciais que não estavam mapeadas no dispatcher

O frontend chamava:

- `SaldoInicial_listDeptos`
- `SaldoInicial_listRubricas`
- `SaldoInicial_set`
- `SaldoInicial_setRubrica`

Mas `Server_call.gs` só mapeava:

- `SaldoInicial_getFormOptions`
- `SaldoInicial_listAll`
- `SaldoInicial_saveBulk`
- `SaldoInicial_delete`

Foram adicionados wrappers de compatibilidade em `SaldosIniciais.gs` e o mapeamento correspondente em `Server_call.gs`.

### 3. `SaldoInicial_delete` estava mapeada mas não existia

`Server_call.gs` chamava `SaldoInicial_delete`, mas a função não existia em `SaldosIniciais.gs`. Foi adicionada uma versão de eliminação lógica, que marca `activo = false`.

### 4. Referência inválida a `SHEETS.FECHOS_MES`

`Server_call.gs` usava `SHEETS.FECHOS_MES`, mas em `Config.gs` existe `SHEETS.FECHOS`. Foi corrigido para `SHEETS.FECHOS`.

### 5. PWA incompleto

`index.html` tenta registar `/sw.js`, mas o ficheiro `sw.js` não estava entre os ficheiros carregados. Sem esse ficheiro, a instalação PWA/offline não fica completa.

`manifest.json` também referencia ícones dentro da pasta `icons/`, mas só foram carregados ícones na raiz (`icon-152.png`, `icon-192.png`, `icon-512.png`).

### 6. Ficheiros com nomes problemáticos

Foram recebidos ficheiros com nomes irregulares:

- `Admin,gs`
- `Setup-gs`

Na versão corrigida foram renomeados para:

- `Admin.gs`
- `Setup.gs`

### 7. Segurança e permissões

O Web App está configurado como `ANYONE_ANONYMOUS`, o que é aceitável se todo o acesso for protegido por token. Contudo, deve-se garantir que todas as funções chamadas via `Server_call` validam permissões específicas, especialmente funções administrativas e de alteração de dados.

### 8. Passwords

As palavras-passe são guardadas como SHA-256 simples. Funciona, mas não é o ideal para segurança forte. O recomendado seria usar salt por utilizador e um mecanismo mais resistente a ataques de força bruta. Em Apps Script, pelo menos deve ser usado salt individual gravado na folha de utilizadores.

### 9. Validação de anexos

O frontend valida limite de 10MB antes de enviar anexos, mas o backend também deve validar tamanho/tipo de ficheiro, porque validações no frontend podem ser contornadas.

### 10. Compatibilidade com dados antigos

A alteração para `ENTRADA` e `SAIDA` foi feita de forma compatível: dados antigos com `RECEITA` e `DESPESA` continuam a ser lidos correctamente nos dashboards e relatórios.

## Recomendação de implementação

1. Fazer backup do projecto Apps Script e da planilha.
2. Substituir primeiro `Utils.gs`, `Lancamento.gs`, `Dashboard.gs`, `Server_call.gs`, `SaldosIniciais.gs` e `app.js`.
3. Verificar se os dashboards continuam a contar dados antigos.
4. Criar novo lançamento e confirmar se o campo `tipo_movimento` passa a gravar `ENTRADA` ou `SAIDA`.
5. Depois, limpar duplicações de funções para estabilizar o projecto.
