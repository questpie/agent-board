# Tutorial pre Jozka: ako pracovat s Agent Board autopilotom

Tento dokument vysvetluje, ako pouzivat `agent-board` ako riadiacu vrstvu pre autopilot pracu s coding agentmi. Nie je to dalsi chat ani todo list bokom. Agent Board je lokalny zdroj pravdy pre ciele, rozhodnutia, tasky, flow behy a dokaz, ze praca bola overena.

## 1. Mentalny model

Predstav si tri vrstvy:

- Chat je riadenie. Tu clovek povie, co chce dosiahnut, a controller agent vysvetli dalsi krok.
- Agent Board je pamat. Tu ostavaju ciele, specs, tasky, blokery, knowledge, flow vystupy a verify evidencia.
- Git repo je pracovisko. Tu sa realne citaju subory, robia zmeny, spustaju testy a pripravuju commity.

Autopilot znamena, ze clovek nemusi rucne pisat kazdy CLI prikaz. Clovek zada ciel prirodzenym jazykom a controller agent pouzije `agent-board` na planovanie, delegovanie a kontrolu. Dolezite je, ze stav prace nezostava iba v chate.

Zakladne pojmy:

- `project` je board pre konkretny repozitar.
- `goal` je aktivny kus prace, napriklad `billing-redesign` alebo `review-hardening`.
- `spec` je trvale rozhodnutie alebo plan: preco sa vec robi, ake su tradeoffy a co musi platit.
- `task` je najmensia vykonatelna jednotka prace, ktoru vie worker agent claimnut, spravit, overit a zavriet.
- `knowledge` je znovupouzitelna pamat: konvencie, gotchas, rozhodnutia.
- `flow` je riadena multi-agent vlna: fan-out research, review, synthesis alebo task graph.
- `evidence` je dokaz o praci: progress checkpointy, verify vystupy, flow summary, review findings.

## 2. Kedy Agent Board pouzit

Pouzi Agent Board, ked praca:

- trva dlhsie ako jeden kratky prompt,
- ma viac krokov alebo viac agentov,
- potrebuje rozdelit planning, implementaciu a review,
- ma riziko regresie a musi mat verify gate,
- potrebuje research alebo porovnanie viacerych moznosti,
- bude pokracovat neskor a stav nesmie zmiznut v chate.

Na uplne male jednorazove veci moze stacit priamy agent. Len co sa objavi plan, viacero taskov, blokery alebo paralelna praca, Agent Board zacina davat zmysel.

## 3. Prvy setup

Instalacia:

```sh
bun add -g @questpie/agent-board
agent-board skills install
```

Ak pracujes zo zdrojaku:

```sh
bun install
bun link
agent-board skills install
```

Inicializacia boardu v repozitari:

```sh
agent-board init --project my-project
```

Toto pouzije domaci board v `~/.agent-board`, co je vhodne pre viac repozitarov a worktree. Ak chces board verzovat priamo s repozitarom:

```sh
agent-board init --local --project my-project
```

Rychla kontrola:

```sh
agent-board status
agent-board plan
agent-board web
```

`agent-board web` spusti lokalny read-only prehliadac boardu. Je uzitocny, ked chces vidiet goals, tasks, specs, knowledge, wireframes a flow runs prehladne mimo terminalu.

## 4. Ako rozmyslat o autopilot workflow

Standardny loop vyzera takto:

```txt
intent -> goal -> spec -> task graph -> flow / workers -> verify -> review -> knowledge -> archive
```

Prakticky postup:

1. Najprv zisti aktualny stav:

```sh
agent-board status
agent-board plan
```

2. Ak ide o novy kus prace, vytvor goal:

```sh
agent-board goal new "Improve onboarding" --id improve-onboarding
export AGENT_BOARD_GOAL=improve-onboarding
```

Pre agentov je lepsie pouzivat `AGENT_BOARD_GOAL` alebo `--goal <id>` ako `goal use`, lebo `goal use` meni zdielany aktivny ciel v `project.json`.

3. Zachyt plan ako spec:

```sh
agent-board spec new "Onboarding improvement plan" --scope goal
```

Spec ma vysvetlit rozhodnutia, acceptance criteria, rizika a overovacie pravidla. Ak rozhodnutie zavisi od aktualnych externych faktov, agent ma pouzit aktualne docs alebo repo/runtime discovery a vysledok ulozit do specu alebo knowledge.

4. Rozdel pracu na konkretne tasky:

```sh
agent-board new "Audit current onboarding flow" --status ready --priority high
agent-board new "Add onboarding completion test" --status todo
agent-board new "Implement onboarding copy update" --status todo
```

5. Prepoj zavislosti a spec:

```sh
agent-board link audit-current-onboarding-flow --blocks add-onboarding-completion-test
agent-board link add-onboarding-completion-test --blocks implement-onboarding-copy-update
agent-board link audit-current-onboarding-flow --spec onboarding-improvement-plan
```

6. Deleguj vykonanie workerovi alebo flow vlne.

Controller agent drzi roadmapu. Worker agent ma dostat jeden explicitny task id. Flow agenti mozu robit research, review alebo synthesis, ale nerozhoduju sami, co je finalny roadmap.

## 5. Controller vs worker

Controller je PM/orchestrator:

- cita `agent-board status` a `agent-board plan`,
- vytvara alebo upravuje goals, specs a tasks,
- rozhoduje, kedy treba research, design gate, safe workflow alebo review,
- deleguje konkretne task id workerom,
- cita flow summaries a evidence,
- vytvara follow-up tasky,
- rozhoduje, co ide do dalsej vlny.

Worker je implementator jedneho tasku:

```sh
agent-board show <task-id>
agent-board claim <task-id> --agent jozko-worker
# implementacia
agent-board progress <task-id> "Implemented parser path; adding focused tests" --agent jozko-worker
agent-board verify <task-id>
agent-board done <task-id>
```

Worker nema vymyslat cely roadmap. Ak zisti, ze task je prilis siroky, ma vytvorit mensie linknute tasky alebo zablokovat aktualny task s konkretnym dovodom.

## 6. Flow: ked chces viac agentov naraz

Flow pouzi, ked sa oplati paralelny pohlad:

- research viacerych subsystemov,
- review patchu viacerymi agentmi,
- hladanie rizikov a test gaps,
- tvorba task graphu,
- design gate alebo safe workflow gate.

Najprv zisti, co lokalny stroj vie spustit:

```sh
agent-board flow runtimes
agent-board flow models --runtime codex
```

Vytvor flow zo sablony:

```sh
agent-board flow new onboarding-review --template review
agent-board flow cat onboarding-review
```

Ak treba, controller upravi skript a vysvetli fazy cloveku. Potom spusti vlnu:

```sh
agent-board flow run onboarding-review --input "Review onboarding changes" --task audit-current-onboarding-flow
```

Po dobehnuti citaj najprv:

```sh
agent-board flow show <run-id>
```

V artefaktoch citaj v tomto poradi:

1. `summary.md`
2. `agents/*.md`, iba ked potrebujes detail
3. `diagnostics.jsonl`, iba pri runtime alebo MCP probleme

Pozor: heartbeat znamena, ze agent este zije. Nie je to dokaz, ze review preslo. Dokaz je az text v `summary.md`, `agents/*.md` alebo verify evidencia na tasku.

## 7. Bezpecnostne pravidla

Dodrziavaj tieto pravidla:

- Task sa pred editaciou claimuje cez `agent-board claim`.
- `claim` odmietne detached HEAD, pokial explicitne nepouzijes `--allow-detached`.
- `done` ma prejst az po splnenych acceptance criteria a uspesnom `agent-board verify`.
- Pri dlhsom tasku zapisuj checkpointy cez `agent-board progress`.
- Research a review flow nechaj v read mode, ak nema dovod editovat.
- Pre viac writerov naraz pouzi samostatne git worktrees a `AGENT_BOARD_REPO`.
- V jednom worktree nepustaj viac writerov na tie iste subory.
- Agenti nemaju prepinat branch, commitovat, resetovat ani rebasovat bez jasnej dohody.
- Stare specs, tasky a knowledge radsej archivuj cez `agent-board archive`, nemaz ich rucne.
- Ak je fakt casovo citlivy, over aktualne zdroje a uloz vysledok do specu alebo knowledge.

## 8. Design gate a safe workflow

Pri frontend alebo product praci nerob rovno produkcny kod. Najprv:

```txt
spec -> wireframe/design board -> design review -> implementation tasks
```

Pri user-facing spravani alebo riziku regresii najprv:

```txt
use cases -> scenario matrix -> failing test/replay -> implementation -> full regression
```

To znamena, ze Agent Board nema len sledovat implementaciu. Ma zachytit aj to, ake scenare musia ostat funkcne a cim sa to overi.

## 9. Copy-paste prompty pre Jozka

Novy ciel:

```txt
Pouzi Agent Board ako controller. Najprv skontroluj status, vytvor alebo vyber goal, napis spec s acceptance criteria, rozdel pracu na male tasky, prepoj dependencies a az potom navrhni prvu implementacnu vlnu.
```

Research pred implementaciou:

```txt
Pouzi agent-board-research read-only workflow. Preskumaj repo a aktualne zdroje, najdi rizika, navrhni specs/knowledge/tasky, ale nerob kodove zmeny.
```

Implementacia jedneho tasku:

```txt
Pouzi agent-board-implement. Claimni task <task-id>, precitaj kontext, implementuj iba rozsah tasku, spusti verify, zapis evidence a zatvor task az ked prejdu gates.
```

Review vlna:

```txt
Pouzi agent-board-flow review template. Spusti read-only review pre scope "<scope>", po dobehnuti precitaj summary.md, rozdel findings na blocking/non-blocking a vytvor follow-up tasky.
```

Safe workflow:

```txt
Pouzi agent-board-safe-workflow. Pred implementaciou definuj use-case ids, scenario matrix, stabilne test id/selectors, failing test alebo replay a finalny regression verify block.
```

## 10. Najcastejsie chyby

- Plan ostane iba v chate. Spravne: zapis spec, tasky alebo knowledge.
- Task je prilis siroky. Spravne: rozdel ho na mensie tasky s dependencies.
- Worker nedostal task id. Spravne: worker startuje z konkretneho tasku.
- Flow summary sa necita. Spravne: po kazdej vlne precitaj `summary.md` a aktualizuj board.
- Heartbeat sa berie ako review verdict. Spravne: heartbeat je iba liveness.
- Agenti menia `goal use` pocas paralelnej prace. Spravne: pouzi `AGENT_BOARD_GOAL` alebo `--goal`.
- Done sa da bez verify. Spravne: `agent-board verify` a az potom `agent-board done`.
- Stare veci sa zmazu. Spravne: archivuj ich s dovodom a pripadne `--superseded-by`.

## 11. Minimalny denny postup

Ked Jozo zacina den:

```sh
agent-board status
agent-board plan --related
agent-board web
```

Potom si polozi tri otazky:

1. Je aktualny goal stale spravny?
2. Existuje spec, ktory vysvetluje, preco ideme tymto smerom?
3. Je dalsi task dost maly na claim, implementaciu, verify a done?

Ked odpoved na ktorukolvek otazku nie je jasna, najprv uprav board. Az potom pustaj implementaciu.

## 12. Kratke zhrnutie

Agent Board autopilot je disciplina:

- clovek hovori ciel,
- controller drzi plan a board,
- specs vysvetluju rozhodnutia,
- tasky su male vykonatelne jednotky,
- flow robi paralelny research/review/synthesis,
- worker robi jeden task,
- verify a evidence rozhoduju, ci je hotovo.

Ked sa toho Jozo bude drzat, autopilot prestane byt "agent nieco skusa v chate" a zacne byt riadena praca s pamatou, kontrolou a navratnostou.
