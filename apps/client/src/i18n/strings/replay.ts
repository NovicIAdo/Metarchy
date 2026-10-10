import type { Strings } from '../types.js'

/** The replay gallery + the step-through replay viewer. */
export const replay: Strings = {
  'replay.title': { en: 'Past Games', ru: 'Прошедшие игры' },
  'replay.subtitle': {
    en: 'Recorded ranked games — step through any of them move by move.',
    ru: 'Записи рейтинговых игр — можно прокрутить любую пошагово.'
  },
  'replay.refresh': { en: 'Refresh', ru: 'Обновить' },
  'replay.loading': { en: 'Loading games…', ru: 'Загрузка игр…' },
  'replay.none': { en: 'No recorded games yet.', ru: 'Записей пока нет.' },
  'replay.watch': { en: 'Replay', ru: 'Смотреть' },
  'replay.vs': { en: 'vs', ru: 'против' },
  'replay.truncated': {
    en: 'Playback stops here: this game was played under earlier rules, and the current engine no longer accepts the rest of its moves.',
    ru: 'Дальше воспроизвести нельзя: этот бой игрался по прежним правилам, и нынешний движок не принимает остальные ходы.'
  },
  'replay.won': { en: 'won', ru: 'победа' },
  'replay.turns': { en: '{n} turns', ru: 'ходов: {n}' },
  'replay.more': { en: 'Show more ({shown} of {total})', ru: 'Показать ещё ({shown} из {total})' },
  'replay.starredOnly': { en: 'Starred', ru: 'Избранные' },
  'replay.star': { en: 'Add to favorites', ru: 'В избранное' },
  'replay.unstar': { en: 'Remove from favorites', ru: 'Убрать из избранного' },
  'replay.noneStarred': {
    en: 'No starred games yet — tap ☆ on a game to keep it here.',
    ru: 'Избранных пока нет — нажмите ☆ на игре, чтобы закрепить её здесь.'
  },

  'replay.building': { en: 'Reconstructing the game…', ru: 'Восстанавливаем игру…' },
  'replay.notFound': { en: 'This replay is unavailable.', ru: 'Эта запись недоступна.' },
  'replay.back': { en: 'Back to games', ru: 'К списку игр' },
  'replay.prev': { en: '‹ Prev', ru: '‹ Назад' },
  'replay.next': { en: 'Next ›', ru: 'Дальше ›' },
  'replay.play': { en: 'Play', ru: 'Играть' },
  'replay.pause': { en: 'Pause', ru: 'Пауза' },
  'replay.speed': { en: 'Speed {n}×', ru: 'Скорость {n}×' },
  'replay.step': { en: 'Step {n} / {total}', ru: 'Шаг {n} / {total}' },
  'replay.record': { en: 'Record', ru: 'Запись' },
  'replay.copy': { en: 'Copy record', ru: 'Копировать запись' },
  'replay.copied': { en: 'Copied', ru: 'Скопировано' },

  // --- The three panels beside the board -----------------------------------------
  'replay.tab.story': { en: 'Story', ru: 'Хроника' },
  'replay.tab.economy': { en: 'Economy', ru: 'Экономика' },
  'replay.turn': { en: 'Turn {n}', ru: 'Ход {n}' },
  'replay.turnTie': { en: 'Turn {n} · tie-breaker', ru: 'Ход {n} · переигровка' },
  'replay.feed.empty': {
    en: 'Nothing was recorded for this game.',
    ru: 'Для этой игры ничего не записано.'
  },
  'replay.feed.jump': {
    en: 'Show this moment on the board',
    ru: 'Показать этот момент на поле'
  },

  // --- The per-turn story: events, cards, conflicts, market ----------------------
  // Only real words live here; names, numbers and separators are composed in code
  // (screens/replay/ReplayFeed.tsx) out of the shared domain labels.
  'replay.log.compare': { en: 'Compared {metric}: {list}', ru: 'Сравнение {metric}: {list}' },
  'replay.log.totalValues': { en: 'total Values', ru: 'суммы Ценностей' },
  'replay.log.discards': {
    en: 'Secret discard · {res}: {list}',
    ru: 'Тайный сброс · {res}: {list}'
  },
  'replay.log.eventWinner': {
    en: '{who} takes the Event: +{n} {fame}',
    ru: '{who} забирает Событие: +{n} {fame}'
  },
  'replay.log.eventCardWon': {
    en: '{who} discarded the most and draws {card}',
    ru: '{who} сбросил больше всех и берёт карту: {card}'
  },
  'replay.log.eventWonNoCard': {
    en: '{who} discarded the most — but the Action deck is empty',
    ru: '{who} сбросил больше всех — но колода действий пуста'
  },
  'replay.log.tiebreak': {
    en: 'Tie-break · round {n}: {list}',
    ru: 'Переигровка · раунд {n}: {list}'
  },
  'replay.log.tiebreakWon': {
    en: '{who} wins the tie-break',
    ru: 'Переигровку выигрывает {who}'
  },
  'replay.log.betOn': { en: 'bet: {bet}', ru: 'ставка: {bet}' },
  'replay.log.cards': { en: '{who} plays: {list}', ru: '{who} играет: {list}' },
  'replay.log.blocked': {
    en: '{who} · {card} — {loc} is closed for the turn',
    ru: '{who} · {card} — {loc} закрыта на этот Ход'
  },
  'replay.log.collision': {
    en: 'Two orders on the same {actor} — {who} wins the tie-break',
    ru: 'Два приказа на одного {actor} — переигровку выигрывает {who}'
  },
  'replay.log.collisionNone': {
    en: 'Two orders on the same {actor} — nobody moved it',
    ru: 'Два приказа на одного {actor} — его никто не сдвинул'
  },
  'replay.log.exchanged': {
    en: '{who} · {card} — gives {give}, takes {take} from {whom}',
    ru: '{who} · {card} — отдаёт {give}, берёт {take} у {whom}'
  },
  'replay.log.conflict': { en: 'Conflict {n} · {where}', ru: 'Конфликт {n} · {where}' },
  'replay.log.result': { en: 'Resolution', ru: 'Разрешение' },
  'replay.log.bets': { en: 'Bets', ru: 'Ставки' },
  'replay.log.betPlayed': { en: '{who} — {bet} bet played', ru: '{who} — ставка ({bet}) сыграла' },
  'replay.log.betFailed': {
    en: '{who} — {bet} bet failed',
    ru: '{who} — ставка ({bet}) провалена'
  },
  'replay.log.peaceful': { en: 'Unopposed', ru: 'Без соперников' },
  'replay.log.closed': {
    en: '{loc} is closed — {list} return with nothing',
    ru: '{loc} закрыта — {list} возвращаются ни с чем'
  },
  'replay.log.deadlock': {
    en: 'Politician deadlock — nobody takes the Location',
    ru: 'Тупик Политиков — Локацию не забирает никто'
  },
  'replay.log.bought': { en: '{who} — bought {n}: {list}', ru: '{who} — куплено {n}: {list}' },
  'replay.log.boughtShort': {
    en: '{who} — ordered {requested}, got {n} (deck empty): {list}',
    ru: '{who} — заказано {requested}, получено {n} (колода пуста): {list}'
  },
  'replay.log.outDisconnect': {
    en: '{who} dropped out — {n} VP at that moment',
    ru: '{who} выбывает из-за разрыва связи — {n} ПО на тот момент'
  },
  'replay.log.outForfeit': {
    en: '{who} left the game — {n} VP at that moment',
    ru: '{who} покидает игру — {n} ПО на тот момент'
  },
  'replay.log.outScoring': {
    en: '{who} is knocked out at scoring — {n} VP',
    ru: '{who} выбывает по подсчёту очков — {n} ПО'
  },
  'replay.log.scoring': { en: 'Victory points: {list}', ru: 'Победные очки: {list}' },
  'replay.log.finished': { en: 'Game over — {who} wins', ru: 'Игра окончена — победа: {who}' },
  'replay.log.finishedDraw': { en: 'Game over — a draw', ru: 'Игра окончена — ничья' },

  // --- Economy over time ---------------------------------------------------------
  'replay.eco.hint': {
    en: 'Totals after every turn, with the change from the turn before — bets, purchases and rewards are the reasons.',
    ru: 'Итоги после каждого хода и изменение к предыдущему — причины: ставки, покупки и награды.'
  },
  'replay.eco.start': { en: 'Opening position', ru: 'Начальная позиция' },
  'replay.eco.turnEnd': { en: 'After turn {n}', ru: 'После хода {n}' },
  'replay.eco.bets': { en: 'bets: {list}', ru: 'ставки: {list}' },
  'replay.eco.bought': { en: 'bought {n}', ru: 'куплено карт: {n}' },
  'replay.eco.discarded': { en: 'discarded {n} {res}', ru: 'сброшено {n} {res}' },
  'replay.eco.drew': { en: 'drew {list}', ru: 'взято: {list}' },
  'replay.eco.gained': { en: 'won {list}', ru: 'получено: {list}' },
  'replay.eco.out': { en: 'out of the game', ru: 'выбыл из игры' },
  'replay.eco.noChange': { en: 'nothing changed', ru: 'без изменений' }
}
