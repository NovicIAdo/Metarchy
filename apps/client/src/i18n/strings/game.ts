import type { Strings } from '../types.js'

// In-game panel chrome: everything the live board's DOM panels render that
// isn't a domain noun (those come from ../domain.ts via useDomain()). RU is the
// rulebook canon from docs/metarchy-rules.ru.md — Ход/Фаза/Ставка/Ничья/etc.
//
// Log-style lines that name a player ({who}) avoid gendered/person-inflected
// Russian verbs by using a nominal "·"/parenthetical form, so one template
// reads naturally for both "Вы" and a third-party nickname.
export const game: Strings = {
  // Shared across panels
  'game.you': { en: 'You', ru: 'Вы' },
  'game.youLower': { en: 'you', ru: 'вы' },
  'game.seat': { en: 'Seat {n}', ru: 'Игрок {n}' },
  'game.seatLower': { en: 'seat {n}', ru: 'игрок {n}' },
  'game.waitingOthers': { en: 'Waiting for others…', ru: 'Ждём остальных…' },
  'game.getIt': { en: 'Get It!', ru: 'Понятно!' },
  'game.done': { en: 'Done', ru: 'Готово' },
  'game.confirm': { en: 'Confirm', ru: 'Подтвердить' },
  'game.vs': { en: 'vs', ru: 'против' },

  // Ordinals (feminine, agreeing with "карта"): "the {ord} Relocation card".
  'game.ordinal.1': { en: 'first', ru: 'первой' },
  'game.ordinal.2': { en: 'second', ru: 'второй' },
  'game.ordinal.3': { en: 'third', ru: 'третьей' },
  'game.ordinal.4': { en: 'fourth', ru: 'четвёртой' },
  'game.ordinal.n': { en: '{n}th', ru: '{n}-й' },

  // ActiveGame — commit bar, waiting, forfeit, reconnect
  'game.commitHint': {
    en: '{n}/4 placed · tap a staged token to edit',
    ru: '{n}/4 размещено · нажмите на фишку, чтобы изменить'
  },
  'game.commitPlacements': { en: 'Commit placements', ru: 'Подтвердить размещение' },
  'game.placementsSealed': {
    en: 'Placements sealed — waiting for others…',
    ru: 'Размещение зафиксировано — ждём остальных…'
  },
  // The Phase 2 reveal beat (author: "надо чтобы после расстановки своих акторов
  // показывало как оппоненты расставили своих").
  'game.reveal.title': { en: 'Everyone has placed', ru: 'Все расставили' },
  'game.reveal.body': {
    en: 'Here is where every Actor stands. Arguments and Bets stay sealed until the Conflicts.',
    ru: 'Вот где стоят все Деятели. Аргументы и Ставки останутся закрыты до Конфликтов.'
  },
  'game.reveal.waiting': { en: 'Waiting for {names}…', ru: 'Ждём: {names}…' },
  'game.syncing': { en: 'Syncing game state…', ru: 'Синхронизация состояния игры…' },
  'game.leaveGame': { en: 'Leave game', ru: 'Покинуть игру' },
  'game.youAreOut': { en: 'You are out of this game', ru: 'Вы вышли из этой игры' },
  'game.youLost': { en: 'You lost', ru: 'Вы проиграли' },
  'game.youAreOutWatch': {
    en: 'Your Actors have left the board. You can watch the rest.',
    ru: 'Ваши Деятели покинули поле. Вы можете смотреть до конца.'
  },
  'game.forfeit': { en: 'Forfeit', ru: 'Сдаться' },
  'game.forfeitConfirm.title': { en: 'Forfeit the game?', ru: 'Сдаться?' },
  'game.forfeitConfirm.body': {
    en: 'You leave the game immediately and your Actors leave the board. There is no way back into this match.',
    ru: 'Вы сразу выходите из игры, а ваши Деятели покидают поле. Вернуться в этот матч будет нельзя.'
  },
  'game.forfeitConfirm.rated': {
    en: 'This match counts: it goes on the record as a loss and costs rating.',
    ru: 'Этот матч зачётный: он пойдёт в статистику как поражение и снизит рейтинг.'
  },
  'game.forfeitConfirm.keep': { en: 'Keep playing', ru: 'Продолжить игру' },
  'game.reconnecting': { en: 'Reconnecting…', ru: 'Переподключение…' },
  'game.reconnectSafe': {
    en: 'The game is safe on the server — hang tight.',
    ru: 'Игра сохранена на сервере — подождите.'
  },

  // ActorDock
  'game.ready': { en: '{n} ready', ru: 'готово: {n}' },

  // AllyPanel (2v2 team transparency) + ally chips in the event modal
  'game.ally.label': { en: 'Ally', ru: 'Союзник' },
  'game.ally.hand': { en: 'Ally cards · {n}', ru: 'Карты союзника · {n}' },
  'game.ally.bet': { en: 'Bet', ru: 'Ставка' },
  'game.ally.eliminated': { en: 'eliminated', ru: 'выбыл(а)' },
  'game.ally.discardPlanning': { en: 'plans to discard {n}', ru: 'планирует скинуть {n}' },
  'game.ally.discardSealed': { en: 'sealed: discards {n}', ru: 'запечатано: скинет {n}' },

  // ActorChooser — placement the other way round: tap a Location, pick who goes
  'game.chooser.title': { en: 'Who goes to {loc}?', ru: 'Кто идёт: {loc}?' },

  // ArgBetPicker (radial argument/bet menu)
  'game.picker.chooseArg': { en: 'Choose the argument', ru: 'Выберите аргумент' },
  'game.picker.placeBet': { en: 'Place a bet · or skip', ru: 'Сделайте ставку · или пропустите' },
  'game.picker.skip': { en: 'Skip', ru: 'Пропустить' },
  'game.picker.noBet': { en: 'No bet', ru: 'Без ставки' },
  'game.picker.betCost': { en: 'Bet {bet} — costs 1 {res}', ru: 'Ставка {bet} — стоит 1 {res}' },
  'game.picker.betNoRes': {
    en: 'Bet {bet} — no {res} left',
    ru: 'Ставка {bet} — не хватает ресурса: {res}'
  },

  // ActionPhasePanel (P3)
  'game.action.blockedThisTurn': { en: 'Blocked this turn', ru: 'Закрыто на этот ход' },
  'game.action.cardsLocked': {
    en: 'Cards locked in ({done}/{total}) — waiting for others…',
    ru: 'Карты зафиксированы ({done}/{total}) — ждём остальных…'
  },
  'game.action.selectCards': {
    en: 'Select Action Cards to play this turn',
    ru: 'Выберите Карты действий для этого хода'
  },
  'game.action.noCardsHand': { en: 'No Action Cards in hand.', ru: 'Нет Карт действий на руке.' },
  'game.action.commitCardsOne': {
    en: 'Commit {n} Action Card',
    ru: 'Разыграть 1 Карту действий'
  },
  'game.action.commitCardsMany': {
    en: 'Commit {n} Action Cards',
    ru: 'Разыграть Карты действий ({n})'
  },
  'game.action.playNoCards': { en: 'Play No Cards', ru: 'Не разыгрывать карты' },
  'game.action.waitingRelocations': {
    en: 'Waiting for relocations…',
    ru: 'Ждём релокаций…'
  },
  'game.action.relocateMulti': {
    en: 'Move an Actor with the {ord} {card} card ({n}/{total})',
    ru: 'Переместите Деятеля {ord} картой «{card}» ({n}/{total})'
  },
  'game.action.relocateSingle': {
    en: '{card} · {left} of {total} left',
    ru: '{card} · осталось {left} из {total}'
  },
  'game.action.relocateStaged': {
    en: '{actor} ({owner}): {from} → {to}. Tap elsewhere to change your mind.',
    ru: '{actor} ({owner}): {from} → {to}. Нажмите в другом месте, чтобы передумать.'
  },
  'game.action.relocateMoving': {
    en: 'Moving {actor} ({owner}) from {from} — tap a glowing location.',
    ru: 'Перемещаем {actor} ({owner}) с локации {from} — нажмите на подсвеченную локацию.'
  },
  'game.action.relocateHint': {
    en: "Tap any actor on the board (yours or an opponent's), then its new location.",
    ru: 'Нажмите на любого Деятеля на столе (своего или чужого), затем на его новую локацию.'
  },
  'game.action.relocateHintNone': {
    en: "Tap any actor on the board (yours or an opponent's — none movable), then its new location.",
    ru: 'Нажмите на любого Деятеля на столе (своего или чужого — нет доступных), затем на его новую локацию.'
  },
  'game.action.relocConflict': { en: 'Relocation conflict', ru: 'Конфликт релокации' },
  'game.action.relocForActor': {
    en: '{list} for actor {id}',
    ru: '{list} за Деятеля {id}'
  },
  'game.action.tieRound': {
    en: 'Round {round}: {list}. Tie, go again.',
    ru: 'Раунд {round}: {list}. Ничья, ещё раз.'
  },
  'game.action.waitingResolution': {
    en: 'Waiting for the resolution…',
    ru: 'Ждём результата…'
  },
  'game.action.waitingExchangeWho': {
    en: "Waiting for {who}'s value exchange…",
    ru: 'Ждём обмен ценностями: {who}…'
  },
  'game.action.waitingExchange': {
    en: 'Waiting for the value exchange…',
    ru: 'Ждём обмен ценностями…'
  },
  'game.action.exchWhichPre': {
    en: 'What is the effect of the',
    ru: 'Каким будет эффект'
  },
  'game.action.exchWhichPost': { en: '{card} card?', ru: 'карты «{card}»?' },
  'game.action.giveYours': { en: 'Give one of yours', ru: 'Отдайте одну свою' },
  'game.action.takeFrom': { en: 'Take from', ru: 'Забрать у' },
  'game.action.theirValue': { en: 'Their value to take', ru: 'Ценность соперника' },
  'game.action.changeValues': { en: 'Change Values', ru: 'Сменить Ценности' },

  // Tie-break rounds (shared phrasing)
  'game.tiebreakRound': { en: 'Tie-break · round {n}', ru: 'Переигровка · раунд {n}' },

  // TieBreakerAnnounce — VP tie at game end → an extra deciding turn
  'game.tiebreak.title': { en: 'It’s a tie!', ru: 'Ничья!' },
  'game.tiebreak.body': {
    en: 'These players hold the highest equal Victory Points — the game plays one more turn to decide the winner.',
    ru: 'У этих игроков наибольшее равное число Победных баллов — игра идёт ещё один ход, чтобы определить победителя.'
  },
  'game.tiebreak.continue': { en: 'Play the deciding turn', ru: 'Играть решающий ход' },

  // ActionResultsModal (P3 result ceremonies)
  'game.results.header': { en: 'Action cards · results', ru: 'Карты действий · итоги' },
  'game.results.titleBlocked': { en: 'Locations blocked', ru: 'Локации закрыты' },
  'game.results.titleReloc': { en: 'Relocations', ru: 'Релокации' },
  'game.results.titleExch': { en: 'Values exchanged', ru: 'Обмен ценностями' },
  'game.results.blockedPre': { en: '{who} played {card} —', ru: '{who} · {card} —' },
  'game.results.blockedPost': {
    en: 'will not work this turn.',
    ru: 'не работает в этот ход.'
  },
  'game.results.relocNone': {
    en: 'Every relocation order cancelled out — nothing moved.',
    ru: 'Все приказы о релокации отменили друг друга — ничего не сдвинулось.'
  },
  'game.results.relocPre': {
    en: '{who} played {card}, moved {actor} ({owner}):',
    ru: '{who} · {card} — {actor} ({owner}):'
  },
  'game.results.exchPre': {
    en: '{who} played {card}: gave',
    ru: '{who} · {card}. Отдано:'
  },
  'game.results.exchMid': { en: 'to {to} and took', ru: 'игроку {to}, получено:' },
  'game.results.exchPost': { en: '.', ru: '.' },

  // ChatPanel (2v2)
  'game.chat.team': { en: 'Team chat', ru: 'Командный чат' },
  'game.chat.close': { en: 'Close chat', ru: 'Закрыть чат' },
  'game.chat.onlyTeammate': {
    en: 'Only your teammate sees these messages.',
    ru: 'Эти сообщения видит только ваш союзник.'
  },
  'game.chat.placeholder': { en: 'Message your teammate…', ru: 'Напишите союзнику…' },
  'game.chat.send': { en: 'Send', ru: 'Отправить' },

  // EventModal / EventTieArena (P1)
  'game.event.headCompare': { en: 'Event · comparison', ru: 'Событие · сравнение' },
  'game.event.headDiscard': { en: 'Event · secret discard', ru: 'Событие · тайный сброс' },
  'game.event.noReward': { en: 'Nobody takes the reward.', ru: 'Награду не получает никто.' },
  'game.event.youTieWin': {
    en: 'You take the tie-break — +1 {fame}!',
    ru: 'Вы выигрываете переигровку — +1 {fame}!'
  },
  'game.event.othersTieWin': {
    en: '{names} takes the tie-break — +1 {fame}.',
    ru: '{names} выигрывает переигровку — +1 {fame}.'
  },
  'game.event.leastYouWin': {
    en: 'Least amount — you win +1 {fame}!',
    ru: 'Наименьшее значение — вы получаете +1 {fame}!'
  },
  'game.event.othersWin': {
    en: '{names} wins +1 {fame}.',
    ru: '{names} получает +1 {fame}.'
  },
  'game.event.standoff': {
    en: 'Lowest amount is a tie between {names} — the winner will be decided by a conflict resolution.',
    ru: 'Наименьшее значение — ничья между {names}; победитель определится в Разрешении конфликта.'
  },
  'game.event.resolveConflict': { en: 'Resolve the Conflict', ru: 'Разрешить конфликт' },
  'game.event.discardedRow': { en: '{who} discarded', ru: '{who} — сброшено' },
  'game.event.discardedInline': { en: '{who} discarded {n}', ru: '{who} — сброшено {n}' },
  'game.event.tieBetween': {
    en: 'Tie between {names} · round {n}',
    ru: 'Ничья между {names} · раунд {n}'
  },
  'game.event.resourceOnHand': { en: '{res} on hand', ru: '{res} на руках' },
  'game.event.discardSealed': {
    en: 'Your discard is sealed. Waiting for others…',
    ru: 'Ваш сброс зафиксирован. Ждём остальных…'
  },
  // Watchers see progress, never the amounts — those open on the reveal.
  'game.event.sealedCount': {
    en: '{n} of {total} have sealed their discard — amounts open when everyone has.',
    ru: 'Сброс зафиксировали {n} из {total} — суммы откроются, когда закончат все.'
  },
  'game.event.discardNoWinner': {
    en: 'No winner — nobody discarded the most.',
    ru: 'Победителя нет — никто не сбросил больше всех.'
  },
  'game.event.youDiscardMostCard': {
    en: 'You discarded the most and draw an Action Card!',
    ru: 'Вы сбросили больше всех и берёте Карту действий!'
  },
  'game.event.youDiscardMostEmpty': {
    en: 'You discarded the most and win — but the deck is empty.',
    ru: 'Вы сбросили больше всех — но колода пуста.'
  },
  'game.event.otherDiscardMostCard': {
    en: '{who} discarded the most and draws an Action Card.',
    ru: '{who} сбросил больше всех и берёт Карту действий.'
  },
  'game.event.otherDiscardMostEmpty': {
    en: '{who} discarded the most and wins — but the deck is empty.',
    ru: '{who} сбросил больше всех — но колода пуста.'
  },
  'game.event.tieResolved': {
    en: 'Event tie-break · resolved',
    ru: 'Переигровка события · решено'
  },
  'game.event.tieRoundN': {
    en: 'Event tie-break · round {n}',
    ru: 'Переигровка события · раунд {n}'
  },
  'game.event.tieAgain': {
    en: 'Round {n} — {list}. Tie, go again!',
    ru: 'Раунд {n} — {list}. Ничья, ещё раз!'
  },
  'game.event.rpsWinnerEvent': {
    en: 'Rock · Paper · Scissors — the winner takes the event.',
    ru: 'Камень · Ножницы · Бумага — победитель забирает событие.'
  },
  'game.event.throwSealed': {
    en: 'Your throw is sealed. Waiting for others…',
    ru: 'Ваш ход зафиксирован. Ждём остальных…'
  },
  'game.event.thrownCount': {
    en: '{n} of {total} have thrown — the coins turn over once everyone has.',
    ru: 'Бросили {n} из {total} — монеты откроются, когда бросят все.'
  },

  // GlobalStats
  'game.stats.title': { en: 'Global Stats', ru: 'Общая статистика' },
  'game.stats.closeStats': { en: 'Close stats', ru: 'Закрыть статистику' },
  'game.stats.players': { en: 'Players', ru: 'Игроки' },
  'game.stats.you': { en: '(you)', ru: '(вы)' },
  'game.stats.ally': { en: '(ally)', ru: '(союзник)' },
  'game.stats.cardsInHand': { en: 'Cards in hand', ru: 'Карты на руке' },
  'game.stats.cards': { en: 'Cards', ru: 'Карты' },
  'game.stats.teamPools': {
    en: 'Values are team pools in 2v2.',
    ru: 'В 2×2 Ценности общие для команды.'
  },
  'game.stats.yourHand': { en: 'Your hand ({n})', ru: 'Ваша рука ({n})' },
  'game.stats.tapEffect': { en: "Tap for the card's effect", ru: 'Нажмите, чтобы увидеть эффект' },
  'game.stats.tapCard': {
    en: 'Tap a card to see what it does.',
    ru: 'Нажмите на карту, чтобы узнать, что она делает.'
  },
  'game.stats.decks': { en: 'Decks', ru: 'Колоды' },
  'game.stats.eventsLeft': { en: 'Events left', ru: 'Осталось событий' },
  'game.stats.events': { en: 'Events', ru: 'События' },
  'game.stats.actionsLeft': { en: 'Action Cards left', ru: 'Осталось Карт действий' },
  'game.stats.actions': { en: 'Actions', ru: 'Действия' },
  'game.stats.eventsPlayed': { en: 'Events played', ru: 'Сыгранные события' },
  'game.stats.noEvents': { en: 'No events resolved yet.', ru: 'Событий пока не было.' },
  'game.stats.actionsPlayed': { en: 'Action Cards played', ru: 'Сыгранные Карты действий' },
  'game.stats.nothingPlayed': { en: 'Nothing played yet.', ru: 'Пока ничего не разыграно.' },
  'game.stats.turnShort': { en: 'T{n}', ru: 'Х{n}' },

  // HudPanels (top bar + hand strip)
  'game.hud.tiebreaker': { en: 'Tie-breaker', ru: 'Переигровка' },
  'game.hud.turnOf': { en: 'Turn {n}/{max}', ru: 'Ход {n}/{max}' },
  'game.hud.syncing': { en: 'Syncing…', ru: 'Синхронизация…' },
  'game.hud.globalStats': { en: 'Global stats', ru: 'Общая статистика' },
  'game.hud.stats': { en: 'Stats', ru: 'Статистика' },
  'game.hud.eventsLeftDeck': { en: 'Events left in deck', ru: 'Событий в колоде' },
  'game.hud.eventDeck': { en: 'Event deck', ru: 'Колода событий' },
  'game.hud.actionsLeftDeck': { en: 'Action Cards left in deck', ru: 'Карт действий в колоде' },
  'game.hud.actionDeck': { en: 'Action deck', ru: 'Колода действий' },
  'game.hud.handTip': {
    en: 'Your hand — tap for Global Stats',
    ru: 'Ваша рука — нажмите для общей статистики'
  },

  // MarketPanel (P5)
  'game.market.closed': {
    en: 'Market closed — waiting for others…',
    ru: 'Рынок закрыт — ждём остальных…'
  },
  'game.market.head': {
    en: 'Market · {n} cards left in the deck',
    ru: 'Рынок · в колоде осталось {n} карт'
  },
  'game.market.oneCard': { en: '1 Action Card =', ru: '1 Карта действий =' },
  'game.market.staged': { en: 'Staged buys: {n} ·', ru: 'Заказано: {n} ·' },
  'game.market.afford': { en: 'you can afford {n} more', ru: 'можете купить ещё {n}' },
  'game.market.buy': { en: 'Buy', ru: 'Купить' },
  'game.market.dealt': {
    en: 'Cards are dealt when the market closes.',
    ru: 'Карты раздаются, когда рынок закрывается.'
  },

  // PhaseSplash
  'game.splash.tiebreaker': { en: 'Tie-breaker · Phase {n}', ru: 'Переигровка · Фаза {n}' },
  'game.splash.turnPhase': { en: 'Turn {n} Phase {m}', ru: 'Ход {n} Фаза {m}' },
  'game.splash.tag.p1_event': { en: 'The event', ru: 'Событие' },
  'game.splash.tag.p2_distribution': {
    en: 'Distribute actors by location',
    ru: 'Расставьте Деятелей по локациям'
  },
  'game.splash.tag.p3_action': { en: 'Action cards', ru: 'Карты действий' },
  'game.splash.tag.p4_conflict': { en: 'The conflict', ru: 'Конфликт' },
  'game.splash.tag.p5_market': { en: 'The market', ru: 'Рынок' }
}
