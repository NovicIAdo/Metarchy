import type { Strings } from '../types.js'

// P4 conflict arena + sidebar chrome. RU canon (docs/metarchy-rules.ru.md):
// Конфликт, Разрешение конфликта, Ставка сыграла/провалена, тупик Политиков,
// переигровка. Shared words (You/Seat/Get It!/Waiting…) live in ./game.ts.
export const conflict: Strings = {
  // End-of-Phase-4 recap (author request): the turn's whole outcome on one screen.
  'summary.header': { en: 'Turn {n} · end of Phase 4', ru: 'Ход {n} · конец Фазы 4' },
  'summary.title': { en: 'How the turn resolved', ru: 'Чем закончился ход' },
  'summary.noConflicts': { en: 'No conflicts this turn', ru: 'Конфликтов в этом ходу не было' },
  'summary.conflicts': { en: 'Conflicts', ru: 'Конфликты' },
  'summary.unopposed': { en: 'Stood alone', ru: 'Стояли одни' },
  'summary.gained': { en: '+{n} {unit}', ru: '+{n} {unit}' },
  'summary.nothing': { en: 'nothing', ru: 'ничего' },
  'summary.winBet': { en: 'Win bet paid +1', ru: 'ставка на победу дала +1' },
  'summary.empty': {
    en: 'Nobody was on the board this turn.',
    ru: 'В этом ходу на поле никого не было.'
  },
  'summary.waiting': { en: 'Waiting for {n} more…', ru: 'Ждём ещё: {n}…' },
  'summary.watching': { en: 'The players are reading the summary…', ru: 'Игроки читают итоги…' },

  // The market beat: how the Action-Card market closed, said out loud for
  // players and watchers (author: nobody should have to guess who stocked up).
  'market.summary.title': { en: 'Market closed', ru: 'Рынок закрыт' },
  'market.summary.bought.one': { en: '{name} bought {n} card', ru: '{name} купил(а) {n} карту' },
  'market.summary.bought.few': { en: '{name} bought {n} cards', ru: '{name} купил(а) {n} карты' },
  'market.summary.bought.many': { en: '{name} bought {n} cards', ru: '{name} купил(а) {n} карт' },
  'market.summary.none': { en: '{name} bought no cards', ru: '{name} не купил(а) карт' },
  'market.summary.allPassed': {
    en: 'Nobody bought an Action Card.',
    ru: 'Никто не купил карту действия.'
  },

  'game.conflict.nothing': { en: 'nothing', ru: 'ничего' },
  'game.conflict.returnsNothing': {
    en: 'returns with nothing',
    ru: 'возвращается ни с чем'
  },
  'game.conflict.counter': { en: 'Conflict {n}/{total}', ru: 'Конфликт {n}/{total}' },
  'game.conflict.actorsAt': { en: '{actor}s at {loc}', ru: '{actor} · {loc}' },
  'game.conflict.sealed': { en: 'Arguments are sealed.', ru: 'Аргументы скрыты.' },
  'game.conflict.reveal': { en: 'Reveal Conflict', ru: 'Открыть конфликт' },
  'game.conflict.deadlock': {
    en: 'Politician deadlock — player tie-break · round {n}',
    ru: 'Тупик Политиков — переигровка игроков · раунд {n}'
  },
  // No "fight" anywhere in the conflict chrome (author rule): this is a bright
  // future, arguments are what clash, so the conflict is *resolved again*.
  'game.conflict.refight': {
    en: 'Resolving again · round {n}',
    ru: 'Разрешаем заново · раунд {n}'
  },
  'game.conflict.refightReview': {
    en: 'This round is unresolved — review it, then resolve the conflict again.',
    ru: 'Раунд не выявил победителя — посмотрите итог и разрешите конфликт заново.'
  },
  'game.conflict.refightAgain': {
    en: 'Resolve Conflict Again',
    ru: 'Продолжить разрешение конфликта'
  },
  'game.conflict.bet': { en: 'bet', ru: 'ставка' },
  'game.conflict.spectator': {
    en: 'Conflict {n}/{total} — {actor}s at {loc}…',
    ru: 'Конфликт {n}/{total} — {actor} · {loc}…'
  },

  // Bet-story lines (why the outcome shifted). Nominal "(names)" form keeps the
  // Russian genderless for both "Вы" and a nickname.
  'game.conflict.drawFiresOne': {
    en: '{names} called the draw — the Draw bet fires: the called draw becomes a win, the rest of the draw group is denied.',
    ru: 'Ставка на Ничью ({names}) сыграла: заявленная ничья становится Победой, остальные из группы ничьей лишаются награды.'
  },
  'game.conflict.drawFiresMany': {
    en: '{names} all called the draw — the Draw bets fire: they resolve the conflict again for the converted win, everyone else is denied.',
    ru: 'Ставки на Ничью ({names}) сыграли: они разрешают конфликт заново за обращённую Победу, остальные лишаются награды.'
  },
  'game.conflict.loseFires': {
    en: '{names} called the loss — the Lose bet fires: round-one rewards are void and the conflict is resolved again.',
    ru: 'Ставка на Поражение ({names}) сыграла: награды первого раунда обнуляются, Конфликт разрешается заново.'
  },

  // ConflictSidebar
  'game.conflict.yours': { en: 'Your conflicts', ru: 'Ваши конфликты' },
  'game.conflict.sideConflict': { en: '{actor}s · {loc}', ru: '{actor} · {loc}' },
  'game.conflict.sidePeaceful': {
    en: '{actor} unopposed · {reward}',
    ru: '{actor} без соперников · {reward}'
  },
  'game.conflict.sideBlocked': { en: '{actor} · {loc} blocked', ru: '{actor} · {loc} закрыта' }
}
