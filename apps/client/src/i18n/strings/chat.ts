import type { Strings } from '../types.js'

/**
 * The persisted chat screen: the global room, private messages, threads,
 * reactions and flags. Nothing here is in-game table talk — that one lives in
 * game.ts.
 */
export const chat: Strings = {
  'chat.title': { en: 'Chat', ru: 'Чат' },
  'chat.subtitle': {
    en: 'The global room is read by every player. Be civil — ten flags and a message is gone.',
    ru: 'Общую комнату читают все игроки. Без хамства — десять жалоб, и сообщение исчезнет.'
  },
  'chat.tab.global': { en: 'Global', ru: 'Общий' },
  'chat.tab.direct': { en: 'Private', ru: 'Личные' },

  // --- Sorting (top-level messages only; a thread stays chronological) ------------
  'chat.sort.new': { en: 'Newest', ru: 'Новые' },
  'chat.sort.likes': { en: 'Most liked', ru: 'Больше лайков' },
  'chat.sort.dislikes': { en: 'Most disliked', ru: 'Больше дизлайков' },

  // --- Composing -----------------------------------------------------------------
  'chat.placeholder': { en: 'Say something…', ru: 'Напишите что-нибудь…' },
  'chat.replyPlaceholder': { en: 'Reply to {who}…', ru: 'Ответить {who}…' },
  'chat.send': { en: 'Send', ru: 'Отправить' },
  'chat.counter': { en: '{n}/{max}', ru: '{n}/{max}' },
  'chat.cooldown': { en: 'One message per minute — {n}s', ru: 'Одно сообщение в минуту — {n} с' },
  'chat.rateLimited': {
    en: 'The global chat takes one message per minute from each player.',
    ru: 'Общий чат принимает по одному сообщению в минуту от каждого игрока.'
  },

  // --- A message -----------------------------------------------------------------
  'chat.like': { en: 'Like', ru: 'Нравится' },
  'chat.dislike': { en: 'Dislike', ru: 'Не нравится' },
  'chat.flag': { en: 'Report', ru: 'Пожаловаться' },
  'chat.flagged': { en: 'Reported', ru: 'Жалоба отправлена' },
  'chat.flagHint': {
    en: 'Ten reports from ten different players remove a message.',
    ru: 'Десять жалоб от десяти разных игроков удаляют сообщение.'
  },
  'chat.reply': { en: 'Reply', ru: 'Ответить' },
  'chat.replies': { en: '{n} replies', ru: 'ответов: {n}' },
  'chat.hideReplies': { en: 'Hide replies', ru: 'Скрыть ответы' },
  'chat.removed': {
    en: 'Removed after ten reports.',
    ru: 'Удалено после десяти жалоб.'
  },
  'chat.cancel': { en: 'Cancel', ru: 'Отмена' },

  // --- Lists ---------------------------------------------------------------------
  'chat.loading': { en: 'Loading messages…', ru: 'Загрузка сообщений…' },
  'chat.empty': {
    en: 'Nothing here yet — write the first message.',
    ru: 'Здесь пока пусто — напишите первое сообщение.'
  },
  'chat.more': { en: 'Show more ({shown} of {total})', ru: 'Показать ещё ({shown} из {total})' },
  'chat.refresh': { en: 'Refresh', ru: 'Обновить' },

  // --- Private messages ----------------------------------------------------------
  'chat.dm.title': { en: 'Private messages', ru: 'Личные сообщения' },
  'chat.dm.none': {
    en: 'No conversations yet. Find a player by their username to start one.',
    ru: 'Переписок пока нет. Найдите игрока по имени, чтобы начать.'
  },
  'chat.dm.search': { en: 'Username', ru: 'Имя игрока' },
  'chat.dm.find': { en: 'Find', ru: 'Найти' },
  'chat.dm.notFound': { en: 'No player with that username.', ru: 'Игрока с таким именем нет.' },
  'chat.dm.write': { en: 'Write to {who}', ru: 'Написать {who}' },
  'chat.dm.you': { en: 'You:', ru: 'Вы:' },
  'chat.dm.back': { en: 'All conversations', ru: 'Все переписки' },
  'chat.dm.removedLast': { en: '(message removed)', ru: '(сообщение удалено)' },
  'chat.dm.block': { en: 'Close conversation', ru: 'Закрыть переписку' },
  'chat.dm.unblock': { en: 'Reopen conversation', ru: 'Открыть переписку' },
  'chat.dm.blocked': {
    en: 'Conversation closed. They can no longer write to you.',
    ru: 'Переписка закрыта. Они больше не могут вам писать.'
  },
  'chat.dm.blockedYou': {
    en: 'This player closed the conversation.',
    ru: 'Этот игрок закрыл переписку.'
  }
}
